import { describe, expect, it, vi } from 'vitest';

import { compileWand } from '@/combat/wands/compiler';
import { WandSystem } from '@/combat/wands/WandSystem';
import { TRIGGERED } from '@/combat/wands/projectileMarks';
import { createDefaultWandLightSettings, createGameParams } from '@/config/params';
import { EventBus } from '@/core/events';
import type { CardId, CastAction, Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { canOpenWandBench } from '@/ui/WandBench';

/**
 * The cast compiler is a PURE function of the slot list, so every rule that
 * matters — left-to-right modifier attachment, multicast grouping, the x4
 * damage clamp, the 6-actions-per-group spill, the depth-1 trigger fold,
 * and group mana accounting — is pinned here.
 */
describe('compileWand', () => {
  it('compiles an empty or projectile-less wand to []', () => {
    expect(compileWand([])).toEqual([]);
    expect(compileWand([null, null, null])).toEqual([]);
    // Mods and multicasts with nothing to fire produce no program.
    expect(compileWand(['speed', 'double', null])).toEqual([]);
  });

  it('attaches a modifier to the next projectile: [speed, spark]', () => {
    const program = compileWand(['speed', 'spark']);
    expect(program).toHaveLength(1);
    expect(program[0].actions).toHaveLength(1);
    expect(program[0].actions[0].card).toBe('spark');
    expect(program[0].actions[0].speedMul).toBeCloseTo(1.6);
    // speed (4) + spark (10)
    expect(program[0].manaCost).toBe(14);
  });

  it('does not leak consumed modifiers onto later projectiles', () => {
    const program = compileWand(['speed', 'spark', 'spark']);
    expect(program).toHaveLength(2);
    expect(program[0].actions[0].speedMul).toBeCloseTo(1.6);
    expect(program[1].actions[0].speedMul).toBe(1);
  });

  it('groups the next 2 projectiles under a double: [double, spark, spark]', () => {
    const program = compileWand(['double', 'spark', 'spark']);
    expect(program).toHaveLength(1);
    expect(program[0].actions).toHaveLength(2);
    expect(program[0].actions.map((a) => a.card)).toEqual(['spark', 'spark']);
    // double (6) + spark (10) + spark (10)
    expect(program[0].manaCost).toBe(26);
  });

  it('ships a partial multicast when the deck runs dry: [double, spark]', () => {
    const program = compileWand(['double', 'spark']);
    expect(program).toHaveLength(1);
    expect(program[0].actions).toHaveLength(1);
    expect(program[0].manaCost).toBe(16);
  });

  it('clamps the total damage multiplier at x4: [heavy, heavy, heavy, spark]', () => {
    const program = compileWand(['heavy', 'heavy', 'heavy', 'spark']);
    expect(program).toHaveLength(1);
    const a = program[0].actions[0];
    // 1.7^3 = 4.913 -> clamped to 4; velocity penalty is NOT clamped.
    expect(a.dmgMul).toBe(4);
    expect(a.speedMul).toBeCloseTo(0.75 ** 3);
  });

  it('spills past 6 projectiles per group into the next group', () => {
    const cards: CardId[] = ['triple', 'triple', 'triple',
      'spark', 'spark', 'spark', 'spark', 'spark', 'spark', 'spark', 'spark', 'spark'];
    const program = compileWand(cards);
    expect(program).toHaveLength(2);
    expect(program[0].actions).toHaveLength(6);
    expect(program[1].actions).toHaveLength(3);
    // Multicast mana lands on the group it opened: 3x triple + 6x spark.
    expect(program[0].manaCost).toBe(36 + 60);
    expect(program[1].manaCost).toBe(30);
  });

  it('folds the following group into a trigger payload: [trigger, spark, bomb]', () => {
    const program = compileWand(['trigger', 'spark', 'bomb']);
    // The bomb is consumed as the payload — NOT a separate program step.
    expect(program).toHaveLength(1);
    const spark = program[0].actions[0];
    expect(spark.card).toBe('spark');
    expect(spark.triggered).not.toBeNull();
    expect(spark.triggered).toHaveLength(1);
    expect(spark.triggered![0].card).toBe('bomb');
    // trigger (8) + spark (10) + payload bomb (24), paid up front.
    expect(program[0].manaCost).toBe(42);
  });

  it('carries the payload projectile its OWN mods', () => {
    const program = compileWand(['trigger', 'spark', 'heavy', 'bomb']);
    expect(program).toHaveLength(1);
    const payload = program[0].actions[0].triggered!;
    expect(payload[0].card).toBe('bomb');
    expect(payload[0].dmgMul).toBeCloseTo(1.7);
    expect(program[0].actions[0].dmgMul).toBe(1); // host spark untouched
  });

  it('ignores triggers inside a triggered payload (depth-1 clamp)', () => {
    const program = compileWand(['trigger', 'spark', 'trigger', 'bomb', 'spark']);
    expect(program).toHaveLength(2);
    const host = program[0].actions[0];
    expect(host.triggered![0].card).toBe('bomb');
    // The payload bomb's own trigger is a dud: it must NOT capture the
    // trailing spark, which stays a normal program group.
    expect(host.triggered![0].triggered).toBeNull();
    expect(program[1].actions[0].card).toBe('spark');
    expect(program[1].actions[0].triggered).toBeNull();
  });

  it('leaves a trigger with no following group as a dud (triggered: null)', () => {
    const program = compileWand(['trigger', 'spark']);
    expect(program).toHaveLength(1);
    expect(program[0].actions[0].triggered).toBeNull();
  });

  it('compiles [flame] alone to a single one-action group', () => {
    const program = compileWand(['flame']);
    expect(program).toHaveLength(1);
    expect(program[0].actions[0]).toEqual({
      card: 'flame',
      speedMul: 1,
      dmgMul: 1,
      spreadAdd: 0,
      infused: false,
      bounces: 0,
      triggered: null,
    });
    expect(program[0].manaCost).toBe(2);
  });

  it('skips null slots entirely (slot indices still point at the real slots)', () => {
    const sparse = compileWand([null, 'speed', null, 'spark', null]);
    const dense = compileWand(['speed', 'spark']);
    // identical PROGRAM (slots differ by design: the HUD cursor must point
    // at the cards' true positions in the wand, gaps included)
    const stripSlots = (gs: typeof sparse) => gs.map(({ slots: _slots, ...g }) => g);
    expect(stripSlots(sparse)).toEqual(stripSlots(dense));
    expect(sparse[0].slots).toEqual([1, 3]);
    expect(dense[0].slots).toEqual([0, 1]);
  });

  it('marks spread/infuser/bounce on the action it modifies', () => {
    const program = compileWand(['spread', 'spread', 'infuser', 'bounce', 'spark']);
    const a = program[0].actions[0];
    expect(a.spreadAdd).toBeCloseTo(0.36);
    expect(a.infused).toBe(true);
    expect(a.bounces).toBe(2);
    // spread (3) x2 + infuser (6) + bounce (5) + spark (10)
    expect(program[0].manaCost).toBe(27);
  });
});

describe('wand light defaults', () => {
  it('preserves the shipped player wand light look', () => {
    expect(createDefaultWandLightSettings()).toEqual({
      intensity: 4.6,
      radius: 112,
      r: 1.0,
      g: 0.84,
      b: 0.6,
      flicker: 0.24,
      fillR: 0.5,
      fillG: 0.45,
      fillB: 0.36,
      torchIntensity: 5.6,
      torchRadius: 152,
      torchMinFlicker: 1.05,
    });
  });
});

describe('WandSystem runtime snapshots', () => {
  it('restores private playtest progression flags with the visible loadout', () => {
    const events = new EventBus();
    const ctx = {
      events,
      telemetry: { count: () => undefined },
      audio: { wandSwap: () => undefined },
      state: { mode: 'build' },
      player: {},
    } as unknown as Ctx;
    const wands = new WandSystem(ctx);
    const before = wands.snapshotRuntimeState();

    events.emit('recipeBrewed', { id: 'life', name: 'ELIXIR OF LIFE', firstDiscovery: true });
    events.emit('levelChanged', { depth: 2, name: 'D2' });
    expect(wands.collection).toContain('infuser');
    expect(wands.snapshotRuntimeState().infuserGranted).toBe(true);
    expect(wands.snapshotRuntimeState().depthsGranted).toEqual([2]);

    wands.restoreRuntimeState(before);

    const restored = wands.snapshotRuntimeState();
    expect(restored.infuserGranted).toBe(false);
    expect(restored.depthsGranted).toEqual([]);
    expect(wands.collection).toEqual(before.collection);

    events.emit('recipeBrewed', { id: 'life', name: 'ELIXIR OF LIFE', firstDiscovery: true });
    expect(wands.collection.filter((card) => card === 'infuser')).toHaveLength(1);
  });

  it('marks legacy loadouts that already contain Infuser as progression-complete', () => {
    const events = new EventBus();
    const ctx = {
      events,
      telemetry: { count: () => undefined },
      audio: { wandSwap: () => undefined },
      state: { mode: 'build' },
      player: {},
    } as unknown as Ctx;
    const wands = new WandSystem(ctx);

    wands.loadLoadout({
      active: 0,
      collection: ['infuser'],
      wands: [
        { frameId: 'oak', cards: ['spark', null, null], mana: 90 },
        { frameId: 'bone', cards: ['dig', null, null, null], mana: 120 },
      ],
    });
    wands.markDepthGrantsThrough(3);
    events.emit('recipeBrewed', { id: 'life', name: 'ELIXIR OF LIFE', firstDiscovery: true });

    expect(wands.collection.filter((card) => card === 'infuser')).toHaveLength(1);
    expect(wands.snapshotRuntimeState().infuserGranted).toBe(true);
  });

  it('keeps Infuser out of waystone random grants', () => {
    const events = new EventBus();
    const ctx = {
      events,
      telemetry: { count: () => undefined },
      audio: { wandSwap: () => undefined },
      state: { mode: 'build' },
      player: {},
    } as unknown as Ctx;
    const wands = new WandSystem(ctx);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      events.emit('waystoneLit');
    } finally {
      random.mockRestore();
    }

    expect(wands.collection).not.toContain('infuser');
    expect(wands.snapshotRuntimeState().infuserGranted).toBe(false);
  });
});

function action(card: CardId, overrides: Partial<CastAction> = {}): CastAction {
  return {
    card,
    speedMul: 1,
    dmgMul: 1,
    spreadAdd: 0,
    infused: false,
    bounces: 0,
    triggered: null,
    ...overrides,
  };
}

function makeCastCtx(): Ctx & { spawned: Array<{ x: number; y: number; type: number | null }> } {
  const spawned: Array<{ x: number; y: number; type: number | null }> = [];
  const ctx = {
    spawned,
    world: new World(),
    events: new EventBus(),
    telemetry: { count: () => undefined },
    audio: {
      zap: () => undefined,
      noiseBurst: () => undefined,
      tone: () => undefined,
      flame: () => undefined,
      dig: () => undefined,
      learn: () => undefined,
      wandSwap: () => undefined,
    },
    params: createGameParams(),
    state: { mode: 'play', frameCount: 1 },
    input: {
      mouse: { x: 180, y: 180 },
      activeChargingBlackHole: null,
    },
    player: {
      perks: {},
      dead: false,
      aimAngle: 0,
      vx: 0,
      mana: 0,
      maxMana: 0,
    },
    projectiles: [],
    particles: {
      spawn: (x: number, y: number, _vx: number, _vy: number, type: number | null) => {
        spawned.push({ x, y, type });
      },
      burst: () => undefined,
    },
    lightning: { cast: () => undefined },
    spells: {
      wandTip: () => ({ x: 10, y: 10 }),
      digRay: () => null,
      erodeAt: () => undefined,
    },
    fx: { digBeam: null },
    flask: { state: { material: null, count: 0, capacity: 600 } },
  } as unknown as Ctx & { spawned: Array<{ x: number; y: number; type: number | null }> };
  return ctx;
}

describe('WandSystem trigger executor', () => {
  it('uses the impact point for triggered conjure instead of the live mouse', () => {
    const ctx = makeCastCtx();
    const wands = new WandSystem(ctx);

    wands.castActionAt(ctx, action('conjure'), 24, 25, 0, {
      origin: 'trigger',
      target: { x: 24, y: 25 },
    });

    expect(ctx.world.types[ctx.world.idx(24, 25)]).toBe(Cell.Stone);
    expect(ctx.world.types[ctx.world.idx(180, 180)]).toBe(Cell.Empty);
  });

  it('uses the impact point for triggered vitrify instead of the live mouse', () => {
    const ctx = makeCastCtx();
    const wands = new WandSystem(ctx);
    ctx.world.types[ctx.world.idx(35, 36)] = Cell.Water;
    ctx.world.types[ctx.world.idx(180, 180)] = Cell.Water;

    wands.castActionAt(ctx, action('vitrify'), 35, 36, 0, {
      origin: 'trigger',
      target: { x: 35, y: 36 },
    });

    expect(ctx.world.types[ctx.world.idx(35, 36)]).toBe(Cell.Glass);
    expect(ctx.world.types[ctx.world.idx(180, 180)]).toBe(Cell.Water);
  });

  it('emits triggered flame from the impact point immediately', () => {
    const ctx = makeCastCtx();
    const wands = new WandSystem(ctx);

    wands.castActionAt(ctx, action('flame'), 40, 41, 0, {
      origin: 'trigger',
      target: { x: 40, y: 41 },
    });

    expect(ctx.spawned.length).toBeGreaterThan(0);
    expect(ctx.spawned.every((particle) => particle.x === 40 && particle.y === 41 && particle.type === Cell.Fire)).toBe(true);
  });

  it('marks wand-cast black-hole hosts with trigger payload metadata', () => {
    const ctx = makeCastCtx();
    const wands = new WandSystem(ctx);
    const payload = action('spark');

    wands.castActionAt(ctx, action('blackhole', { triggered: [payload] }), 55, 56, 0);

    expect(ctx.projectiles).toHaveLength(1);
    expect(ctx.projectiles[0].type).toBe('blackhole');
    expect(ctx.projectiles[0].charging).toBe(true);
    expect(ctx.input.activeChargingBlackHole).toBe(ctx.projectiles[0]);
    expect(TRIGGERED.get(ctx.projectiles[0])).toEqual([payload]);
  });

  it('spawns triggered black holes without claiming the mouse-up charging lifecycle', () => {
    const ctx = makeCastCtx();
    const wands = new WandSystem(ctx);
    const payload = action('spark');

    wands.castActionAt(ctx, action('blackhole', { triggered: [payload] }), 55, 56, 0, {
      origin: 'trigger',
      target: { x: 55, y: 56 },
    });

    expect(ctx.projectiles).toHaveLength(1);
    expect(ctx.projectiles[0].type).toBe('blackhole');
    expect(ctx.projectiles[0].charging).toBe(false);
    expect(ctx.input.activeChargingBlackHole).toBeNull();
    expect(TRIGGERED.get(ctx.projectiles[0])).toEqual([payload]);
  });
});

describe('WandSystem bench transfers', () => {
  it('supports indexed collection placement, slot swaps, and slot returns', () => {
    const events = new EventBus();
    let changed = 0;
    events.on('wandChanged', () => changed++);
    const ctx = {
      events,
      telemetry: { count: () => undefined },
      audio: { wandSwap: () => undefined },
      state: { mode: 'build' },
      player: {},
    } as unknown as Ctx;
    const wands = new WandSystem(ctx);
    wands.grantCard(ctx, 'flame');
    const flameIndex = wands.collection.indexOf('flame');

    wands.slotCollectionCard(flameIndex, 0, 1);
    expect(wands.wands[0].cards).toEqual(['spark', 'flame', null]);
    expect(wands.collection).not.toContain('flame');

    wands.swapSlots(0, 0, 0, 1);
    expect(wands.wands[0].cards).toEqual(['flame', 'spark', null]);

    wands.moveSlotToCollection(0, 1, 0);
    expect(wands.wands[0].cards).toEqual(['flame', null, null]);
    expect(wands.collection[0]).toBe('spark');
    expect(changed).toBe(3);
  });
});

describe('wand bench access', () => {
  function benchCtx(overrides: Partial<Ctx> = {}): Ctx {
    return {
      state: { mode: 'play' },
      player: { x: 100, y: 100, dead: false },
      levels: {
        current: {
          refuge: { x: 120, y: 100 },
          cauldron: null,
        },
      },
      ...overrides,
    } as unknown as Ctx;
  }

  it('opens only in play near the Refuge', () => {
    expect(canOpenWandBench(benchCtx())).toBe(true);
    expect(canOpenWandBench(benchCtx({ player: { x: 220, y: 100, dead: false } } as Partial<Ctx>))).toBe(false);
    expect(canOpenWandBench(benchCtx({ state: { mode: 'build' } } as Partial<Ctx>))).toBe(false);
    expect(canOpenWandBench(benchCtx({ player: { x: 100, y: 100, dead: true } } as Partial<Ctx>))).toBe(false);
    expect(canOpenWandBench(benchCtx({
      levels: { current: { refuge: undefined, cauldron: { x: 110, y: 100 } } },
    } as Partial<Ctx>))).toBe(false);
  });

  it('opens from anywhere in play once god mode is active', () => {
    expect(canOpenWandBench(benchCtx({
      state: { mode: 'play', debugGodMode: true },
      player: { x: 400, y: 100, dead: false },
    } as Partial<Ctx>))).toBe(true);
    expect(canOpenWandBench(benchCtx({
      state: { mode: 'build', debugGodMode: true },
    } as Partial<Ctx>))).toBe(false);
  });
});

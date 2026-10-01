import { describe, expect, it, vi } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy, LevelDef, LevelRuntime, MutatorLevelGen } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { GLOBAL_PARAMS, GLOBAL_PARAM_DEFAULTS, MATERIAL_PARAMS, MATERIAL_PARAM_DEFAULTS, createGameParams } from '@/config/params';
import { captureTuning, flushTuning } from '@/config/tuningStore';
import { LEVELS } from '@/config/worldgraph';
import { MutatorDirector } from '@/game/MutatorDirector';

/**
 * The runtime of the complications (game/MutatorDirector) with a hand-made context: the per-run tuning
 * clone and the proof it never leaks into the saved tuning, short rations, fireworks, the notice, and
 * the dressing of a floor on both of the paths a floor is built.
 */
interface Harness {
  ctx: Ctx;
  director: MutatorDirector;
  toasts: string[];
  telemetry: Array<[string, number | undefined]>;
  bursts: number[];
  damage: Array<{ kind: string; amount: number; source: string | undefined }>;
  playerHits: number[];
}

function harness(overrides: Partial<{ hp: number; maxHp: number }> = {}): Harness {
  const events = new EventBus();
  const toasts: string[] = [];
  events.on('toast', ({ text }) => toasts.push(text));
  const telemetry: Array<[string, number | undefined]> = [];
  const bursts: number[] = [];
  const damage: Harness['damage'] = [];
  const playerHits: number[] = [];
  const enemies: Enemy[] = [];
  const ctx = {
    events,
    params: createGameParams(),
    state: { mode: 'play', frameCount: 0, arrivalGraceUntil: 0, playtestSource: null, score: 0, difficulty: 2 },
    player: { x: 0, y: 0, hp: overrides.hp ?? 60, maxHp: overrides.maxHp ?? 100, dead: false },
    enemies,
    telemetry: { count: (name: string, n?: number) => { telemetry.push([name, n]); } },
    audio: new Proxy({}, { get: () => () => undefined }),
    particles: { burst: () => undefined, spawn: () => undefined },
    sparks: { burst: (_x: number, _y: number, o: { count: number }) => { bursts.push(o.count); } },
    fx: { bloomKick: 0 },
    enemyCtl: { damage: (e: Enemy, amount: number, _kx: number, _ky: number, source?: string) => { damage.push({ kind: e.kind, amount, source }); e.hp -= amount; } },
    playerCtl: { damage: (amount: number) => { playerHits.push(amount); } },
    levels: { current: null },
    world: new World(40, 40),
  } as unknown as Ctx;
  const director = new MutatorDirector(ctx);
  ctx.mutators = director;
  return { ctx, director, toasts, telemetry, bursts, damage, playerHits };
}

describe('the tuning clone', () => {
  const dryShipped = (): number => MATERIAL_PARAM_DEFAULTS[Cell.Wood].flammability!;

  it('leaves an ordinary run exactly as it was: the shared tuning objects, no complications in the state', () => {
    const h = harness();
    expect(h.ctx.params.materials).toBe(MATERIAL_PARAMS);
    expect(h.ctx.params.global).toBe(GLOBAL_PARAMS);
    h.director.activate(h.ctx, []);
    expect(h.ctx.params.materials).toBe(MATERIAL_PARAMS);
    expect(h.ctx.state.mutators).toBeUndefined();
    expect(h.director.ids).toEqual([]);
  });

  it('swaps in a clone with the fuel scaled for the run, and never writes the shared objects', () => {
    const h = harness();
    h.director.activate(h.ctx, ['tinderbox', 'dark-works']);
    expect(h.ctx.params.materials).not.toBe(MATERIAL_PARAMS);
    expect(h.ctx.params.global).not.toBe(GLOBAL_PARAMS);
    expect(h.ctx.params.materials[Cell.Wood].flammability).toBeCloseTo(dryShipped() * 2.4);
    expect(h.ctx.params.materials[Cell.Oil].igniteChance!).toBeGreaterThan(MATERIAL_PARAM_DEFAULTS[Cell.Oil].igniteChance!);
    expect(h.ctx.params.global.ambient).toBeCloseTo(GLOBAL_PARAM_DEFAULTS.ambient * 0.45);
    // ...a fuel that was already as flammable as can be stays a probability, never above one.
    for (const m of Object.values(h.ctx.params.materials)) if (m.flammability !== undefined) expect(m.flammability).toBeLessThanOrEqual(1);
    // The shared objects are as shipped.
    expect(MATERIAL_PARAMS[Cell.Wood].flammability).toBe(dryShipped());
    expect(GLOBAL_PARAMS.ambient).toBe(GLOBAL_PARAM_DEFAULTS.ambient);
  });

  it('LEAKS NOTHING into the saved tuning: the tuning store sees no change, and writes nothing, while a complication is in force', () => {
    const h = harness();
    const store = new Map<string, string>();
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    });
    try {
      expect(captureTuning(h.ctx)).toEqual({});
      h.director.activate(h.ctx, ['tinderbox', 'wet-floors', 'dark-works']);
      // What the tuning store reads (the singletons) is untouched...
      expect(captureTuning(h.ctx)).toEqual({});
      // ...and a flush on page hide (or after any paramsChanged) stores nothing for the run's complications.
      h.ctx.events.emit('paramsChanged', undefined);
      flushTuning(h.ctx);
      expect(store.has('ad:tuning:v1')).toBe(false);
      // The player's own tuning still persists as it always did, with the complication layered over it only in the clone.
      MATERIAL_PARAMS[Cell.Wood].flammability = 0.2;
      try {
        flushTuning(h.ctx);
        const saved = JSON.parse(store.get('ad:tuning:v1') ?? '{}') as { materials?: Record<string, Record<string, number>> };
        expect(saved.materials?.[String(Cell.Wood)]?.flammability).toBe(0.2);
      } finally {
        MATERIAL_PARAMS[Cell.Wood].flammability = dryShipped();
      }
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
    }
  });

  it('puts the shipped objects back when the run ends, and again for the next run', () => {
    const h = harness();
    h.director.activate(h.ctx, ['tinderbox']);
    h.director.deactivate(h.ctx);
    expect(h.ctx.params.materials).toBe(MATERIAL_PARAMS);
    expect(h.ctx.params.global).toBe(GLOBAL_PARAMS);
    expect(h.ctx.state.mutators).toBeUndefined();
    expect(h.director.ids).toEqual([]);
    // A second run with a different set starts from the shipped tuning, not from the first run's clone.
    h.director.activate(h.ctx, ['wet-floors']);
    expect(h.ctx.params.materials[Cell.Wood].flammability).toBeCloseTo(dryShipped() * 0.55);
    expect(h.ctx.params.global.ambient).toBe(GLOBAL_PARAM_DEFAULTS.ambient);
    h.director.activate(h.ctx, ['hush']);
    expect(h.ctx.params.materials).toBe(MATERIAL_PARAMS);
  });

  it('is idempotent for the same set, and a replaced run re-activates cleanly', () => {
    const h = harness();
    h.director.activate(h.ctx, ['tinderbox']);
    const clone = h.ctx.params.materials;
    h.director.activate(h.ctx, ['tinderbox']);
    expect(h.ctx.params.materials).toBe(clone);
    // RunDirector.beginRun over a live run: the old run's end deactivates, the new run's begin activates.
    h.director.deactivate(h.ctx);
    h.director.activate(h.ctx, ['tinderbox']);
    expect(h.ctx.params.materials[Cell.Wood].flammability).toBeCloseTo(dryShipped() * 2.4);
  });

  it('plays the descent on the clone and everything else (the title, the Workshop) on the shipped tuning', () => {
    const h = harness();
    h.director.activate(h.ctx, ['tinderbox']);
    expect(h.ctx.params.materials).not.toBe(MATERIAL_PARAMS);
    h.ctx.state.mode = 'build';
    h.ctx.events.emit('modeChanged', { mode: 'build' });
    expect(h.ctx.params.materials).toBe(MATERIAL_PARAMS);
    expect(h.ctx.state.mutators).toEqual(['tinderbox']); // still the run's
    h.ctx.state.mode = 'play';
    h.ctx.events.emit('modeChanged', { mode: 'play' });
    expect(h.ctx.params.materials[Cell.Wood].flammability).toBeCloseTo(dryShipped() * 2.4);
  });

  it('does not clone for a complication that needs no tuning, and does not clobber objects someone else swapped in', () => {
    const h = harness();
    h.director.activate(h.ctx, ['low-gravity']);
    expect(h.ctx.params.materials).toBe(MATERIAL_PARAMS);
    expect(h.ctx.state.mutators).toEqual(['low-gravity']);
    const g = harness();
    g.director.activate(g.ctx, ['tinderbox']);
    const elsewhere = { ...g.ctx.params.materials };
    g.ctx.params.materials = elsewhere;
    g.director.deactivate(g.ctx);
    expect(g.ctx.params.materials).toBe(elsewhere);
  });

  it('cleans what it is given', () => {
    const h = harness();
    h.director.activate(h.ctx, ['nonsense', 'wet-floors', 'wet-floors']);
    expect(h.director.ids).toEqual(['wet-floors']);
    expect(h.director.has('wet-floors')).toBe(true);
    expect(h.director.has('tinderbox')).toBe(false);
  });
});

describe('short rations', () => {
  it('halves what the alchemist heals in a tick, and leaves a rest or a respawn alone', () => {
    const h = harness({ hp: 50 });
    h.director.activate(h.ctx, ['famine']);
    h.director.update(h.ctx); // learns the health
    h.ctx.player.hp += 10; // a potion
    h.director.update(h.ctx);
    expect(h.ctx.player.hp).toBeCloseTo(55);
    h.ctx.player.hp += 0.2; // regeneration
    h.director.update(h.ctx);
    expect(h.ctx.player.hp).toBeCloseTo(55.1);
    h.ctx.player.hp = h.ctx.player.maxHp; // a full rest: a jump far larger than any heal
    h.director.update(h.ctx);
    expect(h.ctx.player.hp).toBe(100);
    h.ctx.player.hp -= 20; // damage is not touched
    h.director.update(h.ctx);
    expect(h.ctx.player.hp).toBe(80);
  });

  it('does nothing without the complication', () => {
    const h = harness({ hp: 50 });
    h.director.activate(h.ctx, ['hush']);
    h.director.update(h.ctx);
    h.ctx.player.hp += 10;
    h.director.update(h.ctx);
    expect(h.ctx.player.hp).toBe(60);
  });

  it('forgets the health across a death (the respawn is not a heal)', () => {
    const h = harness({ hp: 50 });
    h.director.activate(h.ctx, ['famine']);
    h.director.update(h.ctx);
    h.ctx.player.dead = true;
    h.ctx.player.hp = 0;
    h.director.update(h.ctx);
    h.ctx.player.dead = false;
    h.ctx.player.hp = 12;
    h.director.update(h.ctx);
    expect(h.ctx.player.hp).toBe(12);
  });
});

describe('fireworks', () => {
  const foe = (kind: string, x: number, hp: number): Enemy => ({ kind, x, y: 20, hp, maxHp: hp } as unknown as Enemy);

  it('bursts where a creature fell, a few ticks after, and hurts what is near it', () => {
    const h = harness();
    h.director.activate(h.ctx, ['fireworks']);
    const neighbour = foe('slime', 24, 30);
    h.ctx.enemies.push(neighbour);
    h.ctx.events.emit('enemyKilled', { kind: 'bat', x: 20, y: 20 });
    h.director.update(h.ctx);
    expect(h.bursts).toEqual([]); // not yet: the fuse
    h.ctx.state.frameCount = 20;
    h.director.update(h.ctx);
    expect(h.bursts.length).toBeGreaterThan(0);
    expect(h.damage).toHaveLength(1);
    expect(h.damage[0]).toMatchObject({ kind: 'slime', source: 'detonated' });
    expect(h.damage[0].amount).toBeGreaterThan(5);
    expect(neighbour.hp).toBeLessThan(30);
  });

  it('hurts the alchemist only when he is close, mildly, and not at all from across the room', () => {
    const near = harness();
    near.director.activate(near.ctx, ['fireworks']);
    near.ctx.player.x = 24;
    near.ctx.player.y = 28;
    near.ctx.events.emit('enemyKilled', { kind: 'bat', x: 20, y: 20 });
    near.ctx.state.frameCount = 20;
    near.director.update(near.ctx);
    expect(near.playerHits).toHaveLength(1);
    expect(near.playerHits[0]).toBeLessThan(8);
    const far = harness();
    far.director.activate(far.ctx, ['fireworks']);
    far.ctx.player.x = 30;
    far.ctx.events.emit('enemyKilled', { kind: 'bat', x: 0, y: 20 });
    far.ctx.state.frameCount = 20;
    far.director.update(far.ctx);
    expect(far.playerHits).toEqual([]);
  });

  it('leaves a warden to its own ending, and does nothing without the complication', () => {
    const h = harness();
    h.director.activate(h.ctx, ['fireworks']);
    h.ctx.events.emit('enemyKilled', { kind: 'colossus', x: 20, y: 20 });
    h.ctx.state.frameCount = 40;
    h.director.update(h.ctx);
    expect(h.bursts).toEqual([]);
    const plain = harness();
    plain.director.activate(plain.ctx, ['hush']);
    plain.ctx.events.emit('enemyKilled', { kind: 'bat', x: 20, y: 20 });
    plain.ctx.state.frameCount = 40;
    plain.director.update(plain.ctx);
    expect(plain.bursts).toEqual([]);
  });

  it('chains: a creature a burst kills bursts in its turn, and the queue is bounded', () => {
    const h = harness();
    h.director.activate(h.ctx, ['fireworks']);
    const doomed = foe('bat', 24, 3);
    h.ctx.enemies.push(doomed);
    // the test double does what the real one does: a creature that reaches zero is announced
    (h.ctx.enemyCtl as { damage: (e: Enemy, a: number, kx: number, ky: number, s?: string) => void }).damage = (e, a) => {
      e.hp -= a;
      if (e.hp <= 0) h.ctx.events.emit('enemyKilled', { kind: e.kind, x: e.x, y: e.y });
    };
    h.ctx.events.emit('enemyKilled', { kind: 'bat', x: 20, y: 20 });
    h.ctx.state.frameCount = 20;
    h.director.update(h.ctx);
    expect(h.bursts).toHaveLength(2); // the first burst's two layers
    h.ctx.state.frameCount = 40;
    h.director.update(h.ctx); // the second pop, from the creature the first one finished
    expect(h.bursts).toHaveLength(4);
    // A flood of deaths cannot queue without limit.
    for (let i = 0; i < 100; i++) h.ctx.events.emit('enemyKilled', { kind: 'bat', x: 20, y: 20 });
    h.ctx.state.frameCount = 60;
    h.director.update(h.ctx);
    expect(h.bursts.length).toBeLessThanOrEqual(4 + 2 * 24);
  });
});

describe('the notice', () => {
  it('names the complications once, after the arrival grace, and not on a plain run', () => {
    const h = harness();
    h.director.activate(h.ctx, ['wet-floors', 'low-gravity']);
    h.ctx.state.frameCount = 10;
    h.director.update(h.ctx);
    expect(h.toasts).toEqual([]); // the title card is up
    h.ctx.state.frameCount = 400;
    h.director.update(h.ctx);
    h.director.update(h.ctx);
    expect(h.toasts).toHaveLength(1);
    expect(h.toasts[0]).toMatch(/Wet Floors and Low Gravity/);
    const plain = harness();
    plain.director.activate(plain.ctx, []);
    plain.ctx.state.frameCount = 400;
    plain.director.update(plain.ctx);
    expect(plain.toasts).toEqual([]);
  });
});

describe('dressing a floor', () => {
  const FLOOR = 88;
  const def = LEVELS.d2 as LevelDef;
  function caveWorld(): World {
    const world = new World(460, 140);
    for (let i = 0; i < world.types.length; i++) world.types[i] = Cell.Wall;
    for (let y = 50; y < FLOOR; y++) for (let x = 10; x <= 450; x++) world.clearCellAt(x + y * 460);
    for (let y = FLOOR; y <= FLOOR + 3; y++) for (let x = 150; x <= 175; x++) world.clearCellAt(x + y * 460);
    return world;
  }
  const gen = (): MutatorLevelGen => ({
    spawn: { x: 20, y: FLOOR - 1 },
    exit: { x: 440, sealY: FLOOR + 10, halfW: 6 },
    pickups: [],
    portal: { x: 440, y: FLOOR - 1, open: false } as MutatorLevelGen['portal'],
    boss: null,
    placedPrefabs: [],
    mechanisms: [],
    waystones: [],
  });

  it('plans from the pristine cells, the same way on createLevel and on restoreLevel', () => {
    const a = harness();
    a.ctx.world = caveWorld();
    a.director.activate(a.ctx, ['wet-floors', 'gas-leak']);
    a.director.planLevel(a.ctx, def, 4242, gen());
    const first = JSON.stringify(a.director.planFor('d2'));
    // a second build of the same floor (the resumed game's restoreLevel) plans identically
    const b = harness();
    b.ctx.world = caveWorld();
    b.director.activate(b.ctx, ['wet-floors', 'gas-leak']);
    b.director.planLevel(b.ctx, def, 4242, gen());
    expect(JSON.stringify(b.director.planFor('d2'))).toBe(first);
    expect(a.director.planFor('d2')!.vents.length).toBeGreaterThan(0);
  });

  it('writes the puddles as real water, once, and the route is whole', () => {
    const h = harness();
    h.ctx.world = caveWorld();
    h.director.activate(h.ctx, ['wet-floors']);
    h.director.planLevel(h.ctx, def, 4242, gen());
    const runtime = { def, world: h.ctx.world, spawn: gen().spawn } as unknown as LevelRuntime;
    h.director.dressLevel(h.ctx, runtime);
    const water = h.ctx.world.types.reduce((n, t) => n + (t === Cell.Water ? 1 : 0), 0);
    expect(water).toBeGreaterThan(0);
    expect(h.telemetry.some(([name]) => name.endsWith('.reverted'))).toBe(false);
  });

  it('plans nothing for the refuge floor, a plain run, or a set that dresses nothing', () => {
    const h = harness();
    h.ctx.world = caveWorld();
    h.director.activate(h.ctx, ['wet-floors']);
    h.director.planLevel(h.ctx, LEVELS.d1 as LevelDef, 1, gen());
    expect(h.director.planFor('d1')).toBeUndefined();
    const plain = harness();
    plain.ctx.world = caveWorld();
    plain.director.activate(plain.ctx, []);
    plain.director.planLevel(plain.ctx, def, 1, gen());
    expect(plain.director.planFor('d2')).toBeUndefined();
    const dials = harness();
    dials.ctx.world = caveWorld();
    dials.director.activate(dials.ctx, ['glass-cannon', 'tinderbox']);
    dials.director.planLevel(dials.ctx, def, 1, gen());
    expect(dials.director.planFor('d2')).toBeUndefined();
  });

  it('puts a gas vent into the world on its cadence, only while the alchemist is near, and only until its pipe runs dry', () => {
    const h = harness();
    h.ctx.world = caveWorld();
    h.director.activate(h.ctx, ['gas-leak']);
    h.director.planLevel(h.ctx, def, 4242, gen());
    const plan = h.director.planFor('d2')!;
    expect(plan.vents.length).toBeGreaterThan(0);
    const vent = plan.vents[0];
    (h.ctx.levels as { current: unknown }).current = { def, world: h.ctx.world };
    h.ctx.player.x = vent.x;
    h.ctx.player.y = vent.y - 10;
    h.ctx.state.frameCount = vent.rate * 20 - vent.phase; // a frame it fires on
    const before = vent.budget;
    h.director.update(h.ctx);
    expect(vent.budget).toBeLessThan(before);
    // far away, it is silent
    h.ctx.player.x = vent.x + 900;
    const kept = vent.budget;
    h.ctx.state.frameCount += vent.rate;
    h.director.update(h.ctx);
    expect(vent.budget).toBe(kept);
  });
});

describe('the run ending', () => {
  it('stops every effect and forgets the plans', () => {
    const h = harness();
    h.director.activate(h.ctx, ['fireworks', 'famine']);
    h.ctx.events.emit('enemyKilled', { kind: 'bat', x: 20, y: 20 });
    h.director.deactivate(h.ctx);
    h.ctx.state.frameCount = 40;
    h.director.update(h.ctx);
    expect(h.bursts).toEqual([]);
    expect(h.director.planFor('d2')).toBeUndefined();
    vi.useRealTimers();
  });
});

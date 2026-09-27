import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultPostFxSettings } from '@/config/params';
import { LEVELS } from '@/config/worldgraph';
import {
  BOSS_ACT_TICKS,
  BOSS_ENGAGE_CELLS,
  BossWard,
  blastAuthor,
  bossOrganRect,
  KILN_QUENCH,
} from '@/core/bossWard';
import { EventBus } from '@/core/events';
import { fnv1aString } from '@/core/rng';
import type { Ctx, Enemy, GameStateData } from '@/core/types';
import { Enemies, ENEMY_DEFS } from '@/entities/Enemies';
import { Physics } from '@/entities/physics';
import { Explosions } from '@/sim/explosion';
import { createDefaultStatus } from '@/entities/status';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';
import { mockRandom } from './helpers/randomSeam';

/**
 * THE BOSS WARD (QA P0): the Kiln Colossus died on its own — a world-repair carve
 * opened its ceiling tank, its own slam left live charge in its floor, lava lit
 * powder beside it — and the run was won by an idle player. A warded boss's hp
 * now moves only for harm the player set in motion.
 */

function boss(kind: 'colossus' | 'leviathan', x = 200, y = 150): Enemy {
  const def = ENEMY_DEFS[kind];
  return {
    kind, x, y, fx: 0, fy: 0, vx: 0, vy: 0, hp: def.hp, maxHp: def.hp, flash: 0, timer: 0, attackCd: 0,
    bobPhase: 0, grounded: true, stride: 0, splat: 0, prevG: true, blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0,
    status: createDefaultStatus(),
  };
}

describe('BossWard (pure)', () => {
  it('a direct blow always lands; the world only while the player is engaged', () => {
    const ward = new BossWard();
    const c = boss('colossus');
    expect(ward.allows(c, 'direct', 1000)).toBe(true);
    expect(ward.allows(c, 'detonated', 1000)).toBe(false);
    expect(ward.allows(c, 'shorted', 1000)).toBe(false);
    ward.noteAct(1000, c.x + 100, c.y); // a cast in the lair
    expect(ward.allows(c, 'detonated', 1000 + BOSS_ACT_TICKS)).toBe(true);
    // ...which goes stale
    expect(ward.allows(c, 'detonated', 1001 + BOSS_ACT_TICKS)).toBe(false);
  });

  it('an act far from the boss engages nothing', () => {
    const ward = new BossWard();
    const c = boss('colossus');
    ward.noteAct(1000, c.x + BOSS_ENGAGE_CELLS + 20, c.y);
    expect(ward.engaged(c, 1001)).toBe(false);
    expect(ward.allows(c, 'burned', 1001)).toBe(false);
  });

  it('never wards an ordinary creature', () => {
    const ward = new BossWard();
    const slime = { ...boss('colossus'), kind: 'slime' as const };
    expect(ward.allows(slime, 'detonated', 5)).toBe(true);
  });

  it('a level change forgets the last act', () => {
    const ward = new BossWard();
    const c = boss('colossus');
    ward.noteAct(1000, c.x, c.y);
    ward.reset();
    expect(ward.engaged(c, 1001)).toBe(false);
  });

  it('remembers whether the player ever harmed the boss', () => {
    const ward = new BossWard();
    const c = boss('colossus');
    ward.allows(c, 'detonated', 10); // refused
    expect(ward.harmedByPlayer(c)).toBe(false);
    ward.allows(c, 'direct', 11);
    expect(ward.harmedByPlayer(c)).toBe(true);
  });

  it('names a boss-authored blast from its source tag', () => {
    expect(blastAuthor('colossus-slam')).toBe('colossus');
    expect(blastAuthor('colossus-fireball')).toBe('colossus');
    expect(blastAuthor('colossus-death')).toBe('colossus');
    expect(blastAuthor('leviathan-water')).toBe('leviathan');
    expect(blastAuthor('gunpowder')).toBeNull();
    expect(blastAuthor('bomber')).toBeNull();
    expect(blastAuthor(undefined)).toBeNull();
  });
});

describe('Kiln quench (thermal shock as a burst)', () => {
  it('an uncredited douse (a flood nobody caused) never cracks the kiln', () => {
    const ward = new BossWard();
    const c = boss('colossus');
    let total = 0;
    for (let f = 0; f < 60 * 60; f++) total += ward.quenchTick(c, true, 5000 + f);
    expect(total).toBe(0);
  });

  it('a douse the player caused cracks at once, then every rearm while soaked', () => {
    const ward = new BossWard();
    const c = boss('colossus');
    ward.noteAct(1000, c.x, c.y - 38); // dug the seal
    const cracks: number[] = [];
    // The flood arrives 90 ticks later and soaks it for 20 s — long after the
    // act window closed: the douse stays his while it lasts.
    for (let f = 1090; f < 1090 + 20 * 60; f++) {
      const dmg = ward.quenchTick(c, true, f);
      if (dmg > 0) cracks.push(f);
    }
    expect(cracks[0]).toBe(1090);
    expect(cracks.length).toBe(Math.ceil((20 * 60) / KILN_QUENCH.rearmTicks));
    for (let k = 1; k < cracks.length; k++) expect(cracks[k] - cracks[k - 1]).toBe(KILN_QUENCH.rearmTicks);
    expect(ward.harmedByPlayer(c)).toBe(true);
  });

  it('one crack is a readable chunk, not a trickle', () => {
    const ward = new BossWard();
    const c = boss('colossus');
    ward.noteAct(10, c.x, c.y);
    const dmg = ward.quenchTick(c, true, 11);
    expect(dmg).toBeCloseTo(c.maxHp * KILN_QUENCH.share, 5);
    expect(dmg).toBeGreaterThan(60);
  });

  it('drying out drops the credit: a later stray douse does nothing', () => {
    const ward = new BossWard();
    const c = boss('colossus');
    ward.noteAct(10, c.x, c.y);
    expect(ward.quenchTick(c, true, 11)).toBeGreaterThan(0);
    for (let f = 12; f < 400; f++) ward.quenchTick(c, false, f);
    let total = 0;
    for (let f = 2000; f < 2400; f++) total += ward.quenchTick(c, true, f);
    expect(total).toBe(0);
  });
});

function combatCtx(): { ctx: Ctx; enemies: Enemies; events: EventBus } {
  const events = new EventBus();
  const noop = (): undefined => undefined;
  const ctx = {
    events,
    world: new World(400, 200),
    state: { mode: 'play', frameCount: 1000, worldSeed: 3 },
    player: { x: 300, y: 150, vx: 0, vy: 0, dead: false },
    enemies: [] as Enemy[],
    camera: { x: 0, y: 0 },
    fx: { bloomKick: 0, screenShake: 0, hitstop: 0 },
    params: { global: { bloodAmount: 1 } },
    particles: { spawn: noop, burst: noop },
    audio: new Proxy({}, { get: (_t, key) => (key === 'at' ? (_x: number, _y: number, fn: () => void) => fn() : noop) }),
  } as unknown as Ctx;
  return { ctx, enemies: new Enemies(ctx), events };
}

describe('Enemies.damage honours the ward', () => {
  it('a blast the player did not cast leaves an idle boss untouched', () => {
    const { ctx, enemies } = combatCtx();
    const c = boss('colossus');
    ctx.enemies.push(c);
    enemies.damage(c, 40, 0, 0, 'detonated');
    enemies.damage(c, 40, 0, 0, 'burned');
    enemies.damage(c, 40, 0, 0, 'flattened');
    expect(c.hp).toBe(c.maxHp);
    expect(c.flash).toBe(0);
  });

  it('the same blast lands once the player cast nearby; direct hits always land', () => {
    const { ctx, enemies, events } = combatCtx();
    const c = boss('colossus');
    ctx.enemies.push(c);
    enemies.damage(c, 10, 0, 0, 'direct');
    expect(c.hp).toBe(c.maxHp - 10);
    events.emit('cardCast', { id: 'bolt', origin: 'wand', x: c.x + 60, y: c.y - 10 });
    enemies.damage(c, 40, 0, 0, 'detonated');
    expect(c.hp).toBe(c.maxHp - 50);
  });

  it('a poured flask engages the ward too (a bucket on the kiln is his)', () => {
    const { ctx, enemies, events } = combatCtx();
    const c = boss('leviathan');
    ctx.enemies.push(c);
    ctx.player.x = c.x + 40;
    events.emit('flaskUsed', { verb: 'pour', material: Cell.Water, amount: 10 });
    enemies.damage(c, 30, 0, 0, 'shorted');
    expect(c.hp).toBe(c.maxHp - 30);
  });

  it('an ordinary creature still takes the world’s harm', () => {
    const { ctx, enemies } = combatCtx();
    const e = { ...boss('colossus'), kind: 'golem' as const, hp: 100, maxHp: 100 };
    ctx.enemies.push(e);
    enemies.damage(e, 30, 0, 0, 'detonated');
    expect(e.hp).toBe(70);
  });
});

function makeGenCtx(world: World, worldSeed: number): Ctx {
  const noop = (): undefined => undefined;
  const sub = (): unknown => new Proxy({}, { get: () => noop });
  const state: GameStateData = {
    mode: 'build',
    score: 0,
    frameCount: 0,
    activeInputMode: 'element',
    currentElement: Cell.Sand,
    currentSpell: 'bolt',
    currentBiome: 'earthen',
    brushSize: 6,
    playerSpawned: false,
    worldSeed,
    paused: false,
    postFx: createDefaultPostFxSettings(),
    editorLights: null,
  };
  return {
    world,
    state,
    player: { x: 800, y: 500, vx: 0, vy: 0, fx: 0, fy: 0 },
    enemies: [],
    enemyCtl: { spawn: noop },
    events: { emit: noop, on: noop, off: noop },
    audio: sub(),
    particles: sub(),
    rigidBodies: sub(),
    fx: {},
    levels: { current: null },
    sanctum: { open: noop },
  } as unknown as Ctx;
}

describe('the Kiln tank survives generation', () => {
  // Expedition seeds as `run test --level d4 --seed N` derives the floor seed;
  // seed 4 is QA's repro (the gauge-rescue carve had eaten the whole seal).
  for (const expedition of [1, 2, 3, 4]) {
    it(`d4 (expedition seed ${expedition}): sealed, full and cased`, () => {
      const world = new World();
      const gen = new WorldGen();
      const seed = (expedition ^ fnv1aString('d4')) >>> 0;
      const ctx = makeGenCtx(world, seed);
      ctx.worldgen = gen;
      const level = gen.generateLevel(ctx, LEVELS.d4, seed);
      expect(level.boss?.kind).toBe('colossus');
      const cx = level.boss!.x;
      const ty = level.boss!.y - 14 - 24;
      let seal = 0,
        water = 0,
        casing = 0;
      for (let dx = -9; dx <= 9; dx++) {
        for (let dy = -8; dy <= 2; dy++) {
          const t = world.types[world.idx(cx + dx, ty + dy)];
          if (Math.abs(dx) > 7 || dy < -6) casing += t === Cell.Metal ? 1 : 0;
          else if (dy <= 0) water += t === Cell.Water ? 1 : 0;
          else seal += t === Cell.Stone ? 1 : 0;
        }
      }
      expect(seal).toBe(15 * 2);
      expect(water).toBe(15 * 7);
      expect(casing).toBe(4 * 11 + 15 * 2);
    });
  }
});

function blastCtx(world: World, bossSpawn: { x: number; y: number; kind: 'colossus' }): { ctx: Ctx; damage: ReturnType<typeof vi.fn> } {
  const damage = vi.fn();
  const ctx = {
    world,
    shockwaves: [],
    camera: { x: 0, y: 0 },
    fx: { bloomKick: 0, screenShake: 0 },
    audio: { boom: vi.fn() },
    events: { emit: vi.fn() },
    particles: { spawn: vi.fn(), burst: vi.fn() },
    enemies: [] as Enemy[],
    enemyCtl: { damage },
    levels: { current: { boss: bossSpawn } },
    state: { mode: 'play', frameCount: 0 },
    player: { dead: true },
    playerCtl: { damage: vi.fn() },
    rigidBodies: { applyRadialImpulse: vi.fn() },
    vineStrands: { applyRadialImpulse: vi.fn() },
    critters: { scatter: vi.fn() },
  } as unknown as Ctx;
  ctx.physics = new Physics(ctx);
  return { ctx, damage };
}

describe('a boss never blows itself up', () => {
  afterEach(() => vi.restoreAllMocks());

  it("its own slam neither hurts it nor leaves live charge in the floor; a gunpowder blast does both", () => {
    mockRandom().mockReturnValue(0.1); // every charge roll would land
    for (const [tag, own] of [['colossus-slam', true], ['gunpowder', false]] as const) {
      const world = new World(200, 120);
      for (let y = 80; y < 120; y++) for (let x = 0; x < 200; x++) world.types[world.idx(x, y)] = Cell.Stone;
      const c = boss('colossus', 100, 79);
      const { ctx, damage } = blastCtx(world, { x: 100, y: 79, kind: 'colossus' });
      ctx.enemies.push(c);
      new Explosions(ctx).trigger(110, 80, 11, { playerDamageSource: tag });
      let charged = 0;
      for (let i = 0; i < world.charge.length; i++) if (world.charge[i] > 0) charged++;
      expect(damage.mock.calls.length, tag).toBe(own ? 0 : 1);
      expect(charged > 0, tag).toBe(!own);
    }
  });

  it("no blast the player did not cast breaks the ceiling tank; the player's bolt can", () => {
    mockRandom().mockReturnValue(0.5);
    const cases = [['colossus-fireball', true], ['bomber', true], ['gunpowder', true], [undefined, false]] as const;
    for (const [tag, own] of cases) {
      const world = new World(200, 120);
      const spawn = { x: 100, y: 100, kind: 'colossus' as const };
      const organ = bossOrganRect(spawn)!;
      // a stone seal row inside the organ, right where the blast lands
      const sealY = spawn.y - 37;
      for (let x = 93; x <= 107; x++) world.types[world.idx(x, sealY)] = Cell.Stone;
      expect(sealY).toBeGreaterThanOrEqual(organ.y0);
      expect(sealY).toBeLessThanOrEqual(organ.y1);
      const { ctx } = blastCtx(world, spawn);
      new Explosions(ctx).trigger(100, sealY + 3, 10, tag ? { playerDamageSource: tag } : undefined);
      let seal = 0;
      for (let x = 93; x <= 107; x++) if (world.types[world.idx(x, sealY)] === Cell.Stone) seal++;
      expect(seal, String(tag)).toBe(own ? 15 : 0);
    }
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LEVELS, populationForLevel } from '@/config/worldgraph';
import { EventBus } from '@/core/events';
import { Rng } from '@/core/rng';
import type { Critter, Ctx, Enemy, EnemyDef, EnemySpawnOptions, WeaverLairWeb } from '@/core/types';
import { ENEMY_KINDS as BUILDER_ENEMY_KINDS, PATROL_KINDS } from '@/builder/inspectorSchemas';
import { Enemies, ENEMY_DEFS, enemyLethalCell } from '@/entities/Enemies';
import { spawnPrefabEnemy } from '@/game/instantiate';
import { Levels } from '@/game/Levels';
import { blocksEntity, Cell, isSoftGrowth } from '@/sim/CellType';
import { World } from '@/sim/World';
import { EXTRAS } from '@/world/biomeExtras';

function makeEnemy(kind: Enemy['kind'], overrides: Partial<Enemy> = {}): Enemy {
  return {
    kind,
    x: 40,
    y: 40,
    fx: 0,
    fy: 0,
    vx: 0,
    vy: 0,
    hp: 20,
    maxHp: 20,
    flash: 0,
    timer: 0,
    attackCd: 0,
    bobPhase: 0,
    grounded: false,
    stride: 0,
    splat: 0,
    prevG: false,
    blink: 0,
    jetFuel: 0,
    jetCd: 0,
    stuckT: 0,
    status: {
      wet: 0,
      oiled: 0,
      burning: 0,
      frozen: 0,
      electrified: 0,
      regen: 0,
      levity: 0,
      stoneskin: 0,
      swift: 0,
      torch: 0,
    },
    ...overrides,
  };
}

describe('enemy bounty economy', () => {
  it('splits non-multiple bounties into exact-value homing coins', () => {
    const values: number[] = [];
    const ctx = {
      state: { mode: 'play', score: 0 },
      particles: {
        spawn: (
          _x: number,
          _y: number,
          _vx: number,
          _vy: number,
          _type: number | null,
          _color: number,
          _life: number,
          opts?: { value?: number },
        ) => {
          values.push(opts?.value ?? 10);
        },
      },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);

    (enemies as unknown as { dropBounty(e: Enemy, def: EnemyDef): void }).dropBounty(
      { x: 10, y: 20 } as Enemy,
      ENEMY_DEFS.bat,
    );

    expect(values.reduce((sum, value) => sum + value, 0)).toBe(ENEMY_DEFS.bat.bounty);
    expect(values).toHaveLength(2);
  });
});

describe('enemy controller edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null instead of forcing a spawn into blocked terrain', () => {
    const ctx = {
      physics: { entityFree: () => false },
      particles: { burst: () => undefined },
      enemies: [],
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);

    expect(enemies.spawn('slime', 40, 40)).toBeNull();
    expect(ctx.enemies).toHaveLength(0);
  });

  it('returns null for unknown enemy kinds instead of reading missing defs', () => {
    const ctx = {
      physics: { entityFree: () => true },
      enemies: [],
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);

    expect(enemies.spawn('not-a-kind' as never, 40, 40)).toBeNull();
    expect(ctx.enemies).toHaveLength(0);
  });

  it('supports exact authored spawns without relocating into another pocket', () => {
    const ctx = {
      state: { mode: 'build' },
      physics: {
        entityFree: (_x: number, y: number) => y >= 45,
      },
      particles: { burst: () => undefined },
      enemies: [],
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);

    expect(enemies.spawn('slime', 40, 40, { exact: true })).toBeNull();
    const relocated = enemies.spawn('slime', 40, 40, { rng: () => 0.5 });

    expect(relocated?.y).toBe(45);
    expect(ctx.enemies).toHaveLength(1);
  });

  it('preserves authored sleeping state for prefab Weavers', () => {
    const calls: Array<{ kind: Enemy['kind']; x: number; y: number; opts?: EnemySpawnOptions }> = [];
    const spawned = makeEnemy('weaver', { x: 11, y: 12, hp: 1, maxHp: 1 });
    const ctx = {
      enemyCtl: {
        spawn: (kind: Enemy['kind'], x: number, y: number, opts?: EnemySpawnOptions) => {
          calls.push({ kind, x, y, opts });
          return spawned;
        },
      },
    } as unknown as Ctx;

    spawnPrefabEnemy(ctx, { kind: 'weaver', x: 42, y: 36, sleeping: true });

    expect(calls).toEqual([{ kind: 'weaver', x: 42, y: 36, opts: { exact: true } }]);
    expect(spawned.sleeping).toBe(true);
    expect(spawned.x).toBe(11);
    expect(spawned.y).toBe(12);
  });

  it('wakes and alerts sleeping enemies when they take damage', () => {
    const enemy = makeEnemy('bat', { sleeping: true, alerted: false, vy: 0 });
    const ctx = {
      particles: {
        burst: () => undefined,
        spawn: () => undefined,
      },
      world: new World(80, 80),
      enemies: [enemy],
      params: { global: { bloodAmount: 1, goreBlood: 1, goreSlime: 1, goreOoze: 1 } },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);

    enemies.damage(enemy, 3, 0, 0);

    expect(enemy.sleeping).toBe(false);
    expect(enemy.alerted).toBe(true);
    expect(enemy.vy).toBeGreaterThan(0);
  });

  it('uses one fireproof hazard contract for bosses and imps', () => {
    expect(enemyLethalCell('imp', Cell.Fire)).toBe(false);
    expect(enemyLethalCell('colossus', Cell.Lava)).toBe(false);
    expect(enemyLethalCell('leviathan', Cell.Fire)).toBe(false);
    expect(enemyLethalCell('slime', Cell.Fire)).toBe(true);

    const world = new World(60, 60);
    const colossus = makeEnemy('colossus', { x: 20, y: 30, hp: 30, maxHp: 30, envDamageFeedbackCd: 99 });
    world.types[world.idx(20, 30)] = Cell.Lava;
    const ctx = {
      world,
      particles: { burst: () => undefined },
      enemies: [colossus],
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);

    (enemies as unknown as { enemyEnvironmentDamage(e: Enemy): void }).enemyEnvironmentDamage(colossus);

    expect(colossus.hp).toBe(30);
  });

  it('samples environmental damage across the enemy footprint', () => {
    const world = new World(60, 60);
    const enemy = {
      kind: 'slime',
      x: 20,
      y: 30,
      hp: 20,
      maxHp: 20,
      envDamageFeedbackCd: 99,
    } as Enemy;
    world.types[world.idx(25, 30)] = Cell.Acid;
    const ctx = {
      world,
      particles: { burst: () => undefined },
      enemies: [enemy],
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);

    (enemies as unknown as { enemyEnvironmentDamage(e: Enemy): void }).enemyEnvironmentDamage(enemy);

    expect(enemy.hp).toBeLessThan(20);
  });

  it('lets the Powder Mage throw fallback loose materials and reports empty rooms', () => {
    const world = new World(120, 90);
    const spawned: Array<{ type: number | null }> = [];
    const ctx = {
      world,
      player: { x: 80, y: 40 },
      particles: {
        spawn: (
          _x: number,
          _y: number,
          _vx: number,
          _vy: number,
          type: number | null,
        ) => spawned.push({ type }),
      },
      audio: { tone: () => undefined },
      camera: { x: 0, y: 0 },
      fx: { screenShake: 0 },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);
    const mage = { kind: 'mage', x: 50, y: 45, attackCd: 200 } as Enemy;

    expect((enemies as unknown as { telekinesisVolley(e: Enemy): boolean }).telekinesisVolley(mage)).toBe(false);
    world.types[world.idx(48, 42)] = Cell.Ash;
    world.colors[world.idx(48, 42)] = 0x554433;

    expect((enemies as unknown as { telekinesisVolley(e: Enemy): boolean }).telekinesisVolley(mage)).toBe(true);
    expect(spawned.some((p) => p.type === Cell.Ash)).toBe(true);
    expect(world.types[world.idx(48, 42)]).toBe(Cell.Empty);
  });

  it('lets the Powder Mage chip real stone when loose ammunition is unavailable', () => {
    const world = new World(120, 90);
    const spawned: Array<{ type: number | null }> = [];
    const ctx = {
      world,
      player: { x: 86, y: 44 },
      particles: {
        spawn: (_x: number, _y: number, _vx: number, _vy: number, type: number | null) => spawned.push({ type }),
      },
      audio: { tone: () => undefined },
      camera: { x: 0, y: 0 },
      fx: { screenShake: 0 },
      levels: { current: null },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);
    const mage = makeEnemy('mage', { x: 50, y: 45 });
    const chip = world.idx(56, 32);
    world.replaceCellAt(chip, Cell.Stone, 0x777777);

    expect((enemies as unknown as { mageVolley(e: Enemy): boolean }).mageVolley(mage)).toBe(true);

    expect(spawned.some((p) => p.type === Cell.Stone)).toBe(true);
    expect(world.types[chip]).toBe(Cell.Empty);
  });

  it('lets Spitters root into the grid with toxic habitat cells', () => {
    const world = new World(80, 70);
    const spitter = makeEnemy('spitter', { x: 34, y: 44, timer: 30, grounded: true });
    world.replaceCellAt(world.idx(34, 46), Cell.Stone, 0x777777);
    const ctx = {
      world,
      state: { frameCount: 0 },
      particles: { burst: () => undefined },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);

    (enemies as unknown as { spitterRootHabitat(e: Enemy, def: EnemyDef): void }).spitterRootHabitat(spitter, ENEMY_DEFS.spitter);

    expect(world.types[world.idx(34, 45)]).toBe(Cell.Toxic);
  });

  it('reads Root Loper footing from real growth and stamps only capped soft growth', () => {
    const world = new World(90, 70);
    const ctx = {
      world,
      player: { x: 75, y: 40 },
      physics: {
        cellBlocks: (x: number, y: number) => world.inBounds(x, y) && blocksEntity(world.types[world.idx(x, y)]),
      },
      particles: { burst: () => undefined },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);
    const root = { kind: 'rootloper', x: 42, y: 42, rootGrowthBudget: 4 } as Enemy;
    for (let x = 24; x <= 60; x += 3) {
      world.replaceCellAt(world.idx(x, 40), Cell.Vines, 0x33aa44);
      world.replaceCellAt(world.idx(x, 37), Cell.Moss, 0x336633);
    }

    const footing = (enemies as unknown as {
      rootLoperFooting(e: Enemy, def: EnemyDef): { support: number; growth: number; hazard: number; seekDir: number };
    }).rootLoperFooting(root, ENEMY_DEFS.rootloper);
    expect(footing.support).toBeGreaterThan(0.5);
    expect(footing.growth).toBeGreaterThan(0);

    for (let x = 20; x <= 64; x++) world.replaceCellAt(world.idx(x, 44), Cell.Stone, 0x777777);
    const before = world.types.slice();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const placed = (enemies as unknown as { stampRootLoperGrowth(e: Enemy, support: number): number }).stampRootLoperGrowth(
      root,
      0.8,
    );

    expect(placed).toBeGreaterThan(0);
    expect(root.rootGrowthBudget).toBeLessThanOrEqual(3);
    let changed = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i] === world.types[i]) continue;
      changed++;
      expect([Cell.Vines, Cell.Moss, Cell.Fungus]).toContain(world.types[i]);
      expect(blocksEntity(world.types[i])).toBe(false);
    }
    expect(changed).toBe(placed);
  });

  it('keeps Stone Maw chewing bounded and refuses Metal or Glass', () => {
    const world = new World(90, 70);
    const spawned: Array<{ type: number | null }> = [];
    const ctx = {
      world,
      player: { x: 70, y: 36 },
      particles: {
        spawn: (_x: number, _y: number, _vx: number, _vy: number, type: number | null) => spawned.push({ type }),
        burst: () => undefined,
      },
      audio: { hollowKnock: () => undefined },
      camera: { x: 0, y: 0 },
      fx: { screenShake: 0 },
      levels: { current: null },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);
    const maw = { kind: 'stonemaw', x: 35, y: 36, mawDir: 1 } as Enemy;
    for (let y = 28; y <= 36; y++) {
      for (let x = 44; x <= 52; x++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x777777);
    }
    const metal = world.idx(46, 32);
    const glass = world.idx(47, 33);
    world.replaceCellAt(metal, Cell.Metal, 0x778899);
    world.replaceCellAt(glass, Cell.Glass, 0xaabbcc);
    const before = world.types.slice();

    const chewed = (enemies as unknown as { stoneMawChewBrush(e: Enemy, def: EnemyDef): number }).stoneMawChewBrush(
      maw,
      ENEMY_DEFS.stonemaw,
    );

    expect(chewed).toBeGreaterThan(0);
    expect(chewed).toBeLessThanOrEqual(7);
    expect(world.types[metal]).toBe(Cell.Metal);
    expect(world.types[glass]).toBe(Cell.Glass);
    expect(maw.mawChewT).toBeGreaterThan(0);
    expect(maw.mawChewCd).toBeGreaterThan(0);
    const opened = before.reduce((sum, t, i) => sum + (t !== Cell.Empty && world.types[i] === Cell.Empty ? 1 : 0), 0);
    expect(opened).toBe(chewed);
    expect(spawned.length).toBeLessThanOrEqual(chewed);
  });

  it('shares the protected terrain brush for Golem punches near progression objects', () => {
    const ctx = {
      levels: {
        current: {
          spawn: { x: 10, y: 10 },
          mechanisms: [{ x: 44, y: 48, w: 10, h: 14 }],
          runeVaults: [],
          waystones: [],
        },
      },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);

    expect((enemies as unknown as { protectedCellInRadius(x: number, y: number, radius: number): boolean }).protectedCellInRadius(50, 42, 6)).toBe(
      true,
    );
    expect((enemies as unknown as { protectedCellInRadius(x: number, y: number, radius: number): boolean }).protectedCellInRadius(80, 60, 6)).toBe(
      false,
    );
  });

  it('collides flying enemies against walls instead of drifting through them', () => {
    const ctx = {
      physics: {
        tryMoveEntity: (ent: { x: number; y: number }, dx: number, dy: number) => {
          if (dx > 0 && ent.x >= 50) return false;
          ent.x += dx;
          ent.y += dy;
          return true;
        },
      },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);
    const imp = makeEnemy('imp', { x: 50, y: 40, vx: 3, vy: 0, fx: 0, fy: 0 });

    (enemies as unknown as { integrateFlying(e: Enemy, def: EnemyDef, spd: number): void }).integrateFlying(imp, ENEMY_DEFS.imp, 1);

    expect(imp.x).toBe(50);
    expect(imp.vx).toBe(0);
  });

  it('lets offscreen egg clutches keep aging and hatch without running full combat AI', () => {
    const egg = makeEnemy('eggs', { timer: 1500, bobPhase: 0, x: 30, y: 30 });
    const enemiesList: Enemy[] = [egg];
    const ctx = {
      enemies: enemiesList,
      enemyCtl: {
        spawn: (kind: Enemy['kind'], x: number, y: number) => {
          const e = makeEnemy(kind, { x, y });
          enemiesList.push(e);
          return e;
        },
      },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);

    (enemies as unknown as { tickOffscreenLifecycle(index: number, e: Enemy, debugEnemyAttacksSuppressed: boolean): void }).tickOffscreenLifecycle(
      0,
      egg,
      false,
    );

    expect(ctx.enemies).toHaveLength(2);
    expect(ctx.enemies.every((e) => e.kind === 'slime')).toBe(true);
  });

  it('lets Rillback read wetness and charge only water or blood conductors', () => {
    const world = new World(70, 60);
    const ctx = {
      world,
      audio: { zap: () => undefined },
      particles: { burst: () => undefined },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);
    const rill = { kind: 'rillback', x: 30, y: 34, rillChargeCd: 0, blink: 0 } as Enemy;
    const cells = [
      [29, 34, Cell.Water],
      [31, 34, Cell.Blood],
      [27, 34, Cell.Slime],
      [29, 32, Cell.Acid],
    ] as const;
    for (const [x, y, t] of cells) world.replaceCellAt(world.idx(x, y), t, 0x335577);

    const footing = (enemies as unknown as {
      rillbackLiquidFooting(e: Enemy, def: EnemyDef): { wet: number; hazard: number; conductor: number };
    }).rillbackLiquidFooting(rill, ENEMY_DEFS.rillback);
    expect(footing.wet).toBeGreaterThan(0);
    expect(footing.hazard).toBeGreaterThan(0);

    const charged = (enemies as unknown as { rillbackChargePulse(e: Enemy, def: EnemyDef): number }).rillbackChargePulse(
      rill,
      ENEMY_DEFS.rillback,
    );

    expect(charged).toBe(2);
    expect(world.charge[world.idx(29, 34)]).toBeGreaterThan(0);
    expect(world.activeCharges.has(world.idx(29, 34))).toBe(true);
    expect(world.charge[world.idx(31, 34)]).toBeGreaterThan(0);
    expect(world.charge[world.idx(27, 34)]).toBe(0);
    expect(world.charge[world.idx(29, 32)]).toBe(0);
    expect(rill.rillChargeCd).toBeGreaterThan(0);
    expect(rill.blink).toBeGreaterThan(0);
  });
});

describe('weaver encounter contract', () => {
  it('adds sparse organic enemies to biome populations', () => {
    expect(ENEMY_DEFS.weaver).toMatchObject({ hp: 260, halfW: 9, h: 18 });
    expect(ENEMY_DEFS.rootloper).toMatchObject({ hp: 90, halfW: 6, h: 14 });
    expect(ENEMY_DEFS.stonemaw).toMatchObject({ hp: 150, halfW: 8, h: 10 });
    expect(ENEMY_DEFS.rillback).toMatchObject({ hp: 58, halfW: 7, h: 8 });

    expect(populationForLevel(LEVELS.d1, EXTRAS.earthen.foes).weaver ?? 0).toBe(0);
    expect(populationForLevel(LEVELS.d2, EXTRAS.fungal.foes).weaver).toBe(1);
    expect(populationForLevel(LEVELS.d2, EXTRAS.fungal.foes).rootloper).toBe(2);
    expect(populationForLevel(LEVELS.d4, EXTRAS.flooded.foes).rillback).toBe(1);
    expect(populationForLevel(LEVELS.d5, EXTRAS.timber.foes).weaver).toBe(1);
    expect(populationForLevel(LEVELS.d5, EXTRAS.timber.foes).rootloper).toBe(1);
    expect(populationForLevel(LEVELS.d6, EXTRAS.crystal.foes).stonemaw).toBe(1);
    expect(populationForLevel(LEVELS.d8, EXTRAS.volcanic.foes).stonemaw).toBe(1);
    // Adding the Weaver's weight shifts the ROUNDED counts of the other timber
    // foes (weightSum 12 -> 12.25): pin the full d5 roster so that rebalance stays
    // intentional and any future silent drift is caught.
    expect(populationForLevel(LEVELS.d5, EXTRAS.timber.foes)).toMatchObject({
      imp: 13,
      slime: 10,
      bomber: 10,
      bat: 7,
      weaver: 1,
      rootloper: 1,
    });
    expect(LEVELS['weaver-test']).toMatchObject({
      id: 'weaver-test',
      biome: 'fungal',
      depth: 0,
      nextLevelId: null,
    });
  });

  it('keeps placed enemy populations inside the readable campaign budget', () => {
    for (const def of Object.values(LEVELS)) {
      if (def.depth <= 0) continue;
      const foes = EXTRAS[def.biome].foes;
      const pop = populationForLevel(def, foes);
      const base = Object.values(pop).reduce((sum, count) => sum + (count ?? 0), 0);
      const reserved =
        (foes.bat ? 4 : 0) +
        (foes.slime ? 2 : 0) +
        (def.depth === 4 && !def.branch ? 1 : 0) +
        (def.depth === 8 && !def.branch ? 1 : 0) +
        (def.branch ? 2 : 0);

      expect(base + reserved).toBeLessThanOrEqual(70);
      expect(base + reserved).toBeGreaterThanOrEqual(45);
    }
  });

  it('keeps Builder enemy authoring in sync with runtime enemy definitions', () => {
    expect([...BUILDER_ENEMY_KINDS].sort()).toEqual(Object.keys(ENEMY_DEFS).sort());
    expect(PATROL_KINDS.has('weaver')).toBe(true);
    expect(PATROL_KINDS.has('rootloper')).toBe(true);
    expect(PATROL_KINDS.has('stonemaw')).toBe(false);
    expect(PATROL_KINDS.has('rillback')).toBe(false);
  });

  it('counts slime as preferred Weaver footing without changing global soft-growth rules', () => {
    const world = new World(120, 90);
    const ctx = { world } as unknown as Ctx;
    const enemies = new Enemies(ctx);
    const weaver = { kind: 'weaver', x: 60, y: 50 } as Enemy;
    for (let x = 47; x <= 73; x += 4) world.types[world.idx(x, 50)] = Cell.Slime;

    const support = (enemies as unknown as { weaverFooting(e: Enemy, def: EnemyDef): number }).weaverFooting(
      weaver,
      ENEMY_DEFS.weaver,
    );

    expect(isSoftGrowth(Cell.Slime)).toBe(false);
    expect(support).toBeGreaterThan(0);
  });

  it('stamps compact campaign lair webs above the Weaver body lane', () => {
    const world = new World(180, 140);
    world.types.fill(Cell.Empty);
    for (let x = 30; x <= 150; x++) world.replaceCellAt(world.idx(x, 50), Cell.Stone, 0x555055);
    const before = world.types.slice();
    const ctx = { world } as unknown as Ctx;
    const levels = new Levels(ctx);
    const webs: WeaverLairWeb[] = [];

    (levels as unknown as {
      stampWeaverLair(ctx: Ctx, x: number, y: number, rng: Rng, weaverLairWebs: WeaverLairWeb[]): void;
    }).stampWeaverLair(ctx, 90, 96, new Rng(7), webs);

    expect(webs).toHaveLength(1);
    const web = webs[0];
    expect(web.radius).toBeGreaterThanOrEqual(24);
    expect(web.radius).toBeLessThanOrEqual(34);
    expect(web.radials).toBeGreaterThanOrEqual(6);
    expect(web.radials).toBeLessThanOrEqual(8);
    expect(web.rings).toBeGreaterThanOrEqual(3);
    expect(web.rings).toBeLessThanOrEqual(4);
    expect(web.thickness).toBe(1);
    expect(web.y + web.radius).toBeLessThanOrEqual(96 - 18);

    for (let i = 0; i < before.length; i++) {
      if (before[i] !== Cell.Empty || world.types[i] === Cell.Empty) continue;
      expect(isSoftGrowth(world.types[i])).toBe(true);
      expect(blocksEntity(world.types[i])).toBe(false);
    }
  });

  it('stamps organic trio lairs as grid-real habitat without new blockers', () => {
    const world = new World(180, 140);
    world.types.fill(Cell.Empty);
    for (let x = 30; x <= 150; x++) {
      world.replaceCellAt(world.idx(x, 50), Cell.Stone, 0x555055);
      world.replaceCellAt(world.idx(x, 112), Cell.Stone, 0x555055);
    }
    for (let y = 62; y <= 104; y++) {
      for (let x = 20; x <= 54; x++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x555055);
      for (let x = 126; x <= 160; x++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x555055);
    }
    world.replaceCellAt(world.idx(45, 82), Cell.Metal, 0x778899);
    world.replaceCellAt(world.idx(135, 82), Cell.Glass, 0xaabbcc);
    const before = world.types.slice();
    const ctx = { world } as unknown as Ctx;
    const levels = new Levels(ctx);
    const lairs = levels as unknown as {
      stampRootLoperGrove(ctx: Ctx, x: number, y: number, rng: Rng): number;
      stampStoneMawSeam(ctx: Ctx, x: number, y: number, rng: Rng): number;
      stampRillbackPool(ctx: Ctx, x: number, y: number, rng: Rng): number;
    };

    const rootCells = lairs.stampRootLoperGrove(ctx, 90, 96, new Rng(11));
    const mawCells = lairs.stampStoneMawSeam(ctx, 90, 96, new Rng(12));
    const rillCells = lairs.stampRillbackPool(ctx, 90, 96, new Rng(13));

    expect(rootCells).toBeGreaterThan(0);
    expect(mawCells).toBeGreaterThan(0);
    expect(rillCells).toBeGreaterThan(0);
    expect(world.types[world.idx(45, 82)]).toBe(Cell.Metal);
    expect(world.types[world.idx(135, 82)]).toBe(Cell.Glass);

    let softGrowth = 0;
    let oreOrCoal = 0;
    let liquid = 0;
    for (let i = 0; i < before.length; i++) {
      if (world.types[i] === before[i]) continue;
      if (isSoftGrowth(world.types[i])) {
        softGrowth++;
        expect(blocksEntity(world.types[i])).toBe(false);
      }
      if (world.types[i] === Cell.RawOre || world.types[i] === Cell.Coal) oreOrCoal++;
      if (world.types[i] === Cell.Water || world.types[i] === Cell.Blood || world.types[i] === Cell.Slime) liquid++;
    }
    expect(softGrowth).toBeGreaterThan(0);
    expect(oreOrCoal).toBeGreaterThan(0);
    expect(liquid).toBeGreaterThan(0);
  });

  it('explains thread spit through a launched live web strand without open-air anchors', () => {
    const world = new World(120, 80);
    const webShots: Array<{ x: number; y: number; dirX: number; dirY: number; length?: number; ashOnExpire?: boolean }> = [];
    const ctx = {
      world,
      audio: { squelch: () => undefined },
      particles: { burst: () => undefined },
      vineStrands: {
        addWebShot: (
          x: number,
          y: number,
          dirX: number,
          dirY: number,
          opts?: { length?: number; ashOnExpire?: boolean },
        ) => {
          webShots.push({ x, y, dirX, dirY, length: opts?.length, ashOnExpire: opts?.ashOnExpire });
        },
      },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);
    const weaver = { kind: 'weaver', x: 20, y: 40, timer: 7 } as Enemy;

    (enemies as unknown as { weaveThread(e: Enemy, tx: number, ty: number): void }).weaveThread(weaver, 70, 35);

    let vines = 0;
    for (const t of world.types) if (t === Cell.Vines) vines++;
    expect(webShots).toHaveLength(1);
    expect(webShots[0]).toMatchObject({ x: 20.5, y: 30.5, ashOnExpire: true });
    expect(webShots[0].dirX).toBeCloseTo(0.995, 2);
    expect(webShots[0].dirY).toBeCloseTo(0.1, 2);
    expect(webShots[0].length).toBeGreaterThan(55);
    expect(vines).toBe(0);
  });

  it('feeds on nearby ambient cave life when not pressuring the player', () => {
    const prey: Critter = {
      kind: 'moth',
      x: 24,
      y: 32,
      vx: 0,
      vy: 0,
      phase: 0,
      gasp: 0,
      facing: 1,
    };
    const critters = [prey];
    const ctx = {
      critters: {
        list: critters,
        remove: (critter: Critter) => {
          const index = critters.indexOf(critter);
          if (index >= 0) return critters.splice(index, 1)[0];
          return undefined;
        },
      },
      audio: { squelch: () => undefined },
      particles: { burst: () => undefined },
    } as unknown as Ctx;
    const enemies = new Enemies(ctx);
    const weaver = {
      kind: 'weaver',
      x: 20,
      y: 40,
      hp: 200,
      maxHp: 260,
      attackCd: 0,
      weaverSupport: 1,
    } as Enemy;

    const fed = (enemies as unknown as { weaverFeed(e: Enemy): boolean }).weaverFeed(weaver);

    expect(fed).toBe(true);
    expect(critters).toHaveLength(0);
    expect(weaver.hp).toBeGreaterThan(200);
    expect(weaver.recoil).toBeGreaterThan(0);
  });

  it('wakes cranky when a nearby stomp or structure hit disturbs its sleep', () => {
    const events = new EventBus();
    const world = new World(200, 140);
    const calls = {
      burst: 0,
      impulse: 0,
      scatter: 0,
      squelch: 0,
      tone: 0,
      webShot: 0,
    };
    const countVines = () => {
      let vines = 0;
      for (const t of world.types) if (t === Cell.Vines) vines++;
      return vines;
    };
    const sleeper = {
      kind: 'weaver',
      x: 100,
      y: 80,
      vx: 0,
      vy: 0,
      sleeping: true,
      alerted: false,
      blink: 0,
      attackCd: 120,
    } as Enemy;
    const ctx = {
      events,
      world,
      enemies: [sleeper],
      player: { x: 30, y: 80 },
      audio: {
        squelch: () => {
          calls.squelch++;
        },
        tone: () => {
          calls.tone++;
        },
      },
      particles: {
        burst: () => {
          calls.burst++;
        },
      },
      critters: {
        scatter: () => {
          calls.scatter++;
        },
      },
      vineStrands: {
        addWebShot: () => {
          calls.webShot++;
        },
        applyRadialImpulse: () => {
          calls.impulse++;
        },
      },
      camera: { x: 0, y: 0 },
      fx: { screenShake: 0 },
    } as unknown as Ctx;
    const _enemies = new Enemies(ctx);

    events.emit('structureStrike', { x: 500, y: 80, radius: 6 });
    expect(sleeper.sleeping).toBe(true);

    events.emit('structureStrike', { x: 112, y: 72, radius: 6 });
    expect(sleeper.sleeping).toBe(false);
    expect(sleeper.alerted).toBe(true);
    expect(sleeper.cranky).toBeGreaterThan(0);
    expect(sleeper.attackCd).toBeLessThan(120);
    expect(sleeper.webPulse).toBeGreaterThan(0);
    expect(sleeper.vx).toBeGreaterThan(0);
    expect(countVines()).toBe(0);
    expect(calls.webShot).toBe(1);
    expect(calls.scatter).toBe(1);
    expect(calls.impulse).toBe(1);
    expect(calls.squelch).toBeGreaterThan(0);
    expect(calls.tone).toBeGreaterThan(0);
    expect(calls.burst).toBeGreaterThanOrEqual(2);
    expect(ctx.fx.screenShake).toBeGreaterThan(0);

    world.clear();
    calls.burst = 0;
    calls.impulse = 0;
    calls.scatter = 0;
    calls.squelch = 0;
    calls.tone = 0;
    calls.webShot = 0;
    ctx.fx.screenShake = 0;
    sleeper.sleeping = true;
    sleeper.alerted = false;
    sleeper.cranky = 0;
    sleeper.webPulse = 0;
    sleeper.attackCd = 120;
    events.emit('groundImpact', { x: 74, y: 82, radius: 28, strength: 0.8 });
    expect(sleeper.sleeping).toBe(false);
    expect(sleeper.alerted).toBe(true);
    expect(sleeper.cranky).toBeGreaterThan(0);
    expect(sleeper.webPulse).toBeGreaterThan(0);
    expect(countVines()).toBe(0);
    expect(calls.webShot).toBe(1);
    expect(calls.scatter).toBe(1);
    expect(calls.impulse).toBe(1);
    expect(calls.squelch).toBeGreaterThan(0);
    expect(calls.burst).toBeGreaterThanOrEqual(2);
    expect(ctx.fx.screenShake).toBeGreaterThan(0);
  });
});

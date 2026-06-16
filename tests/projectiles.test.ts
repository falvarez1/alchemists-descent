import { describe, expect, it } from 'vitest';

import { Projectiles } from '@/combat/Projectiles';
import type { CastAction } from '@/combat/wands/compiler';
import { PROJECTILE_MODS, TRIGGERED, TRIGGER_SOURCE_SPREAD } from '@/combat/wands/projectileMarks';
import type { CastActionExecutionContext, Ctx, Enemy, Projectile } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { vi } from 'vitest';

describe('projectile trigger payloads', () => {
  it('routes terminal impacts through the wand executor', () => {
    const world = new World();
    world.types[world.idx(6, 5)] = Cell.Stone;
    const projectile: Projectile = {
      x: 5,
      y: 5,
      vx: 1,
      vy: 0,
      type: 'bolt',
      life: 10,
      age: 0,
      charging: false,
      hostile: false,
    };
    const payload: CastAction = {
      card: 'dig',
      speedMul: 1,
      dmgMul: 1,
      spreadAdd: 0,
      infused: false,
      waterTrail: 0,
      oilTrail: 0,
      electricCharge: false,
      critWet: false,
      shortHoming: false,
      bounces: 0,
      triggered: null,
    };
    TRIGGERED.set(projectile, [payload]);
    TRIGGER_SOURCE_SPREAD.set(projectile, 0.123);
    const calls: Array<{
      action: CastAction;
      x: number;
      y: number;
      angle: number;
      options?: CastActionExecutionContext;
    }> = [];
    const ctx = {
      world,
      projectiles: [projectile],
      enemies: [],
      state: { mode: 'play', frameCount: 1 },
      player: { dead: false, crawling: false },
      params: {
        spells: {
          bolt: { explosionRadius: 3 },
        },
      },
      particles: {
        spawn: () => undefined,
        burst: () => undefined,
      },
      audio: {
        hollowKnock: () => undefined,
        implode: () => undefined,
      },
      events: {
        emit: () => undefined,
      },
      explosions: {
        trigger: () => undefined,
      },
      spells: {
        executeWarp: () => false,
        erodeAt: () => undefined,
      },
      enemyCtl: {
        damage: () => undefined,
      },
      playerCtl: {
        damage: () => undefined,
      },
      fx: {
        bloomKick: 0,
        screenShake: 0,
      },
      wands: {
        castActionAt: (
          _ctx: Ctx,
          action: CastAction,
          x: number,
          y: number,
          angle: number,
          options?: CastActionExecutionContext,
        ) => {
          calls.push({ action, x, y, angle, options });
        },
      },
    } as unknown as Ctx;

    new Projectiles().update(ctx);

    expect(ctx.projectiles).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: payload, x: 6, y: 5, angle: 0 });
    expect(calls[0].options).toMatchObject({ origin: 'trigger', sourceSpread: 0.123 });
  });

  it('uses bomb projectile damage multipliers when the fuse expires', () => {
    const world = new World();
    const projectile: Projectile = {
      x: 5,
      y: 5,
      vx: 0,
      vy: 0,
      type: 'bomb',
      life: 1,
      age: 0,
      charging: false,
      hostile: false,
      mul: 2,
    };
    const explosions: Array<{ x: number; y: number; r: number; enemyDamageMul?: number }> = [];
    const ctx = {
      world,
      projectiles: [projectile],
      enemies: [],
      state: { mode: 'play', frameCount: 1 },
      player: { dead: false, crawling: false },
      params: { spells: { bomb: { explosionRadius: 10 } } },
      particles: { spawn: () => undefined, burst: () => undefined },
      audio: { hollowKnock: () => undefined, implode: () => undefined },
      events: { emit: () => undefined },
      explosions: {
        trigger: (x: number, y: number, r: number, options?: { enemyDamageMul?: number }) => {
          explosions.push({ x, y, r, enemyDamageMul: options?.enemyDamageMul });
        },
      },
      spells: { executeWarp: () => false, erodeAt: () => undefined },
      enemyCtl: { damage: () => undefined },
      playerCtl: { damage: () => undefined },
      fx: { bloomKick: 0, screenShake: 0 },
      wands: { castActionAt: () => undefined },
    } as unknown as Ctx;

    new Projectiles().update(ctx);

    expect(explosions).toEqual([{ x: 5, y: 5, r: 11, enemyDamageMul: 2 }]);
    expect(ctx.projectiles).toHaveLength(0);
  });

  it('uses meteor damage multipliers when it hits terrain', () => {
    const world = new World();
    world.types[world.idx(6, 5)] = Cell.Stone;
    const projectile: Projectile = {
      x: 5,
      y: 5,
      vx: 1,
      vy: 0,
      type: 'meteor',
      life: 10,
      age: 0,
      charging: false,
      hostile: false,
      mul: 1.7,
    };
    const explosions: Array<{ x: number; y: number; r: number; enemyDamageMul?: number }> = [];
    const ctx = {
      world,
      projectiles: [projectile],
      enemies: [],
      state: { mode: 'play', frameCount: 1 },
      player: { dead: false, crawling: false },
      params: { spells: {} },
      particles: { spawn: () => undefined, burst: () => undefined },
      audio: { hollowKnock: () => undefined, implode: () => undefined },
      events: { emit: () => undefined },
      explosions: {
        trigger: (x: number, y: number, r: number, options?: { enemyDamageMul?: number }) => {
          explosions.push({ x, y, r, enemyDamageMul: options?.enemyDamageMul });
        },
      },
      spells: { executeWarp: () => false, erodeAt: () => undefined },
      enemyCtl: { damage: () => undefined },
      playerCtl: { damage: () => undefined },
      fx: { bloomKick: 0, screenShake: 0 },
      wands: { castActionAt: () => undefined },
    } as unknown as Ctx;

    new Projectiles().update(ctx);

    expect(explosions).toEqual([{ x: 6, y: 5, r: 40, enemyDamageMul: 1.7 }]);
    expect(ctx.projectiles).toHaveLength(0);
  });

  it('uses spatial enemy candidates while preserving player projectile hits', () => {
    const world = new World();
    const projectile: Projectile = {
      x: 5,
      y: 5,
      vx: 1,
      vy: 0,
      type: 'bolt',
      life: 10,
      age: 0,
      charging: false,
      hostile: false,
    };
    const near = enemyAt(6, 10);
    const far = enemyAt(80, 10);
    const damaged: Enemy[] = [];
    const explosions: Array<{ x: number; y: number; r: number }> = [];
    const ctx = {
      world,
      projectiles: [projectile],
      enemies: [near, far],
      state: { mode: 'play', frameCount: 1 },
      player: { dead: false, crawling: false },
      params: {
        spells: {
          bolt: { explosionRadius: 3 },
        },
      },
      particles: {
        spawn: () => undefined,
        burst: () => undefined,
      },
      audio: {
        hollowKnock: () => undefined,
        implode: () => undefined,
      },
      events: {
        emit: () => undefined,
      },
      explosions: {
        trigger: (x: number, y: number, r: number) => explosions.push({ x, y, r }),
      },
      spells: {
        executeWarp: () => false,
        erodeAt: () => undefined,
      },
      enemyCtl: {
        damage: (e: Enemy) => damaged.push(e),
      },
      playerCtl: {
        damage: () => undefined,
      },
      fx: {
        bloomKick: 0,
        screenShake: 0,
      },
      wands: {
        castActionAt: () => undefined,
      },
    } as unknown as Ctx;

    new Projectiles().update(ctx);

    expect(ctx.projectiles).toHaveLength(0);
    expect(damaged).toEqual([near]);
    expect(explosions).toEqual([{ x: 6, y: 5, r: 3 }]);
  });

  it('resyncs spatial enemy membership after lethal collateral damage', () => {
    const world = new World();
    const projectile: Projectile = {
      x: 5,
      y: 5,
      vx: 1,
      vy: 0,
      type: 'icelance',
      life: 10,
      age: 0,
      charging: false,
      hostile: false,
    };
    const first = enemyAt(6, 10);
    const collateral = enemyAt(7, 10);
    const damaged: Enemy[] = [];
    const ctx = {
      world,
      projectiles: [projectile],
      enemies: [first, collateral],
      state: { mode: 'play', frameCount: 1 },
      player: { dead: false, crawling: false },
      params: { spells: {} },
      particles: {
        spawn: () => undefined,
        burst: () => undefined,
      },
      audio: {
        tone: () => undefined,
        hollowKnock: () => undefined,
      },
      events: {
        emit: () => undefined,
      },
      explosions: {
        trigger: () => undefined,
      },
      spells: {
        executeWarp: () => false,
        erodeAt: () => undefined,
      },
      enemyCtl: {
        damage: (e: Enemy) => {
          damaged.push(e);
          e.hp = 0;
          ctx.enemies.length = 0;
        },
      },
      playerCtl: {
        damage: () => undefined,
      },
      fx: {
        bloomKick: 0,
        screenShake: 0,
      },
      wands: {
        castActionAt: () => undefined,
      },
    } as unknown as Ctx;

    new Projectiles().update(ctx);

    expect(damaged).toEqual([first]);
    expect(ctx.enemies).toHaveLength(0);
  });

  it('ages triggered black-hole payloads instead of leaving them in the charging lifecycle', () => {
    const world = new World();
    const host: Projectile = {
      x: 5,
      y: 5,
      vx: 1,
      vy: 0,
      type: 'bolt',
      life: 10,
      age: 0,
      charging: false,
      hostile: false,
    };
    const blackhole: CastAction = {
      card: 'blackhole',
      speedMul: 1,
      dmgMul: 1,
      spreadAdd: 0,
      infused: false,
      waterTrail: 0,
      oilTrail: 0,
      electricCharge: false,
      critWet: false,
      shortHoming: false,
      bounces: 0,
      triggered: [{
        card: 'spark',
        speedMul: 1,
        dmgMul: 1,
        spreadAdd: 0,
        infused: false,
        waterTrail: 0,
        oilTrail: 0,
        electricCharge: false,
        critWet: false,
        shortHoming: false,
        bounces: 0,
        triggered: null,
      }],
    };
    world.types[world.idx(6, 5)] = Cell.Stone;
    TRIGGERED.set(host, [blackhole]);
    const released: CastAction[] = [];
    const ctx = {
      world,
      projectiles: [host],
      enemies: [],
      state: { mode: 'play', frameCount: 1 },
      player: { dead: false, crawling: false },
      input: { activeChargingBlackHole: null },
      shockwaves: [],
      params: {
        spells: {
          bolt: { explosionRadius: 3 },
          blackhole: { baseRadius: 8, collapseLimit: 18, chargeRate: 1 },
        },
      },
      particles: {
        spawn: () => undefined,
        burst: () => undefined,
      },
      audio: {
        hollowKnock: () => undefined,
        implode: () => undefined,
      },
      events: {
        emit: () => undefined,
      },
      explosions: {
        trigger: () => undefined,
      },
      spells: {
        executeWarp: () => false,
        erodeAt: () => undefined,
      },
      enemyCtl: {
        damage: () => undefined,
      },
      playerCtl: {
        damage: () => undefined,
      },
      fx: {
        bloomKick: 0,
        screenShake: 0,
      },
      wands: {
        castActionAt: (_ctx: Ctx, action: CastAction, x: number, y: number, _angle: number, options?: CastActionExecutionContext) => {
          if (action.card === 'blackhole') {
            const p: Projectile = {
              x,
              y,
              vx: 0,
              vy: 0,
              type: 'blackhole',
              vortexRad: 8,
              life: 2,
              age: 0,
              charging: options?.origin !== 'trigger',
              hostile: false,
            };
            _ctx.projectiles.push(p);
            if (action.triggered) TRIGGERED.set(p, action.triggered);
            return;
          }
          released.push(action);
        },
      },
    } as unknown as Ctx;
    const projectiles = new Projectiles();

    projectiles.update(ctx);

    expect(ctx.input.activeChargingBlackHole).toBeNull();
    expect(ctx.projectiles).toHaveLength(1);
    expect(ctx.projectiles[0]).toMatchObject({ type: 'blackhole', charging: false });

    projectiles.update(ctx);
    projectiles.update(ctx);

    expect(ctx.projectiles).toHaveLength(0);
    expect(released.map((action) => action.card)).toEqual(['spark']);
  });

  it('clears stale cell metadata when frost converts water to ice', () => {
    const world = new World();
    const wall = world.idx(6, 5);
    const water = world.idx(6, 6);
    world.types[wall] = Cell.Stone;
    world.types[water] = Cell.Water;
    world.life[water] = 77;
    world.charge[water] = 12;
    const projectile: Projectile = {
      x: 5,
      y: 5,
      vx: 1,
      vy: 0,
      type: 'frostbolt',
      life: 10,
      age: 0,
      charging: false,
      hostile: false,
    };
    const ctx = {
      world,
      projectiles: [projectile],
      enemies: [],
      state: { mode: 'play', frameCount: 1 },
      player: { dead: false, crawling: false },
      params: { spells: {} },
      particles: {
        spawn: () => undefined,
        burst: () => undefined,
      },
      audio: {
        tone: () => undefined,
        hollowKnock: () => undefined,
      },
      events: {
        emit: () => undefined,
      },
      explosions: {
        trigger: () => undefined,
      },
      spells: {
        executeWarp: () => false,
        erodeAt: () => undefined,
      },
      enemyCtl: {
        damage: () => undefined,
      },
      playerCtl: {
        damage: () => undefined,
      },
      fx: {
        bloomKick: 0,
        screenShake: 0,
      },
      wands: {
        castActionAt: () => undefined,
      },
    } as unknown as Ctx;

    new Projectiles().update(ctx);

    expect(world.types[water]).toBe(Cell.Ice);
    expect(world.life[water]).toBe(0);
    expect(world.charge[water]).toBe(0);
  });

  it('deposits budgeted real water for Water Trail projectiles', () => {
    const world = new World();
    const projectile: Projectile = {
      x: 20,
      y: 20,
      vx: 2,
      vy: 0,
      type: 'bolt',
      life: 10,
      age: 0,
      charging: false,
      hostile: false,
    };
    PROJECTILE_MODS.set(projectile, { waterTrailBudget: 1, waterTrailCadence: 2 });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const ctx = {
      world,
      projectiles: [projectile],
      enemies: [],
      state: { mode: 'play', frameCount: 2 },
      player: { x: 100, y: 100, dead: false, crawling: false },
      params: { spells: { bolt: { explosionRadius: 3 } } },
      particles: {
        spawn: () => undefined,
        burst: () => undefined,
      },
      audio: {
        hollowKnock: () => undefined,
        implode: () => undefined,
      },
      events: {
        emit: () => undefined,
      },
      explosions: {
        trigger: () => undefined,
      },
      spells: {
        executeWarp: () => false,
        erodeAt: () => undefined,
      },
      enemyCtl: {
        damage: () => undefined,
      },
      playerCtl: {
        damage: () => undefined,
      },
      fx: {
        bloomKick: 0,
        screenShake: 0,
      },
      wands: {
        castActionAt: () => undefined,
      },
    } as unknown as Ctx;

    try {
      new Projectiles().update(ctx);
    } finally {
      random.mockRestore();
    }

    const waterCells = Array.from(world.types).filter((t) => t === Cell.Water).length;
    expect(waterCells).toBe(1);
    expect(PROJECTILE_MODS.get(projectile)?.waterTrailBudget).toBeUndefined();
  });

  it('deposits budgeted real oil for Oil Wick projectiles', () => {
    const world = new World();
    const projectile: Projectile = {
      x: 20,
      y: 20,
      vx: 2,
      vy: 0,
      type: 'bolt',
      life: 10,
      age: 0,
      charging: false,
      hostile: false,
    };
    PROJECTILE_MODS.set(projectile, { oilTrailBudget: 1, oilTrailCadence: 2 });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    try {
      new Projectiles().update(modifierCtx(world, projectile, { frameCount: 2 }));
    } finally {
      random.mockRestore();
    }

    const oilCells = Array.from(world.types).filter((t) => t === Cell.Oil).length;
    expect(oilCells).toBe(1);
    expect(PROJECTILE_MODS.get(projectile)?.oilTrailBudget).toBeUndefined();
  });

  it('electrifies hit enemies and charges nearby conductor cells', () => {
    const world = new World();
    const conductor = world.idx(7, 5);
    world.types[conductor] = Cell.Water;
    const projectile: Projectile = {
      x: 5,
      y: 5,
      vx: 1,
      vy: 0,
      type: 'bolt',
      life: 10,
      age: 0,
      charging: false,
      hostile: false,
    };
    const enemy = enemyAt(6, 10);
    PROJECTILE_MODS.set(projectile, { electricCharge: true });

    new Projectiles().update(modifierCtx(world, projectile, { enemies: [enemy], frameCount: 1 }));

    expect(enemy.status.electrified).toBe(60);
    expect(world.charge[conductor]).toBeGreaterThan(0);
  });

  it('nudges Short Homing projectiles toward nearby enemies for a limited window', () => {
    const world = new World();
    const projectile: Projectile = {
      x: 20,
      y: 20,
      vx: 2,
      vy: 0,
      type: 'bolt',
      life: 10,
      age: 4,
      charging: false,
      hostile: false,
    };
    const enemy = enemyAt(50, 45);
    PROJECTILE_MODS.set(projectile, { shortHomingFrames: 5, shortHomingCadence: 1 });

    new Projectiles().update(modifierCtx(world, projectile, { enemies: [enemy], frameCount: 4 }));

    expect(projectile.vy).toBeGreaterThan(0);
    expect(PROJECTILE_MODS.get(projectile)?.shortHomingFrames).toBe(4);
  });

  it('applies Critical on Wet only when the target is wet', () => {
    const dryWorld = new World();
    const wetWorld = new World();
    const dryProjectile: Projectile = {
      x: 5,
      y: 5,
      vx: 1,
      vy: 0,
      type: 'bolt',
      life: 10,
      age: 0,
      charging: false,
      hostile: false,
    };
    const wetProjectile: Projectile = { ...dryProjectile };
    const dryEnemy = enemyAt(6, 10);
    const wetEnemy = enemyAt(6, 10);
    wetEnemy.status.wet = 20;
    PROJECTILE_MODS.set(dryProjectile, { critWet: true });
    PROJECTILE_MODS.set(wetProjectile, { critWet: true });
    const dryDamage: number[] = [];
    const wetDamage: number[] = [];
    const makeCtx = (world: World, projectile: Projectile, enemy: Enemy, damage: number[]): Ctx =>
      ({
        world,
        projectiles: [projectile],
        enemies: [enemy],
        state: { mode: 'play', frameCount: 1 },
        player: { x: 100, y: 100, dead: false, crawling: false },
        params: { spells: { bolt: { explosionRadius: 3 } } },
        particles: {
          spawn: () => undefined,
          burst: () => undefined,
        },
        audio: {
          hollowKnock: () => undefined,
          implode: () => undefined,
          tone: () => undefined,
        },
        events: {
          emit: () => undefined,
        },
        explosions: {
          trigger: () => undefined,
        },
        spells: {
          executeWarp: () => false,
          erodeAt: () => undefined,
        },
        enemyCtl: {
          defs: { slime: { halfW: 4, h: 8 } },
          damage: (_enemy: Enemy, amount: number) => damage.push(amount),
        },
        playerCtl: {
          damage: () => undefined,
        },
        fx: {
          bloomKick: 0,
          screenShake: 0,
        },
        wands: {
          castActionAt: () => undefined,
        },
      }) as unknown as Ctx;

    new Projectiles().update(makeCtx(dryWorld, dryProjectile, dryEnemy, dryDamage));
    new Projectiles().update(makeCtx(wetWorld, wetProjectile, wetEnemy, wetDamage));

    expect(dryDamage[0]).toBeCloseTo(18);
    expect(wetDamage[0]).toBeCloseTo(18 * 1.8);
  });

  it('advances large blackhole terrain slices across repeated sim substeps in the same render frame', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(1);
    try {
      const world = new World(180, 180);
      world.types.fill(Cell.Wall);
      const projectile: Projectile = {
        x: 90,
        y: 90,
        vx: 0,
        vy: 0,
        type: 'blackhole',
        vortexRad: 64,
        life: 20,
        age: 0,
        charging: false,
        hostile: false,
      };
      const ctx = modifierCtx(world, projectile, {
        frameCount: 77,
        player: { x: 170, y: 170, vx: 0, vy: 0 },
      });
      const projectiles = new Projectiles();

      projectiles.update(ctx);
      const afterFirst = countCells(world, Cell.Empty);
      projectiles.update(ctx);

      expect(afterFirst).toBeGreaterThan(0);
      expect(projectile.age).toBe(2);
      expect(countCells(world, Cell.Empty)).toBeGreaterThan(afterFirst);
    } finally {
      random.mockRestore();
    }
  });
});

function countCells(world: World, cell: Cell): number {
  let count = 0;
  for (const type of world.types) {
    if (type === cell) count++;
  }
  return count;
}

function enemyAt(x: number, y: number): Enemy {
  return {
    kind: 'slime',
    x,
    y,
    hp: 10,
    flash: 0,
    status: {},
  } as Enemy;
}

function modifierCtx(
  world: World,
  projectile: Projectile,
  opts: {
    enemies?: Enemy[];
    frameCount?: number;
    player?: Partial<Ctx['player']>;
  } = {},
): Ctx {
  return {
    world,
    projectiles: [projectile],
    enemies: opts.enemies ?? [],
    state: { mode: 'play', frameCount: opts.frameCount ?? 1 },
    player: { x: 100, y: 100, dead: false, crawling: false, status: {}, ...opts.player },
    params: { spells: { bolt: { explosionRadius: 3 } } },
    particles: {
      spawn: () => undefined,
      burst: () => undefined,
    },
    audio: {
      hollowKnock: () => undefined,
      implode: () => undefined,
      tone: () => undefined,
    },
    events: {
      emit: () => undefined,
    },
    explosions: {
      trigger: () => undefined,
    },
    spells: {
      executeWarp: () => false,
      erodeAt: () => undefined,
    },
    enemyCtl: {
      defs: { slime: { halfW: 4, h: 8 } },
      damage: () => undefined,
    },
    playerCtl: {
      damage: () => undefined,
    },
    fx: {
      bloomKick: 0,
      screenShake: 0,
    },
    wands: {
      castActionAt: () => undefined,
    },
  } as unknown as Ctx;
}

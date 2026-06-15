import { describe, expect, it } from 'vitest';

import { Projectiles } from '@/combat/Projectiles';
import type { CastAction } from '@/combat/wands/compiler';
import { TRIGGERED } from '@/combat/wands/projectileMarks';
import type { CastActionExecutionContext, Ctx, Projectile } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

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
      bounces: 0,
      triggered: null,
    };
    TRIGGERED.set(projectile, [payload]);
    const calls: Array<{ action: CastAction; x: number; y: number; angle: number }> = [];
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
        castActionAt: (_ctx: Ctx, action: CastAction, x: number, y: number, angle: number) => {
          calls.push({ action, x, y, angle });
        },
      },
    } as unknown as Ctx;

    new Projectiles().update(ctx);

    expect(ctx.projectiles).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: payload, x: 6, y: 5, angle: 0 });
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
      bounces: 0,
      triggered: [{
        card: 'spark',
        speedMul: 1,
        dmgMul: 1,
        spreadAdd: 0,
        infused: false,
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
});

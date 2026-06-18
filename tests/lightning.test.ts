import { afterEach, describe, expect, it, vi } from 'vitest';

import { Lightning } from '@/combat/Lightning';
import type { Ctx, Enemy } from '@/core/types';
import { World } from '@/sim/World';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Lightning', () => {
  it('strikes nearby enemies through the spatial index path', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const world = new World(64, 64);
    const near = enemyAt(10, 10);
    const far = enemyAt(40, 10);
    const damaged: Enemy[] = [];
    const ctx = {
      world,
      enemies: [near, far],
      params: {
        spells: {
          lightning: { range: 20, branches: 0, damage: 7 },
        },
        global: { chargeStrength: 1 },
      },
      enemyCtl: {
        damage: (enemy: Enemy, amount: number) => {
          damaged.push(enemy);
          enemy.hp -= amount;
          if (enemy.hp <= 0) ctx.enemies.splice(ctx.enemies.indexOf(enemy), 1);
        },
      },
      explosions: {
        trigger: () => undefined,
      },
      fx: {
        screenShake: 0,
      },
      audio: {
        lightning: () => undefined,
      },
    } as unknown as Ctx;

    const lightning = new Lightning(ctx);
    lightning.cast(5, 5, 0);

    expect(damaged).toEqual([near]);
    expect(near.hp).toBe(13);
    expect(far.hp).toBe(20);
    expect(lightning.arcs).toHaveLength(1);
    expect(lightning.arcs[0].pts.length).toBeGreaterThan(1);
  });
});

function enemyAt(x: number, y: number): Enemy {
  return {
    x,
    y,
    hp: 20,
  } as Enemy;
}

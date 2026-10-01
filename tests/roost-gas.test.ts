import { describe, expect, it } from 'vitest';

import { HEIGHT, WIDTH } from '@/config/constants';
import { Rng } from '@/core/rng';
import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { Levels } from '@/game/Levels';

/**
 * A bat roost prefers a marsh-gas dome (GEN 62): on a floor that holds one, the brood hangs under the gas
 * (a lit pocket over it is the floor's own trap); on a floor without gas the ordinary search is unchanged.
 */

type RoostFinder = (ctx: Ctx, rng: Rng, spawn: { x: number; y: number }, regions: undefined, reachable: Uint8Array) => { x: number; y: number } | null;

function fixture(withGas: boolean): { ctx: Ctx; reachable: Uint8Array; find: RoostFinder; gasX: [number, number] } {
  const world = new World();
  for (let i = 0; i < world.types.length; i++) world.types[i] = Cell.Wall;
  // one long chamber, 60 tall, ceiling at y = 300
  for (let y = 300; y <= 360; y++) for (let x = 100; x <= 1400; x++) world.types[world.idx(x, y)] = Cell.Empty;
  const gasX: [number, number] = [900, 1000];
  if (withGas) for (let y = 300; y < 312; y++) for (let x = gasX[0]; x <= gasX[1]; x++) world.types[world.idx(x, y)] = Cell.MarshGas;
  const reachable = new Uint8Array(world.types.length);
  for (let y = 300; y <= 360; y++) for (let x = 100; x <= 1400; x++) reachable[world.idx(x, y)] = 1;
  const ctx = {
    world,
    enemyCtl: { defs: { bat: { halfW: 4, h: 6 } } },
    physics: { entityFree: () => true },
  } as unknown as Ctx;
  const levels = Object.create(Levels.prototype) as { findRoostSpot: RoostFinder };
  return { ctx, reachable, find: (c, r, s, g, a) => levels.findRoostSpot(c, r, s, g, a), gasX };
}

describe('Levels.findRoostSpot', () => {
  it('hangs the brood under the gas dome when the floor has one', () => {
    const { ctx, reachable, find, gasX } = fixture(true);
    for (let seed = 1; seed <= 12; seed++) {
      const spot = find(ctx, new Rng(seed), { x: 120, y: 340 }, undefined, reachable);
      expect(spot, `seed ${seed}`).not.toBeNull();
      expect(spot!.x).toBeGreaterThanOrEqual(gasX[0] - 4);
      expect(spot!.x).toBeLessThanOrEqual(gasX[1] + 4);
      expect(spot!.y).toBeLessThan(316);
    }
  });

  it('searches the whole ceiling, as before, on a floor with no gas', () => {
    const { ctx, reachable, find } = fixture(false);
    const xs = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const spot = find(ctx, new Rng(seed), { x: 120, y: 340 }, undefined, reachable);
      if (spot) xs.add(Math.floor(spot.x / 200));
    }
    expect(xs.size, 'roosts spread along the ceiling').toBeGreaterThan(3);
    expect(HEIGHT).toBeGreaterThan(0);
    expect(WIDTH).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';

import type { Ctx } from '@/core/types';
import { Physics } from '@/entities/physics';
import { Cell, blocksEntity, isSolid } from '@/sim/CellType';
import { cellBlocksEntityWithLooseRubble, computeLooseRubbleBlockingMask } from '@/sim/collision';
import { World } from '@/sim/World';
import { computeFits } from '@/world/validate';

function set(world: World, x: number, y: number, t: Cell): void {
  world.types[world.idx(x, y)] = t;
}

describe('loose-rubble collision parity', () => {
  it('treats isolated metal as blocking in runtime collision and findability fits', () => {
    const world = new World();
    set(world, 40, 34, Cell.Metal);

    expect(cellBlocksEntityWithLooseRubble(world, 40, 34)).toBe(true);

    const fits = computeFits(world);
    expect(fits[40 + 50 * world.width]).toBe(0);
    expect(fits[60 + 50 * world.width]).toBe(1);
  });

  it('uses 8-connected clusters for both runtime collision and findability fits', () => {
    const world = new World();
    for (let n = 0; n < 5; n++) set(world, 40 + n, 30 + n, Cell.Stone);

    expect(cellBlocksEntityWithLooseRubble(world, 40, 30)).toBe(true);

    const fits = computeFits(world);
    expect(fits[42 + 50 * world.width]).toBe(0);
  });

  it('keeps clusters smaller than five cells walk-through rubble', () => {
    const world = new World();
    for (let n = 0; n < 4; n++) set(world, 40 + n, 30 + n, Cell.Stone);

    expect(cellBlocksEntityWithLooseRubble(world, 40, 30)).toBe(false);

    const fits = computeFits(world);
    expect(fits[41 + 49 * world.width]).toBe(1);
  });

  it('routes Physics.cellBlocks through the shared loose-rubble contract', () => {
    const world = new World();
    for (let n = 0; n < 5; n++) set(world, 40 + n, 30 + n, Cell.Stone);
    set(world, 60, 30, Cell.Metal);
    set(world, 80, 30, Cell.Stone);

    const physics = new Physics({ world } as unknown as Ctx);

    expect(physics.cellBlocks(40, 30)).toBe(true);
    expect(physics.cellBlocks(60, 30)).toBe(true);
    expect(physics.cellBlocks(80, 30)).toBe(false);
  });

  it('keeps soft growth grid-real but pass-through for bodies and findability', () => {
    for (const growth of [Cell.Vines, Cell.Moss, Cell.Fungus, Cell.Glowshroom]) {
      const world = new World();
      for (let n = 0; n < 5; n++) set(world, 40 + n, 30, growth);

      expect(isSolid(growth)).toBe(true);
      expect(blocksEntity(growth)).toBe(false);
      expect(cellBlocksEntityWithLooseRubble(world, 40, 30)).toBe(false);
      expect(computeLooseRubbleBlockingMask(world)[40 + 30 * world.width]).toBe(0);

      const fits = computeFits(world);
      expect(fits[42 + 50 * world.width]).toBe(1);
    }
  });
});

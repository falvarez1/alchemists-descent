import { describe, expect, it } from 'vitest';

import { createGameParams } from '@/config/params';
import type { Ctx } from '@/core/types';
import { updateElectricalGrid } from '@/sim/electrical';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

describe('updateElectricalGrid', () => {
  it('spreads charge to the established conductor neighbors and decays the source', () => {
    const world = new World(8, 8);
    const source = world.idx(3, 3);
    world.types[source] = Cell.Metal;
    world.charge[source] = 5;
    world.types[world.idx(4, 3)] = Cell.Water;
    world.types[world.idx(2, 3)] = Cell.Metal;
    world.types[world.idx(3, 4)] = Cell.Acid;
    world.types[world.idx(2, 2)] = Cell.Blood;
    world.types[world.idx(3, 2)] = Cell.Metal;

    updateElectricalGrid(ctxFor(world));

    expect(world.charge[source]).toBe(4);
    expect(world.charge[world.idx(4, 3)]).toBe(4);
    expect(world.charge[world.idx(2, 3)]).toBe(4);
    expect(world.charge[world.idx(3, 4)]).toBe(4);
    expect(world.charge[world.idx(2, 2)]).toBe(4);
    expect(world.charge[world.idx(3, 2)]).toBe(0);
  });

  it('ignores charged cells outside the active simulation window', () => {
    const world = new World(8, 8);
    world.simBounds.x0 = 0;
    world.simBounds.x1 = 4;
    world.simBounds.y0 = 0;
    world.simBounds.y1 = 4;
    const outside = world.idx(6, 6);
    world.types[outside] = Cell.Metal;
    world.charge[outside] = 7;

    updateElectricalGrid(ctxFor(world));

    expect(world.charge[outside]).toBe(7);
  });
});

function ctxFor(world: World): Ctx {
  return {
    world,
    params: createGameParams(),
  } as Ctx;
}

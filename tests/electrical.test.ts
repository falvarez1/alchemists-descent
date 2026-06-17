import { describe, expect, it } from 'vitest';

import { createGameParams } from '@/config/params';
import type { Ctx } from '@/core/types';
import { updateElectricalGrid } from '@/sim/electrical';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

describe('updateElectricalGrid', () => {
  it('spreads ATTENUATED charge to water/metal neighbors only (acid/blood no longer conduct) and decays the source', () => {
    const world = new World(8, 8);
    const source = world.idx(3, 3);
    world.types[source] = Cell.Metal;
    world.charge[source] = 8;
    world.types[world.idx(4, 3)] = Cell.Water; // x+1     conductor
    world.types[world.idx(2, 3)] = Cell.Metal; // x-1     conductor
    world.types[world.idx(3, 4)] = Cell.Acid; // x,y+1    no longer conducts
    world.types[world.idx(2, 2)] = Cell.Blood; // x-1,y-1 no longer conducts
    world.types[world.idx(3, 2)] = Cell.Metal; // x,y-1   not in the neighbor list

    updateElectricalGrid(ctxFor(world));

    expect(world.charge[source]).toBe(7); // decays by 1
    expect(world.charge[world.idx(4, 3)]).toBe(7); // src - 1 (attenuated, was a flat 4)
    expect(world.charge[world.idx(2, 3)]).toBe(7);
    expect(world.charge[world.idx(3, 4)]).toBe(0); // acid no longer conducts
    expect(world.charge[world.idx(2, 2)]).toBe(0); // blood no longer conducts
    expect(world.charge[world.idx(3, 2)]).toBe(0); // not a tracked neighbor direction
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

  it('discovers directly restored charges when the simulation window reaches a new tile', () => {
    const world = new World(128, 8);
    world.simBounds.x0 = 0;
    world.simBounds.x1 = 16;
    world.simBounds.y0 = 0;
    world.simBounds.y1 = 8;
    const restored = world.idx(80, 3);
    world.types[restored] = Cell.Metal;
    world.charge[restored] = 5;

    updateElectricalGrid(ctxFor(world));
    expect(world.charge[restored]).toBe(5);

    world.simBounds.x0 = 64;
    world.simBounds.x1 = 96;
    updateElectricalGrid(ctxFor(world));

    expect(world.charge[restored]).toBe(4);
  });
});

function ctxFor(world: World): Ctx {
  return {
    world,
    params: createGameParams(),
  } as Ctx;
}

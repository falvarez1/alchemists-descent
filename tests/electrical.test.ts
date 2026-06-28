import { describe, expect, it } from 'vitest';

import { createGameParams } from '@/config/params';
import type { Ctx } from '@/core/types';
import { updateElectricalGrid } from '@/sim/electrical';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

describe('updateElectricalGrid', () => {
  it('spreads ATTENUATED charge through the four cardinal neighbors only and decays the source', () => {
    const world = new World(8, 8);
    const source = world.idx(3, 3);
    world.types[source] = Cell.Metal;
    world.charge[source] = 8;
    world.types[world.idx(4, 3)] = Cell.Water; // x+1     conductor
    world.types[world.idx(2, 3)] = Cell.Metal; // x-1     conductor
    world.types[world.idx(3, 4)] = Cell.Acid; // x,y+1    still inert
    world.types[world.idx(3, 2)] = Cell.Metal; // x,y-1   conductor

    updateElectricalGrid(ctxFor(world));

    expect(world.charge[source]).toBe(7); // decays by 1
    expect(world.charge[world.idx(4, 3)]).toBe(5); // water: src - base*3 (far less conductive)
    expect(world.charge[world.idx(2, 3)]).toBe(7); // metal: src - base (carries far)
    expect(world.charge[world.idx(3, 4)]).toBe(0); // acid does not conduct
    expect(world.charge[world.idx(3, 2)]).toBe(7); // straight up conducts like the other cardinals

    const diagonalWorld = new World(8, 8);
    const diagonalSource = diagonalWorld.idx(3, 3);
    diagonalWorld.types[diagonalSource] = Cell.Metal;
    diagonalWorld.charge[diagonalSource] = 8;
    diagonalWorld.types[diagonalWorld.idx(2, 2)] = Cell.Blood;

    updateElectricalGrid(ctxFor(diagonalWorld));

    expect(diagonalWorld.charge[diagonalWorld.idx(2, 2)]).toBe(0); // diagonal wet gore is not a neighbor
  });

  it('uses live material conductivity when attenuating conductor spread', () => {
    const world = new World(8, 8);
    const source = world.idx(3, 3);
    world.types[source] = Cell.Metal;
    world.charge[source] = 8;
    world.types[world.idx(2, 3)] = Cell.Metal;
    const params = createGameParams();
    params.materials = structuredClone(params.materials);
    params.materials[Cell.Metal] = { ...params.materials[Cell.Metal], conductivity: 0.25 };

    updateElectricalGrid(ctxFor(world, params));

    expect(world.charge[world.idx(2, 3)]).toBe(4);
  });

  it('caps metal-to-water intake without weakening metal-to-lava propagation', () => {
    const world = new World(8, 8);
    const source = world.idx(3, 3);
    const water = world.idx(4, 3);
    const lava = world.idx(2, 3);
    world.types[source] = Cell.Metal;
    world.charge[source] = 80;
    world.types[water] = Cell.Water;
    world.types[lava] = Cell.Lava;

    updateElectricalGrid(ctxFor(world));

    expect(world.charge[water]).toBe(15);
    expect(world.charge[lava]).toBe(79);
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

  it('decays independent worlds on the same frame count', () => {
    const params = createGameParams();
    params.global.chargeFalloff = 1;
    params.global.chargeDecay = 1;
    const frameCount = ++testFrame;
    const first = chargedWorld();
    const second = chargedWorld();

    updateElectricalGrid({ world: first, params, state: { frameCount } } as Ctx);
    updateElectricalGrid({ world: second, params, state: { frameCount } } as Ctx);

    expect(first.charge[first.idx(3, 3)]).toBe(4);
    expect(second.charge[second.idx(3, 3)]).toBe(4);
  });
});

function chargedWorld(): World {
  const world = new World(8, 8);
  const source = world.idx(3, 3);
  world.types[source] = Cell.Metal;
  world.charge[source] = 5;
  return world;
}

// Decay now fires once per FRAME (updateElectricalGrid gates on frameCount), so
// each call gets a fresh, advancing frame — every decay-expecting call decays.
let testFrame = 0;
function ctxFor(world: World, params = createGameParams()): Ctx {
  // Pin the tuning these assertions assume — production defaults are tuned for
  // long in-game reach/glow, but the unit math here expects 1 lost per hop at the
  // best conductor and 1 decayed per frame.
  params.global.chargeFalloff = 1;
  params.global.chargeDecay = 1;
  return {
    world,
    params,
    state: { frameCount: ++testFrame },
  } as Ctx;
}

import { describe, expect, it } from 'vitest';

import { createGameParams } from '@/config/params';
import type { Ctx } from '@/core/types';
import { updateElectricalGrid } from '@/sim/electrical';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { mockRandom } from './helpers/randomSeam';

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

  it('decays charged cells outside the camera interest window', () => {
    const world = new World(8, 8);
    world.simBounds.x0 = 0;
    world.simBounds.x1 = 4;
    world.simBounds.y0 = 0;
    world.simBounds.y1 = 4;
    const outside = world.idx(6, 6);
    world.types[outside] = Cell.Metal;
    world.charge[outside] = 7;

    updateElectricalGrid(ctxFor(world));

    expect(world.charge[outside]).toBe(6);
  });

  it('discovers restored charges immediately and keeps decaying through a window move', () => {
    const world = new World(128, 8);
    world.simBounds.x0 = 0;
    world.simBounds.x1 = 16;
    world.simBounds.y0 = 0;
    world.simBounds.y1 = 8;
    const restored = world.idx(80, 3);
    world.types[restored] = Cell.Metal;
    world.charge[restored] = 5;

    updateElectricalGrid(ctxFor(world));
    expect(world.charge[restored]).toBe(4);

    world.simBounds.x0 = 64;
    world.simBounds.x1 = 96;
    updateElectricalGrid(ctxFor(world));

    expect(world.charge[restored]).toBe(3);
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

/**
 * THE SUMP HOLDS ITS WATER (fix3): the Sunken Leviathan's pool drained itself
 * mid-fight because every current in it spalled the stone drain plugs set into
 * its metal floor. These pin the three rules that stopped it.
 */
describe('electro-erosion keeps to the strike', () => {
  /** A 5-wide, 16-deep pool in a metal tub whose floor is one stone plug. */
  function sump(): { world: World; plug: number; surface: number } {
    const world = new World(9, 24);
    for (let y = 2; y <= 20; y++) {
      world.types[world.idx(1, y)] = Cell.Metal;
      world.types[world.idx(7, y)] = Cell.Metal;
    }
    for (let x = 1; x <= 7; x++) world.types[world.idx(x, 20)] = Cell.Metal;
    const plug = world.idx(4, 20);
    world.types[plug] = Cell.Stone;
    for (let y = 4; y <= 19; y++) for (let x = 2; x <= 6; x++) world.types[world.idx(x, y)] = Cell.Water;
    return { world, plug, surface: world.idx(4, 4) };
  }
  function run(world: World, frames: number): void {
    const params = createGameParams(); // shipped falloff / decay / erosion
    for (let f = 0; f < frames; f++) {
      updateElectricalGrid({ world, params, state: { frameCount: ++testFrame }, particles: { spawn: () => undefined } } as unknown as Ctx);
    }
  }

  it('a strike on the surface does not bore out the plug 16 rows down', () => {
    mockRandom().mockReturnValue(0); // every eligible bite lands
    const { world, plug, surface } = sump();
    world.setChargeAt(surface, 70); // a lightning strike's deposit (chargeDeposit 20)
    run(world, 90);
    expect(world.types[plug]).toBe(Cell.Stone);
  });

  it('a strike right beside wet rock still chips it', () => {
    mockRandom().mockReturnValue(0);
    const world = new World(6, 6);
    const water = world.idx(2, 2), rock = world.idx(3, 2);
    world.types[water] = Cell.Water;
    world.types[rock] = Cell.Stone;
    world.setChargeAt(water, 70);
    run(world, 2);
    expect(world.types[rock]).toBe(Cell.Empty);
  });

  it('metal carries its current without arcing into the rock it holds', () => {
    mockRandom().mockReturnValue(0);
    const world = new World(6, 6);
    const metal = world.idx(2, 2), rock = world.idx(3, 2);
    world.types[metal] = Cell.Metal;
    world.types[rock] = Cell.Stone;
    world.setChargeAt(metal, 210); // a blast rings metal at chargeDeposit(60)
    run(world, 60);
    expect(world.types[rock]).toBe(Cell.Stone);
  });

  it('blood takes the capped water intake from metal, so it cannot relay the full current into a pool', () => {
    const world = new World(8, 8);
    const metal = world.idx(3, 3), blood = world.idx(4, 3);
    world.types[metal] = Cell.Metal;
    world.charge[metal] = 80;
    world.types[blood] = Cell.Blood;
    updateElectricalGrid(ctxFor(world));
    expect(world.charge[blood]).toBe(15);
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

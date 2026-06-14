import { describe, expect, it } from 'vitest';

import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { packRGB, unpackG } from '@/sim/colors';
import { polishCaveTerrain } from '@/world/terrainPolish';

const ROCK = packRGB(62, 92, 58);

function setCell(world: World, x: number, y: number, type: number, color = ROCK): void {
  const i = world.idx(x, y);
  world.types[i] = type;
  world.colors[i] = color;
}

function clearCell(world: World, x: number, y: number): void {
  setCell(world, x, y, Cell.Empty, 0);
}

function fillRect(world: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) setCell(world, x, y, Cell.Wall);
  }
}

describe('cave terrain polish', () => {
  it('fills a tiny enclosed notch with neighboring terrain shade', () => {
    const world = new World(24, 24);
    fillRect(world, 6, 6, 16, 16);
    clearCell(world, 12, 10);

    const stats = polishCaveTerrain(world, { seed: 77, minY: 1, floorBand: 23 });
    const i = world.idx(12, 10);

    expect(stats.notchesFilled).toBeGreaterThan(0);
    expect(world.types[i]).toBe(Cell.Wall);
    expect(unpackG(world.colors[i])).toBeGreaterThan(80);
    expect(unpackG(world.colors[i])).toBeLessThan(100);
  });

  it('plugs a shallow pit between two exposed floor shoulders', () => {
    const world = new World(32, 24);
    fillRect(world, 2, 16, 29, 23);
    for (let x = 13; x <= 18; x++) {
      for (let y = 16; y <= 19; y++) clearCell(world, x, y);
    }

    const stats = polishCaveTerrain(world, { seed: 91, minY: 1, floorBand: 23 });

    expect(stats.surfaceCellsFilled).toBeGreaterThan(0);
    for (let x = 13; x <= 18; x++) {
      for (let y = 16; y <= 19; y++) expect(world.types[world.idx(x, y)]).toBe(Cell.Wall);
    }
  });

  it('does not seal a deeper shaft through a surface', () => {
    const world = new World(32, 24);
    fillRect(world, 2, 16, 29, 23);
    for (let x = 13; x <= 18; x++) {
      for (let y = 16; y <= 22; y++) clearCell(world, x, y);
    }

    polishCaveTerrain(world, { seed: 105, minY: 1, floorBand: 23 });

    expect(world.types[world.idx(15, 16)]).toBe(Cell.Empty);
    expect(world.types[world.idx(16, 18)]).toBe(Cell.Empty);
  });
});

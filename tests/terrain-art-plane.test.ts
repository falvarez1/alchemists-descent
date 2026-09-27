import { describe, expect, it } from 'vitest';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import {
  ART_AIR_MASK, ART_BUILT_BIT, ART_DEPTH_MASK, ART_LOOSE_BIT, ART_SEALED_BIT, ART_SOLID_BIT,
  TerrainArtPlane, type ArtPlaneOptions,
} from '@/render/terrainArtPlane';

const OPTIONS: ArtPlaneOptions = { builtRun: 24, lining: 8, zones: [] };

/** Rock from row 60 down, with a long straight floor and a 45° slope. */
function cave(width = 256, height = 192): World {
  const world = new World(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const slope = x >= 160 && y >= 60 - (x - 160); // a diagonal rise on the right
    if (y >= 60 || slope) world.types[world.idx(x, y)] = Cell.Wall;
  }
  return world;
}

const solidDepth = (plane: TerrainArtPlane, world: World, x: number, y: number): number => {
  const v = plane.data[world.idx(x, y)];
  expect(v & ART_SOLID_BIT).toBe(ART_SOLID_BIT);
  return v & ART_DEPTH_MASK;
};
const built = (plane: TerrainArtPlane, world: World, x: number, y: number): boolean =>
  (plane.data[world.idx(x, y)] & (ART_SOLID_BIT | ART_BUILT_BIT)) === (ART_SOLID_BIT | ART_BUILT_BIT);

function dig(world: World, cx: number, cy: number, r: number, type: number = Cell.Empty): void {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
    world.types[world.idx(x, y)] = type;
    world.activity.touch(x, y);
  }
}

describe('terrain art plane', () => {
  it('measures depth into rock and air distance out of it', () => {
    const world = cave();
    const plane = new TerrainArtPlane(world, OPTIONS);
    expect(solidDepth(plane, world, 40, 60)).toBe(1);
    expect(solidDepth(plane, world, 40, 64)).toBe(5);
    expect(solidDepth(plane, world, 40, 150)).toBe(20); // clamped at the field reach
    expect(plane.data[world.idx(40, 59)] & ART_AIR_MASK).toBe(1);
    expect(plane.data[world.idx(40, 54)] & ART_AIR_MASK).toBe(6);
  });

  it('lines long straight faces with masonry and leaves diagonals natural', () => {
    const world = cave();
    const plane = new TerrainArtPlane(world, OPTIONS);
    expect(built(plane, world, 60, 60)).toBe(true);   // the straight floor
    expect(built(plane, world, 60, 63)).toBe(true);   // its lining
    expect(built(plane, world, 60, 90)).toBe(false);  // the core behind it
    expect(built(plane, world, 200, 21)).toBe(false); // the 45° face
    expect(built(plane, world, 201, 24)).toBe(false);
  });

  it('builds every face inside an authored footprint', () => {
    const world = cave();
    const plane = new TerrainArtPlane(world, { ...OPTIONS, zones: [{ x0: 190, y0: 10, x1: 220, y1: 40 }] });
    expect(built(plane, world, 200, 20)).toBe(true);
  });

  it('seals small buried air pockets so they do not light the rock around them', () => {
    const world = cave();
    dig(world, 60, 130, 3);
    const plane = new TerrainArtPlane(world, OPTIONS);
    const pocket = plane.data[world.idx(60, 130)];
    expect(pocket & ART_SEALED_BIT).toBe(ART_SEALED_BIT);
    expect(solidDepth(plane, world, 60, 126)).toBe(20);
  });

  it('keeps a large enclosed cavern exposed', () => {
    const world = cave();
    dig(world, 80, 130, 24);
    const plane = new TerrainArtPlane(world, OPTIONS);
    expect(plane.data[world.idx(80, 130)] & ART_SEALED_BIT).toBe(0);
    expect(solidDepth(plane, world, 80, 130 + 25)).toBe(1);
  });

  it('re-derives a dig to the same fields a fresh build would make', () => {
    const world = cave();
    const plane = new TerrainArtPlane(world, OPTIONS);
    // A shaft from the surface, then a chamber at its foot.
    for (let y = 60; y < 100; y++) for (let x = 50; x < 54; x++) { world.types[world.idx(x, y)] = Cell.Empty; world.activity.touch(x, y); }
    dig(world, 52, 104, 6);
    plane.sync(0, 0, world.width, world.height);
    const fresh = new TerrainArtPlane(world, OPTIONS);
    let compared = 0;
    for (let y = 70; y < 140; y++) for (let x = 20; x < 90; x++) {
      const i = world.idx(x, y);
      const mask = plane.data[i] & ART_SOLID_BIT ? ART_DEPTH_MASK | ART_SOLID_BIT : ART_AIR_MASK | ART_SEALED_BIT | ART_LOOSE_BIT;
      expect(plane.data[i] & mask).toBe(fresh.data[i] & mask);
      compared++;
    }
    expect(compared).toBeGreaterThan(4000);
    expect(plane.data[world.idx(52, 104)] & ART_SEALED_BIT).toBe(0); // dug from the surface: exposed
  });

  it('never turns a straight tunnel dug through rock into masonry', () => {
    const world = cave();
    const plane = new TerrainArtPlane(world, OPTIONS);
    for (let x = 20; x < 120; x++) for (let y = 120; y < 126; y++) { world.types[world.idx(x, y)] = Cell.Empty; world.activity.touch(x, y); }
    for (let y = 60; y < 120; y++) { world.types[world.idx(20, y)] = Cell.Empty; world.activity.touch(20, y); }
    plane.sync(0, 0, world.width, world.height);
    expect(built(plane, world, 70, 126)).toBe(false);
    expect(built(plane, world, 70, 119)).toBe(false);
    expect(solidDepth(plane, world, 70, 126)).toBe(1);
  });

  it('treats liquid as part of the mass and converges on liquid churn over later syncs', () => {
    const world = cave();
    dig(world, 100, 110, 5, Cell.Water);
    const plane = new TerrainArtPlane(world, OPTIONS);
    expect(plane.data[world.idx(100, 110)] & ART_LOOSE_BIT).toBe(ART_LOOSE_BIT);
    expect(solidDepth(plane, world, 100, 103)).toBe(20); // no lit halo around a water pore
    // The pore drains into a sealed hollow: shading only, applied within a few syncs.
    dig(world, 100, 110, 5, Cell.Empty);
    for (let k = 0; k < 8; k++) plane.sync(0, 0, world.width, world.height);
    expect(plane.data[world.idx(100, 110)] & ART_SEALED_BIT).toBe(ART_SEALED_BIT);
  });
});

import { describe, expect, it } from 'vitest';

import { HEIGHT, WIDTH } from '@/config/constants';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { extractRegionGraph } from '@/world/regions';

/** Open a rectangle of empty space: [x0, x1) x [y0, y1) in world cells. */
function carve(world: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) world.types[x + y * world.width] = Cell.Empty;
  }
}

/**
 * Synthetic level: two chambers joined by an open tunnel (one region) plus a
 * fully sealed pocket below chamber A, separated by a 16-world-cell wall.
 *
 *   A [100,300)x[200,400) --tunnel [300,500)x[284,316)-- B [500,700)x[200,400)
 *   pocket [150,230)x[416,452)   (wall y 400..415 between A and the pocket)
 */
function buildTestWorld(): World {
  const world = new World();
  world.types.fill(Cell.Wall);
  carve(world, 100, 200, 300, 400); // chamber A
  carve(world, 500, 200, 700, 400); // chamber B
  carve(world, 300, 284, 500, 316); // connecting tunnel
  carve(world, 150, 416, 230, 452); // sealed pocket (area 180 downsampled cells)
  return world;
}

describe('region graph extraction', () => {
  const world = buildTestWorld();
  const spawn = { x: 200, y: 300 }; // inside chamber A
  const exit = { x: 600, y: 300 }; // inside chamber B

  const t0 = performance.now();
  const graph = extractRegionGraph(world, spawn, exit);
  const elapsed = performance.now() - t0;

  const ds = (v: number): number => Math.floor(v / 4);
  const chamberLabel = graph.labels[ds(200) + ds(300) * graph.w];
  const pocketLabel = graph.labels[ds(190) + ds(430) * graph.w];

  it('downsamples to the contract dimensions', () => {
    expect(graph.scale).toBe(4);
    expect(graph.w).toBe(WIDTH / 4);
    expect(graph.h).toBe(HEIGHT / 4);
    expect(graph.labels.length).toBe(graph.w * graph.h);
  });

  it('finds the chamber complex and the sealed pocket as separate regions', () => {
    expect(graph.regions.length).toBeGreaterThanOrEqual(2);
    expect(chamberLabel).toBeGreaterThanOrEqual(0);
    expect(pocketLabel).toBeGreaterThanOrEqual(0);
    expect(pocketLabel).not.toBe(chamberLabel);
    // Tunnel-joined chambers flood-fill into ONE region.
    expect(graph.labels[ds(600) + ds(300) * graph.w]).toBe(chamberLabel);
  });

  it('flags the sealed pocket as a pocket (small + off the main path)', () => {
    const pocket = graph.regions[pocketLabel];
    expect(pocket.area).toBeGreaterThan(0);
    expect(pocket.area).toBeLessThan(220);
    expect(pocket.onMainPath).toBe(false);
    expect(pocket.isPocket).toBe(true);
    expect(graph.regions[chamberLabel].isPocket).toBe(false);
  });

  it('records a pocket<->chamber edge with the real wall thickness and midpoint', () => {
    const a = Math.min(chamberLabel, pocketLabel);
    const b = Math.max(chamberLabel, pocketLabel);
    const edge = graph.edges.find((e) => e.a === a && e.b === b);
    expect(edge).toBeDefined();
    // The separating wall is world rows 400..415 -> 4 downsampled cells = 16.
    expect(edge!.minWallThickness).toBe(16);
    expect(edge!.mx).toBeGreaterThanOrEqual(148);
    expect(edge!.mx).toBeLessThanOrEqual(232);
    expect(edge!.my).toBeGreaterThanOrEqual(400);
    expect(edge!.my).toBeLessThanOrEqual(416);
  });

  it('anchors spawn/exit in the chamber complex and walks the main path', () => {
    expect(graph.spawnRegion).toBe(chamberLabel);
    expect(graph.exitRegion).toBe(chamberLabel);
    expect(graph.mainPath).toEqual([chamberLabel]);
    expect(graph.regions[chamberLabel].onMainPath).toBe(true);
  });

  it('completes a full-size world in under 2 seconds', () => {
    expect(elapsed).toBeLessThan(2000);
  });

  it('never throws on a degenerate all-solid world', () => {
    const sealed = new World();
    sealed.types.fill(Cell.Metal);
    const g = extractRegionGraph(sealed, { x: 10, y: 10 }, { x: 100, y: 100 });
    expect(g.regions.length).toBe(0);
    expect(g.spawnRegion).toBe(-1);
    expect(g.exitRegion).toBe(-1);
    expect(g.mainPath).toEqual([]);
  });
});

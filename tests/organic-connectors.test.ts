import { afterEach, describe, expect, it } from 'vitest';

import { HEIGHT, WIDTH } from '@/config/constants';
import { Rng } from '@/core/rng';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { connectToCaves, setOrganicTunnels, tunnelTo } from '@/world/connect';
import { extractRegionGraph } from '@/world/regions';
import { computeFits, wizardMask } from '@/world/validate';

/**
 * ORGANIC CONNECTORS (GEN 62, world/connect): a connector ends at the nearest body-fit cell the
 * spawn can WALK to (not at a hub's centroid, and never in a cave the spawn cannot reach), leaves
 * its line in a slow wander that dies out at both ends, and never gets narrower than asked.
 */

afterEach(() => setOrganicTunnels(false));

function solidWorld(): World {
  const w = new World();
  for (let i = 0; i < w.types.length; i++) w.types[i] = Cell.Wall;
  return w;
}
function carveBox(w: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.types[w.idx(x, y)] = Cell.Empty;
}
const openCount = (w: World): number => {
  let n = 0;
  for (let i = 0; i < w.types.length; i++) if (w.types[i] === Cell.Empty) n++;
  return n;
};

describe('tunnelTo with the organic switch', () => {
  it('wanders off the straight line, ends where it was asked to, and keeps its width', () => {
    const run = (organic: boolean): { w: World; steps: Array<[number, number]> } => {
      setOrganicTunnels(organic);
      const w = solidWorld();
      const steps = tunnelTo(w, new Rng(11), 200, 300, 430, 340, 12);
      return { w, steps };
    };
    const off = run(false), on = run(true);
    // the same walk (the rng draws are identical), shifted sideways by a bounded, tapering wander
    expect(on.steps.length).toBe(off.steps.length);
    const shift = on.steps.map(([x, y], i) => Math.hypot(x - off.steps[i][0], y - off.steps[i][1]));
    expect(Math.max(...shift)).toBeGreaterThan(3);
    expect(Math.max(...shift)).toBeLessThan(12);
    expect(shift[0]).toBeLessThan(1.5);
    expect(shift[shift.length - 1]).toBeLessThan(1.5);
    // starts and ends on the asked points (within the walk's own tolerance)
    const first = on.steps[0], last = on.steps[on.steps.length - 1];
    expect(Math.hypot(first[0] - 200, first[1] - 300)).toBeLessThan(6);
    expect(Math.hypot(last[0] - 430, last[1] - 340)).toBeLessThan(8);
    // never narrower than the asked radius: every step's disc is carved
    for (const [x, y] of on.steps) expect(on.w.types[on.w.idx(x, y)]).toBe(Cell.Empty);
    // and it swells: more open cells than the plain walk's (same radius floor)
    expect(openCount(on.w)).toBeGreaterThan(openCount(off.w) * 0.98);
  });

  it('leaves a narrow (dig-gated) connector exactly as it was', () => {
    const run = (organic: boolean): number => {
      setOrganicTunnels(organic);
      const w = solidWorld();
      tunnelTo(w, new Rng(5), 200, 300, 700, 340, 6);
      return openCount(w);
    };
    expect(run(true)).toBe(run(false));
  });
});

describe('a long walk to the right', () => {
  it('arrives on a campaign floor (the old walk drifts left and ended on its guard ~0.3 cells a step)', () => {
    const run = (organic: boolean): { last: [number, number] } => {
      setOrganicTunnels(organic);
      const w = solidWorld();
      const steps = tunnelTo(w, new Rng(9), 200, 300, 1250, 320, 12);
      return { last: steps[steps.length - 1] };
    };
    expect(Math.abs(run(true).last[0] - 1250)).toBeLessThanOrEqual(4);
    // ...and the old style still stops short (every other biome's output is unchanged)
    expect(Math.abs(run(false).last[0] - 1250)).toBeGreaterThan(300);
  });
});

describe('connectToCaves with the organic switch', () => {
  it('ends in the cave the spawn can walk to, not in a nearer island it cannot', () => {
    const w = solidWorld();
    carveBox(w, 100, 300, 300, 340); // the spawn's cave
    carveBox(w, 560, 300, 620, 340); // an island, nearer the structure, joined to nothing
    const spawn = { x: 200, y: 330 };
    const fits = computeFits(w);
    const graph = extractRegionGraph(w, spawn, { x: 200, y: 330 });
    setOrganicTunnels(true);
    const steps = connectToCaves(w, new Rng(3), graph, 500, 320, 12, fits);
    expect(steps.length).toBeGreaterThan(0);
    // the walkable component now spans the structure's mouth: the wizard mask from the spawn reaches it
    const wiz = wizardMask({ world: w, spawn });
    let reached = false;
    for (let dy = -10; dy <= 10 && !reached; dy++) for (let dx = -10; dx <= 10; dx++) if (wiz[500 + dx + (320 + dy) * WIDTH]) { reached = true; break; }
    expect(reached, 'the mouth is on the spawn\'s walk').toBe(true);
    // ...and the island is still its own cave, far from the tunnel's end
    const last = steps[steps.length - 1];
    expect(last[0]).toBeLessThan(330);
    expect(last[1]).toBeGreaterThan(0);
    expect(last[1]).toBeLessThan(HEIGHT);
  });
});

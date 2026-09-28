import { describe, expect, it } from 'vitest';

import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { distanceToSegment, mirrorNormal, PRISM_SPLIT, reflect, traceBeam } from '@/sim/beam';

/**
 * LIGHT THAT TURNS CORNERS (sim/beam): mirrors reflect off the face their cells
 * make, crystal splits a beam into two, glass passes it, rock stops it.
 */

function room(w = 120, h = 80): World {
  const world = new World(w, h);
  for (let x = 0; x < w; x++) { world.types[world.idx(x, 0)] = Cell.Wall; world.types[world.idx(x, h - 1)] = Cell.Wall; }
  for (let y = 0; y < h; y++) { world.types[world.idx(0, y)] = Cell.Wall; world.types[world.idx(w - 1, y)] = Cell.Wall; }
  return world;
}

/** A two-cell-thick mirror line from (x0, y0) in direction (dx, dy), n cells long. */
function mirrorLine(world: World, x0: number, y0: number, dx: number, dy: number, n: number): void {
  for (let k = 0; k < n; k++) {
    const x = x0 + dx * k, y = y0 + dy * k;
    world.types[world.idx(x, y)] = Cell.Mirror;
    world.types[world.idx(x + (dy !== 0 ? 1 : 0), y + (dx !== 0 && dy === 0 ? 1 : 0))] = Cell.Mirror;
  }
}

describe('mirror faces', () => {
  it('reads a vertical mirror as facing the beam horizontally', () => {
    const world = room();
    mirrorLine(world, 60, 20, 0, 1, 30);
    const [nx, ny] = mirrorNormal(world, 60, 35, 1, 0);
    expect(nx).toBeCloseTo(-1, 1);
    expect(Math.abs(ny)).toBeLessThan(0.2);
  });

  it('reads a diagonal mirror as a 45° face', () => {
    const world = room();
    mirrorLine(world, 40, 20, 1, 1, 30);
    const [nx, ny] = mirrorNormal(world, 55, 35, 1, 0);
    expect(Math.abs(nx)).toBeCloseTo(Math.SQRT1_2, 1);
    expect(Math.abs(ny)).toBeCloseTo(Math.SQRT1_2, 1);
    const [rx, ry] = reflect(1, 0, nx, ny);
    expect(Math.abs(rx)).toBeLessThan(0.15);
    expect(Math.abs(ry)).toBeCloseTo(1, 1);
  });
});

describe('traceBeam', () => {
  it('stops at rock and passes through glass', () => {
    const world = room();
    for (let y = 1; y < 79; y++) world.types[world.idx(50, y)] = Cell.Glass;
    for (let y = 1; y < 79; y++) world.types[world.idx(90, y)] = Cell.Stone;
    const segs = traceBeam(world, 10, 40, 0, 200);
    expect(segs).toHaveLength(1);
    expect(segs[0].end).toBe('stop');
    expect(segs[0].x1).toBeGreaterThan(88);
    expect(segs[0].x1).toBeLessThan(90);
  });

  it('turns a corner off a diagonal mirror and lands on the target', () => {
    const world = room();
    // A "\" mirror at x = y + 20 turns a rightward beam downward.
    mirrorLine(world, 40, 20, 1, 1, 40);
    const segs = traceBeam(world, 10, 40, 0, 300);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0].end).toBe('mirror');
    const turned = segs[1];
    expect(turned.depth).toBe(1);
    expect(turned.y1).toBeGreaterThan(turned.y0 + 20); // downward
    expect(Math.abs(turned.x1 - turned.x0)).toBeLessThan(4);
    // A lens at the bottom of that fall is on the beam.
    expect(distanceToSegment(turned.x0, 70, turned)).toBeLessThan(2);
  });

  it('splits in crystal into a warm and a cool beam, bent either way', () => {
    const world = room(200, 120);
    for (let y = 50; y < 70; y++) for (let x = 60; x < 64; x++) world.types[world.idx(x, y)] = Cell.Crystal;
    const segs = traceBeam(world, 10, 60, 0, 300);
    const daughters = segs.filter((s) => s.depth === 1);
    expect(daughters).toHaveLength(2);
    const tints = daughters.map((s) => s.tint).sort();
    expect(tints).toEqual([-1, 1]);
    for (const s of daughters) {
      const angle = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
      expect(Math.abs(Math.abs(angle) - PRISM_SPLIT)).toBeLessThan(0.05);
    }
  });

  it('is bounded: two facing mirrors do not trace forever', () => {
    const world = room();
    mirrorLine(world, 30, 5, 0, 1, 70);
    mirrorLine(world, 90, 5, 0, 1, 70);
    const segs = traceBeam(world, 60, 40, 0, 5000);
    expect(segs.length).toBeLessThanOrEqual(16);
    expect(segs.every((s) => s.depth <= 5)).toBe(true);
  });
});

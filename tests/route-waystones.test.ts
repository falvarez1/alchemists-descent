import { describe, expect, it } from 'vitest';

import { HEIGHT, WIDTH } from '@/config/constants';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { PlacementLedger } from '@/world/connect';
import { fitWalks } from '@/world/fitWalks';
import { bowlSiteNear, keyBrazierSite, placeRouteWaystones, routeAnchors, stampWaystoneBowl } from '@/world/routeWaystones';
import { computeFits } from '@/world/validate';

/**
 * WAYSTONES ON THE ROUTE (GEN 62, world/routeWaystones): the bowls stand at fractions of the body-fit
 * walk from the spawn to the cave nearest the exit, and one more stands beside the key.
 */

function solidWorld(): World {
  const w = new World();
  for (let i = 0; i < w.types.length; i++) w.types[i] = Cell.Wall;
  return w;
}
function carveBox(w: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.types[w.idx(x, y)] = Cell.Empty;
}
/** A long corridor east from the spawn, then a drop: 960 cells east, 560 south. */
function lShape(): { w: World; spawn: { x: number; y: number }; exit: { x: number; y: number } } {
  const w = solidWorld();
  carveBox(w, 100, 300, 1100, 340);
  carveBox(w, 1060, 300, 1100, 900);
  return { w, spawn: { x: 120, y: 330 }, exit: { x: 1080, y: 880 } };
}

describe('routeAnchors', () => {
  it('puts the stops at fractions of the walk, not of the world width', () => {
    const { w, spawn, exit } = lShape();
    const walks = fitWalks(computeFits(w), spawn.x, spawn.y)!;
    const stops = routeAnchors(walks, exit, [0.35, 0.7])!;
    expect(stops).not.toBeNull();
    const [a, b] = stops;
    // the walk is ~960 east then ~560 south: 35% is well along the corridor, 70% is down the drop
    expect(a.y).toBeLessThan(345);
    expect(a.x).toBeGreaterThan(400);
    expect(a.x).toBeLessThan(800);
    expect(b.x).toBeGreaterThan(1040);
    expect(b.y).toBeGreaterThan(400);
    for (const s of stops) expect(w.types[w.idx(s.x, s.y)]).toBe(Cell.Empty);
    expect(Math.abs(a.x - WIDTH * 0.33)).toBeGreaterThan(20);
  });

  it('gives no stops for a route too short to divide', () => {
    const w = solidWorld();
    carveBox(w, 100, 300, 180, 340);
    const walks = fitWalks(computeFits(w), 120, 330)!;
    expect(routeAnchors(walks, { x: 170, y: 330 }, [0.35, 0.7])).toBeNull();
  });
});

describe('bowlSiteNear', () => {
  it('finds a floored, roomy, walkable site near a point and never inside a reserved room', () => {
    const { w, spawn } = lShape();
    const walks = fitWalks(computeFits(w), spawn.x, spawn.y)!;
    const ledger = new PlacementLedger();
    const site = bowlSiteNear(w, ledger, walks, 500, 330)!;
    expect(site).not.toBeNull();
    expect(Math.abs(site.cx - 500)).toBeLessThan(40);
    for (let dx = -1; dx <= 1; dx++) expect(w.types[w.idx(site.cx + dx, site.baseY + 1)]).toBe(Cell.Wall);
    // with the whole corridor reserved, no site
    ledger.reserve(100, 300, 1100, 340, 'prefab:test');
    expect(bowlSiteNear(w, ledger, walks, 500, 330)).toBeNull();
  });
});

describe('keyBrazierSite', () => {
  it('finds a floored 7x6 room 10-34 cells from the key that the spawn can reach', () => {
    const w = solidWorld();
    carveBox(w, 100, 300, 400, 340);
    const reach = new Uint8Array(w.types.length);
    for (let y = 300; y <= 340; y++) for (let x = 100; x <= 400; x++) reach[x + y * WIDTH] = 1;
    const site = keyBrazierSite(w, reach, { x: 250, y: 338 })!;
    expect(site).not.toBeNull();
    const d = Math.abs(site.cx - 250);
    expect(d).toBeGreaterThanOrEqual(10);
    expect(d).toBeLessThanOrEqual(34);
    for (let dx = -1; dx <= 1; dx++) expect(w.types[w.idx(site.cx + dx, site.baseY + 1)]).toBe(Cell.Wall);
  });

  it('finds none where the room is not reachable', () => {
    const w = solidWorld();
    carveBox(w, 100, 300, 400, 340);
    expect(keyBrazierSite(w, new Uint8Array(w.types.length), { x: 250, y: 338 })).toBeNull();
  });
});

describe('placeRouteWaystones', () => {
  it('moves a bowl that is off the route to its stop, keeps one that is on it, and lights one by the key', () => {
    const { w, spawn, exit } = lShape();
    const ledger = new PlacementLedger();
    // bowl 0 stands at the spawn (far from 35% of the walk); bowl 1 is placed by the caller near the 70% stop
    const b0 = stampWaystoneBowl(w, 150, 340);
    const b1 = stampWaystoneBowl(w, 1080, 620);
    const waystones = [b0, b1], bowls = [b0, b1];
    const r = placeRouteWaystones({ world: w, ledger, spawn, exit, bowls, waystones, key: { x: 1080, y: 890 } });
    expect(r.moved).toBeGreaterThanOrEqual(1);
    // bowl 0 left the spawn and stands on the corridor well along it; its old stone is gone
    expect(b0.x).toBeGreaterThan(400);
    expect(w.types[w.idx(150, 340)]).toBe(Cell.Empty);
    // the new bowl is a real stamp: stone base, open pouring room
    expect(w.types[w.idx(b0.x, b0.y + 1)]).toBe(Cell.Stone);
    expect(w.types[w.idx(b0.x, b0.y)]).toBe(Cell.Empty);
    // a bowl beside the key
    expect(r.brazier).toBe(true);
    expect(waystones.length).toBe(3);
    expect(bowls.length).toBe(3);
    expect(Math.hypot(waystones[2].x - 1080, waystones[2].y - 890)).toBeLessThan(60);
    expect(HEIGHT).toBeGreaterThan(0);
  });

  it('leaves everything as it was when the spawn has no walk', () => {
    const w = solidWorld();
    const b0 = stampWaystoneBowl(w, 150, 340);
    const r = placeRouteWaystones({ world: w, ledger: new PlacementLedger(), spawn: { x: 400, y: 400 }, exit: { x: 800, y: 800 }, bowls: [b0], waystones: [b0], key: null });
    expect(r).toEqual({ moved: 0, kept: 0, brazier: false });
    expect(b0.x).toBe(150);
  });
});

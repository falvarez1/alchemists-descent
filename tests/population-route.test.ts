import { describe, expect, it } from 'vitest';

import { Rng } from '@/core/rng';
import {
  CORRIDOR_MAX,
  CORRIDOR_NONE,
  EXIT_GUARD_AT,
  ROUTE_SHARE,
  ROUTE_STEP,
  findRouteSpot,
  planRouteSlots,
  routeDistance,
  routePointAt,
  traceRoute,
} from '@/game/populationRoute';

const W = 480;
const H = 220;

/** A wide open cavern with a solid frame (the walk never touches the border rows). */
function openMask(): Uint8Array {
  const reach = new Uint8Array(W * H);
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) reach[x + y * W] = 1;
  return reach;
}

const SPAWN = { x: 30, y: 110 };
const KEY = { x: 430, y: 180 };
const EXIT = { x: 40, y: 30 };

describe('population route: the walk', () => {
  it('traces spawn -> key -> exit with the key at its arc length', () => {
    const route = traceRoute(openMask(), W, H, SPAWN, KEY, EXIT);
    expect(route).not.toBeNull();
    if (!route) return;
    // 4-connected shortest paths over open ground are Manhattan distances.
    const toKey = Math.abs(KEY.x - SPAWN.x) + Math.abs(KEY.y - SPAWN.y);
    const toExit = Math.abs(KEY.x - EXIT.x) + Math.abs(KEY.y - EXIT.y);
    expect(route.keyS).toBe(toKey);
    expect(route.length).toBe(toKey + toExit);
    expect(route.points[0].s).toBe(0);
    expect(route.points[route.points.length - 1].s).toBe(route.length);
    const atKey = routePointAt(route, route.keyS ?? 0);
    expect(Math.hypot(atKey.x - KEY.x, atKey.y - KEY.y)).toBeLessThanOrEqual(ROUTE_STEP);
    // Every sample is on the road; the road is distance 0 in the corridor.
    for (const p of route.points) expect(route.corridor[p.x + p.y * W]).toBe(0);
  });

  it('runs spawn -> exit on floors without a key', () => {
    const route = traceRoute(openMask(), W, H, SPAWN, null, EXIT);
    expect(route).not.toBeNull();
    expect(route?.keyS).toBeNull();
    expect(route?.length).toBe(Math.abs(EXIT.x - SPAWN.x) + Math.abs(EXIT.y - SPAWN.y));
  });

  it('keeps the anchors clear of the arrival and of the exit', () => {
    const route = traceRoute(openMask(), W, H, SPAWN, KEY, EXIT, 70);
    if (!route) throw new Error('route');
    const first = routePointAt(route, route.minS);
    const last = routePointAt(route, route.maxS);
    expect(Math.hypot(first.x - SPAWN.x, first.y - SPAWN.y)).toBeGreaterThanOrEqual(200);
    expect(Math.hypot(last.x - EXIT.x, last.y - EXIT.y)).toBeGreaterThanOrEqual(70);
  });

  it('caps the corridor at CORRIDOR_MAX path steps and marks the rest unreachable', () => {
    const route = traceRoute(openMask(), W, H, SPAWN, null, { x: 200, y: 110 });
    if (!route) throw new Error('route');
    // Open ground: path distance from the road is the Manhattan distance off it.
    expect(route.corridor[200 + 140 * W]).toBe(30);
    expect(route.corridor[200 + 215 * W]).toBe(105);
    expect(route.corridor[470 + 215 * W]).toBe(CORRIDOR_NONE); // 270 + 105 steps from the road's end
  });

  it('is null when an end of the walk is not on the mask (the caller scatters)', () => {
    expect(traceRoute(new Uint8Array(W * H), W, H, SPAWN, KEY, EXIT)).toBeNull();
    const walled = openMask();
    for (let y = 0; y < H; y++) for (let x = 200; x < 260; x++) walled[x + y * W] = 0; // a wall across the cavern
    // The key sits beyond the wall and the mask (spawn-reachable in the real game) cannot reach it.
    expect(traceRoute(walled, W, H, SPAWN, { x: 400, y: 100 }, EXIT)).toBeNull();
  });

  it('measures distance to the road', () => {
    const route = traceRoute(openMask(), W, H, SPAWN, KEY, EXIT);
    if (!route) throw new Error('route');
    expect(routeDistance(route, SPAWN.x, SPAWN.y)).toBe(0);
    expect(routeDistance(route, SPAWN.x, SPAWN.y + 10)).toBeLessThanOrEqual(10);
  });
});

describe('population route: slots', () => {
  const route = traceRoute(openMask(), W, H, SPAWN, KEY, EXIT);
  if (!route) throw new Error('route');

  it('routes about 60% of the roster, exit guard first, key guard second', () => {
    const slots = planRouteSlots(route, 20, new Rng(1).next.bind(new Rng(1)));
    expect(slots).toHaveLength(Math.round(20 * ROUTE_SHARE));
    expect(slots[0].mode).toBe('exitGuard');
    expect(slots[1].mode).toBe('keyGuard');
    expect(slots.slice(2).every((s) => s.mode === 'route')).toBe(true);
  });

  it('puts the guards at the key mouth and 70% of the exit leg', () => {
    const slots = planRouteSlots(route, 10, () => 0.5);
    const exit = slots.find((s) => s.mode === 'exitGuard');
    const key = slots.find((s) => s.mode === 'keyGuard');
    const keyS = route.keyS ?? 0;
    expect(key?.s).toBe(keyS - 35);
    const legStart = Math.max(keyS, route.minS);
    expect(exit?.s).toBeCloseTo(legStart + (Math.max(route.minS, route.maxS) - legStart) * EXIT_GUARD_AT, 6);
  });

  it('runs hotter toward the end and stays inside the anchor window', () => {
    const rng = new Rng(9);
    const slots = planRouteSlots(route, 200, () => rng.next()).filter((s) => s.mode === 'route');
    const mid = (route.minS + route.maxS) / 2;
    const late = slots.filter((s) => s.s > mid).length;
    expect(late).toBeGreaterThan(slots.length - late);
    for (const s of slots) {
      expect(s.s).toBeGreaterThanOrEqual(route.minS);
      expect(s.s).toBeLessThanOrEqual(route.maxS);
    }
  });

  it('makes no slot for an empty roster and one exit guard for a single foe', () => {
    expect(planRouteSlots(route, 0, () => 0.5)).toEqual([]);
    const one = planRouteSlots(route, 1, () => 0.5);
    expect(one.map((s) => s.mode)).toEqual(['exitGuard']);
  });
});

describe('population route: spots', () => {
  const reach = openMask();
  const route = traceRoute(reach, W, H, SPAWN, KEY, EXIT);
  if (!route) throw new Error('route');
  const bounds = { minX: 40, maxX: W - 41, minY: 20, maxY: H - 20 };

  function query(seed: number, slot = planRouteSlots(route as NonNullable<typeof route>, 10, () => 0.4)[3], avoid: Array<{ x: number; y: number }> = []) {
    const rng = new Rng(seed);
    return {
      route: route as NonNullable<typeof route>,
      slot,
      spawn: SPAWN,
      next: () => rng.next(),
      reach,
      bounds,
      clearances: [220, 150, 120],
      avoid,
      accept: () => true,
    };
  }

  it('finds a reachable cell inside the corridor, off the road, clear of the arrival', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const q = query(seed);
      const spot = findRouteSpot(q);
      expect(spot).not.toBeNull();
      if (!spot) continue;
      const c = route.corridor[spot.x + spot.y * W];
      expect(c).not.toBe(CORRIDOR_NONE);
      expect(c).toBeLessThanOrEqual(CORRIDOR_MAX);
      expect(c).toBeGreaterThanOrEqual(q.slot.offRoad);
      expect(Math.hypot(spot.x - SPAWN.x, spot.y - SPAWN.y)).toBeGreaterThanOrEqual(120);
    }
  });

  it('is deterministic per seed', () => {
    for (let seed = 1; seed <= 10; seed++) {
      expect(findRouteSpot(query(seed))).toEqual(findRouteSpot(query(seed)));
    }
  });

  it('keeps route foes apart', () => {
    const first = findRouteSpot(query(3));
    if (!first) throw new Error('spot');
    for (let seed = 1; seed <= 30; seed++) {
      const second = findRouteSpot(query(seed, undefined, [first]));
      if (second) expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeGreaterThanOrEqual(28);
    }
  });

  it('fails open: null when the caller refuses every cell', () => {
    expect(findRouteSpot({ ...query(1), accept: () => false })).toBeNull();
  });

  it('honours the expensive test (habitat) for every spot it returns', () => {
    const q = { ...query(5), accept: (x: number) => x > 300 };
    for (let i = 0; i < 20; i++) {
      const spot = findRouteSpot(q);
      if (spot) expect(spot.x).toBeGreaterThan(300);
    }
  });

  it('never reaches for a cell off the mask', () => {
    const holed = openMask();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x += 2) holed[x + y * W] = 0; // every other column is rock
    const q = { ...query(2), reach: holed };
    for (let i = 0; i < 20; i++) {
      const spot = findRouteSpot(q);
      if (spot) expect(holed[spot.x + spot.y * W]).toBe(1);
    }
  });
});

describe('population route: steps', () => {
  it('samples the road every ROUTE_STEP cells', () => {
    const route = traceRoute(openMask(), W, H, SPAWN, KEY, EXIT);
    if (!route) throw new Error('route');
    for (let i = 1; i < route.points.length - 1; i++) {
      expect(route.points[i].s - route.points[i - 1].s).toBe(ROUTE_STEP);
    }
  });
});

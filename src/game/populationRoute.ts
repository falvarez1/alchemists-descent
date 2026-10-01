/**
 * ROUTE-AWARE POPULATION (levels review #2). A floor's foes used to be dropped
 * uniformly over the whole open grid, so the walk the player actually takes
 * (spawn -> key -> exit, or spawn -> boss) met one or two of them in a thousand
 * cells. This traces that walk once, on the spawn-reachable body-fit mask the
 * placement already owns, and answers three questions for it:
 *
 *  - where is the route (points every ROUTE_STEP cells of path, with arc length);
 *  - which cells lie within a short walk of it (`corridor`, path steps to the
 *    route), so a foe "near the road" is connected to it, not a neighbouring
 *    cave behind a wall that merely looks close on the map;
 *  - where does each foe of the roster go (`planRouteSlots`: stratified arc-length
 *    quantiles that run hotter toward the end, a guard at the key's mouth and one
 *    at ~70% of the exit leg), and which real cell honours a slot (`findRouteSpot`).
 *
 * Pure (no Ctx, no DOM, no Math.random): the caller hands in a seeded stream, so
 * a seed places the same floor every time. Everything here FAILS OPEN: a trace
 * that cannot be made returns null and a slot that cannot be honoured returns
 * null, and the caller's legacy uniform scatter takes over. Only roster share is
 * routed (ROUTE_SHARE); the rest, sleeping roosts and lairs stay scattered.
 */

/** Path cells between route sample points. */
export const ROUTE_STEP = 6;
/** Corridor depth kept (path steps from the route); Uint8 "none" beyond it. */
export const CORRIDOR_MAX = 170;
export const CORRIDOR_NONE = 255;
/** Share of the roster that holds the route (the rest stays scattered). */
export const ROUTE_SHARE = 0.6;
/** Foes of the route share sit this far (cells, Euclid) from the route point they are anchored to. */
export const ROUTE_BAND: readonly [number, number] = [60, 110];
/** A guard stands at the mouth: nearer the road, in its way. */
export const GUARD_BAND: readonly [number, number] = [20, 50];
/** Density along the route grows as t^(HOT-1): > 1 runs hotter toward the end. */
export const ROUTE_HEAT = 1.5;
/** Route foes keep at least this far from each other (cells). */
export const ROUTE_SPACING = 28;
/** The key's guard stands this many path cells before the key. */
export const KEY_MOUTH = 35;
/** The exit leg's guard stands at this fraction of the leg. */
export const EXIT_GUARD_AT = 0.7;
/** Quantile foes keep this many path steps off the road itself (guards may stand on it). */
const OFF_ROAD_MIN = 28;
const GUARD_OFF_ROAD_MIN = 10;

export interface RoutePoint {
  x: number;
  y: number;
  /** Path length from the route's start, in cells. */
  s: number;
}

export interface PopulationRoute {
  width: number;
  points: RoutePoint[];
  /** Total path length, in cells. */
  length: number;
  /** Arc length of the key along the route (null on floors without one). */
  keyS: number | null;
  /** Foes anchor between minS (clear of the arrival) and maxS (clear of the exit / boss arena). */
  minS: number;
  maxS: number;
  corridor: Uint8Array;
}

export type RouteSlotMode = 'keyGuard' | 'exitGuard' | 'route';

export interface RouteSlot {
  mode: RouteSlotMode;
  /** Arc length the slot is anchored at. */
  s: number;
  minR: number;
  maxR: number;
  /** Path steps the foe keeps off the road. */
  offRoad: number;
}

interface Pt {
  x: number;
  y: number;
}

let scratchPrev = new Int32Array(0);
let scratchQueue = new Int32Array(0);

function scratch(n: number): { prev: Int32Array; queue: Int32Array } {
  if (scratchPrev.length < n) {
    scratchPrev = new Int32Array(n);
    scratchQueue = new Int32Array(n);
  }
  return { prev: scratchPrev, queue: scratchQueue };
}

/** The nearest reachable cell to (x, y) within `maxR` (Chebyshev rings), or -1. */
function snapToMask(reach: Uint8Array, W: number, H: number, x: number, y: number, maxR: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let r = 0; r <= maxR; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = cx + dx;
        const py = cy + dy;
        if (px < 1 || py < 1 || px >= W - 1 || py >= H - 1) continue;
        if (reach[px + py * W] === 0) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = px + py * W;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** 4-connected flood over the mask from `start`; fills `prev` (start points at itself). Returns the visited count. */
function floodPaths(reach: Uint8Array, W: number, H: number, start: number, prev: Int32Array, queue: Int32Array): number {
  prev.fill(-1, 0, W * H);
  let head = 0;
  let tail = 0;
  prev[start] = start;
  queue[tail++] = start;
  const bottom = (H - 1) * W;
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    if (x + 1 < W - 1 && prev[i + 1] < 0 && reach[i + 1]) { prev[i + 1] = i; queue[tail++] = i + 1; }
    if (x - 1 >= 1 && prev[i - 1] < 0 && reach[i - 1]) { prev[i - 1] = i; queue[tail++] = i - 1; }
    if (i + W < bottom && prev[i + W] < 0 && reach[i + W]) { prev[i + W] = i; queue[tail++] = i + W; }
    if (i - W >= W && prev[i - W] < 0 && reach[i - W]) { prev[i - W] = i; queue[tail++] = i - W; }
  }
  return tail;
}

/** Cells from `start` to `target` (inclusive) walking `prev` back from the target, start first. */
function pathCells(prev: Int32Array, start: number, target: number): number[] | null {
  if (prev[target] < 0) return null;
  const out: number[] = [];
  let c = target;
  for (let guard = 0; guard < 4_000_000; guard++) {
    out.push(c);
    if (c === start) return out.reverse();
    c = prev[c];
    if (c < 0) return null;
  }
  return null;
}

/**
 * Trace the floor's walk on the spawn-reachable mask. `key` is the key pickup
 * (null on floors without one, which run spawn -> exit); `exit` is the portal,
 * or the boss on boss floors, and `exitClear` the distance a foe keeps from it.
 * Null when any end of the walk cannot be snapped onto the mask: the caller
 * then scatters as it always did.
 */
export function traceRoute(
  reach: Uint8Array,
  W: number,
  H: number,
  spawn: Pt,
  key: Pt | null,
  exit: Pt,
  exitClear = 70,
): PopulationRoute | null {
  const spawnCell = snapToMask(reach, W, H, spawn.x, spawn.y, 40);
  const exitCell = snapToMask(reach, W, H, exit.x, exit.y, 60);
  const keyCell = key ? snapToMask(reach, W, H, key.x, key.y, 48) : -1;
  if (spawnCell < 0 || exitCell < 0 || (key && keyCell < 0)) return null;
  const { prev, queue } = scratch(W * H);
  let cells: number[];
  let keyS: number | null = null;
  if (key) {
    floodPaths(reach, W, H, keyCell, prev, queue);
    const toSpawn = pathCells(prev, keyCell, spawnCell);
    const toExit = pathCells(prev, keyCell, exitCell);
    if (!toSpawn || !toExit) return null;
    toSpawn.reverse(); // spawn -> key
    keyS = toSpawn.length - 1;
    cells = toSpawn.concat(toExit.slice(1));
  } else {
    floodPaths(reach, W, H, spawnCell, prev, queue);
    const toExit = pathCells(prev, spawnCell, exitCell);
    if (!toExit) return null;
    cells = toExit;
  }
  if (cells.length < 2) return null;
  const length = cells.length - 1;
  const points: RoutePoint[] = [];
  for (let i = 0; i < cells.length; i += ROUTE_STEP) {
    points.push({ x: cells[i] % W, y: Math.floor(cells[i] / W), s: i });
  }
  if (points[points.length - 1].s !== length) {
    const last = cells[length];
    points.push({ x: last % W, y: Math.floor(last / W), s: length });
  }

  // Foes anchor clear of the arrival (200) and of the exit (a boss arena is large).
  let minS = 0;
  for (const p of points) {
    if (Math.hypot(p.x - spawn.x, p.y - spawn.y) >= 200) { minS = p.s; break; }
  }
  let maxS = length;
  for (let i = points.length - 1; i >= 0; i--) {
    if (Math.hypot(points[i].x - exit.x, points[i].y - exit.y) >= exitClear) { maxS = points[i].s; break; }
  }
  if (maxS <= minS) { minS = 0; maxS = length; }

  // Corridor: multi-source flood from every route cell, capped at CORRIDOR_MAX.
  const corridor = new Uint8Array(W * H).fill(CORRIDOR_NONE);
  let head = 0;
  let tail = 0;
  for (const c of cells) {
    if (corridor[c] === 0) continue;
    corridor[c] = 0;
    queue[tail++] = c;
  }
  const bottom = (H - 1) * W;
  while (head < tail) {
    const i = queue[head++];
    const d = corridor[i] + 1;
    if (d > CORRIDOR_MAX) continue;
    const x = i % W;
    if (x + 1 < W - 1 && corridor[i + 1] === CORRIDOR_NONE && reach[i + 1]) { corridor[i + 1] = d; queue[tail++] = i + 1; }
    if (x - 1 >= 1 && corridor[i - 1] === CORRIDOR_NONE && reach[i - 1]) { corridor[i - 1] = d; queue[tail++] = i - 1; }
    if (i + W < bottom && corridor[i + W] === CORRIDOR_NONE && reach[i + W]) { corridor[i + W] = d; queue[tail++] = i + W; }
    if (i - W >= W && corridor[i - W] === CORRIDOR_NONE && reach[i - W]) { corridor[i - W] = d; queue[tail++] = i - W; }
  }
  return { width: W, points, length, keyS, minS, maxS, corridor };
}

/** The sample point nearest arc length `s` (clamped to the route). */
export function routePointAt(route: PopulationRoute, s: number): RoutePoint {
  const i = Math.max(0, Math.min(route.points.length - 1, Math.round(s / ROUTE_STEP)));
  return route.points[i];
}

/** Euclidean distance from (x, y) to the nearest route sample point (audits and probes). */
export function routeDistance(route: PopulationRoute, x: number, y: number): number {
  let best = Infinity;
  for (const p of route.points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Where `total` foes of the roster go. About ROUTE_SHARE of them hold the route:
 * the exit leg's guard first (the toughest foe belongs at the end), then the key
 * mouth's, then stratified arc-length quantiles whose density rises toward the
 * end. The caller gives the guard slots to the toughest kinds and shuffles the
 * rest; slots beyond the share are simply not made (those foes scatter).
 */
export function planRouteSlots(route: PopulationRoute, total: number, next: () => number): RouteSlot[] {
  const n = Math.min(total, Math.round(total * ROUTE_SHARE));
  if (n <= 0) return [];
  const lo = route.minS;
  const hi = Math.max(lo, route.maxS);
  const slots: RouteSlot[] = [];
  const legStart = route.keyS !== null ? Math.min(Math.max(route.keyS, lo), hi) : lo;
  slots.push({
    mode: 'exitGuard',
    s: legStart + (hi - legStart) * EXIT_GUARD_AT,
    minR: GUARD_BAND[0],
    maxR: GUARD_BAND[1],
    offRoad: GUARD_OFF_ROAD_MIN,
  });
  if (route.keyS !== null && n >= 2) {
    slots.push({
      mode: 'keyGuard',
      s: Math.max(0, route.keyS - KEY_MOUTH),
      minR: GUARD_BAND[0],
      maxR: GUARD_BAND[1],
      offRoad: GUARD_OFF_ROAD_MIN,
    });
  }
  const m = n - slots.length;
  for (let i = 0; i < m; i++) {
    const u = (i + next()) / m;
    const t = Math.pow(u, 1 / ROUTE_HEAT);
    slots.push({ mode: 'route', s: lo + t * (hi - lo), minR: ROUTE_BAND[0], maxR: ROUTE_BAND[1], offRoad: OFF_ROAD_MIN });
  }
  return slots;
}

export interface RouteSpotQuery {
  route: PopulationRoute;
  slot: RouteSlot;
  spawn: Pt;
  next: () => number;
  /** The population's reach mask (the set-piece rooms already carved out). */
  reach: Uint8Array;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Spawn clearances to relax through, widest first (the legacy steps). */
  clearances: readonly number[];
  /** Positions of the route foes already placed (spacing). */
  avoid: readonly Pt[];
  /** The expensive test (habitat, body fit), run last. */
  accept: (x: number, y: number) => boolean;
  attempts?: number;
}

/**
 * A real cell honouring the slot: reachable, inside the corridor and off the
 * road by the slot's margin, clear of the arrival and of its route neighbours,
 * and accepted by the caller (habitat and body fit). The band widens, then closes
 * onto the road, before giving up (null: the caller scatters).
 */
export function findRouteSpot(q: RouteSpotQuery): { x: number; y: number } | null {
  const { route, slot, bounds } = q;
  const W = route.width;
  const attempts = q.attempts ?? 24;
  // The band widens, then closes onto the road itself (a floor whose open ground
  // is a single slit has nowhere else to put a foe that holds its route).
  const bands: Array<[number, number, number]> = [
    [slot.minR, slot.maxR, slot.offRoad],
    [slot.minR * 0.5, slot.maxR * 1.4, slot.offRoad],
    [6, slot.minR, Math.min(slot.offRoad, 4)],
  ];
  const spacingSq = ROUTE_SPACING * ROUTE_SPACING;
  for (const [minR, maxR, offRoad] of bands) {
    for (const clearance of q.clearances) {
      const clearanceSq = clearance * clearance;
      for (let attempt = 0; attempt < attempts; attempt++) {
        // Quantile foes spread a little along the road; guards hold their mark.
        const jitter = slot.mode === 'route' ? (q.next() - 0.5) * 48 : 0;
        const anchor = routePointAt(route, Math.max(0, Math.min(route.length, slot.s + jitter)));
        const angle = q.next() * Math.PI * 2;
        const r = minR + q.next() * (maxR - minR);
        const x = Math.round(anchor.x + Math.cos(angle) * r);
        const y = Math.round(anchor.y + Math.sin(angle) * r);
        if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
        const i = x + y * W;
        if (q.reach[i] === 0) continue;
        const c = route.corridor[i];
        if (c === CORRIDOR_NONE || c < offRoad) continue;
        const dx = x - q.spawn.x;
        const dy = y - q.spawn.y;
        if (clearance > 0 && dx * dx + dy * dy < clearanceSq) continue;
        let crowded = false;
        for (const a of q.avoid) {
          const ax = x - a.x;
          const ay = y - a.y;
          if (ax * ax + ay * ay < spacingSq) { crowded = true; break; }
        }
        if (crowded) continue;
        if (!q.accept(x, y)) continue;
        return { x, y };
      }
    }
  }
  return null;
}

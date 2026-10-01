/**
 * WHERE THE OFF-SCREEN WAYPOINT ARROW RESTS (feel review #6). The arrow used to
 * clamp to a rim 8% in from every edge, which is exactly where the HUD lives: a
 * target up and to the left parked the arrow on the wand hotbar ("Spark Bolt -
 * 10[313] mana"). The rim is the same, but any HUD block in the way pushes the
 * arrow along the rim to the nearest free spot past it. The blocks are MEASURED
 * from the DOM (ui/Minimap.hudObstacles), so a HUD that grows (a HUD-scale option,
 * a wider window) moves the arrow with it, with no inset to keep in step.
 *
 * Everything is in percent of the game view (0..100 on both axes). Pure.
 */

export interface PctRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** How far in from the view's edge the arrow rests, in % (was the literal 8). */
export const WAYPOINT_EDGE = 8;
/** Clear air left between the arrow's middle and a HUD block, in %. */
export const WAYPOINT_CLEAR = 4;

/** Where the ray from the view's centre toward (vx, vy) meets the rim. */
export function rimPoint(vx: number, vy: number, edge = WAYPOINT_EDGE): { x: number; y: number } {
  const scaleX = Math.abs(vx) > 0.001 ? (50 - edge) / Math.abs(vx) : Number.POSITIVE_INFINITY;
  const scaleY = Math.abs(vy) > 0.001 ? (50 - edge) / Math.abs(vy) : Number.POSITIVE_INFINITY;
  const scale = Math.min(scaleX, scaleY, 1);
  return { x: 50 + vx * scale, y: 50 + vy * scale };
}

function inside(p: { x: number; y: number }, r: PctRect, clear: number): boolean {
  return p.x > r.x0 - clear && p.x < r.x1 + clear && p.y > r.y0 - clear && p.y < r.y1 + clear;
}

/** A point on the rim's perimeter by distance t from its top-left corner, clockwise. */
function rimAt(t: number, lo: number, hi: number): { x: number; y: number } {
  const side = hi - lo;
  const u = ((t % (4 * side)) + 4 * side) % (4 * side);
  if (u < side) return { x: lo + u, y: lo };
  if (u < 2 * side) return { x: hi, y: lo + (u - side) };
  if (u < 3 * side) return { x: hi - (u - 2 * side), y: hi };
  return { x: lo, y: hi - (u - 3 * side) };
}

/** Perimeter distance of a point known to lie on the rim, or null when it lies inside it. */
function rimDistance(p: { x: number; y: number }, lo: number, hi: number): number | null {
  const side = hi - lo;
  const e = 0.01;
  if (Math.abs(p.y - lo) < e) return p.x - lo;
  if (Math.abs(p.x - hi) < e) return side + (p.y - lo);
  if (Math.abs(p.y - hi) < e) return 2 * side + (hi - p.x);
  if (Math.abs(p.x - lo) < e) return 3 * side + (hi - p.y);
  return null;
}

/**
 * The rim point for the ray toward (vx, vy), slid along the rim out from under
 * any obstacle in the way: to the nearest free spot, either way round (so the
 * arrow turns the corner onto the next side if that is where the room is).
 * A rim covered end to end (an absurd HUD) gives the plain clamp back, never nothing.
 */
export function rimPointAvoiding(
  vx: number,
  vy: number,
  obstacles: readonly PctRect[],
  edge = WAYPOINT_EDGE,
  clear = WAYPOINT_CLEAR,
): { x: number; y: number } {
  const home = rimPoint(vx, vy, edge);
  if (obstacles.length === 0) return home;
  const lo = edge;
  const hi = 100 - edge;
  const t0 = rimDistance(home, lo, hi);
  if (t0 === null) return home; // inside the rim: nothing to avoid
  const free = (p: { x: number; y: number }): boolean => !obstacles.some((o) => inside(p, o, clear));
  if (free(home)) return home;
  const step = 0.5;
  for (let k = 1; k * step <= 2 * (hi - lo); k++) {
    const a = rimAt(t0 - k * step, lo, hi);
    const b = rimAt(t0 + k * step, lo, hi);
    if (free(a)) return a;
    if (free(b)) return b;
  }
  return home;
}

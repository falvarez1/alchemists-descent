import type { World } from '@/sim/World';
import { integrate, movePoint, point, translate } from './physics';
import type { IntegrateOpts, RigPoint } from './physics';

/**
 * A pressurised ring of verlet points — gel that behaves like gel. Each rim
 * point collides with the real cells, so a slime flattens on landing, bulges
 * sideways, pours over a lip and wobbles when struck; shape matching pulls
 * the ring back toward its rest outline around the gameplay body, and a
 * pressure term keeps its area, so squash always pays for itself in stretch.
 */
export interface SoftBody {
  pts: RigPoint[];
  /** Rest offsets (x, y pairs) from the centroid. */
  rest: Float32Array;
  area0: number;
  /** Current centroid (updated each step). */
  cx: number;
  cy: number;
}

export function makeSoftBody(cx: number, cy: number, rx: number, ry: number, count = 14, flatBottom = 0.35): SoftBody {
  const pts: RigPoint[] = [];
  const rest = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * rx;
    let y = Math.sin(a) * ry;
    // A resting blob sits on a flattened belly.
    if (y > 0) y *= 1 - flatBottom * (y / ry);
    rest[i * 2] = x; rest[i * 2 + 1] = y;
    pts.push(point(cx + x, cy + y, 0.55));
  }
  const sb: SoftBody = { pts, rest, area0: 0, cx, cy };
  sb.area0 = softArea(sb);
  return sb;
}

export function softArea(sb: SoftBody): number {
  let a = 0;
  const p = sb.pts, n = p.length;
  for (let i = 0; i < n; i++) {
    const q = p[i], r = p[(i + 1) % n];
    a += q.x * r.y - r.x * q.y;
  }
  return Math.abs(a) * 0.5;
}

export interface SoftOpts extends IntegrateOpts {
  /** Shape-matching pull toward the rest outline (0..1 per tick). */
  shape: number;
  /** Area restoring push (0..1). */
  pressure: number;
  /** Pull of the centroid toward the gameplay anchor (0..1 per tick). */
  follow: number;
  /** Rest outline scale this tick (breathing, winding up, fuse swelling). */
  scaleX?: number;
  scaleY?: number;
  /** Rest outline rotation (radians). */
  angle?: number;
}

/** Advance the ring. (ax, ay) is where the gameplay body wants the centroid. */
export function stepSoftBody(world: World, sb: SoftBody, ax: number, ay: number, o: SoftOpts): void {
  const pts = sb.pts, n = pts.length;
  if (Math.abs(sb.cx - ax) + Math.abs(sb.cy - ay) > 40) {
    for (const p of pts) translate(p, ax - sb.cx, ay - sb.cy);
    sb.cx = ax; sb.cy = ay;
  }
  for (const p of pts) integrate(world, p, o);
  // Centroid.
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  // The body is carried by the gameplay anchor: a spring, not a weld.
  const fx = (ax - cx) * o.follow, fy = (ay - cy) * o.follow;
  const sx = o.scaleX ?? 1, sy = o.scaleY ?? 1, ang = o.angle ?? 0, ca = Math.cos(ang), sa = Math.sin(ang);
  // Pressure: push along the outward normal when the ring has lost area.
  const area = softArea(sb);
  const target = sb.area0 * sx * sy;
  const press = o.pressure * (target - area) / Math.max(1, target) * 2.2;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const rx = sb.rest[i * 2] * sx, ry = sb.rest[i * 2 + 1] * sy;
    const tx = cx + fx + rx * ca - ry * sa, ty = cy + fy + rx * sa + ry * ca;
    const prev = pts[(i + n - 1) % n], next = pts[(i + 1) % n];
    // Outward normal of the rim at this point (ring is ordered clockwise on screen).
    let nx = next.y - prev.y, ny = -(next.x - prev.x);
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    const mx = p.x + (tx - p.x) * o.shape + nx * press;
    const my = p.y + (ty - p.y) * o.shape + ny * press;
    movePoint(world, p, mx, my);
  }
  let ncx = 0, ncy = 0;
  for (const p of pts) { ncx += p.x; ncy += p.y; }
  sb.cx = ncx / n; sb.cy = ncy / n;
}

/** Shove the whole ring (hits, landings) — the outline wobbles as it recovers. */
export function softImpulse(sb: SoftBody, vx: number, vy: number, spread = 0): void {
  const n = sb.pts.length;
  for (let i = 0; i < n; i++) {
    const p = sb.pts[i];
    const ox = p.x - sb.cx, oy = p.y - sb.cy, l = Math.hypot(ox, oy) || 1;
    p.px -= vx + ox / l * spread;
    p.py -= vy + oy / l * spread;
  }
}

/**
 * Catmull-Rom resample of the rim into `out` (flat x,y pairs) so the drawn
 * outline is smooth even with a dozen physics points. Returns point count.
 */
export function smoothRing(pts: readonly RigPoint[], sub: number, out: Float64Array): number {
  const n = pts.length;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      if (k * 2 + 1 < out.length) { out[k * 2] = x; out[k * 2 + 1] = y; k++; }
    }
  }
  return k;
}

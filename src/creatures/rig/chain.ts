import type { World } from '@/sim/World';
import { integrate, movePoint, place, point, translate } from './physics';
import type { IntegrateOpts, RigPoint } from './physics';

/**
 * A verlet chain rooted on a body: tails, necks, tentacles, antennae, whiskers,
 * cloth hems. The root rides its anchor; every other link falls, collides,
 * drags through liquid and is pulled back to length follow-the-leader style,
 * so momentum from the body whips down the chain and a tail draped over a
 * ledge actually hangs off it.
 */
export interface Chain {
  pts: RigPoint[];
  /** Rest length of each link. */
  seg: number;
  /** Per-link radius for rendering (cells). */
  radius: Float32Array;
}

export interface ChainOpts extends IntegrateOpts {
  /** 0..1 how strongly each link straightens toward its parent's heading (+curl). */
  stiffness: number;
  /** Rest bend per joint (radians), e.g. a curled tail or hanging hook. */
  curl?: number;
  /** Stiffness of the first link toward the root direction (0..1). */
  rootStiffness?: number;
  /** Constraint passes. */
  iterations?: number;
  /** Collide with terrain (off for gaseous wisps and cloth over the body). */
  collide?: boolean;
  /** Additive per-link acceleration (currents, wind, swimming undulation). */
  forceX?: number;
  forceY?: number;
}

export function makeChain(count: number, x: number, y: number, dirX: number, dirY: number, seg: number, r0: number, r1: number, collideR = -1): Chain {
  const l = Math.hypot(dirX, dirY) || 1;
  dirX /= l; dirY /= l;
  const pts: RigPoint[] = [];
  const radius = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    radius[i] = r0 + (r1 - r0) * t;
    pts.push(point(x + dirX * seg * i, y + dirY * seg * i, collideR >= 0 ? collideR : Math.min(1.2, radius[i] * 0.6)));
  }
  return { pts, seg, radius };
}

/** Move the whole chain rigidly (teleports, spawn re-anchoring). */
export function shiftChain(c: Chain, dx: number, dy: number): void {
  for (const p of c.pts) translate(p, dx, dy);
}

/**
 * Advance a chain one tick. (rootX, rootY) is where it attaches this tick;
 * (dirX, dirY) the direction it leaves the body.
 */
export function stepChain(world: World, c: Chain, rootX: number, rootY: number, dirX: number, dirY: number, o: ChainOpts): void {
  const pts = c.pts, n = pts.length;
  if (n === 0) return;
  const root = pts[0];
  // A body that teleported (or first frame) drags the chain along rigidly.
  if (Math.abs(root.x - rootX) + Math.abs(root.y - rootY) > 40) shiftChain(c, rootX - root.x, rootY - root.y);
  place(root, rootX, rootY);
  const collide = o.collide !== false;
  for (let i = 1; i < n; i++) {
    const p = pts[i];
    if (!collide) {
      const vx = (p.x - p.px) * o.damping, vy = (p.y - p.py) * o.damping;
      p.px = p.x; p.py = p.y;
      p.x += vx + (o.forceX ?? 0); p.y += vy + o.gravity + (o.forceY ?? 0);
    } else integrate(world, p, o, o.forceX ?? 0, o.forceY ?? 0);
  }
  const dl = Math.hypot(dirX, dirY) || 1;
  const hx = dirX / dl, hy = dirY / dl;
  const curl = o.curl ?? 0, cc = Math.cos(curl), cs = Math.sin(curl);
  const iters = o.iterations ?? 2;
  for (let it = 0; it < iters; it++) {
    let px = hx, py = hy;
    for (let i = 1; i < n; i++) {
      const a = pts[i - 1], b = pts[i];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d < 1e-6) { dx = px; dy = py; d = 1; }
      let ux = dx / d, uy = dy / d;
      // Bend toward the parent heading (rotated by the rest curl).
      const k = i === 1 ? (o.rootStiffness ?? o.stiffness) : o.stiffness;
      if (k > 0) {
        const tx = px * cc - py * cs, ty = px * cs + py * cc;
        ux += (tx - ux) * k; uy += (ty - uy) * k;
        const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      }
      const tx2 = a.x + ux * c.seg, ty2 = a.y + uy * c.seg;
      if (collide) movePoint(world, b, tx2, ty2); else { b.x = tx2; b.y = ty2; }
      // Blocked by terrain: keep the link from stretching past its length.
      const ex = b.x - a.x, ey = b.y - a.y, e = Math.hypot(ex, ey);
      if (e > c.seg * 1.35) { b.x = a.x + ex / e * c.seg * 1.35; b.y = a.y + ey / e * c.seg * 1.35; }
      px = ux; py = uy;
    }
  }
}

/**
 * Reach the chain's tip toward a target (grabbing tentacles, lashing roots):
 * a FABRIK backward pass from the tip then a forward pass from the root.
 * `pull` 0..1 blends toward the solved pose so reaching reads as effort.
 */
export function reachChain(world: World | null, c: Chain, tx: number, ty: number, pull: number): void {
  const pts = c.pts, n = pts.length;
  if (n < 2 || pull <= 0) return;
  const xs = REACH_X, ys = REACH_Y;
  for (let i = 0; i < n; i++) { xs[i] = pts[i].x; ys[i] = pts[i].y; }
  const rx = xs[0], ry = ys[0];
  xs[n - 1] = tx; ys[n - 1] = ty;
  for (let i = n - 2; i >= 0; i--) {
    const dx = xs[i] - xs[i + 1], dy = ys[i] - ys[i + 1], d = Math.hypot(dx, dy) || 1;
    xs[i] = xs[i + 1] + dx / d * c.seg; ys[i] = ys[i + 1] + dy / d * c.seg;
  }
  xs[0] = rx; ys[0] = ry;
  for (let i = 1; i < n; i++) {
    const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1], d = Math.hypot(dx, dy) || 1;
    xs[i] = xs[i - 1] + dx / d * c.seg; ys[i] = ys[i - 1] + dy / d * c.seg;
  }
  for (let i = 1; i < n; i++) {
    const p = pts[i];
    const nx = p.x + (xs[i] - p.x) * pull, ny = p.y + (ys[i] - p.y) * pull;
    if (world) movePoint(world, p, nx, ny); else { p.x = nx; p.y = ny; }
  }
}
const REACH_X = new Float64Array(64);
const REACH_Y = new Float64Array(64);

/** Chain arc length from the root to point i (for tapering, fins, markings). */
export function chainHeading(c: Chain, i: number): { x: number; y: number } {
  const pts = c.pts, a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, Math.max(1, i))];
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d };
}

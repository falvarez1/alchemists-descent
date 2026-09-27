import type { World } from '@/sim/World';
import { solidAt } from './physics';

/**
 * A two-bone leg (or arm) whose foot grips real terrain — Rain World's lizard
 * locomotion. The foot stays welded to its grip while the body moves; when
 * the hip drifts too far from it (or the rest pose asks for a new stance) the
 * leg lifts, arcs to a freshly searched grip ahead and plants again. Gait
 * falls out of each leg's reach plus a simple "don't lift while the partner
 * is in the air" rule; nothing here is a keyframe.
 */
export interface Leg {
  upper: number;
  lower: number;
  /** Knee bend side relative to hip→foot (+1 / -1). */
  bend: number;
  /** Foot position. */
  x: number;
  y: number;
  /** Grip anchor and its outward surface normal. */
  gx: number;
  gy: number;
  gnx: number;
  gny: number;
  planted: boolean;
  /** Swing progress 0..1, or -1 when not swinging. */
  swing: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Knee (solved every tick). */
  kx: number;
  ky: number;
  /** Ticks since the foot last touched anything (dangling limbs flail). */
  air: number;
  /** Set true on the tick a swing lands on a grip (footfall event; consumers clear it). */
  landed: boolean;
  /** Steps left of whatever the foot last waded through (blood tracks), and its colour. */
  mud: number;
  mudColor: number;
}

export function makeLeg(upper: number, lower: number, bend: number, x: number, y: number): Leg {
  return { upper, lower, bend, x, y, gx: x, gy: y, gnx: 0, gny: -1, planted: false, swing: -1,
    fromX: x, fromY: y, toX: x, toY: y, kx: x, ky: y, air: 0, landed: false, mud: 0, mudColor: 0 };
}

export function legReach(leg: Leg): number {
  return leg.upper + leg.lower;
}

/** Two-bone IK: place the knee for a hip→foot span, bent to `bend` side. */
export function solveKnee(leg: Leg, hipX: number, hipY: number): void {
  const dx = leg.x - hipX, dy = leg.y - hipY;
  const d = Math.max(1e-4, Math.hypot(dx, dy));
  const reach = leg.upper + leg.lower;
  const dd = Math.min(d, reach * 0.999);
  const a = (leg.upper * leg.upper - leg.lower * leg.lower + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, leg.upper * leg.upper - a * a));
  const ux = dx / d, uy = dy / d;
  leg.kx = hipX + ux * a - uy * h * leg.bend;
  leg.ky = hipY + uy * a + ux * h * leg.bend;
}

export interface Grip { x: number; y: number; nx: number; ny: number }
const GRIP: Grip = { x: 0, y: 0, nx: 0, ny: -1 };

/**
 * Find the surface point nearest (x, y) within `radius` cells: a blocking cell
 * with open air beside it. The returned point sits on the open face, with its
 * outward normal. Prefers faces that point back toward (fromX, fromY) — a
 * foot reaching from above grabs the top of a ledge, not its underside.
 * Returns a shared object (consume immediately) or null.
 */
export function findGrip(world: World, x: number, y: number, radius: number, fromX: number, fromY: number): Grip | null {
  const r = Math.ceil(radius);
  const cx = Math.floor(x), cy = Math.floor(y);
  let best = Infinity, found = false;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      const tx = cx + dx, ty = cy + dy;
      if (!solidAt(world, tx + 0.5, ty + 0.5)) continue;
      // Open faces of this cell.
      const up = !solidAt(world, tx + 0.5, ty - 0.5), down = !solidAt(world, tx + 0.5, ty + 1.5);
      const left = !solidAt(world, tx - 0.5, ty + 0.5), right = !solidAt(world, tx + 1.5, ty + 0.5);
      if (!(up || down || left || right)) continue;
      let nx = (right ? 1 : 0) - (left ? 1 : 0), ny = (down ? 1 : 0) - (up ? 1 : 0);
      if (nx === 0 && ny === 0) { nx = 0; ny = up ? -1 : 1; }
      const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
      const px = tx + 0.5 + nx * 0.5, py = ty + 0.5 + ny * 0.5;
      // Facing term: faces turned toward the reaching hip are preferred.
      const fx = fromX - px, fy = fromY - py, fl = Math.hypot(fx, fy) || 1;
      const facing = (fx * nx + fy * ny) / fl;
      const score = Math.hypot(px - x, py - y) - facing * 2.2 + (facing < -0.2 ? 6 : 0);
      if (score < best) { best = score; GRIP.x = px; GRIP.y = py; GRIP.nx = nx; GRIP.ny = ny; found = true; }
    }
  }
  return found ? GRIP : null;
}

/**
 * Find floor under a column: the first blocking cell between y0 and y1 whose
 * top face is open. Cheap and stable for walkers on uneven ground.
 */
export function findFloor(world: World, x: number, y0: number, y1: number): Grip | null {
  const ix = Math.floor(x);
  let prevOpen = !solidAt(world, ix + 0.5, Math.floor(y0) - 0.5);
  for (let y = Math.floor(y0); y <= Math.floor(y1); y++) {
    const s = solidAt(world, ix + 0.5, y + 0.5);
    if (s && prevOpen) { GRIP.x = x; GRIP.y = y; GRIP.nx = 0; GRIP.ny = -1; return GRIP; }
    prevOpen = !s;
  }
  return null;
}

export interface StepOpts {
  /** Distance from the ideal foothold that triggers a new step. */
  stepDist: number;
  /** Ticks per swing. */
  stepTicks: number;
  /** Swing lift along the grip normal (cells). */
  lift: number;
  /** Grip search radius around the ideal foothold. */
  search: number;
  /** May this leg lift now (gait coordination)? */
  canLift: boolean;
  /** Floor-only search (walkers) instead of any surface (climbers). */
  floorOnly?: boolean;
  /** How far below the ideal foothold a floor search may look. */
  floorDepth?: number;
  /** Where a foot hangs when nothing is gripped (relative to the hip). */
  hangX?: number;
  hangY?: number;
}

/**
 * Advance one leg. (idealX, idealY) is where the creature would like this foot
 * — rest stance plus a lead in the direction of travel.
 */
export function stepLeg(world: World, leg: Leg, hipX: number, hipY: number, idealX: number, idealY: number, o: StepOpts): void {
  const reach = leg.upper + leg.lower;
  if (leg.swing >= 0) {
    leg.swing = Math.min(1, leg.swing + 1 / Math.max(1, o.stepTicks));
    const t = leg.swing, e = t * t * (3 - 2 * t);
    const arc = Math.sin(t * Math.PI) * o.lift;
    leg.x = leg.fromX + (leg.toX - leg.fromX) * e + leg.gnx * arc;
    leg.y = leg.fromY + (leg.toY - leg.fromY) * e + leg.gny * arc;
    if (t >= 1) {
      leg.swing = -1;
      leg.planted = solidAt(world, leg.gx - leg.gnx * 0.5, leg.gy - leg.gny * 0.5);
      leg.x = leg.gx; leg.y = leg.gy;
      leg.landed = leg.planted;
      leg.air = 0;
    }
  } else if (leg.planted) {
    // Lose the grip if the rock under it vanished.
    if (!solidAt(world, leg.gx - leg.gnx * 0.5, leg.gy - leg.gny * 0.5)) leg.planted = false;
    const span = Math.hypot(leg.x - hipX, leg.y - hipY);
    const off = Math.hypot(leg.x - idealX, leg.y - idealY);
    const over = span > reach * 0.98;
    if (leg.planted && (over || (o.canLift && off > o.stepDist))) {
      const g = o.floorOnly
        ? findFloor(world, idealX, idealY - reach * 0.5, idealY + (o.floorDepth ?? reach * 0.6))
        : findGrip(world, idealX, idealY, o.search, hipX, hipY);
      if (g && Math.hypot(g.x - hipX, g.y - hipY) < reach * 0.97 && (o.canLift || over)) {
        leg.fromX = leg.x; leg.fromY = leg.y;
        leg.toX = g.x; leg.toY = g.y; leg.gx = g.x; leg.gy = g.y; leg.gnx = g.nx; leg.gny = g.ny;
        leg.swing = 0;
      } else if (over) {
        leg.planted = false;
      }
    }
    if (leg.planted && leg.swing < 0) { leg.x = leg.gx; leg.y = leg.gy; }
  }
  if (!leg.planted && leg.swing < 0) {
    // Dangling: the foot trails toward a hang pose, reaching for any grip nearby.
    leg.air++;
    const hx = hipX + (o.hangX ?? 0), hy = hipY + (o.hangY ?? reach * 0.75);
    leg.x += (hx - leg.x) * 0.25;
    leg.y += (hy - leg.y) * 0.25;
    if (leg.air % 3 === 0) {
      const g = o.floorOnly
        ? findFloor(world, idealX, idealY - reach * 0.4, idealY + (o.floorDepth ?? reach * 0.4))
        : findGrip(world, idealX, idealY, o.search, hipX, hipY);
      if (g && Math.hypot(g.x - hipX, g.y - hipY) < reach * 0.95) {
        leg.fromX = leg.x; leg.fromY = leg.y;
        leg.toX = g.x; leg.toY = g.y; leg.gx = g.x; leg.gy = g.y; leg.gnx = g.nx; leg.gny = g.ny;
        leg.swing = 0.25;
      }
    }
  }
  // Keep the foot within reach no matter what (the body can outrun a grip).
  const dx = leg.x - hipX, dy = leg.y - hipY, d = Math.hypot(dx, dy);
  if (d > reach) { leg.x = hipX + dx / d * reach; leg.y = hipY + dy / d * reach; }
  solveKnee(leg, hipX, hipY);
}

/** Teleport a leg with its body. */
export function shiftLeg(leg: Leg, dx: number, dy: number): void {
  leg.x += dx; leg.y += dy; leg.gx += dx; leg.gy += dy; leg.fromX += dx; leg.fromY += dy;
  leg.toX += dx; leg.toY += dy; leg.kx += dx; leg.ky += dy;
}

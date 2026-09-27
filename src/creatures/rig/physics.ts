import type { World } from '@/sim/World';
import { blocksEntity, Cell, isLiquid } from '@/sim/CellType';

/**
 * Creature rig physics — the Rain World layer.
 *
 * Bodies are built from verlet points ("chunks") that carry inertia, fall,
 * collide with real cells and drag through real liquid. Tails, necks,
 * tentacles and cloth are chains of them; legs are two-bone IK limbs whose
 * feet search the grid for a real surface to grip. The gameplay body (the
 * enemy's AABB at e.x/e.y) stays the single authority for collision, damage
 * and AI — the rig is attached to it by springs, so it lags, swings,
 * overshoots and drapes over ledges without ever moving the hitbox.
 *
 * Everything here runs at tick rate inside tickCreaturePose and consumes no
 * random stream; renderers only read it.
 */

export interface RigPoint {
  x: number;
  y: number;
  /** Previous position (verlet velocity = x - px). */
  px: number;
  py: number;
  /** Collision radius in cells (0 = no terrain collision). */
  r: number;
  /** Contact sides hit this tick: 1 floor, 2 ceiling, 4 left wall, 8 right wall. */
  hit: number;
  /** 0..1 smoothed liquid immersion at the point. */
  wet: number;
}

export const HIT_FLOOR = 1;
export const HIT_CEIL = 2;
export const HIT_LEFT = 4;
export const HIT_RIGHT = 8;

export function point(x: number, y: number, r = 1): RigPoint {
  return { x, y, px: x, py: y, r, hit: 0, wet: 0 };
}

export function solidAt(world: World, x: number, y: number): boolean {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= world.width || iy >= world.height) return true;
  return blocksEntity(world.types[ix + iy * world.width]);
}

export function liquidAt(world: World, x: number, y: number): boolean {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= world.width || iy >= world.height) return false;
  return isLiquid(world.types[ix + iy * world.width]);
}

export function waterAt(world: World, x: number, y: number): boolean {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= world.width || iy >= world.height) return false;
  const t = world.types[ix + iy * world.width];
  return t === Cell.Water || t === Cell.Blood || t === Cell.Slime;
}

/** Cheap circle-vs-cells test: centre plus rim samples scaled to the radius. */
export function circleBlocked(world: World, x: number, y: number, r: number): boolean {
  if (solidAt(world, x, y)) return true;
  if (r < 0.6) return false;
  if (solidAt(world, x + r, y) || solidAt(world, x - r, y) || solidAt(world, x, y + r) || solidAt(world, x, y - r)) return true;
  if (r < 1.4) return false;
  const d = r * 0.7071;
  return solidAt(world, x + d, y + d) || solidAt(world, x - d, y + d) || solidAt(world, x + d, y - d) || solidAt(world, x - d, y - d);
}

/**
 * Move a point toward (tx, ty) with axis-separated, sub-stepped collision.
 * A point that starts embedded (terrain appeared on it, a teleport) moves
 * freely until it is clear, so a rig can never be welded into rock.
 */
export function movePoint(world: World, p: RigPoint, tx: number, ty: number): void {
  let dx = tx - p.x, dy = ty - p.y;
  if (p.r <= 0 || circleBlocked(world, p.x, p.y, p.r)) { p.x = tx; p.y = ty; return; }
  const steps = Math.min(10, Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.8)));
  dx /= steps; dy /= steps;
  for (let k = 0; k < steps; k++) {
    if (dx !== 0) {
      const nx = p.x + dx;
      if (!circleBlocked(world, nx, p.y, p.r)) p.x = nx;
      else { p.hit |= dx > 0 ? HIT_RIGHT : HIT_LEFT; dx = 0; }
    }
    if (dy !== 0) {
      const ny = p.y + dy;
      if (!circleBlocked(world, p.x, ny, p.r)) p.y = ny;
      else { p.hit |= dy > 0 ? HIT_FLOOR : HIT_CEIL; dy = 0; }
    }
    if (dx === 0 && dy === 0) break;
  }
}

export interface IntegrateOpts {
  gravity: number;
  /** Velocity retained per tick in air (0..1). */
  damping: number;
  /** Velocity retained per tick in liquid. */
  wetDamping?: number;
  /** Gravity multiplier in liquid (negative floats). */
  buoyancy?: number;
  /** Tangential velocity lost on the ground (0..1). */
  friction?: number;
}

/** One verlet step with collision, liquid drag/buoyancy and ground friction. */
export function integrate(world: World, p: RigPoint, o: IntegrateOpts, ax = 0, ay = 0): void {
  let vx = p.x - p.px, vy = p.y - p.py;
  const wet = liquidAt(world, p.x, p.y) ? 1 : 0;
  p.wet += (wet - p.wet) * 0.35;
  const damp = o.damping + ((o.wetDamping ?? o.damping * 0.86) - o.damping) * p.wet;
  vx *= damp; vy *= damp;
  if (p.hit & HIT_FLOOR) vx *= 1 - (o.friction ?? 0.3);
  if (p.hit & (HIT_LEFT | HIT_RIGHT)) vy *= 1 - (o.friction ?? 0.3) * 0.5;
  // Cap per-tick travel so a rig can never tunnel or explode numerically.
  const sp = Math.hypot(vx, vy);
  if (sp > 6) { vx *= 6 / sp; vy *= 6 / sp; }
  const g = o.gravity * (1 + ((o.buoyancy ?? 0.2) - 1) * p.wet);
  p.px = p.x; p.py = p.y;
  p.hit = 0;
  movePoint(world, p, p.x + vx + ax, p.y + vy + g + ay);
}

/** Snap a point (and its history) somewhere, killing its velocity. */
export function place(p: RigPoint, x: number, y: number): void {
  p.x = p.px = x; p.y = p.py = y;
}

/** Shift a point and its history together (teleports, rig re-anchoring). */
export function translate(p: RigPoint, dx: number, dy: number): void {
  p.x += dx; p.y += dy; p.px += dx; p.py += dy;
}

/** Add a velocity impulse to a verlet point. */
export function impulse(p: RigPoint, vx: number, vy: number): void {
  p.px -= vx; p.py -= vy;
}

/**
 * Pull `b` toward rest distance from `a`. `share` of the correction goes to b
 * (1 = a is pinned). Collision-aware so constraints never shove into rock.
 */
export function constrain(world: World | null, a: RigPoint, b: RigPoint, rest: number, share = 0.5, stiffness = 1): void {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  const err = (d - rest) / d * stiffness;
  const bx = b.x - dx * err * share, by = b.y - dy * err * share;
  const ax2 = a.x + dx * err * (1 - share), ay2 = a.y + dy * err * (1 - share);
  if (world) { movePoint(world, b, bx, by); if (share < 1) movePoint(world, a, ax2, ay2); }
  else { b.x = bx; b.y = by; if (share < 1) { a.x = ax2; a.y = ay2; } }
}

/**
 * Critically-damped-ish 1D spring: returns the new value; velocity lives in
 * the caller's store. Stiffness/damping are per tick.
 */
export function spring(value: number, velocity: { v: number }, target: number, stiffness: number, damping: number): number {
  velocity.v = velocity.v * damping + (target - value) * stiffness;
  return value + velocity.v;
}

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

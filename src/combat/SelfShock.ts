import type { Ctx } from '@/core/types';
import { clamp } from '@/core/math';
import { isConductor } from '@/sim/CellType';

/**
 * Self-shock fairness. Sparking a pool you are standing in should still bite
 * (the grid is honest: you are wet and in the circuit), but it must read and
 * it must be fair:
 *
 * - FALLOFF: the jolt scales with the current actually at the body. Charge
 *   loses strength every conductor hop (sim/electrical), so a bolt 30 cells
 *   down the cistern arrives as a tingle, one at your boots as a slam.
 * - CAP: inside any 2-second window the alchemist's OWN current (a cast within
 *   the last 4 s) can take at most SELF_SHOCK_WINDOW_CAP hp. A Rillback's
 *   pulse or a live puzzle rail keeps its full bite.
 * - A VISIBLE PATH: while a current reaches the body, a short crawling arc runs
 *   back up the charge gradient toward its source, so you see where it came
 *   from. Local (<= 16 cells) and short-lived, never a glowing slab.
 */

/** A current this strong at the body shocks at full strength. */
export const SELF_SHOCK_FULL_CHARGE = 40;
/** The faintest current still stings this much of full. */
export const SELF_SHOCK_MIN_SCALE = 0.15;
/** Window (ticks) and cap (hp) for electrical damage from the player's own current. */
export const SELF_SHOCK_WINDOW_TICKS = 120;
export const SELF_SHOCK_WINDOW_CAP = 12;
/** A cast this recent (ticks) makes a shock the player's own doing. */
export const SELF_SHOCK_CAST_TICKS = 240;
/** Longest run (cells) the crawling arc traces back along the conductor. */
export const SELF_SHOCK_ARC_CELLS = 16;

export interface SelfShockState {
  windowStart: number;
  taken: number;
  lastCast: number;
}

export function createSelfShockState(): SelfShockState {
  return { windowStart: -1e9, taken: 0, lastCast: -1e9 };
}

/** Share of full shock the current at the body delivers. */
export function shockFalloff(maxCharge: number): number {
  return clamp(maxCharge / SELF_SHOCK_FULL_CHARGE, SELF_SHOCK_MIN_SCALE, 1);
}

/**
 * The fair electrical damage for one status sample. Self-inflicted shocks (a
 * cast within SELF_SHOCK_CAST_TICKS) scale with the current at the body and
 * share a capped window; anyone else's current keeps its full bite.
 */
export function fairShockDamage(state: SelfShockState, shockDamage: number, maxCharge: number, frame: number): number {
  if (shockDamage <= 0) return 0;
  if (frame - state.lastCast > SELF_SHOCK_CAST_TICKS) return shockDamage;
  if (frame - state.windowStart > SELF_SHOCK_WINDOW_TICKS) {
    state.windowStart = frame;
    state.taken = 0;
  }
  const dmg = Math.min(shockDamage * shockFalloff(maxCharge), Math.max(0, SELF_SHOCK_WINDOW_CAP - state.taken));
  state.taken += dmg;
  return dmg;
}

/**
 * Trace the current back from the body: start at the most-charged cell the body
 * touches and step to the most-charged neighbouring conductor while the charge
 * keeps rising (toward the source), up to SELF_SHOCK_ARC_CELLS. Returns the
 * path from the body outward (empty when nothing charged touches the body).
 */
export function conductorPath(
  world: Ctx['world'],
  bodyX: number,
  bodyY: number,
  halfW: number,
  h: number,
): Array<{ x: number; y: number }> {
  const bx = Math.floor(bodyX);
  const by = Math.floor(bodyY);
  let sx = -1;
  let sy = -1;
  let best = 0;
  for (let dy = -1; dy < h; dy++) {
    for (let dx = -halfW; dx <= halfW; dx++) {
      const x = bx + dx;
      const y = by - dy;
      if (!world.inBounds(x, y)) continue;
      const c = world.charge[world.idx(x, y)];
      if (c > best) {
        best = c;
        sx = x;
        sy = y;
      }
    }
  }
  const path: Array<{ x: number; y: number }> = [];
  if (best <= 0) return path;
  let x = sx;
  let y = sy;
  path.push({ x, y });
  for (let step = 0; step < SELF_SHOCK_ARC_CELLS; step++) {
    let nx = -1;
    let ny = -1;
    let nc = world.charge[world.idx(x, y)];
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const tx = x + ox;
        const ty = y + oy;
        if (!world.inBounds(tx, ty)) continue;
        const i = world.idx(tx, ty);
        if (!isConductor(world.types[i])) continue;
        if (world.charge[i] > nc) {
          nc = world.charge[i];
          nx = tx;
          ny = ty;
        }
      }
    }
    if (nx < 0) break;
    x = nx;
    y = ny;
    path.push({ x, y });
  }
  return path;
}

/** Crawl a few short arcs along the traced conductor into the body (re-rolled each sample). */
export function drawConductorArc(ctx: Ctx, bodyX: number, bodyY: number, halfW: number, h: number): void {
  const path = conductorPath(ctx.world, bodyX, bodyY, halfW, h);
  if (path.length === 0 || !ctx.lightning?.spark) return;
  const cx = bodyX;
  const cy = bodyY - h * 0.45;
  // Into the body from where the current touches it...
  ctx.lightning.spark(path[0].x + 0.5, path[0].y + 0.5, cx, cy);
  // ...and back along the conductor in ~4-cell hops, so the arc crawls toward its source.
  for (let i = 4; i < path.length; i += 4) {
    const a = path[i - 4];
    const b = path[i];
    ctx.lightning.spark(a.x + 0.5, a.y + 0.5, b.x + 0.5, b.y + 0.5);
  }
}

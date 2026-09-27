import type { Critter, Ctx } from '@/core/types';
import { blocksEntity, isLiquid } from '@/sim/CellType';
import { GLOW } from './types';
import { glowThreadX } from './glowworm';
import { wandLightAt } from './common';

/**
 * Wave-2 behaviour for the original critters: lantern moths that swarm the
 * wand's actual light (and lose interest when the lantern is hooded), moths
 * drawn to a glow-worm's beaded lure, and cave fish that school.
 */

/** Moth orbit radius around a light it has reached (cells). */
export const MOTH_ORBIT = 9;
/** How far a moth notices the wand's light / a glow-worm's lure. */
export const MOTH_LIGHT_RANGE = 130;
export const MOTH_LURE_RANGE = 80;

/**
 * LANTERN MOTHS: the wand is a light only while it lights something. A moth
 * the beam (or the omni glow) actually reaches flies at the wand tip and
 * circles it; hood the lantern and the swarm loses it and drifts off. Without
 * a light query (tests, small contexts) the old always-on pull is kept.
 */
export function mothLight(ctx: Ctx, c: Critter): boolean {
  const p = ctx.player;
  if (p.dead) return false;
  const tipX = p.x + Math.cos(p.aimAngle) * 9, tipY = p.y - 9 + Math.sin(p.aimAngle) * 9;
  const dx = tipX - c.x, dy = tipY - c.y, d2 = dx * dx + dy * dy;
  if (d2 > MOTH_LIGHT_RANGE * MOTH_LIGHT_RANGE) return false;
  const hooded = ctx.lightQuery?.hooded ?? false;
  // Beam coverage (light-field units: ~0.05–0.25 in the beam), or the lantern's glow close by.
  const lit = hooded ? 0 : Math.max(wandLightAt(ctx, c.x, c.y), d2 < 40 * 40 ? 0.08 : 0);
  if (lit <= 0.012) return false;
  const d = Math.sqrt(d2) || 1;
  const k = Math.min(1, lit * 10);
  if (d > MOTH_ORBIT) {
    c.vx += (dx / d) * 0.05 * k;
    c.vy += (dy / d) * 0.05 * k;
  } else {
    // Arrived: the orbit, not a landing — a tangential push and a soft spring.
    const dir = (c.phase % 2) < 1 ? 1 : -1;
    c.vx += (-dy / d) * 0.06 * dir + (dx / d) * 0.012;
    c.vy += (dx / d) * 0.06 * dir + (dy / d) * 0.012;
  }
  return true;
}

/** A glow-worm's beaded thread, fishing in the dark, is a light a moth cannot resist. */
export function glowLure(c: Critter, list: readonly Critter[]): boolean {
  let best: Critter | null = null, bd = MOTH_LURE_RANGE * MOTH_LURE_RANGE;
  for (const g of list) {
    if (g.kind !== 'glowworm' || g.state !== GLOW.FISH || (g.extent ?? 0) < 3) continue;
    const gy = (g.anchorY ?? g.y) + (g.extent ?? 0) * 0.7;
    const dx = glowThreadX(g, gy) - c.x, dy = gy - c.y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = g; }
  }
  if (!best) return false;
  const gy = (best.anchorY ?? best.y) + (best.extent ?? 0) * (0.45 + (Math.sin(c.phase * 0.2) + 1) * 0.25);
  const dx = glowThreadX(best, gy) - c.x, dy = gy - c.y, d = Math.hypot(dx, dy) || 1;
  c.vx += (dx / d) * 0.045;
  c.vy += (dy / d) * 0.04;
  return true;
}

/** Fish in one pool school: they swim together, keep a body apart, and turn as one. */
export function schoolFish(ctx: Ctx, c: Critter, list: readonly Critter[]): void {
  let n = 0, cx = 0, cy = 0, vx = 0, vy = 0, sx = 0, sy = 0;
  for (const o of list) {
    if (o === c || o.kind !== 'fish' || (o.dead ?? 0) > 0) continue;
    const dx = o.x - c.x, dy = o.y - c.y;
    if (Math.abs(dx) > 18 || Math.abs(dy) > 10) continue;
    n++; cx += dx; cy += dy; vx += o.vx; vy += o.vy;
    const d2 = dx * dx + dy * dy;
    if (d2 < 9 && d2 > 0.01) { sx -= dx / d2; sy -= dy / d2; }
  }
  if (n === 0) return;
  c.vx += (cx / n) * 0.004 + (vx / n - c.vx) * 0.05 + sx * 0.05;
  c.vy += (cy / n) * 0.003 + (vy / n - c.vy) * 0.04 + sy * 0.05;
  void ctx;
}

/** A shocked fish floats belly-up to the surface of the pool it died in. */
export function driftDeadFish(ctx: Ctx, c: Critter): void {
  const w = ctx.world, xi = Math.floor(c.x), yi = Math.floor(c.y);
  const inWater = w.inBounds(xi, yi) && isLiquid(w.types[w.idx(xi, yi)]);
  const aboveWet = w.inBounds(xi, yi - 1) && isLiquid(w.types[w.idx(xi, yi - 1)]);
  if (inWater && aboveWet) c.vy = Math.max(-0.12, c.vy - 0.01);
  else if (inWater) c.vy = 0;
  else c.vy = Math.min(1.5, c.vy + 0.12);
  c.vx = c.vx * 0.9 + w.flow.x(c.x, c.y) * 0.05;
  const ny = c.y + c.vy, yn = Math.floor(ny);
  if (w.inBounds(xi, yn) && !blocksEntity(w.types[w.idx(xi, yn)])) c.y = ny;
  else c.vy = 0;
  const nx = c.x + c.vx, xn = Math.floor(nx);
  if (w.inBounds(xn, Math.floor(c.y)) && !blocksEntity(w.types[w.idx(xn, Math.floor(c.y))])) c.x = nx;
  else c.vx = 0;
}

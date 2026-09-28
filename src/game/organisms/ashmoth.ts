import type { Critter, Ctx } from '@/core/types';
import { blocksEntity, Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { entityRandom } from '@/core/simRandom';
import { isHot, organismEvent } from './common';

/**
 * ASH MOTH — the Kiln's moth, grey as the flue it lives in, with a warm
 * underside that catches the lava light. It is drawn to heat and glow the way
 * every moth is, rides the updraft over a lava pool in lazy spirals — and now
 * and then one goes too close and flares out in a pinch of real ash.
 */

function typeAt(ctx: Ctx, x: number, y: number): number {
  const w = ctx.world, xi = Math.floor(x), yi = Math.floor(y);
  return w.inBounds(xi, yi) ? w.types[w.idx(xi, yi)] : Cell.Wall;
}

export function stepAshmoth(ctx: Ctx, c: Critter): boolean {
  const here = typeAt(ctx, c.x, c.y);
  if (isHot(here)) {
    // The flare: a bright pinch of flame, and what is left falls as ash.
    ctx.particles.burst(c.x, c.y, 5, null, () => packRGB(255, 190, 90), 1.1, { glow: 2.4, grav: -0.03 });
    const w = ctx.world, xi = Math.floor(c.x), yi = Math.floor(c.y) - 1;
    if (w.inBounds(xi, yi) && w.types[w.idx(xi, yi)] === Cell.Empty) w.replaceCellAt(w.idx(xi, yi), Cell.Ash, packRGB(120, 116, 110));
    organismEvent(ctx, 'ashmoth', 'flare', c.x, c.y);
    return false;
  }
  if (here === Cell.Water || here === Cell.Acid) return false;
  c.phase += 0.13;
  if ((c.startle ?? 0) > 0) {
    c.startle = (c.startle ?? 0) - 1;
    c.vy += 0.03; c.vx *= 0.97; c.vy *= 0.97;
  } else {
    c.vx += Math.sin(c.phase * 1.6) * 0.04 + (entityRandom() - 0.5) * 0.05;
    c.vy += Math.cos(c.phase * 1.2) * 0.035 + (entityRandom() - 0.5) * 0.05;
    // Heat pulls: sample a few cells around; the nearest glow wins the spiral.
    let best = 0, bx = 0, by = 0;
    for (let s = 0; s < 5; s++) {
      const sx = c.x + Math.floor(entityRandom() * 61) - 30, sy = c.y + Math.floor(entityRandom() * 61) - 20;
      if (!isHot(typeAt(ctx, sx, sy))) continue;
      const d = Math.hypot(sx - c.x, sy - c.y);
      const score = 1 / (1 + d);
      if (score > best) { best = score; bx = sx; by = sy; }
    }
    if (best > 0) {
      c.homeX = bx; c.homeY = by - 10; // remembers the glow it last saw
    }
    if (c.homeX !== undefined && c.homeY !== undefined) {
      const dx = c.homeX - c.x, dy = c.homeY - c.y, d = Math.hypot(dx, dy) || 1;
      // Orbit, don't dive: pull in, plus a tangential drift that makes the spiral.
      const pull = d > 12 ? 0.05 : 0.012;
      c.vx += (dx / d) * pull + (-dy / d) * 0.03;
      c.vy += (dy / d) * pull + (dx / d) * 0.03 - 0.006; // the flue's updraft
    }
    c.vx *= 0.93; c.vy *= 0.93;
  }
  if (Math.abs(c.vx) > 0.05) c.facing = c.vx < 0 ? -1 : 1;
  const nx = c.x + c.vx, ny = c.y + c.vy;
  if (!blocksEntity(typeAt(ctx, nx, c.y))) c.x = nx; else c.vx *= -0.5;
  if (!blocksEntity(typeAt(ctx, c.x, ny))) c.y = ny; else c.vy *= -0.5;
  return true;
}

import type { Critter, Ctx } from '@/core/types';
import { blocksEntity, Cell, isLiquid } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { entityRandom } from '@/core/simRandom';
import { isHot, organismEvent, playerGap, projectileWithin, typeAt } from './common';

/**
 * BRINE SKATERS (wave 3, the Cold Store) — pond skaters that live on the
 * surface film of the brine gutters and sumps (fresh water will do). They
 * stand on the surface row — the open cell over a liquid cell — and move in
 * darts: a flick of the long legs, a glide, a pause. A shadow, a bolt or the
 * alchemist's boot sends them skittering away across the film.
 *
 * The film is the grid's: freeze the pool (fresh water turns to ice; brine
 * never does) and a skater on it is stranded — it hops for the nearest open
 * surface it can see, or dies on the ice. Heat kills it, as it kills
 * everything small.
 */

function surfaceAt(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  const xi = Math.floor(x), yi = Math.floor(y);
  if (!w.inBounds(xi, yi + 1)) return false;
  const here = w.types[w.idx(xi, yi)], below = w.types[w.idx(xi, yi + 1)];
  return (here === Cell.Empty || here === Cell.Steam || here === Cell.Smoke) && isLiquid(below) && below !== Cell.Lava && below !== Cell.Acid;
}

/** The surface row near (x, y): the open cell over the first liquid within a few cells. */
function findSurface(ctx: Ctx, x: number, y: number, reach: number): number | null {
  for (let dy = -reach; dy <= reach; dy++) if (surfaceAt(ctx, x, y + dy)) return y + dy;
  return null;
}

export function stepSkater(ctx: Ctx, c: Critter): boolean {
  const here = typeAt(ctx, c.x, c.y);
  if (isHot(here)) {
    ctx.particles.burst(c.x, c.y, 3, null, () => packRGB(90, 80, 70), 0.8, { grav: 0.04 });
    organismEvent(ctx, 'brineskater', 'die', c.x, c.y);
    return false;
  }
  c.phase += 0.2;
  c.stateT = (c.stateT ?? 0) + 1;
  // Airborne (a hop, or the film froze under it): fall, look for a surface.
  const onFilm = surfaceAt(ctx, c.x, c.y);
  if (!onFilm) {
    c.vy += 0.12;
    c.vx *= 0.98;
    const ny = c.y + c.vy, nx = c.x + c.vx;
    if (!blocksEntity(typeAt(ctx, nx, c.y))) c.x = nx; else c.vx *= -0.4;
    if (isLiquid(typeAt(ctx, c.x, ny + 1)) && !blocksEntity(typeAt(ctx, c.x, ny))) {
      // Landed on a film.
      const s = findSurface(ctx, c.x, ny, 2);
      if (s !== null) { c.y = s + 0.5; c.vy = 0; return true; }
    }
    if (blocksEntity(typeAt(ctx, c.x, ny))) {
      c.vy = 0;
      // Stranded on something solid (ice, the bank): hop toward open film, or give up.
      c.meal = (c.meal ?? 0) + 1;
      if ((c.meal ?? 0) > 360) { organismEvent(ctx, 'brineskater', 'die', c.x, c.y); return false; }
      if (c.stateT % 40 === 0) {
        for (let r = 4; r <= 40; r += 4) {
          for (const dir of [-1, 1]) {
            const s = findSurface(ctx, c.x + dir * r, c.y, 6);
            if (s !== null) { c.vx = dir * Math.min(1.4, 0.4 + r * 0.03); c.vy = -1.4; c.stateT = 1; return true; }
          }
        }
      }
      return true;
    }
    c.y = ny;
    return true;
  }
  c.meal = 0;
  // On the film. Threats send it skittering the other way.
  const threat = playerGap(ctx, c.x, c.y) < 18 || projectileWithin(ctx, c.x, c.y, 10) !== null;
  if (threat && (c.startle ?? 0) <= 0) {
    const away = Math.sign(c.x - ctx.player.x) || (entityRandom() < 0.5 ? -1 : 1);
    c.vx = away * (1.1 + entityRandom() * 0.5);
    c.startle = 24;
    organismEvent(ctx, 'brineskater', 'scatter', c.x, c.y);
  } else if ((c.startle ?? 0) > 0) c.startle = (c.startle ?? 0) - 1;
  else if (c.stateT % (30 + ((c.phase * 7) | 0) % 40) === 0) {
    // A dart: a flick of the long legs, then a glide.
    c.vx = (entityRandom() < 0.5 ? -1 : 1) * (0.5 + entityRandom() * 0.7);
  }
  c.vx *= 0.93;
  const nx = c.x + c.vx;
  // Stay on the film: never step onto the bank; turn about at an edge.
  if (surfaceAt(ctx, nx, c.y)) c.x = nx;
  else {
    const s = findSurface(ctx, nx, c.y, 1);
    if (s !== null) { c.x = nx; c.y = s + 0.5; } else c.vx = -c.vx * 0.6;
  }
  if (Math.abs(c.vx) > 0.05) c.facing = c.vx < 0 ? -1 : 1;
  return true;
}

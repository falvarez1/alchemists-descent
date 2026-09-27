import type { Critter, Ctx } from '@/core/types';
import { blocksEntity, Cell, isLiquid } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { entityRandom } from '@/core/simRandom';
import type { OrganismHost } from './common';
import { hotNear, organismEvent, playerGap, playerWading } from './common';
import { LEECH, LEECH_DRAIN, LEECH_DRAIN_TICKS, LEECH_DRY, LEECH_MAX_LATCHED, LEECH_SATED, LEECH_SPEED } from './types';

/**
 * LEECH — the Drowned Cisterns' small tax on wading. It idles on the pool
 * floor in a slow S, and when an alchemist steps into its water it swims at
 * him and fastens on (at most three at once). A latched leech drinks a little
 * every couple of seconds and swells red; sated, it lets go. It lets go sooner
 * if he climbs out and stays dry, if he is on fire (or stands in flame), or if
 * the water it came from is shocked — which kills it outright.
 */

function latchedOn(host: OrganismHost): number {
  let n = 0;
  for (const c of host.list) if (c.kind === 'leech' && c.state === LEECH.LATCHED) n++;
  return n;
}

function letGo(ctx: Ctx, c: Critter, fatal: boolean): void {
  c.state = LEECH.BEACHED; c.stateT = 0;
  c.vx = (entityRandom() - 0.5) * 0.8; c.vy = -0.6;
  c.anchorX = undefined; c.anchorY = undefined;
  if (fatal) c.dead = 1;
  organismEvent(ctx, 'leech', 'shed', c.x, c.y);
}

export function stepLeech(ctx: Ctx, c: Critter, host: OrganismHost): boolean {
  const w = ctx.world, p = ctx.player, t = ctx.state.frameCount;
  c.stateT = (c.stateT ?? 0) + 1;
  c.phase += 0.16;
  if ((c.dead ?? 0) > 0) {
    // A shrivelled leech sinks or dries where it fell, then is gone.
    c.dead = (c.dead ?? 0) + 1;
    c.vy = Math.min(1.2, c.vy + 0.05); c.vx *= 0.9;
    const ny = c.y + c.vy;
    if (!blocksEntity(ctxType(ctx, c.x, ny))) c.y = ny; else c.vy = 0;
    return (c.dead ?? 0) < 420;
  }
  const xi = Math.floor(c.x), yi = Math.floor(c.y);
  if (!w.inBounds(xi, yi)) return false;
  const here = w.types[w.idx(xi, yi)];
  if (here === Cell.Fire || here === Cell.Lava || here === Cell.Acid || here === Cell.Toxic) { c.dead = 1; organismEvent(ctx, 'leech', 'die', c.x, c.y); return true; }
  // Shocked water cooks it.
  if (here === Cell.Water && w.charge[w.idx(xi, yi)] > 0) {
    c.dead = 1;
    ctx.particles.burst(c.x, c.y, 3, null, () => packRGB(140, 230, 255), 0.8, { glow: 2 });
    organismEvent(ctx, 'leech', 'zap', c.x, c.y);
    return true;
  }
  const state = c.state ?? LEECH.SWIM;

  if (state === LEECH.LATCHED) {
    if (p.dead) { letGo(ctx, c, false); return true; }
    const ox = c.anchorX ?? 0, oy = c.anchorY ?? -6;
    c.x = p.x + ox * (p.facing ?? 1) + Math.sin(c.phase) * 0.25;
    c.y = p.y + oy + Math.cos(c.phase * 0.7) * 0.2;
    c.facing = ox >= 0 ? 1 : -1;
    // It drinks.
    if ((c.stateT ?? 0) % LEECH_DRAIN_TICKS === LEECH_DRAIN_TICKS - 1) {
      ctx.playerCtl.damage(LEECH_DRAIN, 0, 0, 'leech');
      c.meal = (c.meal ?? 0) + 1;
      c.extent = Math.min(1, (c.meal ?? 0) / LEECH_SATED);
      ctx.particles.spawn(c.x, c.y, 0, 0.2, Cell.Blood, packRGB(150, 20, 28), 40);
    }
    const burning = (p.status?.burning ?? 0) > 0 || hotNear(ctx, p.x, p.y - 6, 3) > 0;
    const shocked = (p.status?.electrified ?? 0) > 0;
    const wet = playerWading(ctx) || (p.status?.wet ?? 0) > 0;
    c.gasp = wet ? 0 : (c.gasp ?? 0) + 1;
    if (burning || shocked) { ctx.particles.burst(c.x, c.y, 4, null, () => packRGB(255, 150, 60), 1, { glow: 1.6 }); letGo(ctx, c, true); }
    else if ((c.meal ?? 0) >= LEECH_SATED || (c.gasp ?? 0) > LEECH_DRY) letGo(ctx, c, false);
    return true;
  }

  const wet = isLiquid(here);
  if (!wet) {
    // BEACHED: it writhes toward the nearest water it can feel, and dries out.
    c.gasp = (c.gasp ?? 0) + 1;
    c.vy += 0.16;
    if ((c.stateT ?? 0) % 26 === 0) {
      let dir = 0;
      for (let r = 2; r < 30 && dir === 0; r += 3) {
        if (isLiquid(ctxType(ctx, c.x + r, c.y + 1))) dir = 1;
        else if (isLiquid(ctxType(ctx, c.x - r, c.y + 1))) dir = -1;
      }
      c.vx = (dir || (entityRandom() < 0.5 ? -1 : 1)) * 0.5; c.vy -= 0.8;
    }
    if ((c.gasp ?? 0) > 900) { c.dead = 1; organismEvent(ctx, 'leech', 'die', c.x, c.y); }
  } else {
    c.gasp = 0;
    if (state === LEECH.BEACHED) { c.state = LEECH.SWIM; c.stateT = 0; }
    // SWIM: a slow S along the bottom, or a beeline for a wading alchemist.
    const wading = playerWading(ctx);
    const dx = p.x - c.x, dy = p.y - 5 - c.y, d = Math.hypot(dx, dy) || 1;
    const hunting = wading && !p.dead && d < 56 && (c.meal ?? 0) < LEECH_SATED;
    if (hunting) {
      c.vx += (dx / d) * LEECH_SPEED * 0.12 + Math.sin(c.phase * 1.4) * 0.03;
      c.vy += (dy / d) * LEECH_SPEED * 0.12;
    } else {
      c.vx += Math.sin(c.phase * 0.21 + (c.homeX ?? 0)) * 0.012;
      c.vy += 0.008 + Math.sin(c.phase * 0.5) * 0.01; // it hugs the bottom
      if ((c.meal ?? 0) > 0 && t % 120 === 0) c.meal = Math.max(0, (c.meal ?? 0) - 1);
    }
    c.vx *= 0.9; c.vy *= 0.88;
    const sp = Math.hypot(c.vx, c.vy), cap = hunting ? LEECH_SPEED : 0.15;
    if (sp > cap) { c.vx *= cap / sp; c.vy *= cap / sp; }
    // Contact: it fastens on.
    if (hunting && playerGap(ctx, c.x, c.y) < 1.2 && latchedOn(host) < LEECH_MAX_LATCHED) {
      c.state = LEECH.LATCHED; c.stateT = 0; c.gasp = 0;
      c.anchorX = Math.round((c.x - p.x) * (p.facing ?? 1));
      c.anchorX = Math.max(-3, Math.min(3, c.anchorX));
      c.anchorY = Math.max(-13, Math.min(-2, Math.round(c.y - p.y)));
      organismEvent(ctx, 'leech', 'latch', c.x, c.y);
      ctx.audio.squelch(c.x, c.y);
      return true;
    }
  }
  if (Math.abs(c.vx) > 0.03) c.facing = c.vx < 0 ? -1 : 1;
  const nx = c.x + c.vx, ny = c.y + c.vy;
  if (!blocksEntity(ctxType(ctx, nx, c.y))) c.x = nx; else c.vx *= -0.4;
  if (!blocksEntity(ctxType(ctx, c.x, ny))) c.y = ny; else c.vy *= -0.2;
  // Swimmers stay under: a leech at the surface noses back down.
  if (wet && !isLiquid(ctxType(ctx, c.x, c.y - 1))) c.vy += 0.03;
  return true;
}

function ctxType(ctx: Ctx, x: number, y: number): number {
  const w = ctx.world, xi = Math.floor(x), yi = Math.floor(y);
  return w.inBounds(xi, yi) ? w.types[w.idx(xi, yi)] : Cell.Wall;
}

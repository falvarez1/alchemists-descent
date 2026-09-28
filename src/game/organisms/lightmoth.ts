import type { Critter, Ctx } from '@/core/types';
import { blocksEntity, Cell } from '@/sim/CellType';
import { packRGB, waterColor } from '@/sim/colors';
import { entityRandom } from '@/core/simRandom';
import { isHot, organismEvent, typeAt, wandLightAt } from './common';

/**
 * LIGHT MOTHS (wave 3) — the second doors' moths, both drawn to light the way
 * every moth is, but to the COLD light their floors make:
 *
 * - the SNOW MOTH of the Cold Store: white, powdered, circles the rime
 *   crystals and anything the alchemist's wand lights; if it touches a flame
 *   it goes up in a pinch of real snow-melt (a drop of water).
 * - the PRISM MOTH of the Glass Galleries: its scaled wings split the light
 *   that falls on them (render/organisms flashes the spectrum), and it
 *   follows the wand's beam — including a beam turned by a mirror, since it
 *   reads the same light field the photocells do.
 *
 * Lures are real: crystal, glowshrooms and fire in the cells nearby, and the
 * wand's own light at the moth (ctx.lightQuery). A flier with no lure drifts.
 */

function lure(t: number): boolean {
  return t === Cell.Crystal || t === Cell.Glowshroom || t === Cell.Fire || t === Cell.Ember;
}

export function stepLightMoth(ctx: Ctx, c: Critter): boolean {
  const here = typeAt(ctx, c.x, c.y);
  const prism = c.kind === 'prismmoth';
  if (isHot(here)) {
    ctx.particles.burst(c.x, c.y, 4, null, () => (prism ? packRGB(220, 200, 255) : packRGB(230, 240, 250)), 1.0, { glow: prism ? 2.2 : 1.2, grav: -0.02 });
    const w = ctx.world, xi = Math.floor(c.x), yi = Math.floor(c.y) - 1;
    if (!prism && w.inBounds(xi, yi) && w.types[w.idx(xi, yi)] === Cell.Empty) w.replaceCellAt(w.idx(xi, yi), Cell.Water, waterColor());
    organismEvent(ctx, c.kind, 'flare', c.x, c.y);
    return false;
  }
  if (here === Cell.Water || here === Cell.Acid || here === Cell.Brine) return false;
  c.phase += 0.12;
  if ((c.startle ?? 0) > 0) {
    c.startle = (c.startle ?? 0) - 1;
    c.vy += 0.02; c.vx *= 0.97; c.vy *= 0.97;
  } else {
    c.vx += Math.sin(c.phase * 1.7) * 0.035 + (entityRandom() - 0.5) * 0.05;
    c.vy += Math.cos(c.phase * 1.1) * 0.03 + (entityRandom() - 0.5) * 0.05;
    // The wand's light pulls hardest: a moth in the beam flies up it.
    const lit = wandLightAt(ctx, c.x, c.y);
    if (lit > 0.03) {
      const p = ctx.player;
      const tx = p.x + Math.cos(p.aimAngle ?? 0) * 14, ty = p.y - 9 + Math.sin(p.aimAngle ?? 0) * 14;
      c.homeX = tx; c.homeY = ty;
    } else if ((ctx.state.frameCount + (c.phase * 10 | 0)) % 20 === 0) {
      // Otherwise the nearest glow in a few samples becomes its circling point.
      let best = 0;
      for (let s = 0; s < 6; s++) {
        const sx = c.x + Math.floor(entityRandom() * 71) - 35, sy = c.y + Math.floor(entityRandom() * 61) - 30;
        if (!lure(typeAt(ctx, sx, sy))) continue;
        const score = 1 / (1 + Math.hypot(sx - c.x, sy - c.y));
        if (score > best) { best = score; c.homeX = sx; c.homeY = sy + 4; }
      }
    }
    if (c.homeX !== undefined && c.homeY !== undefined) {
      const dx = c.homeX - c.x, dy = c.homeY - c.y, d = Math.hypot(dx, dy) || 1;
      const pull = d > 10 ? 0.045 : 0.01;
      c.vx += (dx / d) * pull + (-dy / d) * 0.028;
      c.vy += (dy / d) * pull + (dx / d) * 0.028;
    }
    c.vx *= 0.93; c.vy *= 0.93;
  }
  if (Math.abs(c.vx) > 0.05) c.facing = c.vx < 0 ? -1 : 1;
  const nx = c.x + c.vx, ny = c.y + c.vy;
  if (!blocksEntity(typeAt(ctx, nx, c.y))) c.x = nx; else c.vx *= -0.5;
  if (!blocksEntity(typeAt(ctx, c.x, ny))) c.y = ny; else c.vy *= -0.5;
  return true;
}

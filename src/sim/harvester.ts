import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { EMPTY_COLOR, goldColor } from '@/sim/colors';

/* ===================== Gold Harvesting ===================== */
export function runHarvesterField(ctx: Ctx): void {
  const w = ctx.world;
  // Build mode: cursor magnet. Play mode: gold flies to the wizard.
  if (ctx.state.mode === 'play') {
    if (ctx.player.dead) return;
    // Gold Sense boon: the pull reaches much further
    const rad = ctx.player.perks.goldmagnet ? 48 : 30,
      mx = Math.round(ctx.player.x),
      my = Math.round(ctx.player.y) - 7;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const px = mx + dx,
          py = my + dy;
        if (
          w.inBounds(px, py) &&
          w.types[w.idx(px, py)] === Cell.Gold &&
          dx * dx + dy * dy <= rad * rad
        ) {
          const i = w.idx(px, py);
          w.types[i] = Cell.Empty;
          w.colors[i] = EMPTY_COLOR;
          ctx.particles.spawn(
            px,
            py,
            (Math.random() - 0.5) * 1.4,
            -0.8 - Math.random(),
            null,
            goldColor(),
            200,
            { homing: true, glow: 2.2, grav: 0 },
          );
        }
      }
    }
    return;
  }
  const hRad = 15;
  const mx = ctx.input.mouse.x,
    my = ctx.input.mouse.y;
  for (let dy = -hRad; dy <= hRad; dy++) {
    for (let dx = -hRad; dx <= hRad; dx++) {
      const px = mx + dx,
        py = my + dy;
      if (w.inBounds(px, py) && w.types[w.idx(px, py)] === Cell.Gold) {
        if (dx === 0 && dy === 0) {
          const i = w.idx(px, py);
          w.types[i] = Cell.Empty;
          w.colors[i] = EMPTY_COLOR;
          ctx.state.score += 10;
          ctx.events.emit('scoreChanged', { score: ctx.state.score });
        } else {
          const sx = px - Math.sign(dx),
            sy = py - Math.sign(dy);
          if (w.inBounds(sx, sy) && w.types[w.idx(sx, sy)] === Cell.Empty) w.swap(px, py, sx, sy);
        }
      }
    }
  }
}

import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { goldColor } from '@/sim/colors';

interface HarvestOffset {
  dx: number;
  dy: number;
}

const diskOffsetCache = new Map<number, readonly HarvestOffset[]>();
const squareOffsetCache = new Map<number, readonly HarvestOffset[]>();

function diskOffsets(radius: number): readonly HarvestOffset[] {
  const cached = diskOffsetCache.get(radius);
  if (cached) return cached;
  const offsets: HarvestOffset[] = [];
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) offsets.push({ dx, dy });
    }
  }
  diskOffsetCache.set(radius, offsets);
  return offsets;
}

function squareOffsets(radius: number): readonly HarvestOffset[] {
  const cached = squareOffsetCache.get(radius);
  if (cached) return cached;
  const offsets: HarvestOffset[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) offsets.push({ dx, dy });
  }
  squareOffsetCache.set(radius, offsets);
  return offsets;
}

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
    for (const { dx, dy } of diskOffsets(rad)) {
      const px = mx + dx,
        py = my + dy;
      if (!w.inBounds(px, py)) continue;
      const i = w.idx(px, py);
      if (w.types[i] === Cell.Gold) {
        w.clearCellAt(i);
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
    return;
  }
  const hRad = 15;
  const mx = ctx.input.mouse.x,
    my = ctx.input.mouse.y;
  for (const { dx, dy } of squareOffsets(hRad)) {
    const px = mx + dx,
      py = my + dy;
    if (w.inBounds(px, py) && w.types[w.idx(px, py)] === Cell.Gold) {
      if (dx === 0 && dy === 0) {
        const i = w.idx(px, py);
        w.clearCellAt(i);
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

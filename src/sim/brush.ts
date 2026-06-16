import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';

/**
 * Build-mode painting: a filled disc of the given material at the brush radius.
 * Walls and metal are protected from being overpainted by loose materials —
 * only the eraser or other structural types may replace them.
 */
export function spawnCircle(ctx: Ctx, centerX: number, centerY: number, type: number): void {
  const { world } = ctx;
  const r = ctx.state.brushSize;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (world.inBounds(x, y)) {
          const i = world.idx(x, y);
          const t = world.types[i];
          if (
            type === Cell.Empty ||
            type === Cell.Wall ||
            type === Cell.Metal ||
            (t !== Cell.Wall && t !== Cell.Metal)
          ) {
            const fn = COLOR_FN[type];
            if (type === Cell.Empty) world.clearCellAt(i);
            else world.replaceCellAt(i, type, fn ? fn() : EMPTY_COLOR);
            if (type === Cell.Smoke) world.life[i] = Math.floor(Math.random() * 40) + 30;
            else if (type === Cell.Fire)
              world.life[i] =
                Math.floor(Math.random() * (ctx.params.materials[Cell.Fire]?.particleLife || 30)) + 15;
          }
        }
      }
    }
  }
}

/** Bresenham line of brush stamps between two grid points (mouse-drag strokes). */
export function drawLine(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  type: number,
): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    spawnCircle(ctx, x0, y0, type);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

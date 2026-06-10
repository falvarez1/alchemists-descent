import type { Ctx } from '@/core/types';
import { Cell, isSolid } from '@/sim/CellType';
import { EMPTY_COLOR, waterColor } from '@/sim/colors';

/**
 * Shared rising-gas behavior for STEAM and SMOKE.
 * (The original's unused `colFunc` parameter is dropped — approved deviation 6.)
 */
export function handleGas(
  ctx: Ctx,
  x: number,
  y: number,
  elementId: Cell,
  flowSpeed: number,
  dispRate: number,
): void {
  const w = ctx.world;
  const ci = w.idx(x, y);
  w.life[ci]--;
  if (elementId === Cell.Steam) {
    if (w.inBounds(x, y - 1) && isSolid(w.types[w.idx(x, y - 1)])) {
      if (Math.random() < ctx.params.materials[Cell.Water].poolingFactor!) {
        w.types[ci] = Cell.Water;
        w.colors[ci] = waterColor();
        w.life[ci] = 0;
        return;
      }
    }
  }
  if (w.life[ci] <= 0) {
    if (elementId === Cell.Steam && Math.random() < 0.15) {
      w.types[ci] = Cell.Water;
      w.colors[ci] = waterColor();
    } else {
      w.types[ci] = Cell.Empty;
      w.colors[ci] = EMPTY_COLOR;
    }
    return;
  }
  if (Math.random() < flowSpeed) {
    if (w.inBounds(x, y - 1) && w.types[w.idx(x, y - 1)] === Cell.Empty) {
      w.swap(x, y, x, y - 1);
      return;
    }
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (w.inBounds(x + dir, y - 1) && w.types[w.idx(x + dir, y - 1)] === Cell.Empty) {
      w.swap(x, y, x + dir, y - 1);
      return;
    }
    if (w.inBounds(x - dir, y - 1) && w.types[w.idx(x - dir, y - 1)] === Cell.Empty) {
      w.swap(x, y, x - dir, y - 1);
      return;
    }
    if (Math.random() < dispRate) {
      if (w.inBounds(x + dir, y) && w.types[w.idx(x + dir, y)] === Cell.Empty) {
        w.swap(x, y, x + dir, y);
        return;
      }
      if (w.inBounds(x - dir, y) && w.types[w.idx(x - dir, y)] === Cell.Empty) {
        w.swap(x, y, x - dir, y);
        return;
      }
    }
  }
}

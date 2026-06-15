import type { Ctx } from '@/core/types';
import { Cell, isConductor } from '@/sim/CellType';

const charged: number[] = [];
const spread: number[] = [];

export function updateElectricalGrid(ctx: Ctx): void {
  const w = ctx.world;
  const sim = w.simBounds;
  // Gather live charges in the active window, then apply spreads + decay in two phases
  const bleed = 1.0 - ctx.params.materials[Cell.Metal].conductivity!;
  charged.length = 0;
  spread.length = 0;
  for (let y = sim.y0; y < sim.y1; y++) {
    const row = y * w.width;
    for (let x = sim.x0; x < sim.x1; x++) {
      if (w.charge[row + x] > 0) charged.push(x, y);
    }
  }
  if (charged.length === 0) return;
  const trySpread = (tx: number, ty: number): void => {
    if (!w.inBounds(tx, ty)) return;
    const ti = tx + ty * w.width;
    if (isConductor(w.types[ti]) && w.charge[ti] === 0) spread.push(tx, ty);
  };
  for (let i = 0; i < charged.length; i += 2) {
    const x = charged[i],
      y = charged[i + 1];
    trySpread(x + 1, y);
    trySpread(x - 1, y);
    trySpread(x, y + 1);
    trySpread(x - 1, y - 1);
  }
  for (let i = 0; i < charged.length; i += 2) {
    const x = charged[i],
      y = charged[i + 1];
    const ci = x + y * w.width;
    const c = w.charge[ci];
    w.charge[ci] = c - (1 + bleed) > 0 ? Math.floor(c - 1) : 0;
  }
  for (let i = 0; i < spread.length; i += 2) w.charge[spread[i] + spread[i + 1] * w.width] = 4;
}

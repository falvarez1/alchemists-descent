import type { Ctx } from '@/core/types';
import { Cell, isConductor } from '@/sim/CellType';

export function updateElectricalGrid(ctx: Ctx): void {
  const w = ctx.world;
  const sim = w.simBounds;
  // Gather live charges in the active window, then apply spreads + decay in two phases
  const bleed = 1.0 - ctx.params.materials[Cell.Metal].conductivity!;
  const charged: number[] = [];
  for (let x = sim.x0; x < sim.x1; x++) {
    for (let y = sim.y0; y < sim.y1; y++) {
      if (w.charge[x + y * w.width] > 0) charged.push(x, y);
    }
  }
  if (charged.length === 0) return;
  const spread: number[] = [];
  for (let i = 0; i < charged.length; i += 2) {
    const x = charged[i],
      y = charged[i + 1];
    const targets = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x - 1, y - 1],
    ];
    for (const [tx, ty] of targets) {
      if (
        w.inBounds(tx, ty) &&
        isConductor(w.types[tx + ty * w.width]) &&
        w.charge[tx + ty * w.width] === 0
      )
        spread.push(tx, ty);
    }
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

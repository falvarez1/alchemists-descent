import type { Ctx } from '@/core/types';
import { Cell, isConductor } from '@/sim/CellType';

const charged: number[] = [];
const spread: number[] = [];

export function updateElectricalGrid(ctx: Ctx): void {
  const w = ctx.world;
  const sim = w.simBounds;
  // Gather tracked live charges in the active window, then apply spreads + decay in two phases.
  // Save loads and legacy direct writes start with an empty tracker, so the first pass rebuilds
  // discovery from the active simulation window; sustained charge then stays sparse.
  const bleed = 1.0 - ctx.params.materials[Cell.Metal].conductivity!;
  charged.length = 0;
  spread.length = 0;
  if (!w.chargeTrackingCovers(sim)) w.rebuildActiveChargesInBounds(sim);
  for (const ci of w.activeCharges) {
    if (w.charge[ci] <= 0) {
      w.activeCharges.delete(ci);
      continue;
    }
    const y = Math.floor(ci / w.width);
    const x = ci - y * w.width;
    if (x >= sim.x0 && x < sim.x1 && y >= sim.y0 && y < sim.y1) charged.push(ci);
  }
  if (charged.length === 0) return;
  const trySpread = (tx: number, ty: number): void => {
    if (!w.inBounds(tx, ty)) return;
    const ti = tx + ty * w.width;
    if (isConductor(w.types[ti]) && w.charge[ti] === 0) spread.push(ti);
  };
  for (const ci of charged) {
    const y = Math.floor(ci / w.width);
    const x = ci - y * w.width;
    trySpread(x + 1, y);
    trySpread(x - 1, y);
    trySpread(x, y + 1);
    trySpread(x - 1, y - 1);
  }
  for (const ci of charged) {
    const c = w.charge[ci];
    w.setChargeAt(ci, c - (1 + bleed) > 0 ? Math.floor(c - 1) : 0);
  }
  for (const ci of spread) w.setChargeAt(ci, 4);
}

import type { Ctx } from '@/core/types';
import { Cell, isConductor } from '@/sim/CellType';

const charged: number[] = [];
/** Cell index → charge to seed it with this frame (attenuated per hop). */
const spreadCharge = new Map<number, number>();

export function updateElectricalGrid(ctx: Ctx): void {
  const w = ctx.world;
  const sim = w.simBounds;
  // Gather tracked live charges in the active window, then apply spreads + decay in two phases.
  // Save loads and legacy direct writes start with an empty tracker, so the first pass rebuilds
  // discovery from the active simulation window; sustained charge then stays sparse.
  const bleed = 1.0 - ctx.params.materials[Cell.Metal].conductivity!;
  charged.length = 0;
  spreadCharge.clear();
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
  // Charge weakens one step per conductor hop (src - 1), so electrification stays
  // LOCAL to the strike and dies out instead of re-seeding at a flat 4 — which let
  // the front circulate through a connected pool and re-ignite decayed cells
  // indefinitely (the cyan glow that "multiplied" across water/blood/ooze).
  const trySpread = (tx: number, ty: number, src: number): void => {
    if (!w.inBounds(tx, ty)) return;
    const ti = tx + ty * w.width;
    if (isConductor(w.types[ti]) && w.charge[ti] === 0) {
      const v = src - 1;
      if (v > 0) {
        const prev = spreadCharge.get(ti);
        if (prev === undefined || v > prev) spreadCharge.set(ti, v);
      }
    }
  };
  for (const ci of charged) {
    const y = Math.floor(ci / w.width);
    const x = ci - y * w.width;
    const c = w.charge[ci];
    trySpread(x + 1, y, c);
    trySpread(x - 1, y, c);
    trySpread(x, y + 1, c);
    trySpread(x - 1, y - 1, c);
  }
  for (const ci of charged) {
    const c = w.charge[ci];
    w.setChargeAt(ci, c - (1 + bleed) > 0 ? Math.floor(c - 1) : 0);
  }
  for (const [ti, v] of spreadCharge) w.setChargeAt(ti, v);
}

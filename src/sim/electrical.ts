import type { Ctx } from '@/core/types';
import { isConductor } from '@/sim/CellType';

const charged: number[] = [];
/** Cell index → charge to seed it with this frame (attenuated per hop). */
const spreadCharge = new Map<number, number>();
/** This grid ticks once per sim SUBSTEP (~6×/frame), but charge must decay only
 *  once per FRAME — otherwise a charge of N vanishes in ~N/6 frames, far too fast
 *  to see now that the spread no longer re-seeds at full strength. */
let lastDecayFrame = -1;

export function updateElectricalGrid(ctx: Ctx): void {
  const w = ctx.world;
  const sim = w.simBounds;
  // Gather tracked live charges in the active window, then apply spreads + decay in two phases.
  // Save loads and legacy direct writes start with an empty tracker, so the first pass rebuilds
  // discovery from the active simulation window; sustained charge then stays sparse.
  // Spread/duration are live-tunable (params.global). Both clamp to >= 1 so a
  // stray 0 can't make charge spread forever or never decay (the self-sustain bug).
  const falloff = Math.max(1, Math.round(ctx.params.global.chargeFalloff));
  const decay = Math.max(1, Math.round(ctx.params.global.chargeDecay));
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
  // Charge weakens by `falloff` per conductor hop, so electrification stays LOCAL
  // to the strike and dies out instead of re-seeding at full strength — which let
  // the front circulate through a connected pool and re-ignite decayed cells
  // indefinitely (the cyan glow that "multiplied" across water/blood/ooze).
  const trySpread = (tx: number, ty: number, src: number): void => {
    if (!w.inBounds(tx, ty)) return;
    const ti = tx + ty * w.width;
    if (isConductor(w.types[ti]) && w.charge[ti] === 0) {
      const v = src - falloff;
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
  // Decay ONCE PER FRAME (not per substep), so `chargeDecay` reads as charge lost
  // per frame — a visible glow duration. Spread still runs every substep so the
  // conduction propagates promptly within the frame.
  const doDecay = ctx.state.frameCount !== lastDecayFrame;
  if (doDecay) {
    lastDecayFrame = ctx.state.frameCount;
    for (const ci of charged) {
      const next = w.charge[ci] - decay;
      w.setChargeAt(ci, next > 0 ? next : 0);
    }
  }
  for (const [ti, v] of spreadCharge) w.setChargeAt(ti, v);
}

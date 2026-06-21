import type { Ctx } from '@/core/types';
import { blocksEntity, Cell, isConductor, isSolid } from '@/sim/CellType';

/**
 * The charge a strike injects, scaled by the live `chargeStrength` (reach) knob.
 * A current conducts ~ deposit / falloff cells before fading, so scaling the
 * deposit is the single lever for "how far does it spread". Clamped to the
 * 0–255 charge range (and ≥1 so a strike always reads). Every spark/lightning/
 * explosion source routes its base deposit through here.
 */
export function chargeDeposit(ctx: Ctx, base: number): number {
  // Fall back to 1x when no electrical tuning is configured (minimal test stubs);
  // production always carries global params, so it gets the real chargeStrength.
  const strength = ctx.params?.global?.chargeStrength ?? 1;
  return Math.max(1, Math.min(65535, Math.round(base * strength)));
}

const charged: number[] = [];
/** Cell index → charge to seed it with this frame (attenuated per hop). */
const spreadCharge = new Map<number, number>();
/** This grid ticks once per sim SUBSTEP (~6×/frame), but charge must decay only
 *  once per FRAME — otherwise a charge of N vanishes in ~N/6 frames, far too fast
 *  to see now that the spread no longer re-seeds at full strength. */
const lastDecayFrameByWorld = new WeakMap<object, number>();
/** Cells the conduction front advances per substep (×6 substeps/frame). A SMALL
 *  value keeps the visible racing crawl — high enough to feel fast, low enough
 *  that it never fills as an instant solid slab (that killed the crackle look). */
const CRAWL_HOPS = 4;
/** Max charge WATER takes in from a SOLID conductor (metal). Water is
 *  far less conductive, so a powerful metal current only weakly energizes the
 *  water sitting on it — a thin crackling layer, not a deep bright pool (keeps the
 *  bloom down). A direct water hit writes straight into the water and spreads
 *  water→water UNCAPPED, so that effect is untouched. */
const WATER_INTAKE_CAP = 15;
/** A current weaker than this won't erode terrain — a faded spark shouldn't crumble rock. */
const EROSION_MIN_CHARGE = 6;
/** Electric fleck thrown off each spalled terrain cell (packed 0xRRGGBB cyan-white). */
const SPARK_COLOR = 0x9fe8ff;

function materialConductivity(ctx: Ctx, t: number): number {
  const tuned = ctx.params?.materials?.[t]?.conductivity;
  if (typeof tuned !== 'number' || !Number.isFinite(tuned)) return t === Cell.Water ? 1 / 3 : 1;
  return Math.max(0.05, Math.min(1, tuned));
}

function conductorFalloff(ctx: Ctx, t: number, base: number): number {
  return Math.max(1, Math.round(base / materialConductivity(ctx, t)));
}

export function updateElectricalGrid(ctx: Ctx): void {
  const w = ctx.world;
  const sim = w.simBounds;
  // Gather tracked live charges in the active window, then apply spreads + decay in two phases.
  // Save loads and legacy direct writes start with an empty tracker, so the first pass rebuilds
  // discovery from the active simulation window; sustained charge then stays sparse.
  // Spread/duration are live-tunable (params.global). Both clamp to >= 1 so a
  // stray 0 can't make charge spread forever or never decay (the self-sustain bug).
  // `chargeFalloff` is the BEST-conductor loss per hop. Per-material
  // conductivity dials scale that loss so metal carries a current farther than
  // water, and live inspector edits affect spread immediately.
  const base = Math.max(1, Math.round(ctx.params.global.chargeFalloff));
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
  const trySpread = (tx: number, ty: number, src: number, srcSolid: boolean): void => {
    if (!w.inBounds(tx, ty)) return;
    const ti = tx + ty * w.width;
    const tt = w.types[ti];
    if (isConductor(tt) && w.charge[ti] === 0) {
      const falloff = conductorFalloff(ctx, tt, base);
      let v = src - falloff;
      // Cap intake ONLY when the source is a SOLID conductor (metal): water sitting
      // on an energized metal plate lights a thin crackling layer, not a deep bright
      // pool (keeps bloom down). A SPARK/BLAST that lands IN the water charges it
      // through its own vaporized cells (empty/steam/fire — not solid), and a direct
      // water-hit spreads water→water; both must stay UNCAPPED or the bolt-in-water
      // ripple flatlines (the cap used to throttle every non-liquid source).
      if (srcSolid && tt === Cell.Water) v = Math.min(v, WATER_INTAKE_CAP);
      if (v > 0) {
        const prev = spreadCharge.get(ti);
        if (prev === undefined || v > prev) spreadCharge.set(ti, v);
      }
    }
  };
  // The front advances CRAWL_HOPS cells per substep — a fast racing crawl, applied
  // hop-by-hop so each freshly-lit cell carries the current onward the same step.
  // Small enough to stay a visible spreading front (with the ambient arcs, this is
  // the crackle), never an instant solid slab.
  let frontier = charged;
  for (let hop = 0; hop < CRAWL_HOPS; hop++) {
    spreadCharge.clear();
    for (const ci of frontier) {
      const y = Math.floor(ci / w.width);
      const x = ci - y * w.width;
      const c = w.charge[ci];
      const srcSolid = isSolid(w.types[ci]);
      trySpread(x + 1, y, c, srcSolid);
      trySpread(x - 1, y, c, srcSolid);
      trySpread(x, y + 1, c, srcSolid);
      trySpread(x - 1, y - 1, c, srcSolid);
    }
    if (spreadCharge.size === 0) break;
    const next: number[] = [];
    for (const [ti, v] of spreadCharge) {
      w.setChargeAt(ti, v);
      next.push(ti);
    }
    frontier = next;
  }
  // Decay ONCE PER FRAME (gated on frameCount), so `chargeDecay` reads as charge
  // lost per frame — the glow duration. The same once-per-frame pass runs erosion.
  if (ctx.state.frameCount !== (lastDecayFrameByWorld.get(w) ?? -1)) {
    lastDecayFrameByWorld.set(w, ctx.state.frameCount);
    const erosion = ctx.params?.global?.chargeErosion ?? 0;
    const eroding = erosion > 0 && ctx.particles !== undefined;
    for (const ci of charged) {
      const cc = w.charge[ci];
      // ELECTRO-EROSION: a live current arcs into the SOLID terrain it touches and
      // spalls it — a zap chips the surface, a sustained current drills through (the
      // freed cell lets the conductor seep in and carry the charge deeper). Metal
      // conducts and is immune; the bite scales with local charge so a faded spark
      // doesn't crumble the world, and decay below makes it self-limiting.
      if (eroding && cc > EROSION_MIN_CHARGE) {
        const y = Math.floor(ci / w.width);
        const x = ci - y * w.width;
        const bite = erosion * Math.min(1, cc / 110) * 0.045;
        for (let k = 0; k < 4; k++) {
          const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (!w.inBounds(nx, ny)) continue;
          const ni = nx + ny * w.width;
          const tt = w.types[ni];
          if (tt === Cell.Metal || !blocksEntity(tt)) continue; // metal conducts; skip air/growth
          if (Math.random() < bite) {
            // a debris fleck of the spalled rock + a hot electric spark, then it's gone
            ctx.particles.spawn(nx + 0.5, ny + 0.5, (Math.random() - 0.5) * 1.4, -0.5 - Math.random(), tt, w.colors[ni], 55, { glow: 0.3 });
            ctx.particles.spawn(nx + 0.5, ny + 0.5, (Math.random() - 0.5) * 0.9, -0.3 - Math.random() * 0.5, null, SPARK_COLOR, 10, { glow: 1.6 });
            w.clearCellAt(ni);
          }
        }
      }
      const next = cc - decay;
      w.setChargeAt(ci, next > 0 ? next : 0);
    }
  }
}

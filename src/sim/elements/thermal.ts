import { MAX_PARTICLES } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { Cell, isGas } from '@/sim/CellType';
import {
  acidColor,
  ashColor,
  emberColor,
  fireColor,
  packRGB,
  smokeColor,
  steamColor,
  waterColor,
} from '@/sim/colors';
import { igniteGunpowder } from '@/sim/elements/powders';
import { igniteTrunk } from '@/sim/elements/flora';
// FIRE_REACTION_OFFSETS was the local name for the shared asymmetric ignition list.
import { CARDINAL_OFFSETS, IGNITION_OFFSETS as FIRE_REACTION_OFFSETS } from '@/sim/neighborOffsets';
import { fxRandom, simRandom } from '@/core/simRandom';
import { AMBIENT_FOLIAGE_LIFE, foliageBurnLife, foliageBurnState, foliageFuel, FOLIAGE_MAX_FUEL } from '@/config/foliage';

/** EXPORTED for cross-handler use: handleFire melts adjacent ice via this. */
export function handleIce(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  // Indexed loop over the hoisted offset constant: avoids the iterator
  // protocol + per-element tuple destructuring on this hot per-cell path.
  for (let k = 0; k < CARDINAL_OFFSETS.length; k++) {
    const o = CARDINAL_OFFSETS[k];
    const tx = x + o[0];
    const ty = y + o[1];
    if (w.inBounds(tx, ty)) {
      const ti = w.idx(tx, ty);
      if (w.types[ti] === Cell.Fire) {
        if (simRandom() < 1.0 - ctx.params.materials[Cell.Ice].insulationRating!) {
          const ci = w.idx(x, y);
          if (simRandom() < 0.40) {
            w.replaceCellAt(ci, Cell.Steam, steamColor());
            w.life[ci] = 260;
          } else {
            w.replaceCellAt(ci, Cell.Water, waterColor());
          }
          return;
        }
      } else if (w.types[ti] === Cell.Lava) {
        if (simRandom() < 0.4) {
          const ci = w.idx(x, y);
          w.replaceCellAt(ci, Cell.Water, waterColor());
          return;
        }
      }
    }
  }
}

export function handleEmber(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const P = ctx.params.materials[Cell.Ember];
  // React with neighbors (indexed loop over the offset constant — hot path).
  for (let k = 0; k < CARDINAL_OFFSETS.length; k++) {
    const o = CARDINAL_OFFSETS[k];
    const nx = x + o[0];
    const ny = y + o[1];
    if (!w.inBounds(nx, ny)) continue;
    const ni = w.idx(nx, ny);
    const n = w.types[ni];
    if (n === Cell.Water || n === Cell.Nitrogen) {
      // quenched with a hiss of steam
      const ci = w.idx(x, y);
      w.replaceCellAt(ci, Cell.Steam, steamColor());
      w.life[ci] = 28;
      w.moved[ci] = w.movedTick;
      if (n === Cell.Water && simRandom() < 0.4) {
        w.replaceCellAt(ni, Cell.Steam, steamColor());
        w.life[ni] = 24;
      }
      return;
    }
    if ((n === Cell.Wood || n === Cell.Vines || n === Cell.Leaf || n === Cell.Seed) && simRandom() < P.igniteChance!) {
      // slow smoulder: a small, short-lived flame that grows or fizzles with the fuel
      const damp = n === Cell.Vines && w.life[ni] <= AMBIENT_FOLIAGE_LIFE;
      w.replaceCellAt(ni, Cell.Fire, fireColor());
      w.life[ni] = damp ? FOLIAGE_MAX_FUEL : 40 + Math.floor(simRandom() * 50);
    }
    // living wood takes an ember as a smoulder in place (FLORA)
    if (n === Cell.Trunk && simRandom() < P.igniteChance!) igniteTrunk(ctx, ni);
    if (n === Cell.MarshGas) {
      // even a drifting ember lights bog vapor at a touch
      w.replaceCellAt(ni, Cell.Fire, fireColor());
      w.life[ni] = 22 + Math.floor(simRandom() * 14);
    }
    if (n === Cell.Oil && w.life[ni] === 0 && simRandom() < P.igniteChance! * 7) {
      // an ember on an oil slick starts it burning IN PLACE (handleOil throws the
      // flame each frame for burnDuration) — a sustained pool fire, not a flash.
      w.life[ni] = ctx.params.materials[Cell.Oil].burnDuration! + Math.floor(simRandom() * 30);
      w.activity.touchIndex(ni);
    } else if (n === Cell.Gunpowder && simRandom() < P.igniteChance! * 7) {
      igniteGunpowder(ctx, nx, ny);
    }
  }
  // Drift downward slowly, fluttering sideways like a falling spark
  if (simRandom() < P.fallChance!) {
    const drift = simRandom();
    const tx = drift < 0.18 ? x - 1 : drift < 0.36 ? x + 1 : x;
    const ty = y + 1;
    if (w.inBounds(tx, ty) && (w.types[w.idx(tx, ty)] === Cell.Empty || isGas(w.types[w.idx(tx, ty)]))) {
      w.swap(x, y, tx, ty); // swap() already stamps moved on both endpoints
      return;
    }
    if (w.inBounds(x, ty) && (w.types[w.idx(x, ty)] === Cell.Empty || isGas(w.types[w.idx(x, ty)]))) {
      w.swap(x, y, x, ty); // swap() already stamps moved on both endpoints
      return;
    }
  }
  // Resting embers shimmer and occasionally spit a spark
  if (fxRandom() < 0.18) w.colors[w.idx(x, y)] = emberColor();
  if (fxRandom() < 0.0025) {
    ctx.particles.spawn(
      x,
      y - 1,
      (fxRandom() - 0.5) * 0.6,
      -0.5 - fxRandom() * 0.5,
      null,
      packRGB(255, 150, 40),
      16,
      { grav: -0.01, glow: 2.0 },
    );
  }
}

export function handleFire(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const ci = w.idx(x, y);
  w.life[ci]--;
  if (w.life[ci] <= 0) {
    // A fraction of burned-out fire leaves drifting ash
    if (simRandom() < 0.1 && w.inBounds(x, y + 1) && w.types[w.idx(x, y + 1)] !== Cell.Empty) {
      w.replaceCellAt(ci, Cell.Ash, ashColor());
    } else {
      w.clearCellAt(ci);
    }
    return;
  }

  // Occasionally lift a glowing ember (visual only) — gorgeous with bloom
  if (fxRandom() < 0.012 && ctx.particles.list.length < MAX_PARTICLES - 100) {
    ctx.particles.spawn(
      x + fxRandom(),
      y,
      (fxRandom() - 0.5) * 0.3,
      -0.4 - fxRandom() * 0.4,
      null,
      packRGB(255, 120 + Math.floor(fxRandom() * 90), 10),
      26 + Math.floor(fxRandom() * 20),
      { grav: -0.012, glow: 2.6 },
    );
  }

  // Indexed loop over the offset constant (hottest fire-spread path).
  for (let k = 0; k < FIRE_REACTION_OFFSETS.length; k++) {
    const o = FIRE_REACTION_OFFSETS[k];
    const tx = x + o[0];
    const ty = y + o[1];
    if (w.inBounds(tx, ty)) {
      const ti = w.idx(tx, ty);
      const n = w.types[ti];
      if (n === Cell.Wood && simRandom() < ctx.params.materials[Cell.Wood].flammability!) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 45;
        if (simRandom() < ctx.params.materials[Cell.Wood].carbonSmokeGen!) spawnSmoke(ctx, x, y);
      }
      if (n === Cell.Vines && simRandom() < ctx.params.materials[Cell.Vines].flammability!) {
        const damp = w.life[ti] <= AMBIENT_FOLIAGE_LIFE;
        const fuel = foliageFuel(w.life[ci]);
        if (damp && fuel === 0) continue;
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = damp ? fuel : 30;
        if (simRandom() < 0.6) spawnSmoke(ctx, x, y);
      }
      if (n === Cell.Fungus && simRandom() < ctx.params.materials[Cell.Fungus].flammability!) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 35;
        if (simRandom() < 0.5) spawnSmoke(ctx, x, y);
      }
      if (
        n === Cell.Glowshroom &&
        simRandom() < ctx.params.materials[Cell.Glowshroom].flammability!
      ) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 40;
        if (simRandom() < 0.5) spawnSmoke(ctx, x, y);
      }
      if (n === Cell.Moss && simRandom() < ctx.params.materials[Cell.Moss].flammability!) {
        if (w.life[ti] <= AMBIENT_FOLIAGE_LIFE) {
          // Rich ambient crowns smoulder in place. Each transmission spends
          // fuel; it cannot turn a two-tick ember into a new long fire.
          const fuel = foliageFuel(w.life[ci]);
          if (fuel > 0 && w.life[ti] > -100) {
            w.life[ti] = foliageBurnLife(fuel, foliageBurnState(w.life[ti]).age);
            w.activity.touchIndex(ti);
          }
        } else {
          w.replaceCellAt(ti, Cell.Fire, fireColor());
          w.life[ti] = 26; // ordinary puzzle moss keeps its existing fuel
          if (simRandom() < 0.7) spawnSmoke(ctx, x, y);
        }
      }
      if (n === Cell.Leaf && simRandom() < ctx.params.materials[Cell.Leaf].flammability!) {
        // a canopy goes up fast and bright (FLORA)
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 18 + Math.floor(simRandom() * 10);
        if (simRandom() < 0.35) spawnSmoke(ctx, x, y);
      }
      if (n === Cell.Trunk && w.life[ti] <= 0 && simRandom() < ctx.params.materials[Cell.Trunk].flammability!) {
        // living wood smoulders in place (handleTrunk) instead of flashing away
        igniteTrunk(ctx, ti);
      }
      if (n === Cell.Seed && simRandom() < ctx.params.materials[Cell.Seed].flammability!) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 12;
      }
      if (n === Cell.Grass && simRandom() < ctx.params.materials[Cell.Grass].flammability!) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 16; // a single blade flares briefly; low flammability keeps the spread a slow sputter
        if (simRandom() < 0.3) spawnSmoke(ctx, x, y);
      }
      if (n === Cell.Coal && w.life[ti] === 0 && simRandom() < ctx.params.materials[Cell.Coal].igniteChance!) {
        // start the coal burning IN PLACE (handleCoal throws the flame) — not a flash
        w.life[ti] = ctx.params.materials[Cell.Coal].burnDuration! + Math.floor(simRandom() * 40);
      }
      if (n === Cell.Toxic && simRandom() < ctx.params.materials[Cell.Toxic].flammability!) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 50;
        // Smoke rises from the FIRE cell's position, matching every other fuel branch.
        if (simRandom() < 0.7) spawnSmoke(ctx, x, y);
      }
      if (n === Cell.Snow) {
        w.replaceCellAt(ti, Cell.Water, waterColor());
      }
      if (n === Cell.Healium) {
        w.replaceCellAt(ti, Cell.Steam, packRGB(255, 175, 205));
        w.life[ti] = 40;
      }
      if (n === Cell.Oil && w.life[ti] === 0 && simRandom() < ctx.params.materials[Cell.Oil].igniteChance!) {
        // Start the slick burning IN PLACE (handleOil throws the flame each frame
        // for burnDuration). Don't flash it to a fire cell that just rises away —
        // a sustained pool fire is what lets oil in a bowl hold a checkpoint lit.
        w.life[ti] = ctx.params.materials[Cell.Oil].burnDuration! + Math.floor(simRandom() * 30);
        w.activity.touchIndex(ti);
      }
      if (n === Cell.Gunpowder) {
        igniteGunpowder(ctx, tx, ty);
        return;
      }
      if (n === Cell.Ice) {
        handleIce(ctx, tx, ty);
      }
      if (n === Cell.MarshGas) {
        // bog vapor catches INSTANTLY - the racing front, not a smoulder
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 22 + Math.floor(simRandom() * 14);
      }
      if (n === Cell.Blood && simRandom() < 0.06) {
        w.replaceCellAt(ti, Cell.Smoke, smokeColor());
        w.life[ti] = 20;
      }
      if (n === Cell.Slime && simRandom() < 0.04) {
        w.replaceCellAt(ti, Cell.Acid, acidColor());
      }
      if (n === Cell.Water || n === Cell.Brine) {
        // (Brine boils away the same way: the salt goes with the steam.)
        w.replaceCellAt(ci, Cell.Steam, steamColor());
        w.life[ci] = 260;
        // Water is a conductor: clear through the World helper so the cell is
        // removed from activeCharges/colorOverrides, not left as an invisible
        // Empty cell the sparse charge tracker keeps radiating from.
        w.clearCellAt(ti);
        return;
      }
    }
  }
  if (simRandom() < ctx.params.materials[Cell.Fire].upwardSpread!) {
    const dir = simRandom() < 0.5 ? 1 : -1;
    if (w.inBounds(x, y - 1) && w.types[w.idx(x, y - 1)] === Cell.Empty) w.swap(x, y, x, y - 1);
    else if (w.inBounds(x + dir, y - 1) && w.types[w.idx(x + dir, y - 1)] === Cell.Empty)
      w.swap(x, y, x + dir, y - 1);
  }
}

export function spawnSmoke(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const sx = x + Math.floor(simRandom() * 3 - 1),
    sy = y - 1;
  if (w.inBounds(sx, sy) && w.types[w.idx(sx, sy)] === Cell.Empty) {
    const si = w.idx(sx, sy);
    w.replaceCellAt(si, Cell.Smoke, smokeColor());
    w.life[si] = Math.floor(simRandom() * 50) + 40;
  }
}

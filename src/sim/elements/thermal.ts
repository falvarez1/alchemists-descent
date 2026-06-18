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
// FIRE_REACTION_OFFSETS was the local name for the shared asymmetric ignition list.
import { CARDINAL_OFFSETS, IGNITION_OFFSETS as FIRE_REACTION_OFFSETS } from '@/sim/neighborOffsets';

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
        if (Math.random() < 1.0 - ctx.params.materials[Cell.Ice].insulationRating!) {
          const ci = w.idx(x, y);
          if (Math.random() < 0.40) {
            w.replaceCellAt(ci, Cell.Steam, steamColor());
            w.life[ci] = 260;
          } else {
            w.replaceCellAt(ci, Cell.Water, waterColor());
          }
          return;
        }
      } else if (w.types[ti] === Cell.Lava) {
        if (Math.random() < 0.4) {
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
      if (n === Cell.Water && Math.random() < 0.4) {
        w.replaceCellAt(ni, Cell.Steam, steamColor());
        w.life[ni] = 24;
      }
      return;
    }
    if ((n === Cell.Wood || n === Cell.Vines) && Math.random() < P.igniteChance!) {
      // slow smoulder: a small, short-lived flame that grows or fizzles with the fuel
      w.replaceCellAt(ni, Cell.Fire, fireColor());
      w.life[ni] = 40 + Math.floor(Math.random() * 50);
    }
    if ((n === Cell.Oil || n === Cell.Gunpowder) && Math.random() < P.igniteChance! * 7) {
      w.replaceCellAt(ni, Cell.Fire, fireColor());
      w.life[ni] = 60 + Math.floor(Math.random() * 60);
    }
  }
  // Drift downward slowly, fluttering sideways like a falling spark
  if (Math.random() < P.fallChance!) {
    const drift = Math.random();
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
  if (Math.random() < 0.18) w.colors[w.idx(x, y)] = emberColor();
  if (Math.random() < 0.0025) {
    ctx.particles.spawn(
      x,
      y - 1,
      (Math.random() - 0.5) * 0.6,
      -0.5 - Math.random() * 0.5,
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
    if (Math.random() < 0.1 && w.inBounds(x, y + 1) && w.types[w.idx(x, y + 1)] !== Cell.Empty) {
      w.replaceCellAt(ci, Cell.Ash, ashColor());
    } else {
      w.clearCellAt(ci);
    }
    return;
  }

  // Occasionally lift a glowing ember (visual only) — gorgeous with bloom
  if (Math.random() < 0.012 && ctx.particles.list.length < MAX_PARTICLES - 100) {
    ctx.particles.spawn(
      x + Math.random(),
      y,
      (Math.random() - 0.5) * 0.3,
      -0.4 - Math.random() * 0.4,
      null,
      packRGB(255, 120 + Math.floor(Math.random() * 90), 10),
      26 + Math.floor(Math.random() * 20),
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
      if (n === Cell.Wood && Math.random() < ctx.params.materials[Cell.Wood].flammability!) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 45;
        if (Math.random() < ctx.params.materials[Cell.Wood].carbonSmokeGen!) spawnSmoke(ctx, x, y);
      }
      if (n === Cell.Vines && Math.random() < ctx.params.materials[Cell.Vines].flammability!) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 30;
        if (Math.random() < 0.6) spawnSmoke(ctx, x, y);
      }
      if (n === Cell.Fungus && Math.random() < ctx.params.materials[Cell.Fungus].flammability!) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 35;
        if (Math.random() < 0.5) spawnSmoke(ctx, x, y);
      }
      if (
        n === Cell.Glowshroom &&
        Math.random() < ctx.params.materials[Cell.Glowshroom].flammability!
      ) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 40;
        if (Math.random() < 0.5) spawnSmoke(ctx, x, y);
      }
      if (n === Cell.Moss && Math.random() < ctx.params.materials[Cell.Moss].flammability!) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 26; // damp greenery burns short and smoky
        if (Math.random() < 0.7) spawnSmoke(ctx, x, y);
      }
      if (n === Cell.Coal && Math.random() < ctx.params.materials[Cell.Coal].igniteChance!) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = ctx.params.materials[Cell.Coal].burnDuration!;
      }
      if (n === Cell.Toxic && Math.random() < ctx.params.materials[Cell.Toxic].flammability!) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 50;
        // Smoke rises from the FIRE cell's position, matching every other fuel branch.
        if (Math.random() < 0.7) spawnSmoke(ctx, x, y);
      }
      if (n === Cell.Snow) {
        w.replaceCellAt(ti, Cell.Water, waterColor());
      }
      if (n === Cell.Healium) {
        w.replaceCellAt(ti, Cell.Steam, packRGB(255, 175, 205));
        w.life[ti] = 40;
      }
      if (n === Cell.Oil) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = ctx.params.materials[Cell.Oil].burnDuration!;
      }
      if (n === Cell.Gunpowder) {
        ctx.explosions.trigger(tx, ty, ctx.params.materials[Cell.Gunpowder].blastRadius!);
        return;
      }
      if (n === Cell.Ice) {
        handleIce(ctx, tx, ty);
      }
      if (n === Cell.Blood && Math.random() < 0.06) {
        w.replaceCellAt(ti, Cell.Smoke, smokeColor());
        w.life[ti] = 20;
      }
      if (n === Cell.Slime && Math.random() < 0.04) {
        w.replaceCellAt(ti, Cell.Acid, acidColor());
      }
      if (n === Cell.Water) {
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
  if (Math.random() < ctx.params.materials[Cell.Fire].upwardSpread!) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (w.inBounds(x, y - 1) && w.types[w.idx(x, y - 1)] === Cell.Empty) w.swap(x, y, x, y - 1);
    else if (w.inBounds(x + dir, y - 1) && w.types[w.idx(x + dir, y - 1)] === Cell.Empty)
      w.swap(x, y, x + dir, y - 1);
  }
}

export function spawnSmoke(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const sx = x + Math.floor(Math.random() * 3 - 1),
    sy = y - 1;
  if (w.inBounds(sx, sy) && w.types[w.idx(sx, sy)] === Cell.Empty) {
    const si = w.idx(sx, sy);
    w.replaceCellAt(si, Cell.Smoke, smokeColor());
    w.life[si] = Math.floor(Math.random() * 50) + 40;
  }
}

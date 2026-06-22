import type { Ctx } from '@/core/types';
import { Cell, isGas, isSoftGrowth, isSolid } from '@/sim/CellType';
import {
  EMPTY_COLOR,
  fireColor,
  fungusColor,
  goldColor,
  iceColor,
  mossColor,
  obsidianColor,
  packRGB,
  smokeColor,
  steamColor,
  stoneColor,
  unpackB,
  unpackG,
  unpackR,
  vineColor,
  waterColor,
} from '@/sim/colors';
import { CARDINAL_OFFSETS, IGNITION_OFFSETS } from '@/sim/neighborOffsets';
import { canDryBloodOnSurface, stainCell } from '@/sim/stains';

function waterCanPass(t: number): boolean {
  return t === Cell.Empty || t === Cell.Oil || t === Cell.Steam || t === Cell.Smoke;
}

function viscousCanPass(t: number): boolean {
  return t === Cell.Empty || t === Cell.Steam || t === Cell.Smoke;
}

/** Per-step chance that a thin film of settled blood on sturdy ground dries to
 *  a permanent floor stain. Deep pools (blood overhead) persist; this only
 *  retires the surface layer, bounding how much liquid a gory fight can leave. */
const BLOOD_DRY = 0.006;

/** Lava meeting water always flashes the water to steam. Whether the lava itself
 *  chills to stone depends on the direction:
 *  - water BELOW/beside (lava boring down into it): only this sparse fleck
 *    chance, so the lava out-bores the crust and eats through instead of
 *    re-sealing into a stable cake.
 *  - water RESTING ON TOP (settled): a thick obsidian rind chills DOWN into the
 *    lava (top cell always, then ragged to LAVA_CRUST_DEPTH) so the seal reads
 *    as a real crust, not a faint single line.
 *  Deliberate deviation from the original always-crust port; see docs/PORTING.md. */
const LAVA_CRUST_CHANCE = 0.06;
const LAVA_CRUST_DEPTH = 3; // max obsidian-rind thickness where water rests on lava
const LAVA_TOP_CRUST_DEEP = 0.7; // chance each successive cell below the rind also chills (ragged underside)

function acidCanPass(t: number): boolean {
  return t === Cell.Empty || t === Cell.Steam || t === Cell.Water || t === Cell.Oil || t === Cell.Smoke;
}

function lavaCanPass(t: number): boolean {
  return t === Cell.Empty || t === Cell.Steam || t === Cell.Oil || t === Cell.Acid || t === Cell.Smoke;
}

function loadBearingGrowthSupport(t: number): boolean {
  return isSolid(t) && !isSoftGrowth(t);
}

function hasLoadBearingNeighbor(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  for (let k = 0; k < CARDINAL_OFFSETS.length; k++) {
    const o = CARDINAL_OFFSETS[k];
    const nx = x + o[0];
    const ny = y + o[1];
    if (w.inBounds(nx, ny) && loadBearingGrowthSupport(w.types[w.idx(nx, ny)])) return true;
  }
  return false;
}

function waterFeedsLivingGrowth(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  const ci = w.idx(x, y);
  for (let k = 0; k < CARDINAL_OFFSETS.length; k++) {
    const o = CARDINAL_OFFSETS[k];
    const nx = x + o[0];
    const ny = y + o[1];
    if (!w.inBounds(nx, ny)) continue;
    const n = w.types[w.idx(nx, ny)];
    if (n === Cell.Vines && Math.random() < 0.08) {
      w.replaceCellAt(ci, Cell.Vines, vineColor());
      w.life[ci] = 65 + Math.floor(Math.random() * 50);
      w.moved[ci] = w.movedTick;
      return true;
    }
    if (n === Cell.Moss && hasLoadBearingNeighbor(ctx, x, y) && Math.random() < 0.055) {
      w.replaceCellAt(ci, Cell.Moss, mossColor());
      w.life[ci] = 12 + Math.floor(Math.random() * 14);
      w.moved[ci] = w.movedTick;
      return true;
    }
    if (n === Cell.Fungus && hasLoadBearingNeighbor(ctx, x, y) && Math.random() < 0.04) {
      w.replaceCellAt(ci, Cell.Fungus, fungusColor());
      w.life[ci] = 16 + Math.floor(Math.random() * 20);
      w.moved[ci] = w.movedTick;
      return true;
    }
  }
  return false;
}

export function handleWater(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  // Clean water dilutes toxic sludge it touches
  if (Math.random() < 0.03) {
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (w.inBounds(nx, ny) && w.types[w.idx(nx, ny)] === Cell.Toxic) {
        // replaceCellAt clears any stale life/charge from the old Toxic cell so
        // the fresh Water doesn't inherit transient metadata.
        w.replaceCellAt(w.idx(nx, ny), Cell.Water, waterColor());
        break;
      }
    }
  }
  if (waterFeedsLivingGrowth(ctx, x, y)) return;
  if (w.inBounds(x, y + 1) && waterCanPass(w.types[w.idx(x, y + 1)])) {
    w.swap(x, y, x, y + 1);
    return;
  }
  const dir = Math.random() < 0.5 ? 1 : -1;
  if (w.inBounds(x + dir, y + 1) && waterCanPass(w.types[w.idx(x + dir, y + 1)])) {
    w.swap(x, y, x + dir, y + 1);
    return;
  }
  if (w.inBounds(x - dir, y + 1) && waterCanPass(w.types[w.idx(x - dir, y + 1)])) {
    w.swap(x, y, x - dir, y + 1);
    return;
  }
  if (Math.random() < ctx.params.materials[Cell.Water].flowRate!) {
    if (w.inBounds(x + dir, y) && waterCanPass(w.types[w.idx(x + dir, y)])) {
      w.swap(x, y, x + dir, y);
      return;
    }
    if (w.inBounds(x - dir, y) && waterCanPass(w.types[w.idx(x - dir, y)])) {
      w.swap(x, y, x - dir, y);
      return;
    }
  }
}

// Blood and slime: generic viscous liquids
export function handleViscousLiquid(ctx: Ctx, x: number, y: number, type: Cell): void {
  const w = ctx.world;
  // Blood soaks whatever sturdy surface it flows across or pools against — the
  // floor beneath it and the walls beside it pick up a red stain over time
  // (stainCell no-ops on non-sturdy cells, so empty space/sand is unaffected).
  if (type === Cell.Blood && Math.random() < 0.35) {
    stainCell(w, x, y + 1, 118, 14, 20, 0.16);
    stainCell(w, x + 1, y, 118, 14, 20, 0.1);
    stainCell(w, x - 1, y, 118, 14, 20, 0.1);
  }
  if (w.inBounds(x, y + 1) && viscousCanPass(w.types[w.idx(x, y + 1)])) {
    w.swap(x, y, x, y + 1);
    return;
  }
  const dir = Math.random() < 0.5 ? 1 : -1;
  if (w.inBounds(x + dir, y + 1) && viscousCanPass(w.types[w.idx(x + dir, y + 1)])) {
    w.swap(x, y, x + dir, y + 1);
    return;
  }
  if (w.inBounds(x - dir, y + 1) && viscousCanPass(w.types[w.idx(x - dir, y + 1)])) {
    w.swap(x, y, x - dir, y + 1);
    return;
  }
  if (Math.random() < ctx.params.materials[type].flowRate!) {
    if (w.inBounds(x + dir, y) && viscousCanPass(w.types[w.idx(x + dir, y)])) {
      w.swap(x, y, x + dir, y);
      return;
    }
    if (w.inBounds(x - dir, y) && viscousCanPass(w.types[w.idx(x - dir, y)])) {
      w.swap(x, y, x - dir, y);
      return;
    }
  }
  // Settled blood slowly coagulates (darkens)...
  if (type === Cell.Blood) {
    const i = w.idx(x, y);
    if (Math.random() < ctx.params.materials[Cell.Blood].coagulation!) {
      const c = w.colors[i];
      w.colors[i] = packRGB(
        Math.max(60, unpackR(c) - 30),
        Math.max(5, unpackG(c) - 4),
        Math.max(8, unpackB(c) - 4),
      );
    }
    // ...and a thin surface film resting on sturdy ground eventually dries to a
    // permanent stain. Deep pools (blood directly overhead) keep their wet body;
    // only the exposed top layer retires, so spray can't drown the level/sim.
    const aboveBlood = w.inBounds(x, y - 1) && w.types[w.idx(x, y - 1)] === Cell.Blood;
    if (!aboveBlood && Math.random() < BLOOD_DRY && canDryBloodOnSurface(w, x, y + 1)) {
      stainCell(w, x, y + 1, 96, 12, 16, 0.55);
      w.replaceCellAt(i, Cell.Empty, EMPTY_COLOR);
    }
  }
}

function bridgeWaterSurface(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  if (!w.inBounds(x, y) || w.types[w.idx(x, y)] !== Cell.Water) return false;
  if (!w.inBounds(x, y - 1)) return true;
  const above = w.types[w.idx(x, y - 1)];
  return above === Cell.Empty || above === Cell.Nitrogen || isGas(above);
}

function freezeWaterCell(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  if (!w.inBounds(x, y)) return false;
  const i = w.idx(x, y);
  if (w.types[i] !== Cell.Water) return false;
  w.replaceCellAt(i, Cell.Ice, iceColor());
  w.moved[i] = w.movedTick;
  return true;
}

function freezeCryoBridge(ctx: Ctx, x: number, y: number): void {
  freezeWaterCell(ctx, x, y);
  const w = ctx.world;
  for (let dir = -1; dir <= 1; dir += 2) {
    for (let step = 1; step <= 4; step++) {
      const nx = x + dir * step;
      if (!bridgeWaterSurface(ctx, nx, y)) break;
      freezeWaterCell(ctx, nx, y);
      const below = y + 1;
      if (w.inBounds(nx, below) && w.types[w.idx(nx, below)] === Cell.Water && Math.random() < 0.22) {
        freezeWaterCell(ctx, nx, below);
      }
    }
  }
}

export function handleNitrogen(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const ci = w.idx(x, y);
  // Indexed loop over the offset constant — hot per-cell path.
  for (let k = 0; k < CARDINAL_OFFSETS.length; k++) {
    const o = CARDINAL_OFFSETS[k];
    const tx = x + o[0];
    const ty = y + o[1];
    if (w.inBounds(tx, ty)) {
      const ti = w.idx(tx, ty);
      const n = w.types[ti];
      if (n === Cell.Water) {
        freezeCryoBridge(ctx, tx, ty);
        w.replaceCellAt(ci, Cell.Smoke, smokeColor());
        w.life[ci] = 20;
        return;
      }
      if (n === Cell.Lava) {
        w.replaceCellAt(ti, Cell.Stone, stoneColor());
        w.replaceCellAt(ci, Cell.Steam, steamColor());
        w.life[ci] = 30;
        return;
      }
    }
  }
  if (
    w.inBounds(x, y + 1) &&
    (w.types[w.idx(x, y + 1)] === Cell.Empty ||
      w.types[w.idx(x, y + 1)] === Cell.Steam ||
      w.types[w.idx(x, y + 1)] === Cell.Smoke)
  ) {
    w.swap(x, y, x, y + 1);
    return;
  }
  const dir = Math.random() < 0.5 ? 1 : -1;
  if (Math.random() < ctx.params.materials[Cell.Nitrogen].flowRate!) {
    if (w.inBounds(x + dir, y) && w.types[w.idx(x + dir, y)] === Cell.Empty) {
      w.swap(x, y, x + dir, y);
      return;
    }
    if (w.inBounds(x - dir, y) && w.types[w.idx(x - dir, y)] === Cell.Empty) {
      w.swap(x, y, x - dir, y);
      return;
    }
  }
  if (Math.random() < ctx.params.materials[Cell.Nitrogen].evaporationSpeed!) {
    w.replaceCellAt(ci, Cell.Smoke, smokeColor());
    w.life[ci] = 25;
  }
}

export function handleOil(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const ci = w.idx(x, y);
  const P = ctx.params.materials[Cell.Oil];

  // BURNING SLICK (life > 0): a fluid fire. The oil keeps FLOWING while it burns
  // for its full burnDuration, throwing a short flame upward every frame (the
  // visible fire + the heat a brazier/waystone reads) and creeping the burn into
  // neighbouring oil — a spreading, sloshing pool fire, not a frozen block. A
  // liquid burns CLEAN: when spent it wisps away as smoke, never a solid ash.
  if (w.life[ci] > 0) {
    w.life[ci]--;
    if (w.inBounds(x, y - 1)) {
      const ai = w.idx(x, y - 1);
      const at = w.types[ai];
      if (at === Cell.Empty || at === Cell.Smoke) {
        w.replaceCellAt(ai, Cell.Fire, fireColor());
        w.life[ai] = 16 + Math.floor(Math.random() * 16);
      }
    }
    for (let k = 0; k < IGNITION_OFFSETS.length; k++) {
      const o = IGNITION_OFFSETS[k];
      const tx = x + o[0],
        ty = y + o[1];
      if (!w.inBounds(tx, ty)) continue;
      const ti = w.idx(tx, ty);
      if (w.types[ti] === Cell.Oil && w.life[ti] === 0 && Math.random() < P.igniteChance!) {
        w.life[ti] = P.burnDuration! + Math.floor(Math.random() * 30);
      }
    }
    // Greasy black smoke curls off the slick — a light haze while it burns hot,
    // THICKENING as the fuel runs low (the dirty tail of an oil fire).
    const lowFuel = w.life[ci] < 70;
    if (Math.random() < (lowFuel ? 0.18 : 0.05)) {
      ctx.particles.spawn(
        x + (Math.random() - 0.5) * 2,
        y - 2,
        (Math.random() - 0.5) * 0.25,
        -0.3 - Math.random() * 0.3,
        null,
        smokeColor(),
        50 + Math.floor(Math.random() * 50),
        { grav: -0.02 },
      );
    }
    if (w.life[ci] <= 0) {
      // gutters out in a curl of greasy smoke: the cell becomes a longer-lived
      // smoke cell, plus a little puff so a dying pool rolls a real cloud.
      w.replaceCellAt(ci, Cell.Smoke, smokeColor());
      w.life[ci] = 40 + Math.floor(Math.random() * 30);
      for (let s = 0; s < 3; s++) {
        ctx.particles.spawn(
          x + (Math.random() - 0.5) * 2.5,
          y - 1 - Math.floor(Math.random() * 2),
          (Math.random() - 0.5) * 0.35,
          -0.35 - Math.random() * 0.4,
          null,
          smokeColor(),
          70 + Math.floor(Math.random() * 50),
          { grav: -0.025 },
        );
      }
      return;
    }
    // ...and fall through to the liquid flow below — a burning slick still flows.
  } else {
    // UNLIT oil: catch from an adjacent flame/charge (gradual), STARTING a burn in
    // place; otherwise flow like a liquid.
    for (let k = 0; k < IGNITION_OFFSETS.length; k++) {
      const o = IGNITION_OFFSETS[k];
      const tx = x + o[0];
      const ty = y + o[1];
      if (
        w.inBounds(tx, ty) &&
        (w.types[w.idx(tx, ty)] === Cell.Fire || w.charge[w.idx(tx, ty)] > 0)
      ) {
        if (Math.random() < P.igniteChance!) {
          w.life[ci] = P.burnDuration! + Math.floor(Math.random() * 30);
          return;
        }
        break; // adjacent to flame but didn't catch this frame — let it flow, retry next tick
      }
    }
  }

  // LIQUID FLOW (lit or unlit — oil is fluid either way)
  if (
    w.inBounds(x, y + 1) &&
    (w.types[w.idx(x, y + 1)] === Cell.Empty ||
      w.types[w.idx(x, y + 1)] === Cell.Steam ||
      w.types[w.idx(x, y + 1)] === Cell.Smoke)
  ) {
    w.swap(x, y, x, y + 1);
    return;
  }
  const dir = Math.random() < 0.5 ? 1 : -1;
  if (Math.random() < P.flowRate!) {
    if (
      w.inBounds(x + dir, y) &&
      (w.types[w.idx(x + dir, y)] === Cell.Empty || w.types[w.idx(x + dir, y)] === Cell.Steam)
    ) {
      w.swap(x, y, x + dir, y);
      return;
    }
    if (
      w.inBounds(x - dir, y) &&
      (w.types[w.idx(x - dir, y)] === Cell.Empty || w.types[w.idx(x - dir, y)] === Cell.Steam)
    ) {
      w.swap(x, y, x - dir, y);
      return;
    }
  }
}

function hasWaterNeighbor(w: Ctx['world'], x: number, y: number): boolean {
  return (
    (w.inBounds(x + 1, y) && w.types[w.idx(x + 1, y)] === Cell.Water) ||
    (w.inBounds(x - 1, y) && w.types[w.idx(x - 1, y)] === Cell.Water) ||
    (w.inBounds(x, y + 1) && w.types[w.idx(x, y + 1)] === Cell.Water) ||
    (w.inBounds(x, y - 1) && w.types[w.idx(x, y - 1)] === Cell.Water)
  );
}

/** Index of a touching Aurum Catalyst cell, or -1 (4-neighborhood). */
function catalystNeighbor(w: Ctx['world'], x: number, y: number): number {
  if (w.inBounds(x + 1, y) && w.types[w.idx(x + 1, y)] === Cell.Catalyst) return w.idx(x + 1, y);
  if (w.inBounds(x - 1, y) && w.types[w.idx(x - 1, y)] === Cell.Catalyst) return w.idx(x - 1, y);
  if (w.inBounds(x, y + 1) && w.types[w.idx(x, y + 1)] === Cell.Catalyst) return w.idx(x, y + 1);
  if (w.inBounds(x, y - 1) && w.types[w.idx(x, y - 1)] === Cell.Catalyst) return w.idx(x, y - 1);
  return -1;
}

export function handleAcid(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  // Indexed loop over the offset constant — hot per-cell path.
  for (let k = 0; k < CARDINAL_OFFSETS.length; k++) {
    const o = CARDINAL_OFFSETS[k];
    const tx = x + o[0];
    const ty = y + o[1];
    if (w.inBounds(tx, ty)) {
      const ti = w.idx(tx, ty);
      const n = w.types[ti];
      if (
        n !== Cell.Empty &&
        n !== Cell.Acid &&
        n !== Cell.Steam &&
        n !== Cell.Metal &&
        n !== Cell.Smoke &&
        n !== Cell.Catalyst // acid cannot eat the philosopher's dust
      ) {
        if (Math.random() < ctx.params.materials[Cell.Acid].corrosiveSpeed!) {
          // Alchemy needs a solvent: transmutation only fires next to water, and
          // rarely (economy guard — portable acid in flasks made 10% an
          // infinite-money hose; see DESIGN.md "acid->gold nerf"). The Gilded
          // Vault's Aurum Catalyst supercharges the reaction in water's place —
          // and is CONSUMED grain for grain, so the amplification is exactly as
          // finite as the dust you found (never a global rule change).
          const cat =
            n === Cell.Wall || n === Cell.Wood || n === Cell.Stone
              ? catalystNeighbor(w, tx, ty)
              : -1;
          if (
            (n === Cell.Wall || n === Cell.Wood || n === Cell.Stone) &&
            (cat >= 0
              ? Math.random() < 0.45
              : Math.random() < 0.03 && hasWaterNeighbor(w, tx, ty))
          ) {
            w.replaceCellAt(ti, Cell.Gold, goldColor());
            if (cat >= 0) {
              // the spent grain puffs away as a golden wisp — visible chemistry
              w.replaceCellAt(cat, Cell.Smoke, smokeColor());
              w.life[cat] = 18;
            }
          } else {
            w.replaceCellAt(ti, Cell.Steam, steamColor());
            w.life[ti] = 25;
          }
          // clearCellAt zeroes life AND charge in lockstep so the now-empty hole
          // never carries stale transient metadata (vs. a raw types/colors write).
          w.clearCellAt(w.idx(x, y));
          return;
        }
      }
    }
  }
  if (w.inBounds(x, y + 1) && acidCanPass(w.types[w.idx(x, y + 1)])) {
    w.swap(x, y, x, y + 1);
    return;
  }
  const dir = Math.random() < 0.5 ? 1 : -1;
  if (Math.random() < ctx.params.materials[Cell.Acid].flowRate!) {
    if (w.inBounds(x + dir, y) && acidCanPass(w.types[w.idx(x + dir, y)])) {
      w.swap(x, y, x + dir, y);
      return;
    }
    if (w.inBounds(x - dir, y) && acidCanPass(w.types[w.idx(x - dir, y)])) {
      w.swap(x, y, x - dir, y);
      return;
    }
  }
}

export function handleLava(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  // Indexed loop over the offset constant — hot per-cell path.
  for (let k = 0; k < CARDINAL_OFFSETS.length; k++) {
    const o = CARDINAL_OFFSETS[k];
    const tx = x + o[0];
    const ty = y + o[1];
    if (w.inBounds(tx, ty)) {
      const ti = w.idx(tx, ty);
      const n = w.types[ti];
      if (n === Cell.Water) {
        // Water always flashes to steam.
        w.replaceCellAt(ti, Cell.Steam, steamColor());
        w.life[ti] = 50;
        const ci = w.idx(x, y);
        const belowT = w.inBounds(x, y + 1) ? w.types[w.idx(x, y + 1)] : Cell.Wall;
        const seated = !(lavaCanPass(belowT) || belowT === Cell.Water); // can't sink -> truly settled
        if (o[1] < 0 && seated) {
          // o[1] is the neighbor's dy: <0 means the water is directly ABOVE the lava.
          // Water resting ON TOP of SEATED lava: chill a THICK obsidian rind DOWN
          // into it so the seal is a real crust, not a faint line. (If the lava
          // can still sink it's boring, not settled — fall through to the fleck.)
          // replaceCellAt clears the lava's charge/life (lava is a conductor) so
          // the chilled Stone doesn't keep re-energizing conductor neighbors.
          w.replaceCellAt(ci, Cell.Stone, obsidianColor());
          for (let d = 1; d <= LAVA_CRUST_DEPTH; d++) {
            const yy = y + d;
            if (!w.inBounds(x, yy) || w.types[w.idx(x, yy)] !== Cell.Lava || Math.random() >= LAVA_TOP_CRUST_DEEP) break;
            w.replaceCellAt(w.idx(x, yy), Cell.Stone, obsidianColor());
          }
        } else if (Math.random() < LAVA_CRUST_CHANCE) {
          // Boring down / spreading: just the occasional fleck, so lava out-bores it.
          w.replaceCellAt(ci, Cell.Stone, obsidianColor());
        }
        return;
      }
      if (n === Cell.Ice && Math.random() < ctx.params.materials[Cell.Lava].meltRange!) {
        w.replaceCellAt(ti, Cell.Water, waterColor());
      }
      if (n === Cell.Snow) {
        w.replaceCellAt(ti, Cell.Steam, steamColor());
        w.life[ti] = 30;
      }
      if (
        n === Cell.Wood ||
        n === Cell.Oil ||
        n === Cell.Vines ||
        n === Cell.Fungus ||
        n === Cell.Glowshroom
      ) {
        w.replaceCellAt(ti, Cell.Fire, fireColor());
        w.life[ti] = 35;
      }
      if (n === Cell.Coal && w.life[ti] === 0 && Math.random() < 0.15) {
        // lava lights coal into a burning ember bed (burns in place — handleCoal)
        w.life[ti] = ctx.params.materials[Cell.Coal].burnDuration! + Math.floor(Math.random() * 40);
      }
      if (n === Cell.Toxic && Math.random() < 0.3) {
        w.replaceCellAt(ti, Cell.Smoke, smokeColor());
        w.life[ti] = 35;
      }
      if (n === Cell.Healium) {
        w.replaceCellAt(ti, Cell.Steam, packRGB(255, 175, 205));
        w.life[ti] = 40;
      }
      if (n === Cell.Blood || n === Cell.Slime) {
        w.replaceCellAt(ti, Cell.Smoke, smokeColor());
        w.life[ti] = 25;
      }
    }
  }
  if (w.inBounds(x, y + 1) && lavaCanPass(w.types[w.idx(x, y + 1)])) {
    w.swap(x, y, x, y + 1);
    return;
  }
  const dir = Math.random() < 0.5 ? 1 : -1;
  if (Math.random() < ctx.params.materials[Cell.Lava].flowRate!) {
    if (w.inBounds(x + dir, y) && lavaCanPass(w.types[w.idx(x + dir, y)])) {
      w.swap(x, y, x + dir, y);
      return;
    }
    if (w.inBounds(x - dir, y) && lavaCanPass(w.types[w.idx(x - dir, y)])) {
      w.swap(x, y, x - dir, y);
      return;
    }
  }
}

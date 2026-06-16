import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import {
  EMPTY_COLOR,
  fireColor,
  goldColor,
  iceColor,
  packRGB,
  smokeColor,
  steamColor,
  stoneColor,
  unpackB,
  unpackG,
  unpackR,
  waterColor,
} from '@/sim/colors';
import { stainCell } from '@/sim/stains';

const CARDINAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const IGNITION_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [-1, -1],
];

function waterCanPass(t: number): boolean {
  return t === Cell.Empty || t === Cell.Oil || t === Cell.Steam || t === Cell.Smoke;
}

function viscousCanPass(t: number): boolean {
  return t === Cell.Empty || t === Cell.Steam || t === Cell.Smoke;
}

function acidCanPass(t: number): boolean {
  return t === Cell.Empty || t === Cell.Steam || t === Cell.Water || t === Cell.Oil || t === Cell.Smoke;
}

function lavaCanPass(t: number): boolean {
  return t === Cell.Empty || t === Cell.Steam || t === Cell.Oil || t === Cell.Acid || t === Cell.Smoke;
}

export function handleWater(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  // Clean water dilutes toxic sludge it touches
  if (Math.random() < 0.03) {
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (w.inBounds(nx, ny) && w.types[w.idx(nx, ny)] === Cell.Toxic) {
        const ni = w.idx(nx, ny);
        w.types[ni] = Cell.Water;
        w.colors[ni] = waterColor();
        break;
      }
    }
  }
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
  // Blood slowly darkens and dries
  if (type === Cell.Blood && Math.random() < ctx.params.materials[Cell.Blood].coagulation!) {
    const i = w.idx(x, y);
    const c = w.colors[i];
    w.colors[i] = packRGB(
      Math.max(60, unpackR(c) - 30),
      Math.max(5, unpackG(c) - 4),
      Math.max(8, unpackB(c) - 4),
    );
  }
}

export function handleNitrogen(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const ci = w.idx(x, y);
  for (const [dx, dy] of CARDINAL_OFFSETS) {
    const tx = x + dx;
    const ty = y + dy;
    if (w.inBounds(tx, ty)) {
      const ti = w.idx(tx, ty);
      const n = w.types[ti];
      if (n === Cell.Water) {
        w.types[ti] = Cell.Ice;
        w.colors[ti] = iceColor();
        w.types[ci] = Cell.Smoke;
        w.life[ci] = 20;
        w.colors[ci] = smokeColor();
        return;
      }
      if (n === Cell.Lava) {
        w.types[ti] = Cell.Stone;
        w.colors[ti] = stoneColor();
        w.types[ci] = Cell.Steam;
        w.life[ci] = 30;
        w.colors[ci] = steamColor();
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
    w.types[ci] = Cell.Smoke;
    w.life[ci] = 25;
    w.colors[ci] = smokeColor();
  }
}

export function handleOil(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  for (const [dx, dy] of IGNITION_OFFSETS) {
    const tx = x + dx;
    const ty = y + dy;
    if (
      w.inBounds(tx, ty) &&
      (w.types[w.idx(tx, ty)] === Cell.Fire || w.charge[w.idx(tx, ty)] > 0)
    ) {
      const ci = w.idx(x, y);
      w.types[ci] = Cell.Fire;
      w.life[ci] = Math.floor(Math.random() * 30) + ctx.params.materials[Cell.Oil].burnDuration!;
      w.colors[ci] = fireColor();
      return;
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
  if (Math.random() < ctx.params.materials[Cell.Oil].flowRate!) {
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
  for (const [dx, dy] of CARDINAL_OFFSETS) {
    const tx = x + dx;
    const ty = y + dy;
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
            w.types[ti] = Cell.Gold;
            w.colors[ti] = goldColor();
            if (cat >= 0) {
              // the spent grain puffs away as a golden wisp — visible chemistry
              w.types[cat] = Cell.Smoke;
              w.life[cat] = 18;
              w.colors[cat] = smokeColor();
            }
          } else {
            w.types[ti] = Cell.Steam;
            w.life[ti] = 25;
            w.colors[ti] = steamColor();
          }
          const ci = w.idx(x, y);
          w.types[ci] = Cell.Empty;
          w.colors[ci] = EMPTY_COLOR;
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
  for (const [dx, dy] of CARDINAL_OFFSETS) {
    const tx = x + dx;
    const ty = y + dy;
    if (w.inBounds(tx, ty)) {
      const ti = w.idx(tx, ty);
      const n = w.types[ti];
      if (n === Cell.Water) {
        const ci = w.idx(x, y);
        w.types[ci] = Cell.Stone;
        w.colors[ci] = stoneColor();
        w.types[ti] = Cell.Steam;
        w.life[ti] = 50;
        w.colors[ti] = steamColor();
        return;
      }
      if (n === Cell.Ice && Math.random() < ctx.params.materials[Cell.Lava].meltRange!) {
        w.types[ti] = Cell.Water;
        w.colors[ti] = waterColor();
      }
      if (n === Cell.Snow) {
        w.types[ti] = Cell.Steam;
        w.life[ti] = 30;
        w.colors[ti] = steamColor();
      }
      if (
        n === Cell.Wood ||
        n === Cell.Oil ||
        n === Cell.Vines ||
        n === Cell.Fungus ||
        n === Cell.Glowshroom
      ) {
        w.types[ti] = Cell.Fire;
        w.life[ti] = 35;
        w.colors[ti] = fireColor();
      }
      if (n === Cell.Coal && Math.random() < 0.15) {
        w.types[ti] = Cell.Fire;
        w.life[ti] = ctx.params.materials[Cell.Coal].burnDuration!;
        w.colors[ti] = fireColor();
      }
      if (n === Cell.Toxic && Math.random() < 0.3) {
        w.types[ti] = Cell.Smoke;
        w.life[ti] = 35;
        w.colors[ti] = smokeColor();
      }
      if (n === Cell.Healium) {
        w.types[ti] = Cell.Steam;
        w.life[ti] = 40;
        w.colors[ti] = packRGB(255, 175, 205);
      }
      if (n === Cell.Blood || n === Cell.Slime) {
        w.types[ti] = Cell.Smoke;
        w.life[ti] = 25;
        w.colors[ti] = smokeColor();
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

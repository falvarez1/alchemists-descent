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

export function handleWater(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const pass = (t: number) =>
    t === Cell.Empty || t === Cell.Oil || t === Cell.Steam || t === Cell.Smoke;
  if (w.inBounds(x, y + 1) && pass(w.types[w.idx(x, y + 1)])) {
    w.swap(x, y, x, y + 1);
    return;
  }
  const dir = Math.random() < 0.5 ? 1 : -1;
  if (w.inBounds(x + dir, y + 1) && pass(w.types[w.idx(x + dir, y + 1)])) {
    w.swap(x, y, x + dir, y + 1);
    return;
  }
  if (w.inBounds(x - dir, y + 1) && pass(w.types[w.idx(x - dir, y + 1)])) {
    w.swap(x, y, x - dir, y + 1);
    return;
  }
  if (Math.random() < ctx.params.materials[Cell.Water].flowRate!) {
    if (w.inBounds(x + dir, y) && pass(w.types[w.idx(x + dir, y)])) {
      w.swap(x, y, x + dir, y);
      return;
    }
    if (w.inBounds(x - dir, y) && pass(w.types[w.idx(x - dir, y)])) {
      w.swap(x, y, x - dir, y);
      return;
    }
  }
}

// Blood and slime: generic viscous liquids
export function handleViscousLiquid(ctx: Ctx, x: number, y: number, type: Cell): void {
  const w = ctx.world;
  const pass = (t: number) => t === Cell.Empty || t === Cell.Steam || t === Cell.Smoke;
  if (w.inBounds(x, y + 1) && pass(w.types[w.idx(x, y + 1)])) {
    w.swap(x, y, x, y + 1);
    return;
  }
  const dir = Math.random() < 0.5 ? 1 : -1;
  if (w.inBounds(x + dir, y + 1) && pass(w.types[w.idx(x + dir, y + 1)])) {
    w.swap(x, y, x + dir, y + 1);
    return;
  }
  if (w.inBounds(x - dir, y + 1) && pass(w.types[w.idx(x - dir, y + 1)])) {
    w.swap(x, y, x - dir, y + 1);
    return;
  }
  if (Math.random() < ctx.params.materials[type].flowRate!) {
    if (w.inBounds(x + dir, y) && pass(w.types[w.idx(x + dir, y)])) {
      w.swap(x, y, x + dir, y);
      return;
    }
    if (w.inBounds(x - dir, y) && pass(w.types[w.idx(x - dir, y)])) {
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
  const targets = [
    { x: x + 1, y: y },
    { x: x - 1, y: y },
    { x: x, y: y + 1 },
    { x: x, y: y - 1 },
  ];
  for (const t of targets) {
    if (w.inBounds(t.x, t.y)) {
      const ti = w.idx(t.x, t.y);
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
  const targets = [
    { x: x + 1, y: y },
    { x: x - 1, y: y },
    { x: x, y: y + 1 },
    { x: x - 1, y: y - 1 },
  ];
  for (const t of targets) {
    if (
      w.inBounds(t.x, t.y) &&
      (w.types[w.idx(t.x, t.y)] === Cell.Fire || w.charge[w.idx(t.x, t.y)] > 0)
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

export function handleAcid(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const targets = [
    { x: x + 1, y: y },
    { x: x - 1, y: y },
    { x: x, y: y + 1 },
    { x: x, y: y - 1 },
  ];
  for (const t of targets) {
    if (w.inBounds(t.x, t.y)) {
      const ti = w.idx(t.x, t.y);
      const n = w.types[ti];
      if (
        n !== Cell.Empty &&
        n !== Cell.Acid &&
        n !== Cell.Steam &&
        n !== Cell.Metal &&
        n !== Cell.Smoke
      ) {
        if (Math.random() < ctx.params.materials[Cell.Acid].corrosiveSpeed!) {
          // Alchemy needs a solvent: transmutation only fires next to water, and
          // rarely (economy guard — portable acid in flasks made 10% an
          // infinite-money hose; see DESIGN.md "acid->gold nerf").
          if (
            (n === Cell.Wall || n === Cell.Wood || n === Cell.Stone) &&
            Math.random() < 0.03 &&
            hasWaterNeighbor(w, t.x, t.y)
          ) {
            w.types[ti] = Cell.Gold;
            w.colors[ti] = goldColor();
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
  const canPass = (t: number) =>
    t === Cell.Empty || t === Cell.Steam || t === Cell.Water || t === Cell.Oil || t === Cell.Smoke;
  if (w.inBounds(x, y + 1) && canPass(w.types[w.idx(x, y + 1)])) {
    w.swap(x, y, x, y + 1);
    return;
  }
  const dir = Math.random() < 0.5 ? 1 : -1;
  if (Math.random() < ctx.params.materials[Cell.Acid].flowRate!) {
    if (w.inBounds(x + dir, y) && canPass(w.types[w.idx(x + dir, y)])) {
      w.swap(x, y, x + dir, y);
      return;
    }
    if (w.inBounds(x - dir, y) && canPass(w.types[w.idx(x - dir, y)])) {
      w.swap(x, y, x - dir, y);
      return;
    }
  }
}

export function handleLava(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  const targets = [
    { x: x + 1, y: y },
    { x: x - 1, y: y },
    { x: x, y: y + 1 },
    { x: x, y: y - 1 },
  ];
  for (const t of targets) {
    if (w.inBounds(t.x, t.y)) {
      const ti = w.idx(t.x, t.y);
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
      if (n === Cell.Wood || n === Cell.Oil || n === Cell.Vines) {
        w.types[ti] = Cell.Fire;
        w.life[ti] = 35;
        w.colors[ti] = fireColor();
      }
      if (n === Cell.Blood || n === Cell.Slime) {
        w.types[ti] = Cell.Smoke;
        w.life[ti] = 25;
        w.colors[ti] = smokeColor();
      }
    }
  }
  const canPass = (t: number) =>
    t === Cell.Empty || t === Cell.Steam || t === Cell.Oil || t === Cell.Acid || t === Cell.Smoke;
  if (w.inBounds(x, y + 1) && canPass(w.types[w.idx(x, y + 1)])) {
    w.swap(x, y, x, y + 1);
    return;
  }
  const dir = Math.random() < 0.5 ? 1 : -1;
  if (Math.random() < ctx.params.materials[Cell.Lava].flowRate!) {
    if (w.inBounds(x + dir, y) && canPass(w.types[w.idx(x + dir, y)])) {
      w.swap(x, y, x + dir, y);
      return;
    }
    if (w.inBounds(x - dir, y) && canPass(w.types[w.idx(x - dir, y)])) {
      w.swap(x, y, x - dir, y);
      return;
    }
  }
}

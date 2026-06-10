import type { Ctx } from '@/core/types';
import { Cell, isGas, isLiquid } from '@/sim/CellType';

/* ===================== Element Physics Behaviors ===================== */

/** Falling-powder behavior shared by SAND and GOLD (type selects the params). */
export function handleSand(ctx: Ctx, x: number, y: number, type: Cell): void {
  const w = ctx.world;
  const passRate = ctx.params.materials[type].densityWeight!;
  const canPass = (t: number) => t === Cell.Empty || (isLiquid(t) && t !== Cell.Lava) || isGas(t);
  if (w.inBounds(x, y + 1) && canPass(w.types[w.idx(x, y + 1)]) && Math.random() < passRate) {
    w.swap(x, y, x, y + 1);
    return;
  }
  if (Math.random() < ctx.params.materials[type].friction!) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (w.inBounds(x + dir, y + 1) && canPass(w.types[w.idx(x + dir, y + 1)])) {
      w.swap(x, y, x + dir, y + 1);
      return;
    }
    if (w.inBounds(x - dir, y + 1) && canPass(w.types[w.idx(x - dir, y + 1)])) {
      w.swap(x, y, x - dir, y + 1);
      return;
    }
  }
}

export function handleGunpowder(ctx: Ctx, x: number, y: number): void {
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
      ctx.explosions.trigger(x, y, ctx.params.materials[Cell.Gunpowder].blastRadius!);
      return;
    }
  }
  const canPass = (t: number) => t === Cell.Empty || (isLiquid(t) && t !== Cell.Lava) || isGas(t);
  if (w.inBounds(x, y + 1) && canPass(w.types[w.idx(x, y + 1)])) {
    w.swap(x, y, x, y + 1);
    return;
  }
  if (Math.random() < ctx.params.materials[Cell.Gunpowder].friction!) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (w.inBounds(x + dir, y + 1) && canPass(w.types[w.idx(x + dir, y + 1)])) {
      w.swap(x, y, x + dir, y + 1);
      return;
    }
    if (w.inBounds(x - dir, y + 1) && canPass(w.types[w.idx(x - dir, y + 1)])) {
      w.swap(x, y, x - dir, y + 1);
      return;
    }
  }
}

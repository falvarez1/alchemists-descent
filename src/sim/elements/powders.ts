import type { Ctx } from '@/core/types';
import { Cell, isGas, isLiquid } from '@/sim/CellType';
import { glassColor } from '@/sim/colors';
import { IGNITION_OFFSETS } from '@/sim/neighborOffsets';

/* ===================== Element Physics Behaviors ===================== */

function powderCanPass(t: number): boolean {
  return t === Cell.Empty || (isLiquid(t) && t !== Cell.Lava) || isGas(t);
}

/** Falling-powder behavior shared by SAND and GOLD (type selects the params). */
export function handleSand(ctx: Ctx, x: number, y: number, type: Cell): void {
  const w = ctx.world;
  // Intense heat or a strong electrical charge fuses sand into glass
  if (type === Cell.Sand) {
    const i = w.idx(x, y);
    if (w.charge[i] > 6 && Math.random() < 0.22) {
      w.replaceCellAt(i, Cell.Glass, glassColor());
      return;
    }
    if (Math.random() < 0.1) {
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (
          w.inBounds(nx, ny) &&
          w.types[w.idx(nx, ny)] === Cell.Lava &&
          Math.random() < 0.22
        ) {
          w.replaceCellAt(i, Cell.Glass, glassColor());
          return;
        }
      }
    }
  }
  const passRate = ctx.params.materials[type].densityWeight!;
  if (w.inBounds(x, y + 1) && powderCanPass(w.types[w.idx(x, y + 1)]) && Math.random() < passRate) {
    w.swap(x, y, x, y + 1);
    return;
  }
  if (Math.random() < ctx.params.materials[type].friction!) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (w.inBounds(x + dir, y + 1) && powderCanPass(w.types[w.idx(x + dir, y + 1)])) {
      w.swap(x, y, x + dir, y + 1);
      return;
    }
    if (w.inBounds(x - dir, y + 1) && powderCanPass(w.types[w.idx(x - dir, y + 1)])) {
      w.swap(x, y, x - dir, y + 1);
      return;
    }
  }
}

export function handleGunpowder(ctx: Ctx, x: number, y: number): void {
  const w = ctx.world;
  // Indexed loop over the offset constant — hot per-cell path.
  for (let k = 0; k < IGNITION_OFFSETS.length; k++) {
    const o = IGNITION_OFFSETS[k];
    const tx = x + o[0];
    const ty = y + o[1];
    if (
      w.inBounds(tx, ty) &&
      (w.types[w.idx(tx, ty)] === Cell.Fire || w.charge[w.idx(tx, ty)] > 0)
    ) {
      ctx.explosions.trigger(x, y, ctx.params.materials[Cell.Gunpowder].blastRadius!);
      return;
    }
  }
  if (w.inBounds(x, y + 1) && powderCanPass(w.types[w.idx(x, y + 1)])) {
    w.swap(x, y, x, y + 1);
    return;
  }
  if (Math.random() < ctx.params.materials[Cell.Gunpowder].friction!) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (w.inBounds(x + dir, y + 1) && powderCanPass(w.types[w.idx(x + dir, y + 1)])) {
      w.swap(x, y, x + dir, y + 1);
      return;
    }
    if (w.inBounds(x - dir, y + 1) && powderCanPass(w.types[w.idx(x - dir, y + 1)])) {
      w.swap(x, y, x - dir, y + 1);
      return;
    }
  }
}

import { blocksEntity, Cell, isGas, isSoftGrowth } from '@/sim/CellType';
import type { World } from '@/sim/World';

/**
 * Where a bat may hang. QA found roosts 8-95 cells below any ceiling: the roost
 * search took the first non-Empty cell above a sample for a roof, and a falling
 * oil drip, a leaf or a wisp of gas all qualified. Shared by the roost search
 * (game/Levels) and the roosting bat itself (entities/Enemies), which lets go
 * when its perch is gone.
 */

/** Air a roosting bat hangs in: open cells and gas (marsh gas pools under the Rot Gardens' ceilings). */
export function roostAir(t: number): boolean {
  return t === Cell.Empty || isGas(t);
}

/** What a bat can hang from: rock and the other solids, a trunk, a vine, a fungus cap, moss. */
export function roostPerch(t: number): boolean {
  return blocksEntity(t) || (isSoftGrowth(t) && t !== Cell.Grass && t !== Cell.Leaf);
}

/**
 * Is there still something to hang from over a roosting bat at (x, y)? Its
 * perch row is 4-5 cells above its feet (Levels hangs it at roost.y + 4); a
 * little slack either way for a body nudged by a blast.
 */
export function roostHeld(world: World, x: number, y: number): boolean {
  const cx = Math.round(x);
  for (let dy = 3; dy <= 8; dy++) {
    const cy = Math.round(y) - dy;
    if (!world.inBounds(cx, cy)) return true; // the world's lid holds
    if (roostPerch(world.types[world.idx(cx, cy)])) return true;
  }
  return false;
}

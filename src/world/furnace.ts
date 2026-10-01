import { Cell, blocksEntity, isLiquid, isSoftGrowth } from '@/sim/CellType';
import { COLOR_FN } from '@/sim/colors';
import type { World } from '@/sim/World';

/**
 * THE FURNACE UNDER THE POT (GEN 64). "Keep a fire under it" was the whole of the cauldron's heat, and it
 * could not be done by hand: measured on a floor-2 cauldron, lamp oil poured against the wall burned eight
 * seconds, flowed into the bowl and spoiled the mix (4 of 8 cells), and the spark that lit it was
 * the only fire most players own. A brew asks for six seconds of heat; the discovery game asks for dozens of
 * brews. So every cauldron stands on a furnace: a sealed pocket in the ground under its base, banked with real
 * Ember cells (an ember never burns out, never ashes and chokes nothing: the heat the cauldron reads is any
 * Fire, Lava or Ember within six cells, and the pocket's top row is three below the bowl's floor). It is a
 * cutaway: the embers glow through the rock face under the pot, and nobody can walk through them.
 *
 * Carved only where the rock can hold it: a pocket in open ground would breathe fire into a cave. Where the
 * ground under the base is not solid enough (a ledge, a thin floor, a pool bed) there is no furnace and the
 * cauldron wants a fire of the player's own making, as it always did.
 */

/** Rows the pocket is cut: the first is the third under the bowl's floor (the basin base and one row of ground are the slab). */
export const FURNACE_TOP = 3;

/** Solid, dry, load-bearing: what a pocket's walls and floor have to be. */
function sound(world: World, x: number, y: number): boolean {
  if (!world.inBounds(x, y)) return false;
  const t = world.types[world.idx(x, y)];
  return blocksEntity(t) && !isLiquid(t) && !isSoftGrowth(t);
}

/**
 * Bank a furnace under the cauldron whose bottom interior row is `c.y`: `rows` rows of embers, seven wide, with a
 * one-cell wall of sound ground on every side and the slab over it. Returns false (and writes nothing) when the ground
 * is not sound all round.
 */
export function bankFurnace(world: World, c: { x: number; y: number }, rows = 2): boolean {
  const x0 = c.x - 3, x1 = c.x + 3;
  const y0 = c.y + FURNACE_TOP, y1 = y0 + rows - 1;
  for (let y = c.y + 2; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) if (!sound(world, x, y)) return false;
  const ember = COLOR_FN[Cell.Ember];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) world.replaceCellAt(world.idx(x, y), Cell.Ember, ember());
  return true;
}

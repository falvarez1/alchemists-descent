import { Cell } from '@/sim/CellType';
import { steamColor } from '@/sim/colors';
import type { World } from '@/sim/World';

/**
 * THE WARM BOWL. An unlit waystone or brazier keeps its bowl dry: its stone is
 * banked warm, so water that drips or seeps into the bowl steams off, one real
 * Steam cell at a time (QA: on the Drowned Cisterns a waystone's bowl filled
 * 40% with water as the floor settled, and fire could never burn there).
 *
 * Only water and brine steam off. Oil is fuel (it lights the bowl), lava is
 * heat, and powders are the player's to dig out. The rate is a trickle: it
 * beats drips and seepage, not a flood, so a bowl sunk in a lake stays drowned
 * (Mechanisms treats a drowned brazier as a wrecked one: fail-open).
 */

/** Steams off the lowest water or brine cell in the rect; returns true if it did. */
export function steamOffBowl(world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let y = y1; y >= y0; y--) {
    for (let x = x0; x <= x1; x++) {
      if (!world.inBounds(x, y)) continue;
      const i = world.idx(x, y);
      const t = world.types[i];
      if (t !== Cell.Water && t !== Cell.Brine) continue;
      world.replaceCellAt(i, Cell.Steam, steamColor());
      world.life[i] = 50;
      return true;
    }
  }
  return false;
}

/** How many cells of the rect hold water or brine. */
export function wetCells(world: World, x0: number, y0: number, x1: number, y1: number): number {
  let wet = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!world.inBounds(x, y)) continue;
      const t = world.types[world.idx(x, y)];
      if (t === Cell.Water || t === Cell.Brine) wet++;
    }
  }
  return wet;
}

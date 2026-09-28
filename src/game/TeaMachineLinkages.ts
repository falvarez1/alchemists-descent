import type { TeaMachineState } from '@/core/types';
import { Cell, isSolid } from '@/sim/CellType';
import type { World } from '@/sim/World';
import { TEA_VALVES, type TeaValve } from '@/world/teaMachine';

/** Ideal ratcheted linkage. Body travel supplies the stroke, never elapsed
 * time. Plates displace existing cells, preserving the vat's finite contents.
 * A broken plate or obstructed guide jams instead of carving through terrain. */
export function pullTeaValve(world: World, state: TeaMachineState, key: TeaValve, stroke: number): number {
  const valve = TEA_VALVES[key], { plate, dx, dy } = valve;
  const travel = state.travel ??= {};
  let moved = travel[key] ?? 0;
  const target = Math.min(valve.max, Math.max(moved, Math.floor(stroke)));
  while (moved < target) {
    const x0 = plate.x + moved * dx, y0 = plate.y + moved * dy;
    for (let y = 0; y < plate.h; y++) for (let x = 0; x < plate.w; x++) {
      if (world.type(x0 + x, y0 + y) !== Cell.Metal) return moved;
      const nx = x0 + x + dx, ny = y0 + y + dy;
      const inside = nx >= x0 && nx < x0 + plate.w && ny >= y0 && ny < y0 + plate.h;
      if (!inside && (!world.inBounds(nx, ny) || isSolid(world.type(nx, ny)))) return moved;
    }
    // Leading edge first, so overlapping source/destination rectangles swap
    // the liquid around the plate instead of copying metal or deleting acid.
    for (let y = 0; y < plate.h; y++) for (let n = 0; n < plate.w; n++) {
      const x = dx > 0 ? plate.w - 1 - n : n;
      world.swap(x0 + x, y0 + y, x0 + x + dx, y0 + y + dy);
    }
    travel[key] = ++moved;
  }
  return moved;
}

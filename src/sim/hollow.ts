import { blocksEntity } from '@/sim/CellType';
import type { World } from '@/sim/World';

/**
 * March from a projectile impact into the wall along the impact direction.
 * If open space lies behind at most 8 blocking cells, return that first open
 * cell; otherwise return null.
 */
export function probeHollow(
  world: World,
  hitX: number,
  hitY: number,
  dirX: number,
  dirY: number,
): { x: number; y: number } | null {
  const len = Math.hypot(dirX, dirY);
  if (len < 1e-4 || !world.inBounds(hitX, hitY)) return null;
  const sx = (dirX / len) * 0.5;
  const sy = (dirY / len) * 0.5;
  let fx = hitX + 0.5;
  let fy = hitY + 0.5;
  let px = hitX;
  let py = hitY;
  let solids = blocksEntity(world.types[hitX + hitY * world.width]) ? 1 : 0;
  for (let it = 0; it < 40; it++) {
    fx += sx;
    fy += sy;
    const cx = Math.floor(fx);
    const cy = Math.floor(fy);
    if (cx === px && cy === py) continue;
    px = cx;
    py = cy;
    if (!world.inBounds(cx, cy)) return null;
    if (blocksEntity(world.types[cx + cy * world.width])) {
      if (++solids > 8) return null;
    } else if (solids > 0) {
      return { x: cx, y: cy };
    }
  }
  return null;
}

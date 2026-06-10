import { HEIGHT, VIEW_H, VIEW_W } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { gunpowderColor, wallColor, woodColor } from '@/sim/colors';

/**
 * Stamp the test-fortress prefab centered on the current camera view:
 * two 45-tall wood pillars at ±30, a central gunpowder column, and three
 * 71-wide slabs (wall floor, wood deck at -20, wall roof at -45).
 */
export function spawnFortress(ctx: Ctx): void {
  const world = ctx.world;
  const cx = ctx.camera.renderX + Math.floor(VIEW_W / 2);
  const baseFloor = Math.min(HEIGHT - 50, ctx.camera.renderY + VIEW_H - 50);
  for (let h = 0; h < 45; h++) {
    if (world.inBounds(cx - 30, baseFloor - h)) {
      const i = world.idx(cx - 30, baseFloor - h);
      world.types[i] = Cell.Wood;
      world.colors[i] = woodColor();
    }
    if (world.inBounds(cx + 30, baseFloor - h)) {
      const i = world.idx(cx + 30, baseFloor - h);
      world.types[i] = Cell.Wood;
      world.colors[i] = woodColor();
    }
    if (world.inBounds(cx, baseFloor - h)) {
      const i = world.idx(cx, baseFloor - h);
      world.types[i] = Cell.Gunpowder;
      world.colors[i] = gunpowderColor();
    }
  }
  for (let w = -35; w <= 35; w++) {
    if (world.inBounds(cx + w, baseFloor)) {
      const i = world.idx(cx + w, baseFloor);
      world.types[i] = Cell.Wall;
      world.colors[i] = wallColor();
    }
    if (world.inBounds(cx + w, baseFloor - 20)) {
      const i = world.idx(cx + w, baseFloor - 20);
      world.types[i] = Cell.Wood;
      world.colors[i] = woodColor();
    }
    if (world.inBounds(cx + w, baseFloor - 45)) {
      const i = world.idx(cx + w, baseFloor - 45);
      world.types[i] = Cell.Wall;
      world.colors[i] = wallColor();
    }
  }
}

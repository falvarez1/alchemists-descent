import { STOCK_STAGE } from '@/config/stockStage';
import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';

/** Stamp stable competitive geometry. Decorative color never changes collision. */
export function stampStockStage(ctx: Ctx): void {
  const w = ctx.world;
  for (const slab of [STOCK_STAGE.main, ...STOCK_STAGE.platforms]) {
    for (let y = slab.y; y < slab.y + slab.depth; y++) {
      const inset = y > slab.y + 8 ? Math.floor((y - slab.y - 8) * 1.7) : 0;
      for (let x = slab.x0 + inset; x <= slab.x1 - inset; x++) {
        const rim = y < slab.y + 2;
        w.replaceCellAt(w.idx(x, y), Cell.Metal, rim ? packRGB(225, 155, 78) : packRGB(60, 69, 77));
      }
    }
  }
  for (const lamp of STOCK_STAGE.lamps) {
    for (let y = lamp.y - 4; y <= lamp.y + 6; y++) for (let x = lamp.x - 3; x <= lamp.x + 3; x++) {
      const glass = x > lamp.x - 2 && x < lamp.x + 2 && y >= lamp.y && y <= lamp.y + 3;
      const shell = x === lamp.x - 3 || x === lamp.x + 3 || y === lamp.y - 1 || y === lamp.y + 5;
      if (glass || shell) w.replaceCellAt(w.idx(x, y), glass ? Cell.Glowshroom : Cell.Metal, glass ? packRGB(101, 202, 197) : packRGB(65, 83, 90));
    }
  }
  ctx.arena?.setSpawns(STOCK_STAGE.spawns);
  ctx.camera.snapTo(STOCK_STAGE.center.x, STOCK_STAGE.center.y);
}

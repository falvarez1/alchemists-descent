import { HEIGHT, WIDTH } from '@/config/constants';
import type { ExitPortal, LevelExitWell } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { stoneColor } from '@/sim/colors';
import type { World } from '@/sim/World';
import { carveRect } from '@/world/connect';

/**
 * THE EXIT SHRINE HAS A FLOOR AND AN OPEN RING (GEN 62). The shrine is an ellipse carved
 * over the well's seal plug, and the carve took the top of the plug with it: on the reviewed
 * seeds the ground under the portal was 0% solid. Later tunnels (the shrine's own flank
 * connectors, a rescue) and seed pockets beside it (d3b: a ring half wall and gunpowder) took
 * the rest. After the last carve this puts the plug's top rows back as a stone pad the
 * length of the plug and clears the ring and the standing room above the pad (never Metal, never
 * the frame pillars two cells out of it). Idempotent; it only ever opens cells in the ring and
 * closes cells of the plug, which no route runs through.
 */
export function holdPortalShrine(world: World, portal: ExitPortal, exit: LevelExitWell): number {
  let changed = 0;
  // The pad: the plug's top four rows, edge to edge.
  for (let y = exit.sealY; y < exit.sealY + 4; y++) {
    for (let dx = -exit.halfW; dx <= exit.halfW; dx++) {
      const x = exit.x + dx;
      if (x < 2 || x >= WIDTH - 2 || y < 2 || y >= HEIGHT - 8) continue;
      const i = world.idx(x, y);
      const t = world.types[i];
      if (t === Cell.Stone || t === Cell.Metal) continue;
      world.types[i] = Cell.Stone;
      world.colors[i] = stoneColor();
      world.life[i] = 0;
      world.charge[i] = 0;
      world.activity.touchIndex(i);
      changed++;
    }
  }
  // The ring and the standing room: from its top row to the pad.
  const x0 = Math.floor(portal.x) - 6, x1 = Math.floor(portal.x) + 6;
  const y0 = Math.floor(portal.y) - 14, y1 = exit.sealY - 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = world.types[world.idx(x, y)];
      if (t !== Cell.Empty && t !== Cell.Metal) changed++;
    }
  }
  carveRect(world, x0, y0, x1, y1);
  return changed;
}

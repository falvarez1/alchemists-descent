import type { AuthoredLight } from '@/core/types';
import type { LevelStorySites, StoryPipeSite, StoryValveSite } from '@/core/story';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import type { World } from '@/sim/World';
import { campLight, findFloorNear, makePipe, valveLight } from '@/world/storySites';

/**
 * FLOOR 1's STORY, placed by hand (wave 3 WS-S). The Breathing Works is
 * authored, so its speaking-pipes name their rooms, Pell warms his hands at
 * the Warm Refuge, and the resonant valve waits in a Guild locker nook off the
 * return shaft — the room the last shift left from.
 */

/** Where each pipe hangs: an anchor on the room's route (snapped to the nearest standable floor). */
export const WORKS_PIPE_ANCHORS: ReadonlyArray<{ id: string; x: number; y: number }> = [
  { id: 'intake', x: 222, y: 314 },
  { id: 'sluice', x: 492, y: 440 },
  { id: 'gallery', x: 1012, y: 446 },
  { id: 'refuge', x: 782, y: 742 },
  { id: 'undertow', x: 560, y: 1006 },
  { id: 'bell', x: 1292, y: 1006 },
];

/** Pell's camp: the Warm Refuge's east end, past the plinth, before the climb to the chamber. */
export const WORKS_CAMP = { x: 1004, y: 759, facing: -1 as const, x0: 968, x1: 1040 };

/**
 * The Guild locker nook: carved into the rock west of the return shaft, its
 * floor level with the shaft's fifth west rung (x 330..358, top row 517), so a
 * climber steps straight in. Interior rows 473..516.
 */
export const WORKS_ECHO_NOOK = { x0: 226, x1: 329, y0: 473, floorY: 516, wheelX: 238 } as const;

/** Carve the locker nook (before the chalk-lip dressing, so its floor gets its lip). */
export function carveWorksEchoNook(world: World): void {
  const n = WORKS_ECHO_NOOK;
  for (let y = n.y0; y <= n.floorY; y++) {
    for (let x = n.x0; x <= n.x1; x++) {
      // A rounded back corner: the rock shoulders in at the top-left.
      const edge = x - n.x0, over = n.y0 + 10 - y;
      if (over > 0 && edge < 10 && edge * edge + over * over < 100 && edge < over) continue;
      const i = world.idx(x, y);
      if (world.types[i] !== Cell.Metal) world.replaceCellAt(i, Cell.Empty, 0x08080c);
    }
  }
  // A laid stone floor, flush with the rung.
  for (let x = n.x0 - 1; x <= n.x1; x++) for (let y = n.floorY + 1; y <= n.floorY + 3; y++) {
    const i = world.idx(x, y);
    if (world.types[i] !== Cell.Metal) world.replaceCellAt(i, Cell.Stone, packRGB(74 + ((x * 5 + y) % 6), 78, 72));
  }
}

/** Resolve floor 1's story sites against the finished world. */
export function worksStorySites(world: World): { sites: LevelStorySites; lights: AuthoredLight[] } {
  const pipes: StoryPipeSite[] = [];
  for (const a of WORKS_PIPE_ANCHORS) {
    const at = findFloorNear(world, a.x, a.y, 40, 20, 30);
    if (at) pipes.push(makePipe(world, a.id, at.x, at.y));
  }
  const campAt = findFloorNear(world, WORKS_CAMP.x, WORKS_CAMP.y, 30, 12, 16) ?? { x: WORKS_CAMP.x, y: WORKS_CAMP.y };
  const camp = { x: campAt.x, floorY: campAt.y, facing: WORKS_CAMP.facing, x0: WORKS_CAMP.x0, x1: WORKS_CAMP.x1 };
  const n = WORKS_ECHO_NOOK;
  const valve: StoryValveSite = { x: n.wheelX, floorY: n.floorY, stageX: Math.round((n.x0 + n.x1) / 2) + 6, stageHalfW: 44 };
  return {
    sites: { pipes, camp, valve, flue: null },
    lights: [campLight(camp, true), valveLight(valve)],
  };
}

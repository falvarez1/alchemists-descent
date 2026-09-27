import { describe, expect, it } from 'vitest';

import type { LevelRuntime, PlacedPrefab, Waystone } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { failOpenFindability, validateFindability } from '@/world/validate';

/**
 * SETTLED REPAIR vs PUZZLE ROOMS (fix3, Flora's report): the settled findability
 * repair bored a 15-wide tunnel straight from the spawn to the cut-off lock, and
 * on D4 seed 3 that line crossed the flora lava-bridge room after arrival and cut
 * its tree in two. A repair now takes the cheapest standing route: open caves
 * first, rock where it must, an authored room's cells only when nothing else
 * reaches (fail-open), where the room is thinnest.
 */

/** A rock world with the spawn chamber on the left and a cut-off waystone chamber on the right. */
function level(): { runtime: LevelRuntime; room: PlacedPrefab; waystone: Waystone } {
  const world = new World(220, 120);
  world.types.fill(Cell.Stone);
  const open = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) world.types[world.idx(x, y)] = Cell.Empty;
  };
  open(10, 50, 50, 80); // spawn chamber
  open(170, 50, 210, 80); // the waystone's chamber, sealed off
  // A puzzle room squarely on the straight line between them: its walls are
  // Wood, its "tree" a Trunk column — the cells that ARE the puzzle.
  const room: PlacedPrefab = { id: 'flora-lava-bridge', x0: 90, y0: 45, x1: 130, y1: 85 };
  for (let y = room.y0; y <= room.y1; y++) {
    for (let x = room.x0; x <= room.x1; x++) {
      const wall = x === room.x0 || x === room.x1 || y === room.y0 || y === room.y1;
      world.types[world.idx(x, y)] = wall ? Cell.Wood : Cell.Empty;
    }
  }
  for (let y = 60; y < room.y1; y++) world.types[world.idx(110, y)] = Cell.Trunk;
  const waystone: Waystone = { x: 190, y: 80, lit: false };
  const runtime = {
    def: { id: 'test', name: 'Test', biome: 'volcanic', depth: 4, nextLevelId: null },
    world,
    enemies: [],
    waystones: [waystone],
    pickups: [],
    mechanisms: [],
    runeVaults: [],
    spawn: { x: 30, y: 80 },
    explored: new Uint8Array(world.width * world.height),
    regions: null,
    cauldron: null,
    portal: null,
    keyTaken: false,
    placedPrefabs: [room],
  } as unknown as LevelRuntime;
  return { runtime, room, waystone };
}

function roomCells(world: World, room: PlacedPrefab): Uint8Array {
  const out = new Uint8Array((room.x1 - room.x0 + 1) * (room.y1 - room.y0 + 1));
  let n = 0;
  for (let y = room.y0; y <= room.y1; y++) for (let x = room.x0; x <= room.x1; x++) out[n++] = world.types[world.idx(x, y)];
  return out;
}

describe('findability repair around authored rooms', () => {
  it('reaches the cut-off waystone without touching a room on the straight line', () => {
    const { runtime, room } = level();
    expect(validateFindability(runtime).some((i) => i.what === 'waystone' && i.severity === 'error')).toBe(true);
    const before = roomCells(runtime.world, room);

    const result = failOpenFindability(runtime);

    expect(result.remaining.filter((i) => i.severity === 'error')).toEqual([]);
    expect(roomCells(runtime.world, room)).toEqual(before); // walls and tree intact
  });

  it('still carves through a room when it is truly the only way (fail-open), and least of it', () => {
    const { runtime, room } = level();
    const world = runtime.world;
    // Wall the room in with metal above and below: the only way east is through it.
    for (let x = 60; x <= 160; x++) {
      for (let y = 1; y < room.y0 - 3; y++) world.types[world.idx(x, y)] = Cell.Metal;
      for (let y = room.y1 + 4; y < world.height - 1; y++) world.types[world.idx(x, y)] = Cell.Metal;
    }
    const result = failOpenFindability(runtime);
    expect(result.remaining.filter((i) => i.severity === 'error')).toEqual([]);
    // It went in through the room's walls, not by clearing the room: most of the
    // tree stands.
    let trunk = 0;
    for (let y = 60; y < room.y1; y++) if (world.types[world.idx(110, y)] === Cell.Trunk) trunk++;
    expect(trunk).toBeGreaterThan(0);
  });

  it('walks through a room\'s open interior without carving it', () => {
    const { runtime, room } = level();
    const world = runtime.world;
    // A doorway on each side of the room lines up with the chambers' floors,
    // and the rock between is thin: the cheap way is through the room's door.
    for (let y = 62; y <= 84; y++) {
      for (let x = 51; x <= 89; x++) world.types[world.idx(x, y)] = Cell.Empty;
      for (let x = 131; x <= 169; x++) world.types[world.idx(x, y)] = Cell.Empty;
    }
    for (let y = 62; y <= 84; y++) {
      world.types[world.idx(room.x0, y)] = Cell.Empty;
      world.types[world.idx(room.x1, y)] = Cell.Empty;
    }
    // ...but the tree blocks the way through the room, so the waystone is cut off.
    for (let y = 46; y < room.y1; y++) world.types[world.idx(110, y)] = Cell.Trunk;
    for (let y = 62; y <= 84; y++) world.types[world.idx(150, y)] = Cell.Stone; // and a thin plug east
    const before = roomCells(world, room);
    const result = failOpenFindability(runtime);
    expect(result.remaining.filter((i) => i.severity === 'error')).toEqual([]);
    expect(roomCells(world, room)).toEqual(before);
  });
});

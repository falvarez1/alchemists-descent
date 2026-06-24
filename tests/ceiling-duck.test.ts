import { describe, expect, it } from 'vitest';

import { Physics } from '@/entities/physics';
import { PLAYER_AIR_CEIL_SLIP, PLAYER_CEIL_SLIP } from '@/core/types';
import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

/**
 * A ceiling that steps DOWN by 5 cells in the travel direction. The grounded
 * duck (PLAYER_CEIL_SLIP = 3) can't follow it, so the move is pinned; the
 * airborne duck (PLAYER_AIR_CEIL_SLIP) can, so a levitating wizard rides the
 * descending ceiling instead of hitting an invisible wall.
 */
function worldWithDescendingCeiling(): World {
  const world = new World();
  // High ceiling solid down to row 26 across a wide span (one big cluster, so
  // the loose-rubble rule treats it as real terrain).
  for (let x = 10; x <= 40; x++) {
    for (let y = 0; y <= 26; y++) world.types[world.idx(x, y)] = Cell.Wall;
  }
  // From column 21 onward the ceiling drops 5 more cells (solid to row 31).
  for (let x = 21; x <= 40; x++) {
    for (let y = 27; y <= 31; y++) world.types[world.idx(x, y)] = Cell.Wall;
  }
  return world;
}

function physicsFor(world: World): Physics {
  const ctx = {
    world,
    state: { mode: 'play' },
    particles: { spawn: () => undefined },
  } as unknown as Ctx;
  return new Physics(ctx);
}

describe('airborne ceiling duck', () => {
  it('pins the move with the tight grounded duck', () => {
    const physics = physicsFor(worldWithDescendingCeiling());
    const ent = { x: 20, y: 30 };
    // 1-wide body, 4 tall, flush under the high ceiling (head at row 27).
    const moved = physics.tryMoveEntity(ent, 1, 0, 0, 4, 5, PLAYER_CEIL_SLIP);
    expect(moved).toBe(false);
    expect(ent).toEqual({ x: 20, y: 30 });
  });

  it('follows the descending ceiling with the airborne duck', () => {
    const physics = physicsFor(worldWithDescendingCeiling());
    const ent = { x: 20, y: 30 };
    const moved = physics.tryMoveEntity(ent, 1, 0, 0, 4, 5, PLAYER_AIR_CEIL_SLIP);
    expect(moved).toBe(true);
    // advanced one column AND ducked the 5-cell step down.
    expect(ent).toEqual({ x: 21, y: 35 });
  });
});

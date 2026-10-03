import { describe, expect, it, vi } from 'vitest';
import { STOCK_STAGE } from '@/config/stockStage';
import type { Ctx } from '@/core/types';
import { Physics } from '@/entities/physics';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

function setup(stock = true) {
  const world = new World(), slab = STOCK_STAGE.platforms[0];
  for (let y = slab.y; y < slab.y + slab.depth; y++) for (let x = slab.x0; x <= slab.x1; x++) world.replaceCellAt(world.idx(x, y), Cell.Metal);
  const player = { x: slab.x0 + 30, y: slab.y + 22, vy: -3 };
  const ctx = { world, player, arena: { stockMatch: stock ? {} : null }, particles: { spawn: vi.fn() } } as unknown as Ctx;
  return { world, player, slab, physics: new Physics(ctx) };
}

describe('stock pass-through platforms', () => {
  it('allows an ascent through the whole slab without destroying its cells, then lands on top', () => {
    const { world, player, slab, physics } = setup();
    for (let i = 0; i < 30; i++) expect(physics.tryMoveEntity(player, 0, -1, 4, 17, 0)).toBe(true);
    expect(world.type(player.x, slab.y)).toBe(Cell.Metal);
    expect(world.type(player.x, slab.y + 10)).toBe(Cell.Metal);
    player.vy = 3;
    while (player.y < slab.y - 1) expect(physics.tryMoveEntity(player, 0, 1, 4, 17, 0)).toBe(true);
    expect(physics.tryMoveEntity(player, 0, 1, 4, 17, 0)).toBe(false);
    expect(physics.entityFree(player.x, player.y + 1, 4, 1)).toBe(false);
  });
  it('does not trap a fighter whose ascent ends inside the platform', () => {
    const { player, slab, physics } = setup(); player.y = slab.y + 4; player.vy = 1;
    expect(physics.entityFree(player.x, player.y + 1, 4, 1)).toBe(true);
    expect(physics.tryMoveEntity(player, 0, 1, 4, 17, 0)).toBe(true);
    expect(physics.tryMoveEntity(player, 1, 0, 4, 17, 0)).toBe(true);
  });
  it('keeps health-duel collision solid and respects destroyed stock-platform cells', () => {
    const health = setup(false); health.player.y = health.slab.y + health.slab.depth + 16;
    expect(health.physics.tryMoveEntity(health.player, 0, -1, 4, 17, 0)).toBe(false);
    const { player, world, slab, physics } = setup(); player.y = slab.y - 1; player.vy = 1;
    for (let x = player.x - 4; x <= player.x + 4; x++) world.clearCellAt(world.idx(x, slab.y));
    expect(physics.tryMoveEntity(player, 0, 1, 4, 17, 0)).toBe(true);
  });
});

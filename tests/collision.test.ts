import { describe, expect, it, vi } from 'vitest';

import type { Ctx } from '@/core/types';
import { Physics } from '@/entities/physics';
import { Cell, blocksEntity, isSolid } from '@/sim/CellType';
import { cellBlocksEntityWithLooseRubble, computeLooseRubbleBlockingMask } from '@/sim/collision';
import { World } from '@/sim/World';
import { computeFits } from '@/world/validate';

function set(world: World, x: number, y: number, t: Cell): void {
  world.types[world.idx(x, y)] = t;
}

function physicsCtx(world: World): Ctx {
  return {
    world,
    particles: { spawn: vi.fn() },
    state: { mode: 'play' },
  } as unknown as Ctx;
}

describe('loose-rubble collision parity', () => {
  it('treats isolated metal as blocking in runtime collision and findability fits', () => {
    const world = new World();
    set(world, 40, 34, Cell.Metal);

    expect(cellBlocksEntityWithLooseRubble(world, 40, 34)).toBe(true);

    const fits = computeFits(world);
    expect(fits[40 + 50 * world.width]).toBe(0);
    expect(fits[60 + 50 * world.width]).toBe(1);
  });

  it('uses 8-connected clusters for both runtime collision and findability fits', () => {
    const world = new World();
    for (let n = 0; n < 5; n++) set(world, 40 + n, 30 + n, Cell.Stone);

    expect(cellBlocksEntityWithLooseRubble(world, 40, 30)).toBe(true);

    const fits = computeFits(world);
    expect(fits[42 + 50 * world.width]).toBe(0);
  });

  it('keeps clusters smaller than five cells walk-through rubble', () => {
    const world = new World();
    for (let n = 0; n < 4; n++) set(world, 40 + n, 30 + n, Cell.Stone);

    expect(cellBlocksEntityWithLooseRubble(world, 40, 30)).toBe(false);

    const fits = computeFits(world);
    expect(fits[41 + 49 * world.width]).toBe(1);
  });

  it('routes Physics.cellBlocks through the shared loose-rubble contract', () => {
    const world = new World();
    for (let n = 0; n < 5; n++) set(world, 40 + n, 30 + n, Cell.Stone);
    set(world, 60, 30, Cell.Metal);
    set(world, 80, 30, Cell.Stone);

    const physics = new Physics({ world } as unknown as Ctx);

    expect(physics.cellBlocks(40, 30)).toBe(true);
    expect(physics.cellBlocks(60, 30)).toBe(true);
    expect(physics.cellBlocks(80, 30)).toBe(false);
  });

  it('keeps soft growth grid-real but pass-through for bodies and findability', () => {
    for (const growth of [Cell.Vines, Cell.Moss, Cell.Fungus, Cell.Glowshroom]) {
      const world = new World();
      for (let n = 0; n < 5; n++) set(world, 40 + n, 30, growth);

      expect(isSolid(growth)).toBe(true);
      expect(blocksEntity(growth)).toBe(false);
      expect(cellBlocksEntityWithLooseRubble(world, 40, 30)).toBe(false);
      expect(computeLooseRubbleBlockingMask(world)[40 + 30 * world.width]).toBe(0);

      const fits = computeFits(world);
      expect(fits[42 + 50 * world.width]).toBe(1);
    }
  });

  it('keeps ash residue pass-through even when it forms long connected trails', () => {
    const world = new World();
    for (let n = 0; n < 20; n++) set(world, 40 + n, 30 + n, Cell.Ash);

    expect(blocksEntity(Cell.Ash)).toBe(false);
    expect(cellBlocksEntityWithLooseRubble(world, 40, 30)).toBe(false);
    expect(computeLooseRubbleBlockingMask(world)[45 + 35 * world.width]).toBe(0);

    const fits = computeFits(world);
    expect(fits[45 + 50 * world.width]).toBe(1);
  });

  it('keeps five-plus-cell floating geometry blocking instead of erasing it', () => {
    const world = new World();
    for (let x = 38; x <= 42; x++) set(world, x, 33, Cell.Stone);
    const ctx = physicsCtx(world);
    const physics = new Physics(ctx);
    const ent = { x: 40, y: 50 };

    expect(cellBlocksEntityWithLooseRubble(world, 40, 33)).toBe(true);
    expect(physics.tryMoveEntity(ent, 0, -1, 4, 17, 0)).toBe(false);

    expect(ent.y).toBe(50);
    for (let x = 38; x <= 42; x++) expect(world.types[world.idx(x, 33)]).toBe(Cell.Stone);
    expect(ctx.particles.spawn).not.toHaveBeenCalled();
  });

  it('does not sweep terrain connected to a real ceiling mass', () => {
    const world = new World();
    for (let y = 20; y <= 33; y++) {
      for (let x = 10; x <= 70; x++) set(world, x, y, Cell.Stone);
    }
    const ctx = physicsCtx(world);
    const physics = new Physics(ctx);
    const ent = { x: 40, y: 50 };

    expect(physics.tryMoveEntity(ent, 0, -1, 4, 17, 0)).toBe(false);

    expect(ent.y).toBe(50);
    expect(world.types[world.idx(40, 33)]).toBe(Cell.Stone);
    expect(ctx.particles.spawn).not.toHaveBeenCalled();
  });

  it('keeps floating metal collision-solid instead of sweepable', () => {
    const world = new World();
    for (let x = 38; x <= 42; x++) set(world, x, 33, Cell.Metal);
    const ctx = physicsCtx(world);
    const physics = new Physics(ctx);
    const ent = { x: 40, y: 50 };

    expect(physics.tryMoveEntity(ent, 0, -1, 4, 17, 0)).toBe(false);

    expect(ent.y).toBe(50);
    expect(world.types[world.idx(40, 33)]).toBe(Cell.Metal);
  });
});

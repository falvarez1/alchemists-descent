import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Ctx } from '@/core/types';
import { Physics } from '@/entities/physics';
import { Explosions } from '@/sim/explosion';
import { Cell, blocksEntity } from '@/sim/CellType';
import { World } from '@/sim/World';
import { mockRandom } from './helpers/randomSeam';

function set(world: World, x: number, y: number, t: Cell): void {
  world.types[world.idx(x, y)] = t;
  world.colors[world.idx(x, y)] = 0x777777;
}

function makeCtx(world: World): Ctx {
  const ctx = {
    world,
    shockwaves: [],
    camera: { x: 0, y: 0 },
    fx: { bloomKick: 0, screenShake: 0 },
    audio: { boom: vi.fn() },
    events: { emit: vi.fn() },
    particles: { spawn: vi.fn(), burst: vi.fn() },
    enemies: [],
    enemyCtl: { damage: vi.fn() },
    state: { mode: 'build', frameCount: 0 },
    player: { dead: true },
    playerCtl: { damage: vi.fn() },
    rigidBodies: { applyRadialImpulse: vi.fn() },
    vineStrands: { applyRadialImpulse: vi.fn() },
    critters: { scatter: vi.fn() },
  } as unknown as Ctx;
  ctx.physics = new Physics(ctx);
  return ctx;
}

describe('explosion debris cleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turns disconnected blast rubble islands into pass-through ash', () => {
    mockRandom().mockReturnValue(0.99);
    const world = new World(80, 60);
    for (let y = 28; y <= 31; y++) {
      for (let x = 36; x <= 43; x++) set(world, x, y, Cell.Stone);
    }
    const ctx = makeCtx(world);

    new Explosions(ctx).trigger(30, 30, 8);

    for (let y = 28; y <= 31; y++) {
      for (let x = 39; x <= 43; x++) {
        expect(world.types[world.idx(x, y)]).toBe(Cell.Ash);
      }
    }
    expect(blocksEntity(Cell.Ash)).toBe(false);
    expect(ctx.physics.cellBlocks(41, 29)).toBe(false);
  });

  it('preserves old disconnected terrain that the blast never touched', () => {
    mockRandom().mockReturnValue(0.99);
    const world = new World(80, 60);
    for (let y = 28; y <= 31; y++) {
      for (let x = 42; x <= 45; x++) set(world, x, y, Cell.Stone);
    }
    const ctx = makeCtx(world);

    new Explosions(ctx).trigger(30, 30, 8);

    for (let y = 28; y <= 31; y++) {
      for (let x = 42; x <= 45; x++) {
        expect(world.types[world.idx(x, y)]).toBe(Cell.Stone);
      }
    }
  });

  it('leaves terrain connected to the surrounding cave mass solid', () => {
    mockRandom().mockReturnValue(0.99);
    const world = new World(80, 60);
    for (let y = 18; y <= 20; y++) {
      for (let x = 14; x <= 28; x++) set(world, x, y, Cell.Stone);
    }
    const ctx = makeCtx(world);

    new Explosions(ctx).trigger(30, 30, 8);

    expect(world.types[world.idx(28, 18)]).toBe(Cell.Stone);
    expect(ctx.physics.cellBlocks(28, 18)).toBe(true);
  });

  it('keeps isolated metal blocking because metal is engineered blast-proof terrain', () => {
    mockRandom().mockReturnValue(0.99);
    const world = new World(80, 60);
    for (let y = 28; y <= 30; y++) {
      for (let x = 40; x <= 42; x++) set(world, x, y, Cell.Metal);
    }
    const ctx = makeCtx(world);

    new Explosions(ctx).trigger(30, 30, 8);

    expect(world.types[world.idx(41, 29)]).toBe(Cell.Metal);
    expect(ctx.physics.cellBlocks(41, 29)).toBe(true);
  });
});

describe('a blast in a pool throws the pool', () => {
  it('launches every displaced water cell as a depositing spray instead of unmaking it', () => {
    mockRandom().mockReturnValue(0); // the fire / smoke rolls would claim every cell
    const world = new World(80, 60);
    let water = 0;
    for (let y = 30; y <= 45; y++) {
      for (let x = 20; x <= 60; x++) {
        set(world, x, y, Cell.Water);
        water++;
      }
    }
    const ctx = makeCtx(world);

    new Explosions(ctx).trigger(40, 30, 6);

    let left = 0, fire = 0;
    for (let i = 0; i < world.types.length; i++) {
      if (world.types[i] === Cell.Water) left++;
      // (the air above the pool still catches: only the pool's own rows count)
      if (Math.floor(i / world.width) >= 30 && (world.types[i] === Cell.Fire || world.types[i] === Cell.Smoke)) fire++;
    }
    const spawn = ctx.particles.spawn as unknown as ReturnType<typeof vi.fn>;
    const thrown = spawn.mock.calls.filter((c) => c[4] === Cell.Water && (c[7] as { deposit?: boolean } | undefined)?.deposit === true).length;
    expect(water - left).toBeGreaterThan(20); // the blast really displaced the surface
    expect(thrown).toBe(water - left); // ...and every displaced cell is in the air, coming back down
    expect(fire).toBe(0); // no water turned to flame or smoke
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createGameParams } from '@/config/params';
import type { Ctx } from '@/core/types';
import { Cell, isConductor, isLiquid, isSolid } from '@/sim/CellType';
import { World } from '@/sim/World';
import { handleBrine } from '@/sim/elements/brine';
import { handleNitrogen } from '@/sim/elements/liquids';
import { handleFire } from '@/sim/elements/thermal';
import { createDefaultStatus, sampleAndTickStatus } from '@/entities/status';
import { mockRandom } from './helpers/randomSeam';

/**
 * BRINE (cell 42): the Cold Store's coolant. It refuses to freeze, it eats
 * ice, it sinks under fresh water, it conducts and boils, and wading in it
 * chills (and, for the alchemist, bites). MIRROR (cell 43) is a static solid.
 */

function ctxFor(world: World): Ctx {
  return {
    world,
    params: createGameParams(),
    particles: { list: [], spawn: vi.fn(), burst: vi.fn() },
    audio: new Proxy({}, { get: () => () => undefined }),
    lightning: { spark: vi.fn() },
    state: { frameCount: 0 },
  } as unknown as Ctx;
}

describe('brine', () => {
  it('is a conducting liquid; a mirror is a solid', () => {
    expect(isLiquid(Cell.Brine)).toBe(true);
    expect(isConductor(Cell.Brine)).toBe(true);
    expect(isSolid(Cell.Mirror)).toBe(true);
  });

  it('never freezes: nitrogen boils off it instead of making ice', () => {
    const world = new World(8, 8);
    const ctx = ctxFor(world);
    world.types[world.idx(3, 3)] = Cell.Brine;
    world.types[world.idx(3, 2)] = Cell.Nitrogen;
    for (let x = 0; x < 8; x++) world.types[world.idx(x, 4)] = Cell.Stone;
    mockRandom().mockReturnValue(0.99);
    // Nitrogen's own pass freezes FRESH water only.
    handleNitrogen(ctx, 3, 2);
    expect(world.types[world.idx(3, 3)]).toBe(Cell.Brine);
    // The brine's pass boils the nitrogen off.
    world.types[world.idx(3, 2)] = Cell.Nitrogen;
    handleBrine(ctx, 3, 3);
    expect(world.types[world.idx(3, 3)]).toBe(Cell.Brine);
    expect(world.types[world.idx(3, 2)]).toBe(Cell.Smoke);
  });

  it('eats the ice it touches back to water', () => {
    const world = new World(8, 8);
    const ctx = ctxFor(world);
    for (let x = 0; x < 8; x++) world.types[world.idx(x, 4)] = Cell.Stone;
    world.types[world.idx(3, 3)] = Cell.Brine;
    world.types[world.idx(4, 3)] = Cell.Ice;
    world.types[world.idx(2, 3)] = Cell.Stone;
    mockRandom().mockReturnValue(0); // every contact roll lands
    handleBrine(ctx, 3, 3);
    expect(world.types[world.idx(4, 3)]).toBe(Cell.Water);
  });

  it('sinks through fresh water', () => {
    const world = new World(8, 8);
    const ctx = ctxFor(world);
    world.types[world.idx(3, 2)] = Cell.Brine;
    world.types[world.idx(3, 3)] = Cell.Water;
    mockRandom().mockReturnValue(0.1);
    handleBrine(ctx, 3, 2);
    expect(world.types[world.idx(3, 3)]).toBe(Cell.Brine);
    expect(world.types[world.idx(3, 2)]).toBe(Cell.Water);
  });

  it('boils under fire like water', () => {
    const world = new World(8, 8);
    const ctx = ctxFor(world);
    world.types[world.idx(3, 3)] = Cell.Fire;
    world.life[world.idx(3, 3)] = 30;
    world.types[world.idx(4, 3)] = Cell.Brine;
    mockRandom().mockReturnValue(0.99);
    handleFire(ctx, 3, 3);
    expect(world.types[world.idx(4, 3)]).toBe(Cell.Empty);
    expect(world.types[world.idx(3, 3)]).toBe(Cell.Steam);
  });

  it('chills whoever wades in it, and bites only the alchemist', () => {
    const world = new World(24, 32);
    const ctx = ctxFor(world);
    for (let y = 8; y < 30; y++) for (let x = 4; x < 20; x++) world.types[world.idx(x, y)] = Cell.Brine;
    const wader = { x: 12, y: 28, status: createDefaultStatus() };
    mockRandom().mockReturnValue(0.5);
    const creature = sampleAndTickStatus(ctx, wader, 4, 17, undefined, 2);
    expect(wader.status.frozen).toBeGreaterThan(0);
    expect(creature.frostbiteDamage).toBe(0);
    expect(creature.slowFactor).toBeLessThan(1);
    const alchemist = { x: 12, y: 28, status: createDefaultStatus() };
    const bitten = sampleAndTickStatus(ctx, alchemist, 4, 17, undefined, 2, { frostbiteScale: 1 });
    expect(bitten.frostbiteDamage).toBeGreaterThan(0);
    expect(bitten.damage).toBeGreaterThanOrEqual(bitten.frostbiteDamage);
    // A body immune to cold takes neither.
    const wisp = { x: 12, y: 28, status: createDefaultStatus() };
    const immune = sampleAndTickStatus(ctx, wisp, 4, 17, { frozen: true }, 2, { frostbiteScale: 1 });
    expect(wisp.status.frozen).toBe(0);
    expect(immune.frostbiteDamage).toBe(0);
  });
});

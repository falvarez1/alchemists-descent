import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGameParams } from '@/config/params';
import type { Ctx } from '@/core/types';
import { VineStrands } from '@/entities/VineStrands';
import { CELL_COUNT, Cell } from '@/sim/CellType';
import { Simulation } from '@/sim/Simulation';
import { World } from '@/sim/World';
import { handleNitrogen } from '@/sim/elements/liquids';
import { handleFungus, handleMoss } from '@/sim/elements/newMaterials';
import { handleSand } from '@/sim/elements/powders';
import { handleFire } from '@/sim/elements/thermal';
import { handleVines } from '@/sim/elements/vines';

function attachVineStrands(ctx: Ctx): Ctx {
  const events = (ctx.events ?? {}) as { on?: () => void };
  events.on ??= () => undefined;
  ctx.events = events as Ctx['events'];
  ctx.vineStrands = new VineStrands(ctx);
  return ctx;
}

function dirtyCell(world: World, i: number, type: Cell): void {
  world.types[i] = type;
  world.colors[i] = 0x112233;
  world.life[i] = 47;
  world.setChargeAt(i, 9);
  world.colorOverrides.add(i);
}

function expectNoTransientMetadata(world: World, i: number): void {
  expect(world.charge[i]).toBe(0);
  expect(world.activeCharges.has(i)).toBe(false);
  expect(world.colorOverrides.has(i)).toBe(false);
}

describe('cell ABI contracts', () => {
  it('keeps material ids append-only and stable for saves and GPU packing', () => {
    expect(Cell).toEqual({
      Empty: 0,
      Sand: 1,
      Water: 2,
      Wall: 3,
      Wood: 4,
      Fire: 5,
      Oil: 6,
      Acid: 7,
      Gunpowder: 8,
      Steam: 9,
      Ice: 10,
      Lava: 11,
      Stone: 12,
      Metal: 13,
      Smoke: 14,
      Vines: 15,
      Nitrogen: 16,
      Gold: 17,
      Blood: 18,
      Slime: 19,
      Ember: 20,
      ElixirLife: 21,
      ElixirLevity: 22,
      ElixirStone: 23,
      Toxic: 24,
      Healium: 25,
      Teleportium: 26,
      Snow: 27,
      Coal: 28,
      Crystal: 29,
      Fungus: 30,
      Glass: 31,
      Ash: 32,
      Glowshroom: 33,
      Moss: 34,
      Catalyst: 35,
      RawOre: 36,
    });
    expect(CELL_COUNT).toBe(37);
    expect(Math.max(...Object.values(Cell))).toBeLessThan(128);
  });
});

describe('World.swap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('swaps full cell state and marks both cells moved in the current tick', () => {
    const world = new World(4, 4);
    const a = world.idx(1, 1);
    const b = world.idx(2, 2);
    world.types[a] = Cell.Water;
    world.colors[a] = 0x123456;
    world.life[a] = 7;
    world.charge[a] = 3;
    world.types[b] = Cell.Fire;
    world.colors[b] = 0xff6600;
    world.life[b] = 11;
    world.charge[b] = 5;
    world.movedTick = 42;

    world.swap(1, 1, 2, 2);

    expect(world.types[a]).toBe(Cell.Fire);
    expect(world.colors[a]).toBe(0xff6600);
    expect(world.life[a]).toBe(11);
    expect(world.charge[a]).toBe(5);
    expect(world.types[b]).toBe(Cell.Water);
    expect(world.colors[b]).toBe(0x123456);
    expect(world.life[b]).toBe(7);
    expect(world.charge[b]).toBe(3);
    expect(world.moved[a]).toBe(42);
    expect(world.moved[b]).toBe(42);
  });

  it('moves sparse color override membership with swapped cells', () => {
    const world = new World(4, 4);
    const a = world.idx(1, 1);
    const b = world.idx(2, 2);
    world.types[a] = Cell.Wood;
    world.colors[a] = 0xaa0000;
    world.types[b] = Cell.Empty;
    world.colors[b] = 0;
    world.colorOverrides.add(a);

    world.swap(1, 1, 2, 2);

    expect(world.colorOverrides.has(a)).toBe(false);
    expect(world.colorOverrides.has(b)).toBe(true);
    world.clearCellAt(b);
    expect(world.colorOverrides.has(b)).toBe(false);
  });

  it('stamps moss and fungus child growth as moved in the current sim tick', () => {
    const world = new World(8, 8);
    world.movedTick = 17;
    const ctx = { world, params: createGameParams() } as unknown as Ctx;

    world.types[world.idx(3, 3)] = Cell.Moss;
    world.life[world.idx(3, 3)] = 10;
    world.types[world.idx(4, 4)] = Cell.Water;
    world.types[world.idx(5, 3)] = Cell.Stone;
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0) // spread
      .mockReturnValueOnce(0.6) // damp sample x
      .mockReturnValueOnce(0.6) // damp sample y
      .mockReturnValueOnce(0) // +x direction
      .mockReturnValueOnce(0); // child life jitter

    handleMoss(ctx, 3, 3);

    const mossChild = world.idx(4, 3);
    expect(world.types[mossChild]).toBe(Cell.Moss);
    expect(world.moved[mossChild]).toBe(17);

    vi.restoreAllMocks();
    world.clear();
    world.movedTick = 18;
    world.types[world.idx(3, 3)] = Cell.Fungus;
    world.life[world.idx(3, 3)] = 12;
    world.types[world.idx(5, 3)] = Cell.Stone;
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0) // spread
      .mockReturnValueOnce(0) // +x direction
      .mockReturnValueOnce(0); // child life jitter

    handleFungus(ctx, 3, 3);

    const fungusChild = world.idx(4, 3);
    expect(world.types[fungusChild]).toBe(Cell.Fungus);
    expect(world.moved[fungusChild]).toBe(18);
  });

  it('converts detached vine clusters into soft strands', () => {
    const world = new World(8, 8);
    world.movedTick = 23;
    const ctx = attachVineStrands({ world, events: { on: () => undefined } } as unknown as Ctx);
    const top = world.idx(3, 2);
    const lower = world.idx(3, 3);
    const branch = world.idx(4, 3);
    world.types[top] = Cell.Vines;
    world.colors[top] = 0x115522;
    world.life[top] = 5;
    world.types[lower] = Cell.Vines;
    world.colors[lower] = 0x227733;
    world.life[lower] = -1;
    world.types[branch] = Cell.Vines;
    world.colors[branch] = 0x339944;
    world.life[branch] = 12;

    handleVines(ctx, 3, 2);

    expect(world.types[top]).toBe(Cell.Empty);
    expect(world.types[lower]).toBe(Cell.Empty);
    expect(world.types[branch]).toBe(Cell.Empty);
    expect(ctx.vineStrands.strands).toHaveLength(1);
    expect(ctx.vineStrands.strands[0].nodes).toHaveLength(3);
    expect(ctx.vineStrands.strands[0].segments).toHaveLength(2);
    expect(ctx.vineStrands.strands[0].color).toBe(0x227733);
  });

  it('keeps vine clusters attached to load-bearing terrain anchored', () => {
    const world = new World(8, 8);
    world.movedTick = 24;
    const ctx = attachVineStrands({ world, events: { on: () => undefined } } as unknown as Ctx);
    world.types[world.idx(3, 1)] = Cell.Stone;
    world.types[world.idx(3, 2)] = Cell.Vines;
    world.life[world.idx(3, 2)] = -1;
    world.types[world.idx(3, 3)] = Cell.Vines;
    world.life[world.idx(3, 3)] = -1;

    handleVines(ctx, 3, 2);
    handleVines(ctx, 3, 3);

    expect(world.types[world.idx(3, 2)]).toBe(Cell.Vines);
    expect(world.types[world.idx(3, 3)]).toBe(Cell.Vines);
    expect(world.types[world.idx(3, 4)]).toBe(Cell.Empty);
    expect(ctx.vineStrands.strands).toHaveLength(0);
  });
});

describe('cell material conversions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears transient metadata when charged sand fuses into glass', () => {
    const world = new World(6, 6);
    const i = world.idx(2, 2);
    dirtyCell(world, i, Cell.Sand);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    handleSand({ world, params: createGameParams() } as unknown as Ctx, 2, 2, Cell.Sand);

    expect(world.types[i]).toBe(Cell.Glass);
    expect(world.life[i]).toBe(0);
    expectNoTransientMetadata(world, i);
  });

  it('clears transient metadata when nitrogen freezes or boils neighboring cells', () => {
    const world = new World(6, 6);
    const source = world.idx(2, 2);
    const target = world.idx(3, 2);
    dirtyCell(world, source, Cell.Nitrogen);
    dirtyCell(world, target, Cell.Water);

    handleNitrogen({ world, params: createGameParams() } as unknown as Ctx, 2, 2);

    expect(world.types[target]).toBe(Cell.Ice);
    expect(world.life[target]).toBe(0);
    expectNoTransientMetadata(world, target);
    expect(world.types[source]).toBe(Cell.Smoke);
    expect(world.life[source]).toBe(20);
    expectNoTransientMetadata(world, source);
  });

  it('clears transient metadata when fire burns out to empty space', () => {
    const world = new World(6, 6);
    const i = world.idx(2, 2);
    dirtyCell(world, i, Cell.Fire);
    world.life[i] = 1;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    handleFire({ world, params: createGameParams() } as unknown as Ctx, 2, 2);

    expect(world.types[i]).toBe(Cell.Empty);
    expect(world.life[i]).toBe(0);
    expectNoTransientMetadata(world, i);
  });
});

describe('VineStrands', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bends detached vines under impulse and settles them back into the grid', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const world = new World(12, 12);
    for (let x = 0; x < world.width; x++) world.types[world.idx(x, 7)] = Cell.Stone;
    world.types[world.idx(5, 3)] = Cell.Vines;
    world.colors[world.idx(5, 3)] = 0x227733;
    world.life[world.idx(5, 3)] = -1;
    world.types[world.idx(5, 4)] = Cell.Vines;
    world.colors[world.idx(5, 4)] = 0x227733;
    world.life[world.idx(5, 4)] = -1;
    const ctx = attachVineStrands({
      world,
      events: { on: () => undefined },
      state: { mode: 'build' },
      player: { x: 0, y: 0, dead: true },
    } as unknown as Ctx);

    expect(ctx.vineStrands.detachCluster(5, 3)).toBe(true);
    const strand = ctx.vineStrands.strands[0];
    ctx.vineStrands.applyRadialImpulse(3, 3, 8, 1.2);
    for (let i = 0; i < 24; i++) ctx.vineStrands.update(ctx);

    const xs = strand.nodes.map((node) => node.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.05);

    for (let i = 0; i < 260 && ctx.vineStrands.strands.length > 0; i++) {
      ctx.vineStrands.update(ctx);
    }

    expect(ctx.vineStrands.strands).toHaveLength(0);
    let settled = 0;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (world.types[world.idx(x, y)] === Cell.Vines) settled++;
      }
    }
    expect(settled).toBeGreaterThan(0);
  });

  it('lets the player brush detached vines into visible motion', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const world = new World(12, 12);
    world.types[world.idx(6, 3)] = Cell.Vines;
    world.colors[world.idx(6, 3)] = 0x227733;
    world.life[world.idx(6, 3)] = -1;
    world.types[world.idx(6, 4)] = Cell.Vines;
    world.colors[world.idx(6, 4)] = 0x227733;
    world.life[world.idx(6, 4)] = -1;
    const ctx = attachVineStrands({
      world,
      events: { on: () => undefined },
      state: { mode: 'play' },
      player: { x: 4.5, y: 11.5, dead: false },
    } as unknown as Ctx);

    expect(ctx.vineStrands.detachCluster(6, 3)).toBe(true);
    const strand = ctx.vineStrands.strands[0];
    const beforeCenter = strand.nodes.reduce((sum, node) => sum + node.x, 0) / strand.nodes.length;

    ctx.vineStrands.update(ctx);

    const afterCenter = strand.nodes.reduce((sum, node) => sum + node.x, 0) / strand.nodes.length;
    const maxVelocity = Math.max(...strand.nodes.map((node) => Math.abs(node.x - node.px)));
    expect(afterCenter - beforeCenter).toBeGreaterThan(0.1);
    expect(maxVelocity).toBeGreaterThan(0.1);
  });
});

describe('Simulation moved epoch', () => {
  it('increments the moved epoch before pre-sweep systems can swap cells', () => {
    const world = new World(8, 8);
    world.simBounds.x1 = 0;
    world.simBounds.y1 = 0;
    world.movedTick = 7;
    world.types[world.idx(2, 2)] = Cell.Gold;
    const ctx = {
      world,
      state: { mode: 'build', score: 0 },
      input: { mouse: { x: 0, y: 0 } },
      params: createGameParams(),
      events: { emit: () => undefined },
      projectileCtl: { update: () => undefined },
      shockwaves: [],
    } as unknown as Ctx;

    new Simulation().processFrame(ctx);

    expect(world.movedTick).toBe(8);
    expect(world.types[world.idx(1, 1)]).toBe(Cell.Gold);
    expect(world.moved[world.idx(1, 1)]).toBe(8);
    expect(world.moved[world.idx(2, 2)]).toBe(8);
  });

  it('drops unsupported vine clusters during the sparse simulation pass', () => {
    const world = new World(8, 8);
    world.movedTick = 30;
    world.types[world.idx(3, 2)] = Cell.Vines;
    world.life[world.idx(3, 2)] = -1;
    world.types[world.idx(3, 3)] = Cell.Vines;
    world.life[world.idx(3, 3)] = -1;
    const ctx = {
      world,
      state: { mode: 'build', score: 0 },
      input: { mouse: { x: 0, y: 0 } },
      params: createGameParams(),
      events: { emit: () => undefined },
      projectileCtl: { update: () => undefined },
      shockwaves: [],
    } as unknown as Ctx;
    attachVineStrands(ctx);

    new Simulation().processFrame(ctx);

    expect(world.types[world.idx(3, 2)]).toBe(Cell.Empty);
    expect(world.types[world.idx(3, 3)]).toBe(Cell.Empty);
    expect(ctx.vineStrands.strands).toHaveLength(1);
    expect(ctx.vineStrands.strands[0].nodes).toHaveLength(2);
  });
});

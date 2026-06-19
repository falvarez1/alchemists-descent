import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '@/core/types';
import { Brewing } from '@/game/Brewing';
import { resetGrimoireCacheForTests } from '@/game/GrimoireStore';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';

const CAULDRON = { x: 40, y: 40 };
const BASIN: Array<[number, number]> = [];
for (let dy = -2; dy <= 0; dy++) {
  for (let dx = -3; dx <= 3; dx++) BASIN.push([CAULDRON.x + dx, CAULDRON.y + dy]);
}

function makeCtx(world: World, levelId = 'd1'): Ctx {
  return {
    world,
    state: { mode: 'play', frameCount: 0, score: 0 },
    levels: { current: { def: { id: levelId }, cauldron: CAULDRON } },
    particles: {
      spawn: () => undefined,
      burst: () => undefined,
    },
    audio: {
      bubble: () => undefined,
      tone: () => undefined,
    },
    events: { emit: () => undefined },
    telemetry: { count: () => undefined },
  } as unknown as Ctx;
}

function setBasin(world: World, cells: Cell[]): void {
  for (const [index, [x, y]] of BASIN.entries()) {
    const i = world.idx(x, y);
    world.types[i] = cells[index] ?? Cell.Empty;
    world.life[i] = 0;
    world.charge[i] = 0;
  }
  world.types[world.idx(CAULDRON.x, CAULDRON.y + 4)] = Cell.Fire;
}

function advance(ctx: Ctx, brewing: Brewing, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    ctx.state.frameCount += 4;
    brewing.update(ctx);
  }
}

function basinCount(world: World, cell: Cell): number {
  let count = 0;
  for (const [x, y] of BASIN) {
    if (world.types[world.idx(x, y)] === cell) count++;
  }
  return count;
}

describe('brewing progress', () => {
  beforeEach(() => {
    resetGrimoireCacheForTests();
  });

  afterEach(() => {
    resetGrimoireCacheForTests();
    vi.unstubAllGlobals();
  });

  it('does not carry partial progress into a different recipe', () => {
    const brewing = new Brewing();
    const world = new World();
    const ctx = makeCtx(world);

    setBasin(world, [
      ...Array<Cell>(10).fill(Cell.Water),
      ...Array<Cell>(3).fill(Cell.Gold),
    ]);
    advance(ctx, brewing, 89);
    expect(basinCount(world, Cell.ElixirLife)).toBe(0);

    setBasin(world, [
      ...Array<Cell>(9).fill(Cell.Water),
      ...Array<Cell>(4).fill(Cell.Slime),
    ]);
    advance(ctx, brewing, 1);
    expect(basinCount(world, Cell.ElixirLevity)).toBe(0);

    advance(ctx, brewing, 89);
    expect(basinCount(world, Cell.ElixirLevity)).toBeGreaterThan(0);
  });

  it('does not carry partial progress across levels', () => {
    const brewing = new Brewing();
    const world = new World();
    const ctx = makeCtx(world, 'd1');

    setBasin(world, [
      ...Array<Cell>(10).fill(Cell.Water),
      ...Array<Cell>(3).fill(Cell.Gold),
    ]);
    advance(ctx, brewing, 89);
    expect(basinCount(world, Cell.ElixirLife)).toBe(0);

    (ctx.levels.current as { def: { id: string } }).def.id = 'd2';
    advance(ctx, brewing, 1);
    expect(basinCount(world, Cell.ElixirLife)).toBe(0);
  });

  it('emits recipeBrewed for known recipes without paying discovery bounty again', () => {
    const storage = new Map<string, string>([['noita-grimoire', JSON.stringify({ life: true })]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const brewing = new Brewing();
    const world = new World();
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const ctx = {
      ...makeCtx(world),
      events: {
        emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
      },
    } as unknown as Ctx;

    setBasin(world, [
      ...Array<Cell>(10).fill(Cell.Water),
      ...Array<Cell>(3).fill(Cell.Gold),
    ]);
    advance(ctx, brewing, 90);

    expect(ctx.state.score).toBe(0);
    expect(emitted.some((entry) => entry.event === 'recipeDiscovered')).toBe(false);
    expect(emitted).toContainEqual({
      event: 'recipeBrewed',
      payload: { id: 'life', name: 'ELIXIR OF LIFE', firstDiscovery: false },
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ctx } from '@/core/types';
import {
  GRIMOIRE_KEY,
  LEGACY_LORE_KEY,
  loadDiscoveredMaterials,
  loadDiscoveredRecipes,
  loadGrimoireRecord,
  recordInteractionDiscovery,
  recordMaterialDiscovery,
  recordRecipeDiscovery,
  resetGrimoireCacheForTests,
} from '@/game/GrimoireStore';
import { GrimoireInteractionObserver, scanGrimoireInteractions } from '@/game/GrimoireInteractions';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

function ctxStub(emit = vi.fn()): Ctx {
  return { events: { emit } } as unknown as Ctx;
}

function interactionCtx(world: World, emit = vi.fn()): Ctx {
  return {
    world,
    events: { emit },
    state: { mode: 'play', paused: false, frameCount: 12 },
    player: { x: 50, y: 56 },
  } as unknown as Ctx;
}

function setCell(world: World, x: number, y: number, type: Cell, charge = 0): void {
  const i = world.idx(x, y);
  world.types[i] = type;
  if (charge > 0) world.setChargeAt(i, charge);
}

describe('GrimoireStore', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    resetGrimoireCacheForTests();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });

  afterEach(() => {
    resetGrimoireCacheForTests();
    vi.unstubAllGlobals();
  });

  it('migrates legacy flat recipe saves into a versioned unified record', () => {
    storage.set(GRIMOIRE_KEY, JSON.stringify({ life: true, stone: false }));

    expect(loadDiscoveredRecipes()).toEqual({ life: true });
    expect(JSON.parse(storage.get(GRIMOIRE_KEY) ?? '{}')).toMatchObject({
      version: 2,
      recipes: { life: true },
      materials: {},
      interactions: {},
    });
  });

  it('merges legacy material lore for one release', () => {
    storage.set(GRIMOIRE_KEY, JSON.stringify({ version: 2, recipes: { life: true }, materials: {}, interactions: {} }));
    storage.set(LEGACY_LORE_KEY, JSON.stringify({ [Cell.Water]: true }));

    expect(loadDiscoveredMaterials()).toEqual({ [Cell.Water]: true });
    expect(JSON.parse(storage.get(GRIMOIRE_KEY) ?? '{}')).toMatchObject({
      version: 2,
      recipes: { life: true },
      materials: { [Cell.Water]: true },
    });
  });

  it('treats bad JSON as an empty versioned record', () => {
    storage.set(GRIMOIRE_KEY, '{bad');

    expect(loadGrimoireRecord()).toEqual({ version: 2, recipes: {}, materials: {}, interactions: {} });
  });

  it('survives storage read/write failures with session cache', () => {
    const emit = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    resetGrimoireCacheForTests();

    expect(recordMaterialDiscovery(ctxStub(emit), String(Cell.Lava), 'Lava')).toBe(true);
    expect(loadDiscoveredMaterials()).toEqual({ [Cell.Lava]: true });
    expect(emit).toHaveBeenCalledWith('grimoireEntryDiscovered', { kind: 'material', id: String(Cell.Lava), title: 'Lava' });
  });

  it('emits first-discovery events once per recipe, material, and interaction', () => {
    const emit = vi.fn();
    const ctx = ctxStub(emit);

    expect(recordRecipeDiscovery(ctx, 'life', 'ELIXIR OF LIFE')).toBe(true);
    expect(recordRecipeDiscovery(ctx, 'life', 'ELIXIR OF LIFE')).toBe(false);
    expect(recordMaterialDiscovery(ctx, String(Cell.Water), 'Water')).toBe(true);
    expect(recordMaterialDiscovery(ctx, String(Cell.Water), 'Water')).toBe(false);
    expect(recordInteractionDiscovery(ctx, 'lava-water', 'Lava Meets Water')).toBe(true);
    expect(recordInteractionDiscovery(ctx, 'lava-water', 'Lava Meets Water')).toBe(false);

    expect(emit.mock.calls).toEqual([
      ['grimoireEntryDiscovered', { kind: 'recipe', id: 'life', title: 'ELIXIR OF LIFE' }],
      ['grimoireEntryDiscovered', { kind: 'material', id: String(Cell.Water), title: 'Water' }],
      ['grimoireEntryDiscovered', { kind: 'interaction', id: 'lava-water', title: 'Lava Meets Water' }],
    ]);
  });

  it('scans the planned near-player material interactions without touching distant cells', () => {
    const world = new World(120, 120);
    const ctx = interactionCtx(world);

    setCell(world, 1, 1, Cell.Water);
    setCell(world, 2, 1, Cell.Fire);
    setCell(world, 40, 40, Cell.Water);
    setCell(world, 41, 40, Cell.Fire);
    setCell(world, 45, 40, Cell.Lava);
    setCell(world, 46, 40, Cell.Water);
    setCell(world, 50, 40, Cell.Nitrogen);
    setCell(world, 51, 40, Cell.Water);
    setCell(world, 55, 40, Cell.Metal, 12);
    setCell(world, 56, 40, Cell.Water);
    setCell(world, 60, 40, Cell.Acid);
    setCell(world, 61, 40, Cell.Stone);
    setCell(world, 62, 40, Cell.Water);

    expect(scanGrimoireInteractions(ctx).map((match) => match.id).sort()).toEqual([
      'acid-water-transmutation',
      'charge-conductors',
      'lava-flashes-water',
      'nitrogen-freezes-water',
      'water-quench-fire',
    ]);
  });

  it('records one witnessed interaction once through the observer', () => {
    const emit = vi.fn();
    const world = new World(120, 120);
    const ctx = interactionCtx(world, emit);
    setCell(world, 50, 50, Cell.Lava);
    setCell(world, 51, 50, Cell.Water);
    const observer = new GrimoireInteractionObserver();

    observer.update(ctx);
    ctx.state.frameCount += 12;
    observer.update(ctx);

    expect(loadGrimoireRecord().interactions).toEqual({ 'lava-flashes-water': true });
    expect(emit.mock.calls).toContainEqual([
      'grimoireEntryDiscovered',
      { kind: 'interaction', id: 'lava-flashes-water', title: 'Lava Flashes Water' },
    ]);
    expect(emit.mock.calls).toContainEqual([
      'worldInteractionObserved',
      { id: 'lava-flashes-water', title: 'Lava Flashes Water', x: 50, y: 50 },
    ]);
    expect(emit.mock.calls.filter(([event]) => event === 'worldInteractionObserved')).toHaveLength(1);
  });
});

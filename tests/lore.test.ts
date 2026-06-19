import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ctx } from '@/core/types';
import { GRIMOIRE_KEY, LEGACY_LORE_KEY, resetGrimoireCacheForTests } from '@/game/GrimoireStore';
import { discoveredLore, MATERIAL_LORE, recordLore } from '@/game/lore';
import { Cell } from '@/sim/CellType';

function ctxStub(emit: (ev: string, payload: unknown) => void): Ctx {
  return { events: { emit } } as unknown as Ctx;
}

describe('material lore discovery', () => {
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

  it('records a cataloged material once and toasts only on the first examine', () => {
    const emit = vi.fn();
    const ctx = ctxStub(emit);

    const first = recordLore(ctx, Cell.Water);
    expect(first?.title).toBe('Water');
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith('grimoireEntryDiscovered', { kind: 'material', id: String(Cell.Water), title: 'Water' });
    expect(emit).toHaveBeenCalledWith('toast', { text: 'Grimoire — learned of Water' });

    // Re-examining the same material is a no-op: no re-discovery, no second toast.
    expect(recordLore(ctx, Cell.Water)).toBeNull();
    expect(emit).toHaveBeenCalledTimes(2);

    expect(discoveredLore()[Cell.Water]).toBe(true);
    expect(JSON.parse(storage.get(GRIMOIRE_KEY) ?? '{}')).toMatchObject({
      version: 2,
      materials: { [Cell.Water]: true },
    });
  });

  it('ignores uncataloged materials (no entry, no toast)', () => {
    const emit = vi.fn();
    expect(recordLore(ctxStub(emit), Cell.Wall)).toBeNull();
    expect(emit).not.toHaveBeenCalled();
    expect(MATERIAL_LORE[Cell.Wall]).toBeUndefined();
  });

  it('migrates legacy lore entries into the unified grimoire store', () => {
    storage.set(LEGACY_LORE_KEY, JSON.stringify({ [Cell.Lava]: true }));
    resetGrimoireCacheForTests();

    expect(discoveredLore()[Cell.Lava]).toBe(true);
    expect(JSON.parse(storage.get(GRIMOIRE_KEY) ?? '{}')).toMatchObject({
      version: 2,
      materials: { [Cell.Lava]: true },
    });
  });
});

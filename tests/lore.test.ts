import { describe, expect, it, vi } from 'vitest';

import type { Ctx } from '@/core/types';
import { discoveredLore, MATERIAL_LORE, recordLore } from '@/game/lore';
import { Cell } from '@/sim/CellType';

function ctxStub(emit: (ev: string, payload: unknown) => void): Ctx {
  return { events: { emit } } as unknown as Ctx;
}

describe('material lore discovery', () => {
  it('records a cataloged material once and toasts only on the first examine', () => {
    const emit = vi.fn();
    const ctx = ctxStub(emit);

    const first = recordLore(ctx, Cell.Water);
    expect(first?.title).toBe('Water');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('toast', { text: 'Grimoire — learned of Water' });

    // Re-examining the same material is a no-op: no re-discovery, no second toast.
    expect(recordLore(ctx, Cell.Water)).toBeNull();
    expect(emit).toHaveBeenCalledTimes(1);

    expect(discoveredLore()[Cell.Water]).toBe(true);
  });

  it('ignores uncataloged materials (no entry, no toast)', () => {
    const emit = vi.fn();
    expect(recordLore(ctxStub(emit), Cell.Wall)).toBeNull();
    expect(emit).not.toHaveBeenCalled();
    expect(MATERIAL_LORE[Cell.Wall]).toBeUndefined();
  });
});

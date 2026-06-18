import { afterEach, describe, expect, it, vi } from 'vitest';

import { rleEncode } from '@/core/rle';
import type { Ctx } from '@/core/types';
import { LevelStore } from '@/ui/LevelStore';
import { CELL_COUNT, Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

interface LevelStorePrivate {
  applySave(save: unknown): boolean;
}

function withDomStorage<T>(run: () => T): T {
  vi.stubGlobal('document', { getElementById: () => null });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  return run();
}

function makeCtx(world: World): Ctx {
  return {
    world,
    enemies: [],
    levels: { current: null },
    state: { currentBiome: 'earthen' },
    events: { emit: () => false },
  } as unknown as Ctx;
}

function snapshotCell(world: World, i: number): {
  type: number;
  color: number;
  life: number;
  charge: number;
  active: boolean;
} {
  return {
    type: world.types[i],
    color: world.colors[i],
    life: world.life[i],
    charge: world.charge[i],
    active: world.activeCharges.has(i),
  };
}

describe('LevelStore sandbox load validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not clear the active world when imported RLE is malformed', () => {
    withDomStorage(() => {
      const world = new World(4, 4);
      const i = world.idx(1, 1);
      world.replaceCellAt(i, Cell.Stone, 0x556677);
      world.life[i] = 42;
      world.setChargeAt(i, 9);
      const before = snapshotCell(world, i);
      const store = new LevelStore(makeCtx(world)) as unknown as LevelStorePrivate;

      expect(store.applySave({ v: 1, w: 4, h: 4, biome: 'earthen', rle: 'not base64', life: [], charge: [] }))
        .toBe(false);

      expect(snapshotCell(world, i)).toEqual(before);
    });
  });

  it('does not apply short streams, invalid material ids, or out-of-range sparse channels', () => {
    withDomStorage(() => {
      const world = new World(4, 4);
      const i = world.idx(2, 2);
      world.replaceCellAt(i, Cell.Wood, 0x221100);
      world.life[i] = 7;
      const before = snapshotCell(world, i);
      const store = new LevelStore(makeCtx(world)) as unknown as LevelStorePrivate;
      const shortRle = rleEncode(new Uint8Array(world.types.length - 1));
      const badTypes = new Uint8Array(world.types.length);
      badTypes[0] = CELL_COUNT;
      const goodRle = rleEncode(new Uint8Array(world.types.length));

      expect(store.applySave({ v: 1, w: 4, h: 4, biome: 'earthen', rle: shortRle, life: [], charge: [] }))
        .toBe(false);
      expect(store.applySave({ v: 1, w: 4, h: 4, biome: 'earthen', rle: rleEncode(badTypes), life: [], charge: [] }))
        .toBe(false);
      expect(store.applySave({ v: 1, w: 4, h: 4, biome: 'earthen', rle: goodRle, life: [[999, 1]], charge: [] }))
        .toBe(false);
      expect(store.applySave({ v: 1, w: 4, h: 4, biome: 'earthen', rle: goodRle, life: [], charge: [[0, 300]] }))
        .toBe(false);

      expect(snapshotCell(world, i)).toEqual(before);
    });
  });
});

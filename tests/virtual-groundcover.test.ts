import { describe, expect, it } from 'vitest';

import { blocksEntity, Cell, isSoftGrowth } from '@/sim/CellType';
import { generateVirtualChunk } from '@/world/virtual/ChunkGenerator';
import { biomeIndexFromId, createDefaultVirtualWorldDef } from '@/world/virtual/defaults';

/**
 * Locks the chunked-gen port of world/surfaceDress.plantGroundCover: living,
 * walk-through grass blades + sparse glowshroom/fungus tufts stood up on verdant
 * (moss-crown) chunk surfaces, deterministically so the World Map caches + tiles
 * without seams. Mirrors the legacy ground-cover the bare-cave generator plants.
 */

function forceBiome(seed: number, id: 'earthen' | 'frozen'): ReturnType<typeof createDefaultVirtualWorldDef> {
  const def = createDefaultVirtualWorldDef(seed);
  (def.map.cells as { fill(v: number): unknown }).fill(biomeIndexFromId(id));
  return def;
}

function countCover(def: ReturnType<typeof createDefaultVirtualWorldDef>, n: number): { grass: number; shroom: number } {
  let grass = 0;
  let shroom = 0;
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const chunk = generateVirtualChunk(def, cx, cy);
      for (let i = 0; i < chunk.types.length; i++) {
        const t = chunk.types[i];
        if (t === Cell.Grass) grass++;
        else if (t === Cell.Glowshroom || t === Cell.Fungus) shroom++;
      }
    }
  }
  return { grass, shroom };
}

describe('chunked ground cover', () => {
  it('plants walk-through grass + mushroom tufts on verdant chunks', () => {
    const { grass, shroom } = countCover(forceBiome(0x6a5511, 'earthen'), 3);
    expect(grass).toBeGreaterThan(0);
    expect(shroom).toBeGreaterThan(0);
    // the whole point: bodies pass straight through it
    expect(isSoftGrowth(Cell.Grass)).toBe(true);
    expect(blocksEntity(Cell.Grass)).toBe(false);
  });

  it('is deterministic per seed (chunks cache + tile seamlessly)', () => {
    const a = generateVirtualChunk(forceBiome(0x6a5511, 'earthen'), 1, 1);
    const b = generateVirtualChunk(forceBiome(0x6a5511, 'earthen'), 1, 1);
    expect(Array.from(a.types)).toEqual(Array.from(b.types));
  });

  it('non-verdant (frozen) biomes get no grass', () => {
    expect(countCover(forceBiome(0x6a5511, 'frozen'), 2).grass).toBe(0);
  });
});

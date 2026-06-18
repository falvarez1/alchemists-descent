import { describe, it, expect } from 'vitest';
import { Cell } from '@/sim/CellType';
import { generateVirtualChunk } from '@/world/virtual/ChunkGenerator';
import { createDefaultVirtualWorldDef } from '@/world/virtual/defaults';
import { makePreviewRgba } from '@/world/virtual/transfer';
import type { VirtualChunk } from '@/world/virtual/types';

function countCells(def: ReturnType<typeof createDefaultVirtualWorldDef>, pred: (t: number) => boolean): number {
  let n = 0;
  for (let cy = 0; cy < 3; cy++) {
    for (let cx = 0; cx < 3; cx++) {
      const chunk = generateVirtualChunk(def, cx, cy);
      for (let i = 0; i < chunk.types.length; i++) if (pred(chunk.types[i])) n++;
    }
  }
  return n;
}

describe('virtual chunk mineral vugs (hidden ore)', () => {
  it('places RawOre in enclosed pockets when enabled, and none when disabled', () => {
    const on = createDefaultVirtualWorldDef(0x4196e2);
    const off = createDefaultVirtualWorldDef(0x4196e2);
    off.generation.mineralVugs = false;
    const rawOn = countCells(on, (t) => t === Cell.RawOre);
    const rawOff = countCells(off, (t) => t === Cell.RawOre);
    // RawOre is placed ONLY by the vug pass, so it must appear with vugs on and
    // be entirely absent with vugs off.
    expect(rawOn).toBeGreaterThan(0);
    expect(rawOff).toBe(0);
  });

  it('vug fill only adds solid cells (never opens space)', () => {
    const on = createDefaultVirtualWorldDef(0x4196e2);
    const off = createDefaultVirtualWorldDef(0x4196e2);
    off.generation.mineralVugs = false;
    const solidOn = countCells(on, (t) => t !== Cell.Empty);
    const solidOff = countCells(off, (t) => t !== Cell.Empty);
    expect(solidOn).toBeGreaterThanOrEqual(solidOff);
  });
});

function chunkOf(types: number[], colors: number[]): VirtualChunk {
  const size = Math.sqrt(types.length);
  return {
    cx: 0, cy: 0, originX: 0, originY: 0, size,
    types: Uint8Array.from(types),
    colors: Uint32Array.from(colors),
    life: new Int16Array(types.length),
    charge: new Uint8Array(types.length),
    meta: { biome: 'earthen', tileIds: [], scenes: [], scenePlacements: [], hash: '', generatedMs: 0 },
  } as unknown as VirtualChunk;
}

describe('virtual preview emissive glow', () => {
  it('brightens emissive cell types over a non-emissive cell of the same base color', () => {
    // Two cells, identical base color; one Stone (inert), one Glowshroom (emissive).
    const base = 0x303030;
    const rgba = makePreviewRgba(chunkOf([Cell.Stone, Cell.Glowshroom, Cell.Stone, Cell.Stone], [base, base, base, base]));
    const lum = (i: number) => rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2];
    expect(lum(1)).toBeGreaterThan(lum(0)); // glowshroom reads brighter than stone
    // Green channel in particular pops for glowshroom.
    expect(rgba[1 * 4 + 1]).toBeGreaterThan(rgba[0 * 4 + 1]);
  });
});

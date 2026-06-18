import { describe, it, expect } from 'vitest';
import { Cell } from '@/sim/CellType';
import { generateVirtualChunk } from '@/world/virtual/ChunkGenerator';
import { createDefaultVirtualWorldDef } from '@/world/virtual/defaults';

// caveScale is GEN_TUNE's global cave-size knob, mirrored into the virtual def
// and normalized in ChunkGenerator (1.5 -> x1.0). It scales every carve family
// (organic pockets/cracks, spline/shaft/chamber tunnels), so a larger value must
// leave strictly more open (Empty) cells across a fixed window of chunks. This is
// the worker-free guarantee that the World Map's "Cave size" actually re-carves.
function openCells(caveScale: number): number {
  const def = createDefaultVirtualWorldDef(0x51a17e);
  def.generation.caveScale = caveScale;
  let open = 0;
  for (let cy = 0; cy < 3; cy++) {
    for (let cx = 0; cx < 3; cx++) {
      const chunk = generateVirtualChunk(def, cx, cy);
      for (let i = 0; i < chunk.types.length; i++) {
        if (chunk.types[i] === Cell.Empty) open++;
      }
    }
  }
  return open;
}

describe('virtual chunk caveScale', () => {
  it('larger cave size carves strictly more open space than smaller', () => {
    const tight = openCells(1.0);
    const neutral = openCells(1.5);
    const grand = openCells(2.0);
    expect(tight).toBeLessThan(neutral);
    expect(neutral).toBeLessThan(grand);
  });

  it('neutral (1.5) matches an undefined caveScale (the shipped default look)', () => {
    const def = createDefaultVirtualWorldDef(0x51a17e);
    delete (def.generation as { caveScale?: number }).caveScale;
    let open = 0;
    for (let cy = 0; cy < 3; cy++) {
      for (let cx = 0; cx < 3; cx++) {
        const chunk = generateVirtualChunk(def, cx, cy);
        for (let i = 0; i < chunk.types.length; i++) if (chunk.types[i] === Cell.Empty) open++;
      }
    }
    expect(open).toBe(openCells(1.5));
  });
});

import { describe, it, expect } from 'vitest';
import { Cell } from '@/sim/CellType';
import { generateVirtualChunk } from '@/world/virtual/ChunkGenerator';
import { createDefaultVirtualWorldDef } from '@/world/virtual/defaults';
import { polishCaveTerrain } from '@/world/terrainPolish';
import type { World } from '@/sim/World';

function solidCells(def: ReturnType<typeof createDefaultVirtualWorldDef>): number {
  let solid = 0;
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const chunk = generateVirtualChunk(def, cx, cy);
      for (let i = 0; i < chunk.types.length; i++) if (chunk.types[i] !== Cell.Empty) solid++;
    }
  }
  return solid;
}

describe('virtual chunk surface-pit / notch fill', () => {
  it('the sink/notch pass only ever adds solid cells (never removes)', () => {
    const off = createDefaultVirtualWorldDef(0x5e1f12);
    off.generation.fillSurfacePits = false;
    off.generation.notchPasses = 0;
    const on = createDefaultVirtualWorldDef(0x5e1f12);
    on.generation.fillSurfacePits = true; // defaults: width 6, depth 4, notch 2
    // Filling pits/notches can only convert Empty -> solid, so the polished pass
    // must have at least as many solid cells, and strictly more here (the organic
    // terrain always leaves some notches for the pass to close).
    const solidOff = solidCells(off);
    const solidOn = solidCells(on);
    expect(solidOn).toBeGreaterThan(solidOff);
  });

  it('normalize preserves fillSurfacePits=false (boolean not clobbered by the finite-check)', () => {
    const def = createDefaultVirtualWorldDef(0x5e1f12);
    def.generation.fillSurfacePits = false;
    generateVirtualChunk(def, 0, 0); // runs normalizeVirtualWorldDef internally
    expect(def.generation.fillSurfacePits).toBe(false);
  });

  it('reuses polishCaveTerrain on the chunked scratch adapter (raises a surface pit)', () => {
    // The exact adapter shape ChunkGenerator hands polishCaveTerrain: a flat
    // Uint8Array grid (width === height) with throwaway life/charge planes.
    const size = 40;
    const types = new Uint8Array(size * size);
    const colors = new Uint32Array(size * size);
    const idx = (x: number, y: number) => x + y * size;
    // Floor top at y=20 everywhere, except a 3-wide pit (cols 18..20) dipping to y=23.
    for (let x = 0; x < size; x++) {
      const floorTop = x >= 18 && x <= 20 ? 23 : 20;
      for (let y = floorTop; y < size; y++) {
        types[idx(x, y)] = Cell.Wall;
        colors[idx(x, y)] = 0x808080;
      }
    }
    const adapter = {
      types,
      colors,
      width: size,
      height: size,
      life: new Int16Array(size * size),
      charge: new Uint8Array(size * size),
    } as unknown as World;
    polishCaveTerrain(adapter, { seed: 1, minY: 0, floorBand: size - 1, surfacePits: true, maxPitWidth: 6, maxPitDepth: 4, notchPasses: 0 });
    // The pit floor is raised up to the shoulder level (y=20), and the walk surface
    // above it stays open.
    expect(types[idx(19, 22)]).not.toBe(Cell.Empty);
    expect(types[idx(19, 21)]).not.toBe(Cell.Empty);
    expect(types[idx(19, 20)]).not.toBe(Cell.Empty);
    expect(types[idx(19, 19)]).toBe(Cell.Empty);
  });
});

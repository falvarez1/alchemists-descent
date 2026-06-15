import { describe, expect, it } from 'vitest';

import { BIOMES } from '@/config/biomes';
import { Cell } from '@/sim/CellType';
import { biomeIndexFromId, createDefaultVirtualWorldDef, VIRTUAL_BIOME_IDS } from '@/world/virtual/defaults';
import { generateVirtualChunk, generateVirtualWindow } from '@/world/virtual/ChunkGenerator';
import { validateTileset } from '@/world/virtual/HerringboneTiles';
import { materializeChunks } from '@/world/virtual/WindowMaterializer';
import { fnv1aByteArrays } from '@/world/virtual/hash';
import { fromTransferableChunk, toTransferableChunk } from '@/world/virtual/transfer';

function allPlaneHash(chunk: ReturnType<typeof generateVirtualChunk>): string {
  return fnv1aByteArrays([
    chunk.types,
    new Uint8Array(chunk.colors.buffer),
    new Uint8Array(chunk.life.buffer),
    chunk.charge,
  ]);
}

function openCellCount(types: Uint8Array): number {
  let open = 0;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === Cell.Empty) open++;
  }
  return open;
}

function countMaterials(types: Uint8Array, materials: readonly number[]): number {
  const set = new Set(materials);
  let count = 0;
  for (let i = 0; i < types.length; i++) {
    if (set.has(types[i])) count++;
  }
  return count;
}

describe('virtual world prototype', () => {
  it('generates deterministic chunks by seed and coordinate', () => {
    const def = createDefaultVirtualWorldDef(1234);
    const a = generateVirtualChunk(def, 0, 0);
    const b = generateVirtualChunk(def, 0, 0);

    expect(allPlaneHash(b)).toBe(allPlaneHash(a));
    expect(b.meta.hash).toBe(a.meta.hash);
  });

  it('changes chunk output when the seed changes', () => {
    const a = generateVirtualChunk(createDefaultVirtualWorldDef(1234), 0, 0);
    const b = generateVirtualChunk(createDefaultVirtualWorldDef(5678), 0, 0);

    expect(allPlaneHash(b)).not.toBe(allPlaneHash(a));
  });

  it('changes chunk output when organic shaping changes', () => {
    const plain = createDefaultVirtualWorldDef(2468);
    plain.generation.edgeRoughness = 0;
    plain.generation.pocketDensity = 0;
    plain.generation.crackDensity = 0;
    plain.generation.shapeWarp = 0;
    plain.generation.cornerRounding = 0;
    plain.generation.organicSmoothingPasses = 0;
    const organic = createDefaultVirtualWorldDef(2468);

    expect(allPlaneHash(generateVirtualChunk(organic, 0, 0))).not.toBe(allPlaneHash(generateVirtualChunk(plain, 0, 0)));
  });

  it('has a virtual material palette for every campaign biome', () => {
    const def = createDefaultVirtualWorldDef(4321);

    expect(new Set(VIRTUAL_BIOME_IDS)).toEqual(new Set(Object.keys(BIOMES)));
    for (const biome of VIRTUAL_BIOME_IDS) {
      expect(def.materialProfile.palettes[biome]).toBeTruthy();
      expect(def.materialProfile.palettes[biome].wall).not.toBe(0);
    }
  });

  it('has virtual dressing recipes for every campaign biome', () => {
    const def = createDefaultVirtualWorldDef(4321);

    expect(new Set(Object.keys(def.dressing.biomes))).toEqual(new Set(VIRTUAL_BIOME_IDS));
    for (const biome of VIRTUAL_BIOME_IDS) {
      const recipe = def.dressing.biomes[biome];
      expect(recipe.ore).toBeGreaterThan(0);
      expect(recipe.glowDensity).toBeGreaterThanOrEqual(0);
    }
  });

  it('uses the virtual biome map to change generated profile chunks', () => {
    const earthen = createDefaultVirtualWorldDef(8642);
    earthen.map.cells.fill(biomeIndexFromId('earthen'));
    const volcanic = createDefaultVirtualWorldDef(8642);
    volcanic.map.cells.fill(biomeIndexFromId('volcanic'));

    const a = generateVirtualChunk(earthen, 0, 0);
    const b = generateVirtualChunk(volcanic, 0, 0);

    expect(a.meta.biome).toBe('earthen');
    expect(b.meta.biome).toBe('volcanic');
    expect(allPlaneHash(b)).not.toBe(allPlaneHash(a));
  });

  it('rounds cave silhouettes without collapsing open space', () => {
    const blocky = createDefaultVirtualWorldDef(13579);
    blocky.generation.baseCellSize = 3;
    blocky.generation.organicSmoothingPasses = 0;
    blocky.generation.cornerRounding = 0;
    blocky.generation.shapeWarp = 0.2;

    const rounded = createDefaultVirtualWorldDef(13579);
    rounded.generation.baseCellSize = 3;
    rounded.generation.organicSmoothingPasses = 0;
    rounded.generation.cornerRounding = 1;
    rounded.generation.shapeWarp = 0.2;

    const a = generateVirtualChunk(blocky, 0, 0);
    const b = generateVirtualChunk(rounded, 0, 0);
    const openDelta = Math.abs(openCellCount(a.types) - openCellCount(b.types)) / a.types.length;

    expect(allPlaneHash(b)).not.toBe(allPlaneHash(a));
    expect(openDelta).toBeLessThan(0.12);
  });

  it('applies tunable surface dressing to exposed terrain', () => {
    const bare = createDefaultVirtualWorldDef(97531);
    bare.generation.surfaceCover = 0;
    bare.generation.vegetationDensity = 0;
    const dressed = createDefaultVirtualWorldDef(97531);
    dressed.generation.surfaceCover = 1;
    dressed.generation.surfaceDepth = 3;
    dressed.generation.vegetationDensity = 1;

    const a = generateVirtualChunk(bare, 0, 4);
    const b = generateVirtualChunk(dressed, 0, 4);
    const surfaceCells = b.types.filter((type) => type === Cell.Moss || type === Cell.Fungus || type === Cell.Ice).length;

    expect(allPlaneHash(b)).not.toBe(allPlaneHash(a));
    expect(surfaceCells).toBeGreaterThan(80);
  });

  it('applies tunable rich biome dressing to chunks', () => {
    const bare = createDefaultVirtualWorldDef(97532);
    bare.map.cells.fill(biomeIndexFromId('earthen'));
    Object.assign(bare.dressing.controls, {
      detailDensity: 0,
      materialRichness: 0,
      liquidRichness: 0,
      glowDensity: 0,
      floorDebris: 0,
      hangingGrowth: 0,
    });

    const rich = createDefaultVirtualWorldDef(97532);
    rich.map.cells.fill(biomeIndexFromId('earthen'));
    Object.assign(rich.dressing.controls, {
      detailDensity: 2,
      materialRichness: 2,
      liquidRichness: 2,
      glowDensity: 2,
      floorDebris: 2,
      hangingGrowth: 2,
    });

    const a = generateVirtualChunk(bare, 0, 2);
    const b = generateVirtualChunk(rich, 0, 2);
    const richCells = countMaterials(b.types, [Cell.Gold, Cell.Coal, Cell.Glowshroom, Cell.Vines, Cell.Water]);

    expect(allPlaneHash(b)).not.toBe(allPlaneHash(a));
    expect(richCells).toBeGreaterThan(20);
  });

  it('uses biome-specific dressing recipes for material signatures', () => {
    const fungal = createDefaultVirtualWorldDef(86420);
    fungal.map.cells.fill(biomeIndexFromId('fungal'));
    const frozen = createDefaultVirtualWorldDef(86420);
    frozen.map.cells.fill(biomeIndexFromId('frozen'));

    const a = generateVirtualChunk(fungal, 0, 0);
    const b = generateVirtualChunk(frozen, 0, 0);
    const fungalSignature = countMaterials(a.types, [Cell.Fungus, Cell.Glowshroom, Cell.Toxic, Cell.Vines]);
    const frozenSignature = countMaterials(b.types, [Cell.Ice, Cell.Snow, Cell.Crystal, Cell.Nitrogen]);

    expect(allPlaneHash(b)).not.toBe(allPlaneHash(a));
    expect(fungalSignature).toBeGreaterThan(40);
    expect(frozenSignature).toBeGreaterThan(40);
  });

  it('handles negative chunk coordinates deterministically', () => {
    const def = createDefaultVirtualWorldDef(99);
    const a = generateVirtualChunk(def, -2, 3);
    const b = generateVirtualChunk(def, -2, 3);

    expect(a.originX).toBe(-512);
    expect(a.originY).toBe(768);
    expect(allPlaneHash(b)).toBe(allPlaneHash(a));
  });

  it('produces identical chunks whether generated alone or inside a window', () => {
    const def = createDefaultVirtualWorldDef(4242);
    const alone = generateVirtualChunk(def, 1, -1);
    const window = generateVirtualWindow(def, -1, -1, 1, 1).find((chunk) => chunk.cx === 1 && chunk.cy === -1);

    expect(window).toBeTruthy();
    expect(allPlaneHash(window!)).toBe(allPlaneHash(alone));
  });

  it('does not artificially seal horizontal chunk seams', () => {
    const def = createDefaultVirtualWorldDef(777);
    const left = generateVirtualChunk(def, 0, 0);
    const right = generateVirtualChunk(def, 1, 0);
    const xL = left.size - 1;
    let openTouches = 0;

    for (let y = 0; y < left.size; y++) {
      const li = xL + y * left.size;
      const ri = y * right.size;
      if (left.types[li] === Cell.Empty || right.types[ri] === Cell.Empty) openTouches++;
    }
    expect(openTouches).toBeGreaterThan(12);
  });

  it('does not artificially seal vertical chunk seams', () => {
    const def = createDefaultVirtualWorldDef(888);
    const top = generateVirtualChunk(def, 0, 0);
    const bottom = generateVirtualChunk(def, 0, 1);
    const yT = top.size - 1;
    let openTouches = 0;

    for (let x = 0; x < top.size; x++) {
      const ti = x + yT * top.size;
      const bi = x;
      if (top.types[ti] === Cell.Empty || bottom.types[bi] === Cell.Empty) openTouches++;
    }
    expect(openTouches).toBeGreaterThan(12);
  });

  it('stamps the default boundary pixel scene across all four neighboring chunks', () => {
    const def = createDefaultVirtualWorldDef(31337);
    const chunks = [
      generateVirtualChunk(def, 0, 0),
      generateVirtualChunk(def, 1, 0),
      generateVirtualChunk(def, 0, 1),
      generateVirtualChunk(def, 1, 1),
    ];

    for (const chunk of chunks) {
      expect(chunk.meta.scenes).toContain('boundary-ruin-0');
      expect(chunk.types.some((type) => type === Cell.Stone)).toBe(true);
    }
  });

  it('materializes a rectangular chunk window into a normal World instance', () => {
    const def = createDefaultVirtualWorldDef(5150);
    const chunks = generateVirtualWindow(def, 0, 0, 1, 1);
    const materialized = materializeChunks(chunks);

    expect(materialized.originX).toBe(0);
    expect(materialized.originY).toBe(0);
    expect(materialized.world.width).toBe(def.chunkSize * 2);
    expect(materialized.world.height).toBe(def.chunkSize * 2);
    expect(materialized.world.simBounds).toEqual({ x0: 0, x1: def.chunkSize * 2, y0: 0, y1: def.chunkSize * 2 });
    expect(materialized.chunks.length).toBe(4);
    expect(materialized.world.types[0]).toBe(chunks[0].types[0]);
  });

  it('rejects sparse virtual materialization windows', () => {
    const def = createDefaultVirtualWorldDef(5151);
    const chunks = generateVirtualWindow(def, 0, 0, 1, 1).filter((chunk) => chunk.cx !== 1 || chunk.cy !== 1);

    expect(() => materializeChunks(chunks)).toThrow(/sparse chunk window/);
  });

  it('serializes only requested chunk planes for worker transfer', () => {
    const def = createDefaultVirtualWorldDef(123);
    const source = generateVirtualChunk(def, 0, 0);
    const { chunk } = toTransferableChunk(source, ['types', 'previewRgba']);

    expect(chunk.types).toBeTruthy();
    expect(chunk.previewRgba).toBeTruthy();
    expect(chunk.colors).toBeUndefined();
    expect(chunk.life).toBeUndefined();
    expect(chunk.charge).toBeUndefined();
    expect(chunk.metrics.generatedBytes).toBe(source.types.byteLength + source.colors.byteLength + source.life.byteLength + source.charge.byteLength);
    expect(chunk.metrics.transferBytes).toBe(source.types.byteLength + source.size * source.size * 4);

    const restored = fromTransferableChunk(chunk);
    expect(restored.types.length).toBe(def.chunkSize * def.chunkSize);
    expect(restored.colors.length).toBe(def.chunkSize * def.chunkSize);
  });

  it('ships a valid minimal herringbone tileset', () => {
    const def = createDefaultVirtualWorldDef(1);
    const issues = validateTileset(def.tileset).filter((issue) => issue.severity === 'error');

    expect(issues).toEqual([]);
  });
});

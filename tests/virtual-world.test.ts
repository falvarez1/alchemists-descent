import { describe, expect, it } from 'vitest';

import { Cell } from '@/sim/CellType';
import { createDefaultVirtualWorldDef } from '@/world/virtual/defaults';
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
    const organic = createDefaultVirtualWorldDef(2468);

    expect(allPlaneHash(generateVirtualChunk(organic, 0, 0))).not.toBe(allPlaneHash(generateVirtualChunk(plain, 0, 0)));
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
    expect(materialized.chunks.length).toBe(4);
    expect(materialized.world.types[0]).toBe(chunks[0].types[0]);
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

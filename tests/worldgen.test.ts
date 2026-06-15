import { describe, expect, it } from 'vitest';

import { applyWorldLayer, captureWorldLayer } from '@/builder/document';
import { createDefaultPostFxSettings } from '@/config/params';
import type { Ctx, GameStateData } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { unpackB, unpackG, unpackR } from '@/sim/colors';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';

/**
 * generateCaves only reaches ctx.world and ctx.state (biome + worldSeed),
 * so the stub provides those for real and nothing else.
 */
function makeCtx(world: World, worldSeed: number): Ctx {
  const state: GameStateData = {
    mode: 'build',
    score: 0,
    frameCount: 0,
    activeInputMode: 'element',
    currentElement: Cell.Sand,
    currentSpell: 'bolt',
    currentBiome: 'earthen',
    brushSize: 6,
    playerSpawned: false,
    worldSeed,
    paused: false,
    postFx: createDefaultPostFxSettings(),
    editorLights: null,
  };
  return { world, state } as Ctx;
}

function generate(seed: number): { world: World; gen: WorldGen } {
  const world = new World();
  const gen = new WorldGen();
  const ctx = makeCtx(world, seed);
  ctx.worldgen = gen;
  gen.generateCaves(ctx);
  return { world, gen };
}

/** Index of the first mismatching cell, or -1 when identical (toEqual on 1.7M cells is too slow). */
function firstDiff(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

function mossyWallCount(world: World): number {
  let count = 0;
  for (let i = 0; i < world.types.length; i++) {
    if (world.types[i] !== Cell.Wall) continue;
    const color = world.colors[i];
    if (unpackG(color) > unpackR(color) + 24 && unpackG(color) > unpackB(color) + 18) count++;
  }
  return count;
}

describe('worldgen determinism', () => {
  it('produces identical cell types and spawn hint for the same seed', () => {
    const a = generate(123456789);
    const b = generate(123456789);

    expect(firstDiff(a.world.types, b.world.types)).toBe(-1);
    expect(a.gen.spawnHint).not.toBeNull();
    expect(b.gen.spawnHint).toEqual(a.gen.spawnHint);
  });

  it('produces a different world for a different seed', () => {
    const a = generate(123456789);
    const b = generate(987654321);

    expect(firstDiff(a.world.types, b.world.types)).not.toBe(-1);
  });

  it('captures generated paint metadata and restores biome-rich wall colors', () => {
    const source = new World();
    const gen = new WorldGen();
    const sourceCtx = makeCtx(source, 123456789);
    sourceCtx.worldgen = gen;
    gen.generateCaves(sourceCtx);
    const beforeMoss = mossyWallCount(source);
    expect(beforeMoss).toBeGreaterThan(100);

    const fireIndex = source.idx(12, 12);
    source.types[fireIndex] = Cell.Fire;
    source.life[fireIndex] = 321;
    const layer = captureWorldLayer(sourceCtx);
    expect(layer.biome).toBe('earthen');
    expect(layer.seed).toBe(123456789);
    expect(layer.paintSeed).toBe(gen.paintSeed);

    const restored = new World();
    const restoreCtx = makeCtx(restored, 1);
    restoreCtx.worldgen = new WorldGen();
    applyWorldLayer(restoreCtx, layer);

    expect(mossyWallCount(restored)).toBeGreaterThan(beforeMoss * 0.75);
    expect(restored.life[fireIndex]).toBe(321);
  });
});

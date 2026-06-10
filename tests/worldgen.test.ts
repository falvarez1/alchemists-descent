import { describe, expect, it } from 'vitest';

import type { Ctx, GameStateData } from '@/core/types';
import { Cell } from '@/sim/CellType';
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
  };
  return { world, state } as Ctx;
}

function generate(seed: number): { world: World; gen: WorldGen } {
  const world = new World();
  const gen = new WorldGen();
  gen.generateCaves(makeCtx(world, seed));
  return { world, gen };
}

/** Index of the first mismatching cell, or -1 when identical (toEqual on 1.7M cells is too slow). */
function firstDiff(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
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
});

import { describe, expect, it } from 'vitest';

import { applyWorldLayer, captureWorldLayer } from '@/builder/document';
import { createDefaultPostFxSettings } from '@/config/params';
import type { Ctx, GameStateData, RegionGraph } from '@/core/types';
import { Rng } from '@/core/rng';
import { Cell } from '@/sim/CellType';
import { unpackB, unpackG, unpackR } from '@/sim/colors';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';
import { stampSecrets } from '@/world/secrets';

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

class ScriptedRng extends Rng {
  private pos = 0;

  constructor(private readonly values: number[]) {
    super(1);
  }

  override next(): number {
    return this.values[this.pos++] ?? 0;
  }
}

function singleRegionGraph(world: World, cx: number, cy: number): RegionGraph {
  return {
    scale: 4,
    w: Math.floor(world.width / 4),
    h: Math.floor(world.height / 4),
    labels: new Int32Array(Math.floor(world.width / 4) * Math.floor(world.height / 4)).fill(-1),
    regions: [{ id: 0, area: 1200, cx, cy, onMainPath: true, isPocket: false }],
    edges: [],
    mainPath: [0],
    spawnRegion: 0,
    exitRegion: 0,
  };
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

  it('rolls back failed secret connector trials without leaving carved pockets', () => {
    const world = new World(320, 320);
    world.types.fill(Cell.Wall);
    const charged = world.idx(210, 160);
    world.life[charged] = 7;
    world.setChargeAt(charged, 4);
    world.colorOverrides.add(charged);
    const beforeTypes = world.types.slice();
    const beforeColors = world.colors.slice();
    const beforeLife = world.life.slice();
    const beforeCharge = world.charge.slice();
    const beforeOverrides = new Set(world.colorOverrides);
    const ctx = { world } as unknown as Ctx;
    const rng = new ScriptedRng([0, 0, 0, (50 - 40) / (160 - 40), 0, 0]);

    const placed = stampSecrets(ctx, rng, singleRegionGraph(world, 160, 160), 'earthen');

    expect(placed).toBe(0);
    expect(world.types).toEqual(beforeTypes);
    expect(world.colors).toEqual(beforeColors);
    expect(world.life).toEqual(beforeLife);
    expect(world.charge).toEqual(beforeCharge);
    expect(world.activeCharges.has(charged)).toBe(true);
    expect(world.colorOverrides).toEqual(beforeOverrides);
  });
});

import { describe, expect, it } from 'vitest';

import { applyWorldLayer, captureWorldLayer } from '@/authoring/worldLayer';
import { HEIGHT, WIDTH } from '@/config/constants';
import { createDefaultPostFxSettings } from '@/config/params';
import { LEVELS } from '@/config/worldgraph';
import type { BiomeId, Ctx, GameStateData, LevelDef } from '@/core/types';
import { fnv1aString } from '@/core/rng';
import { unpackColorDiffs } from '@/core/rle';
import { drawCounts, resetDrawCounts } from '@/core/simRandom';
import { Cell } from '@/sim/CellType';
import * as colorsModule from '@/sim/colors';
import { TINT_PALETTES, waterColor } from '@/sim/colors';
import { World } from '@/sim/World';
import {
  beginGenerationTint,
  endGenerationTint,
  isNaturalToken,
  materialColorAt,
  paintCells,
  sanitizeWorldPaint,
} from '@/sim/worldPaint';
import { WorldGen, cavePaint } from '@/world/CaveGenerator';
import { stampSandboxArena } from '@/world/sandboxArena';

/**
 * D14 (docs/split/SPLIT-PLAN.md): a cell's generated colour is a pure function
 * of the final grid and the seed, computed by ONE function (sim/worldPaint) on
 * both sides, so a world travels as its cells. The contract tests below
 * generate every kind of world the codec serves and hold that the generator's
 * colours ARE the paint's wherever no stamp chose its own: no rock or air cell
 * travels as a difference, and what does travel is a stamp's own palette.
 */

const noop = (): undefined => undefined;
function makeCtx(world: World, worldSeed: number, biome: BiomeId): Ctx {
  const state = {
    mode: 'build',
    score: 0,
    frameCount: 0,
    activeInputMode: 'element',
    currentElement: Cell.Sand,
    currentSpell: 'bolt',
    currentBiome: biome,
    brushSize: 6,
    playerSpawned: false,
    worldSeed,
    paused: false,
    postFx: createDefaultPostFxSettings(),
    editorLights: null,
  } as GameStateData;
  const sub = new Proxy({}, { get: () => noop });
  return {
    world,
    state,
    player: { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2), vx: 0, vy: 0, fx: 0, fy: 0 },
    enemies: [],
    enemyCtl: { spawn: noop },
    events: { emit: noop, on: noop, off: noop },
    audio: sub,
    particles: sub,
    rigidBodies: sub,
    fx: {},
    levels: { current: null },
    sanctum: { open: noop },
    camera: { snapTo: noop },
  } as unknown as Ctx;
}

/** Capture, measure what travels, decode, and hold the decode to the source. */
function travel(world: World, biome: BiomeId, seed: number): { bytes: number; tinted: Map<number, number> } {
  const layer = captureWorldLayer({ world, biome, seed });
  const json = JSON.stringify(layer);
  const tinted = new Map<number, number>();
  if (layer.tints) {
    unpackColorDiffs(layer.tints, new Uint32Array(world.colors.length), (i) => {
      tinted.set(world.types[i], (tinted.get(world.types[i]) ?? 0) + 1);
    });
  }
  const back = new World();
  applyWorldLayer({ world: back, biome, seed }, JSON.parse(json));
  expect(back.colors).toEqual(world.colors);
  expect(back.colorOverrides.mask).toEqual(world.colorOverrides.mask);
  expect(back.paint).toEqual(world.paint);
  return { bytes: json.length, tinted };
}

describe('the shared paint', () => {
  it('knows every palette sim/colors exports', () => {
    const exported = Object.entries(colorsModule)
      .filter(([name, value]) => typeof value === 'function' && name.endsWith('Color') && (value as () => number).length === 0)
      .map(([, value]) => value);
    for (const palette of exported) expect(TINT_PALETTES).toContain(palette);
  });

  it('draws a material colour from the position: its palette, reproducible, varied, no fx draws', () => {
    resetDrawCounts();
    const a = materialColorAt(Cell.Water, 10, 20, 7);
    expect(materialColorAt(Cell.Water, 10, 20, 7)).toBe(a);
    const seen = new Set<number>();
    for (let x = 0; x < 200; x++) {
      const c = materialColorAt(Cell.Water, x, 3, 7);
      seen.add(c);
      const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
      expect(r >= 35 && r < 50 && g >= 105 && g < 130 && b >= 240 && b < 255).toBe(true);
    }
    expect(seen.size).toBeGreaterThan(50);
    expect(drawCounts().fx).toBe(0);
  });

  it('reads the cell types and the descriptor, never the colours', () => {
    const world = new World(200, 120);
    for (let y = 30; y < 120; y++) for (let x = 0; x < 200; x++) world.types[x + y * 200] = Cell.Wall;
    for (let x = 60; x < 140; x++) world.types[x + 70 * 200] = Cell.Water;
    const paint = cavePaint('fungal', 4242, 0);
    const a = new Uint32Array(world.colors.length);
    paintCells(world, paint, a);
    world.colors.fill(0x123456);
    const b = new Uint32Array(world.colors.length);
    paintCells(world, paint, b);
    expect(b).toEqual(a);
  });

  it('turns natural tints into tokens only inside a generation, and nests', () => {
    beginGenerationTint();
    beginGenerationTint();
    const token = waterColor();
    endGenerationTint();
    expect(waterColor()).toBe(token);
    endGenerationTint();
    expect(isNaturalToken(token)).toBe(true);
    const outside = new Set<number>();
    for (let k = 0; k < 40; k++) outside.add(waterColor());
    expect(outside.size).toBeGreaterThan(1);
  });

  it('refuses a malformed descriptor', () => {
    const good = cavePaint('earthen', 9, 6);
    expect(sanitizeWorldPaint(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(sanitizeWorldPaint({ ...good, bands: good.bands.slice(0, 3) })).toBeNull();
    expect(sanitizeWorldPaint({ ...good, crown: 'lava' })).toBeNull();
    expect(sanitizeWorldPaint({ ...good, seed: -1 })).toBeNull();
    expect(sanitizeWorldPaint({ ...good, pores: { density: 2, smooth: 3 } })).toBeNull();
    expect(sanitizeWorldPaint({ v: 3, style: 'plain', seed: 0 })).toBeNull();
    expect(sanitizeWorldPaint('strata')).toBeNull();
  });
});

describe('every generated world travels as its cells (D14)', () => {
  const ROCK = [Cell.Wall, Cell.Empty];

  for (const biome of ['earthen', 'fungal', 'frozen', 'flooded', 'crystal', 'volcanic', 'gilded'] as BiomeId[]) {
    it(`the sandbox's ${biome} caves`, () => {
      const world = new World();
      const gen = new WorldGen();
      const ctx = makeCtx(world, 20261004, biome);
      ctx.worldgen = gen;
      gen.generateCaves(ctx);
      expect(world.paint).toMatchObject({ v: 2, style: 'strata', seed: gen.paintSeed, bedrockRows: 0 });
      const { bytes, tinted } = travel(world, biome, 20261004);
      for (const t of ROCK) expect(tinted.get(t) ?? 0, `cell type ${t}`).toBe(0);
      // What travels: a few cells the polish fills sampled from their neighbours
      // (ice beside rock, on the frozen floor). The timber beams are the paint's planks.
      let total = 0;
      for (const n of tinted.values()) total += n;
      expect(total).toBeLessThan(1_000);
      // The Gilded Vault keeps its skeleton's holes as real air, so its rle alone is ~570 KB.
      expect(bytes).toBeLessThan(biome === 'gilded' ? 800_000 : 400_000);
    });
  }

  it('the Workshop', () => {
    const world = new World();
    stampSandboxArena(makeCtx(world, 1, 'earthen'));
    expect(world.paint).toMatchObject({ v: 2, style: 'plain' });
    const { tinted } = travel(world, 'earthen', 1);
    expect(tinted.size).toBe(0);
  });

  for (const id of ['d1', 'd2', 'd2b', 'd3', 'd3b', 'd4']) {
    it(`campaign floor ${id}`, () => {
      const def = (LEVELS as Record<string, LevelDef>)[id];
      const seed = (5 ^ fnv1aString(id)) >>> 0;
      const world = new World();
      const gen = new WorldGen();
      const ctx = makeCtx(world, seed, def.biome);
      ctx.worldgen = gen;
      gen.generateLevel(ctx, def, seed);
      expect(world.paint).toMatchObject(id === 'd1' ? { v: 2, style: 'beds' } : { v: 2, style: 'strata', bedrockRows: 6 });
      const { bytes, tinted } = travel(world, def.biome, seed);
      // The paint owns the rock (the Works' is Stone, and its frame), the bedrock and the air.
      for (const t of [...ROCK, Cell.Stone].filter((t) => id === 'd1' || t !== Cell.Stone)) {
        expect(tinted.get(t) ?? 0, `cell type ${t}`).toBe(0);
      }
      let total = 0;
      for (const n of tinted.values()) total += n;
      // What travels is the stamps' own palettes: flora, structures, the Works' pools.
      expect(total).toBeLessThan(70_000);
      expect(bytes).toBeLessThan(1_000_000);
    });
  }
});

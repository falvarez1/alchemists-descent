import { describe, expect, it } from 'vitest';
import { BIOMES } from '@/config/biomes';
import { createDefaultPostFxSettings } from '@/config/params';
import type { Ctx, GameStateData } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import type { VirtualBiomeDressingRecipe } from '@/world/virtual/types';
import { campaignDressingRecipeForBiome, goldPocketBudgetForBiome } from '@/world/biomeExtras';
import { WorldGen } from '@/world/CaveGenerator';

/**
 * Golden-hash lock for the earthen cave skeleton. The worldgen overhaul
 * (config extraction, carve primitives, skeleton strategies) is a move-only
 * refactor for the baseline biome: these hashes are the tripwire that proves
 * each step consumed the SAME rng stream in the SAME order. If a change
 * trips this test, either revert it or — for a DELIBERATE generation change
 * (flagged in the commit per CLAUDE.md invariant #4) — re-record the hashes.
 *
 * Colors are randomized paint (Math.random) and deliberately not hashed;
 * cell types + spawn hint are the deterministic contract.
 */

function makeCtx(world: World, worldSeed: number, biome: keyof typeof BIOMES = 'earthen'): Ctx {
  const state: GameStateData = {
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
  };
  return { world, state } as Ctx;
}

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Recorded from the pre-overhaul generator. Re-record ONLY for deliberate,
 *  commit-flagged generation changes. */
// Re-recorded for GEN_VERSION 18 (CAVE_SCALE 1.5 — grander caves). Radius is
// consumed after every rng draw, so the stream + spawn anchors are identical to
// v17; only carved cell width changed, which is exactly what these hashes lock.
const GOLDEN: Record<number, { hash: string; spawn: { x: number; y: number } }> = {
  1: { hash: '5d256487', spawn: { x: 800, y: 550 } },
  5: { hash: 'ac54ba1d', spawn: { x: 800, y: 413 } },
  1337: { hash: '902de2af', spawn: { x: 800, y: 396 } },
  123456789: { hash: '3c40aa05', spawn: { x: 800, y: 542 } },
};

const RECIPE_FIELDS: Array<keyof VirtualBiomeDressingRecipe> = [
  'ore',
  'oreDensity',
  'secondary',
  'secondaryDensity',
  'pocket',
  'pocketDensity',
  'liquid',
  'liquidDensity',
  'glow',
  'glowDensity',
  'rubble',
  'rubbleDensity',
  'hanging',
  'hangingDensity',
];

describe('campaign biome dressing recipe vocabulary', () => {
  for (const biome of Object.keys(BIOMES) as Array<keyof typeof BIOMES>) {
    it(`${biome} exposes a complete virtual-compatible recipe`, () => {
      const recipe = campaignDressingRecipeForBiome(biome);
      for (const field of RECIPE_FIELDS) {
        expect(Number.isFinite(recipe[field])).toBe(true);
      }
    });
  }
});

describe('biome gold pocket budgets', () => {
  it('applies biome goldBonus to the base pocket target', () => {
    expect(goldPocketBudgetForBiome(100, 'earthen')).toBe(100);
    expect(goldPocketBudgetForBiome(100, 'timber')).toBe(110);
    expect(goldPocketBudgetForBiome(100, 'crystal')).toBe(160);
  });
});

describe('biome liquid pool paint', () => {
  it('paints crystal water pools with water colors instead of nitrogen colors', () => {
    const world = new World();
    const gen = new WorldGen();
    gen.generateCaves(makeCtx(world, 1337, 'crystal'));

    const waterColors: number[] = [];
    for (let i = 0; i < world.types.length; i++) {
      if (world.types[i] === Cell.Water) waterColors.push(world.colors[i]);
    }

    expect(waterColors.length).toBeGreaterThan(0);
    expect(waterColors.some((color) => ((color >> 16) & 0xff) < 80 && (color & 0xff) >= 230)).toBe(true);
    expect(waterColors.every((color) => ((color >> 16) & 0xff) < 80)).toBe(true);
  });
});

describe('earthen generateCaves golden hashes', () => {
  for (const seedKey of Object.keys(GOLDEN)) {
    const seed = Number(seedKey);
    it(`seed ${seed} reproduces the locked world`, () => {
      const world = new World();
      const gen = new WorldGen();
      gen.generateCaves(makeCtx(world, seed));
      expect(fnv1a(world.types)).toBe(GOLDEN[seed].hash);
      expect(gen.spawnHint).toEqual(GOLDEN[seed].spawn);
    });
  }
});

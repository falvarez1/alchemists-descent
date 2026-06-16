import { describe, expect, it } from 'vitest';

import { HEIGHT, WIDTH } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { Rng } from '@/core/rng';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { PlacementLedger } from '@/world/connect';
import { applyCampaignDressing, campaignDressingRecipeForBiome } from '@/world/biomeExtras';
import { createDefaultDressingProfile, VIRTUAL_BIOME_IDS } from '@/world/virtual/defaults';

// Build a solid wall mass with a carved corridor (so vine/liquid-adjacency passes have open
// space), away from the protected borders/floor band, then run the recipe-driven campaign
// dressing on it. applyCampaignDressing only touches ctx.world, so the stub is minimal.
function dressBiome(biome: (typeof VIRTUAL_BIOME_IDS)[number], seed: number): { world: World; cellsChanged: number } {
  const world = new World();
  const x0 = 80;
  const x1 = WIDTH - 80;
  const y0 = 80;
  const y1 = HEIGHT - 140;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) world.types[world.idx(x, y)] = Cell.Wall;
  const midY = Math.floor((y0 + y1) / 2);
  for (let y = midY - 6; y <= midY + 6; y++) for (let x = x0 + 4; x <= x1 - 4; x++) world.types[world.idx(x, y)] = Cell.Empty;
  const ctx = { world } as Ctx;
  const stats = applyCampaignDressing(ctx, new Rng(seed), biome, new PlacementLedger(), {});
  return { world, cellsChanged: stats.cellsChanged };
}

function countTypes(world: World, types: readonly number[]): number {
  const want = new Set(types);
  let n = 0;
  for (let i = 0; i < world.types.length; i++) if (want.has(world.types[i])) n++;
  return n;
}

describe('campaign dressing recipe parity', () => {
  it('keeps campaign biome recipes in sync with the virtual dressing recipes', () => {
    // Campaign generation and the virtual chunked generator deliberately share one recipe
    // vocabulary. This locks them identical so the two paths cannot silently drift; if they
    // are ever meant to diverge for a biome, update this expectation deliberately.
    const virtual = createDefaultDressingProfile().biomes;
    for (const biome of VIRTUAL_BIOME_IDS) {
      expect(campaignDressingRecipeForBiome(biome)).toEqual(virtual[biome]);
    }
  });

  it('dresses every campaign biome with its signature recipe materials', () => {
    VIRTUAL_BIOME_IDS.forEach((biome, i) => {
      const { world, cellsChanged } = dressBiome(biome, 4242 + i * 17);
      const r = campaignDressingRecipeForBiome(biome);
      expect(cellsChanged, `${biome} changed cells`).toBeGreaterThan(0);
      // At least one of the biome's recipe materials must appear in the dressed rock.
      const present = countTypes(world, [r.ore, r.secondary, r.pocket, r.liquid, r.glow]);
      expect(present, `${biome} signature materials`).toBeGreaterThan(0);
    });
  });

  it('gives each biome a recognizable material identity', () => {
    const sigOf = (biome: (typeof VIRTUAL_BIOME_IDS)[number], types: number[]): number =>
      countTypes(dressBiome(biome, 9001).world, types);
    // Frozen reads as ice/crystal/snow; fungal as fungus/glowshroom; volcanic/scorched as lava;
    // gilded as gold. These are the at-a-glance biome tells the rich-world effort is about.
    expect(sigOf('frozen', [Cell.Ice, Cell.Crystal, Cell.Snow])).toBeGreaterThan(0);
    expect(sigOf('fungal', [Cell.Fungus, Cell.Glowshroom])).toBeGreaterThan(0);
    expect(sigOf('volcanic', [Cell.Lava])).toBeGreaterThan(0);
    expect(sigOf('gilded', [Cell.Gold])).toBeGreaterThan(0);
  });
});

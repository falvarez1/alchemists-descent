import { describe, expect, it } from 'vitest';

import { GEN_TUNE } from '@/config/gen';
import type { BiomeId } from '@/core/types';
import { campaignDressingRecipeForBiome } from '@/world/biomeExtras';
import {
  createDefaultDressingProfile,
  createDefaultVirtualGenerationParams,
  VIRTUAL_BIOME_IDS,
} from '@/world/virtual/defaults';

// Play Mode virtual runs build their def from these defaults; Builder playtest
// normalizes through effectiveVirtualWorldDef, which stamps live GEN_TUNE onto
// the same fields. Both must read ONE source of truth or the two paths render
// different terrain at identical settings (the stale 6/4/2 mirror bug).
describe('virtual world def parity', () => {
  it('mirrors the live GEN_TUNE walk-surface fields', () => {
    const g = createDefaultVirtualGenerationParams();
    expect(g.caveScale).toBe(GEN_TUNE.caveScale);
    expect(g.fillSurfacePits).toBe(GEN_TUNE.fillSurfacePits);
    expect(g.surfacePitWidth).toBe(GEN_TUNE.surfacePitWidth);
    expect(g.surfacePitDepth).toBe(GEN_TUNE.surfacePitDepth);
    expect(g.notchPasses).toBe(GEN_TUNE.notchPasses);
  });

  it('tracks live Look-tuning edits, not a baked snapshot', () => {
    const prev = GEN_TUNE.surfacePitWidth;
    GEN_TUNE.surfacePitWidth = prev + 3;
    try {
      expect(createDefaultVirtualGenerationParams().surfacePitWidth).toBe(prev + 3);
    } finally {
      GEN_TUNE.surfacePitWidth = prev;
    }
  });

  // The virtual and campaign dressing recipe tables are two declarations of
  // the same intent. They are value-identical today; if one is deliberately
  // changed, change the other (or split them on purpose and update this test
  // with a comment saying why).
  it('keeps the virtual and campaign dressing recipe tables in lockstep', () => {
    const profile = createDefaultDressingProfile();
    for (const id of VIRTUAL_BIOME_IDS) {
      expect(profile.biomes[id], id).toEqual(campaignDressingRecipeForBiome(id as BiomeId));
    }
  });
});

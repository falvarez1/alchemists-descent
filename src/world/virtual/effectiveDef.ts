import { GEN_TUNE } from '@/config/gen';
import type { BiomeId } from '@/core/types';
import { campaignDressingRecipeForBiome } from '@/world/biomeExtras';
import type { VirtualBiomeDressingRecipe, VirtualWorldDef } from '@/world/virtual/types';

/**
 * A copy of `source` with the live worldgen look (GEN_TUNE's cave scale and
 * walk-surface sink fill) stamped onto its generation params, and, when
 * `useGlobalDressing` is set, every biome's dressing recipe replaced by the
 * campaign's own. The input is never mutated. This is the same normalization
 * `createDefaultVirtualGenerationParams` applies at construction, so a def
 * built earlier in a session cannot drift from today's look.
 *
 * Kept out of `index.ts` on purpose: it pulls `biomeExtras`, which the chunk
 * worker has no use for.
 */
export function effectiveVirtualWorldDef(source: VirtualWorldDef, useGlobalDressing: boolean): VirtualWorldDef {
  let def = structuredClone(source);
  def = {
    ...def,
    generation: {
      ...def.generation,
      caveScale: GEN_TUNE.caveScale,
      fillSurfacePits: GEN_TUNE.fillSurfacePits,
      surfacePitWidth: GEN_TUNE.surfacePitWidth,
      surfacePitDepth: GEN_TUNE.surfacePitDepth,
      notchPasses: GEN_TUNE.notchPasses,
    },
  };

  if (useGlobalDressing) {
    const biomes: Record<string, VirtualBiomeDressingRecipe> = {};
    for (const biome of Object.keys(def.dressing.biomes)) {
      biomes[biome] = { ...campaignDressingRecipeForBiome(biome as BiomeId) };
    }
    def = { ...def, dressing: { ...def.dressing, biomes: biomes as VirtualWorldDef['dressing']['biomes'] } };
  }

  return def;
}

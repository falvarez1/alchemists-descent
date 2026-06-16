import type { EnemyKind, LevelDef } from '@/core/types';

/**
 * The descent: a vertical stack of persistent levels connected by sealed
 * wells in each floor — plus the first BRANCH: the Gilded Vault, a secret
 * level off the spine. Its hidden arch generates in one mid-descent host
 * (d2-d4, picked per expedition seed — vaultHostId) and its own arch leads
 * back to that host at the same depth. No well reaches it; no well leaves it.
 */
export const LEVELS: Record<string, LevelDef> = {
  d1: { id: 'd1', name: 'EARTHEN HOLLOWS', biome: 'earthen', depth: 1, nextLevelId: 'd2' },
  d2: { id: 'd2', name: 'FUNGAL DEEP', biome: 'fungal', depth: 2, nextLevelId: 'd3' },
  d3: { id: 'd3', name: 'FROZEN DEPTHS', biome: 'frozen', depth: 3, nextLevelId: 'd4' },
  d4: { id: 'd4', name: 'FLOODED CAVERNS', biome: 'flooded', depth: 4, nextLevelId: 'd5' },
  d5: { id: 'd5', name: 'TIMBERWORKS', biome: 'timber', depth: 5, nextLevelId: 'd6' },
  d6: { id: 'd6', name: 'CRYSTAL HOLLOWS', biome: 'crystal', depth: 6, nextLevelId: 'd7' },
  d7: { id: 'd7', name: 'SCORCHED WASTES', biome: 'scorched', depth: 7, nextLevelId: 'd8' },
  d8: { id: 'd8', name: 'VOLCANIC MAW', biome: 'volcanic', depth: 8, nextLevelId: null },
  vault: {
    id: 'vault',
    name: 'THE GILDED VAULT',
    biome: 'gilded',
    depth: 4,
    nextLevelId: null,
    branch: true,
  },
  // Dev/test arena for the rigid-body physics (selectable from the level
  // dropdown in test mode). Not part of the campaign spine; never autosaved.
  'physics-test': {
    id: 'physics-test',
    name: 'PHYSICS TEST ARENA',
    biome: 'earthen',
    depth: 0,
    nextLevelId: null,
  },
};

export const START_LEVEL = 'd1';

/**
 * Which spine level hides the Gilded Vault's arch this expedition. Pure
 * function of the expedition seed so save-resume's pristine regeneration
 * reproduces the same host without storing anything new in the save.
 */
export function vaultHostId(expeditionSeed: number): string {
  return 'd' + (2 + ((expeditionSeed >>> 0) % 3));
}

/** Placed hostile population per level: base + per-depth growth, kind weights shift down. */
export function populationForDepth(depth: number): Partial<Record<EnemyKind, number>> {
  return {
    slime: 12 + depth * 3,
    imp: depth >= 2 ? 4 + depth * 3 : 2,
    golem: depth >= 3 ? depth * 2 : depth >= 2 ? 1 : 0,
    acidslime: depth >= 2 ? 2 + depth * 2 : 0,
    wisp: depth >= 3 ? 1 + depth : depth === 2 ? 1 : 0,
    mage: depth >= 4 ? depth - 2 : 0,
  };
}

/**
 * Biome-weighted population: the total count follows the depth curve, but the
 * kind mix comes from the biome's foes table (biomeExtras), with a seasoning
 * of our Wave C kinds (acid slimes, wisps, mages) at the depths they unlock.
 */
export function populationForLevel(
  def: LevelDef,
  foes: Partial<Record<EnemyKind, number>>,
): Partial<Record<EnemyKind, number>> {
  const depth = def.depth;
  const total = 24 + depth * 6;
  const weightSum = Object.values(foes).reduce((a, b) => a + (b ?? 0), 0) || 1;
  const out: Partial<Record<EnemyKind, number>> = {};
  for (const [kind, weight] of Object.entries(foes) as Array<[EnemyKind, number]>) {
    out[kind] = Math.round((total * weight) / weightSum);
  }
  // Wave C natives keep their depth gating on top of the biome roster.
  if (depth >= 2) out.acidslime = (out.acidslime ?? 0) + 2;
  if (depth >= 3) out.wisp = (out.wisp ?? 0) + 1 + Math.floor(depth / 3);
  if (depth >= 4) out.mage = (out.mage ?? 0) + Math.max(1, depth - 3);
  return out;
}

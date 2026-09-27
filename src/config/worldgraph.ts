import type { BiomeId, EnemyKind, LevelDef } from '@/core/types';

/**
 * The descent: a vertical stack of persistent levels connected by explicit
 * exit portals — plus the first BRANCH: the Gilded Vault, a secret
 * level off the spine. Its hidden arch generates in one mid-descent host
 * (d2-d4, picked per expedition seed — vaultHostId) and its own arch leads
 * back to that host at the same depth. No descent portal reaches it; no portal leaves it.
 */
export const LEVELS: Record<string, LevelDef> = {
  d1: { id: 'd1', name: 'THE BREATHING WORKS', biome: 'earthen', depth: 1, nextLevelId: 'd2' },
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
  'weaver-test': {
    id: 'weaver-test',
    name: 'WEAVER TEST LAIR',
    biome: 'fungal',
    depth: 0,
    nextLevelId: null,
  },
  'alchemy-test': {
    id: 'alchemy-test',
    name: 'ALCHEMY PROVING GROUNDS',
    biome: 'fungal',
    depth: 0,
    nextLevelId: null,
  },
  'gas-test': {
    id: 'gas-test',
    name: 'THE GASWORKS',
    biome: 'fungal',
    depth: 0,
    nextLevelId: null,
  },
  'frost-test': {
    id: 'frost-test',
    name: 'FLASK & FROST RANGE',
    biome: 'frozen',
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

/**
 * The Breathing Works spine rosters, keyed by the floor's biome (WS-B owns which
 * biome each floor is). A few habitat predators hold the rooms; CROWDS of cheap
 * fodder give the chemistry something to chew on (a lit marsh-gas pocket in a
 * bat roost, a shorted cistern full of eels, a bomber that takes the huddle
 * with it). Bosses are structure-placed, never rostered. `bat` counts hang as
 * sleeping roosts of up to four (Levels.placePopulation); `eggs` are clutches.
 */
export const SPINE_ROSTERS: Partial<Record<BiomeId, Readonly<Partial<Record<EnemyKind, number>>>>> = {
  // Floor 1, THE BELLOWS: hand-built; its foes are authored (this roster is unused there).
  earthen: { weaver: 2, rillback: 2 },
  // Floor 2, THE ROT GARDENS: gut flora. Slime and acid-slime fodder, egg
  // clutches that promise more, two bat roosts over the marsh gas.
  fungal: { weaver: 2, rootloper: 3, rillback: 1, slime: 4, acidslime: 2, eggs: 2, bat: 8 },
  // Floor 3, THE DROWNED CISTERNS: eels in every pool (short them), spitters on
  // the shores, frost wisps that ice the water (then shatter what they froze).
  // The Sunken Leviathan is structure-placed.
  flooded: { rillback: 6, spitter: 3, wisp: 2, weaver: 1, bat: 4 },
  // Floor 4, THE KILN HEART: fire-born imps (water, steam and a sump undo
  // them), bombers that detonate the crowd they die in, golems and stone maws
  // in the slag. The Kiln Colossus is structure-placed.
  volcanic: { imp: 5, bomber: 4, golem: 2, stonemaw: 2 },
};

/**
 * Biome-weighted population: the total count follows the depth curve, but the
 * kind mix comes from the biome's foes table (biomeExtras), with a seasoning
 * of our Wave C kinds (acid slimes, wisps, mages) at the depths they unlock.
 * Spine floors use their biome's SPINE_ROSTERS entry.
 */
export function populationForLevel(
  def: LevelDef,
  foes: Partial<Record<EnemyKind, number>>,
): Partial<Record<EnemyKind, number>> {
  const depth = def.depth;
  if (depth > 0 && !def.branch) {
    const roster = SPINE_ROSTERS[def.biome];
    if (roster) return { ...roster };
    // Legacy spine floors (biomes the four-floor spine no longer uses) keep the
    // small habitat roster they had.
    if (depth === 1) return { weaver: 2, rillback: 2 };
    if (depth === 2) return { weaver: 3, rootloper: 4, rillback: 2 };
    if (depth === 3) return { stonemaw: 3, weaver: 2, rillback: 2 };
    if (depth === 4) return { rillback: 5, weaver: 2, stonemaw: 1 };
    if (depth === 5) return { weaver: 4, rootloper: 4, stonemaw: 2 };
    if (depth === 6) return { stonemaw: 4, rillback: 3, weaver: 3 };
    return { stonemaw: 4, rootloper: 3, weaver: 3, rillback: 2 };
  }
  const native: Partial<Record<EnemyKind, number>> = {};
  if (depth >= 2) native.acidslime = 2;
  if (depth >= 3) native.wisp = 1 + Math.floor(depth / 3);
  if (depth >= 4) native.mage = Math.max(1, depth - 3);
  const nativeTotal = Object.values(native).reduce((a, b) => a + (b ?? 0), 0);
  const reserve =
    (foes.bat ? 4 : 0) +
    (foes.slime ? 2 : 0) +
    (def.depth === 4 && !def.branch ? 1 : 0) +
    (def.depth === 8 && !def.branch ? 1 : 0) +
    (def.branch ? 2 : 0);
  const total = Math.min(70, Math.max(45, 24 + depth * 6));
  const biomeTotal = Math.max(0, total - reserve - nativeTotal);
  const weightSum = Object.values(foes).reduce((a, b) => a + (b ?? 0), 0) || 1;
  const out: Partial<Record<EnemyKind, number>> = {};
  for (const [kind, weight] of Object.entries(foes) as Array<[EnemyKind, number]>) {
    out[kind] = Math.round((biomeTotal * weight) / weightSum);
  }
  // Wave C natives keep their depth gating on top of the biome roster.
  for (const [kind, count] of Object.entries(native) as Array<[EnemyKind, number]>) {
    out[kind] = (out[kind] ?? 0) + count;
  }
  return out;
}

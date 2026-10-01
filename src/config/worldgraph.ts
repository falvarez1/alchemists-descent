import type { BiomeId, EnemyKind, LevelDef } from '@/core/types';
import { titleCaseName } from '@/core/strings';
import { fnv1aString } from '@/core/rng';

/**
 * The descent: four floors of one living refinery, stacked and connected by
 * explicit exit portals (Breathing Works, 2026-09). The refinery reads as an
 * organism — bellows (lungs) → rot gardens (gut) → cisterns (veins) → kiln
 * (heart). Bosses are keyed on the floor, never on a depth number: the Sunken
 * Leviathan waits in the Drowned Cisterns, the Kiln Colossus at the bottom of
 * the Kiln Heart, and killing the Colossus wins the run.
 *
 * THE BRANCHING DESCENT (wave 3, Dead Cells' biome graph): floors 2 and 3
 * each have two doors, chosen at the Sanctum. Floor 2 is the Rot Gardens (the
 * gut) or the Cold Store (the refrigeration wing); floor 3 is the Drowned
 * Cisterns (the veins) or the Glass Galleries (the lens-grinding halls, where
 * the Lenswright keeps the light). Floor 4 is always the Kiln Heart. New level
 * ids APPEND (d2b, d3b) — level ids are save keys and seed salts, never
 * renumbered. `nextLevelId` stays the floor's first door for code that only
 * needs "the floor below"; the doors themselves are FLOOR_DOORS.
 *
 * The Gilded Vault branch and floors five to eight left the campaign with this
 * cut. The biome table still carries their looks for the Builder and the dev
 * arenas below.
 */
export const LEVELS: Record<string, LevelDef> = {
  d1: { id: 'd1', name: 'THE BELLOWS', biome: 'earthen', depth: 1, nextLevelId: 'd2' },
  d2: { id: 'd2', name: 'THE ROT GARDENS', biome: 'fungal', depth: 2, nextLevelId: 'd3' },
  d3: { id: 'd3', name: 'THE DROWNED CISTERNS', biome: 'flooded', depth: 3, nextLevelId: 'd4', boss: 'leviathan' },
  d4: { id: 'd4', name: 'THE KILN HEART', biome: 'volcanic', depth: 4, nextLevelId: null, boss: 'colossus' },
  // The second doors (wave 3). Their bosses are the floors' guardians: the
  // Rime Warden in the Cold Store's ice-house, the Lenswright in the Galleries.
  d2b: { id: 'd2b', name: 'THE COLD STORE', biome: 'frozen', depth: 2, nextLevelId: 'd3', boss: 'rimewarden' },
  d3b: { id: 'd3b', name: 'THE GLASS GALLERIES', biome: 'crystal', depth: 3, nextLevelId: 'd4', boss: 'lenswright' },
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
  // Where the fighters are walked through every move (world/fighterArena; the title's Arena door).
  'fighter-test': {
    id: 'fighter-test',
    name: 'THE PROVING YARD',
    biome: 'earthen',
    depth: 0,
    nextLevelId: null,
  },
  // Where two fighters fight (world/duelStage, docs/arena): one symmetric room, a rival from the Yard's panel.
  'fighter-duel': {
    id: 'fighter-duel',
    name: 'THE DUEL STAGE',
    biome: 'earthen',
    depth: 0,
    nextLevelId: null,
  },
};

export const START_LEVEL = 'd1';

/**
 * The doors on each floor, top to bottom: floor N offers `FLOOR_DOORS[N - 1]`.
 * The first door is the floor's original (the spine the tests and the ledger
 * fall back to); every door of floor N leads to every door of floor N + 1.
 */
export const FLOOR_DOORS: ReadonlyArray<readonly string[]> = [['d1'], ['d2', 'd2b'], ['d3', 'd3b'], ['d4']];

/** The first door of every floor, top to bottom. Floor N's original is `CAMPAIGN_FLOORS[N - 1]`. */
export const CAMPAIGN_FLOORS: readonly string[] = FLOOR_DOORS.map((doors) => doors[0]);

/** Every campaign level, every door, floor by floor. */
export const CAMPAIGN_LEVELS: readonly string[] = FLOOR_DOORS.flat();

/** How many floors a run descends (a branch never makes a run longer). */
export const FLOORS_TOTAL = FLOOR_DOORS.length;

/** 1-based floor number of a campaign level id (either door), or 0 for anything off the spine. */
export function floorOf(levelId: string | null | undefined): number {
  if (!levelId) return 0;
  const i = FLOOR_DOORS.findIndex((doors) => doors.includes(levelId));
  return i + 1;
}

/**
 * The doors below a level: both doors of the next campaign floor, the single
 * next level off the spine, or none at the bottom.
 */
export function nextDoors(levelId: string | null | undefined): readonly string[] {
  const floor = floorOf(levelId);
  if (floor > 0) return FLOOR_DOORS[floor] ?? [];
  const next = levelId ? LEVELS[levelId]?.nextLevelId : null;
  return next ? [next] : [];
}

/** The level a run's path took on floor N (1-based), or the floor's first door. */
export function doorTaken(path: readonly string[] | null | undefined, floor: number): string {
  const doors = FLOOR_DOORS[floor - 1] ?? [];
  return path?.find((id) => doors.includes(id)) ?? doors[0] ?? '';
}

/**
 * A level's seed within an expedition: the expedition seed salted with the
 * level id (FNV-1a), so every door of every floor is deterministic from the
 * run's seed (the daily descent's two doors are the same for everyone) and
 * only the doors a run walks through are ever generated.
 */
export function levelSeedFor(expeditionSeed: number, levelId: string): number {
  return (expeditionSeed ^ fnv1aString(levelId)) >>> 0;
}

/** The floor's player-facing name: 'THE ROT GARDENS' becomes 'The Rot Gardens'. */
export function floorDisplayName(levelId: string | null | undefined): string {
  const def = levelId ? LEVELS[levelId] : undefined;
  return def ? titleCaseName(def.name) : 'the Works';
}

/** "Floor 2 of 4" for campaign floors, '' elsewhere. */
export function floorLabel(levelId: string | null | undefined): string {
  const floor = floorOf(levelId);
  return floor > 0 ? `Floor ${floor} of ${FLOORS_TOTAL}` : '';
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
  // in the slag. The Kiln Colossus is structure-placed. The deepest floor is
  // the fullest (it was the emptiest: 13 foes over a straight 700-cell drop).
  volcanic: { imp: 8, bomber: 6, golem: 3, stonemaw: 3 },
  // Floor 2, THE COLD STORE (the second door): frost wisps drifting through
  // the cold rooms (immune to the chill, not to a fire), bat roosts under the
  // pipes, slimes gone sluggish in the cold, stonemaws chewing through the
  // frost-split rock and a pair of golems. The Rime Warden is structure-placed.
  frozen: { wisp: 4, bat: 6, slime: 4, stonemaw: 2, golem: 2, weaver: 1 },
  // Floor 3, THE GLASS GALLERIES (the second door): light-shy bats in the dark
  // halls, spitters on the grinding floors, a mage among the lenses, golems
  // and slimes for the chemistry to chew. The Lenswright is structure-placed.
  crystal: { bat: 6, spitter: 3, slime: 4, golem: 2, mage: 1, stonemaw: 1 },
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

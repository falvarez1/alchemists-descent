import type { BiomeId } from '@/core/types';

/**
 * Per-biome GENERATION config (skeleton strategy + decoration budgets).
 *
 * Like config/params.ts, these objects are intentionally MUTABLE live-tuning
 * data — tools may write straight into them. BUT: the `baseline` skeleton
 * params are LOAD-BEARING. They are the exact literals of the original
 * earthen cave generator, and tests/gen-golden.test.ts locks FNV-1a hashes
 * of the worlds they produce. Changing any baseline number (or the order of
 * the artery list) changes every existing seed's world; do it deliberately,
 * one value at a time, flagged in the commit (CLAUDE.md invariant #4).
 */

/**
 * Bumps with deliberate generation changes; the expedition save records it
 * and resume retires mismatched saves (restoreLevel's pristine-regen coupling
 * means a stale save against new generation silently desyncs otherwise).
 * v2: per-biome skeleton flip + authored prefab placement pass.
 */
export const GEN_VERSION = 2;

/* ============================================================
 * Baseline skeleton params (golden-hash locked)
 * ============================================================ */

/**
 * Row anchor resolved at carve time. Mirrors the original generator's inline
 * clamp expressions, which mix absolute rows, HEIGHT fractions, and
 * floor-band offsets.
 */
export type RowAnchor =
  | { kind: 'abs'; v: number } // literal row
  | { kind: 'hfrac'; v: number } // HEIGHT * v
  | { kind: 'floorOff'; v: number }; // floorBand - v

export interface ArterySpec {
  /** Center row = HEIGHT * baseFrac (jitter added below). */
  baseFrac: number;
  /**
   * Span of the uniform base jitter: base += (rng - 0.5) * baseJitter.
   * 0 means NO rng draw at all — the draw count is stream-order load-bearing.
   */
  baseJitter: number;
  amp1: number;
  freq1: number;
  amp2: number;
  freq2: number;
  clampLo: RowAnchor;
  clampHi: RowAnchor;
  radius: number;
  /** Carve a disc on every Nth column (x % carveEvery === 0). */
  carveEvery: number;
  /** The primary artery writes the tunnelY profile (spawn chamber anchor). */
  primary?: boolean;
}

export interface ShaftParams {
  /** Shaft x anchors as WIDTH fractions (jittered at carve time). */
  fracs: number[];
  /** Span of the uniform x jitter applied to each anchor. */
  xJitter: number;
  /** Sine sway amplitude = ampBase + rng * ampRand. */
  ampBase: number;
  ampRand: number;
  yStart: number;
  yStep: number;
  /** Shaft stops at floorBand - floorMargin. */
  floorMargin: number;
  /** Random-walk jitter per step: jitter += (rng - 0.5) * walkStep. */
  walkStep: number;
  /** Random-walk jitter clamp (±). */
  walkClamp: number;
  /** Sine sway frequency over y. */
  freq: number;
  /** Carve x clamped to [xClamp, WIDTH - xClamp]. */
  xClamp: number;
  radius: number;
}

export interface ChamberParams {
  count: number;
  /** cx = xMargin + rng * (WIDTH - 2 * xMargin). */
  xMargin: number;
  /** cy = yMin + rng * (floorBand - ySpanOff). */
  yMin: number;
  ySpanOff: number;
  /** Ellipse radii: r = base + rng * rand (rx drawn before ry). */
  rxBase: number;
  rxRand: number;
  ryBase: number;
  ryRand: number;
}

export interface StalactiteParams {
  /** Column scan range: [xMargin, WIDTH - xMargin). */
  xMargin: number;
  /** Ceiling scan stops at floorBand - ceilMaxOff. */
  ceilMaxOff: number;
  /** Max open-run probe below a ceiling cell. */
  probeDepth: number;
  /** Minimum open depth below the ceiling to consider a stalactite. */
  minDepth: number;
  chance: number;
  /** Length = lenBase + floor(rng * min(lenRandCap, depth - lenDepthOff)). */
  lenBase: number;
  lenRandCap: number;
  lenDepthOff: number;
  /** Initial half-width = round(len * hwFrac). */
  hwFrac: number;
  /** Chance of a 1-cell wobble bulge per row. */
  wobChance: number;
  /** Chance per row that the half-width tapers by 1. */
  taperChance: number;
  stalagChance: number;
  /** Stalagmite forms only when the open run is at least this deep. */
  stalagMinDepth: number;
  stalagLenBase: number;
  stalagLenRand: number;
  stalagHwFrac: number;
  stalagTaperChance: number;
  /** Column skip after placing: x += skipBase + floor(rng * skipRand). */
  skipBase: number;
  skipRand: number;
}

export interface BaselineSkeletonParams {
  /** Wall probability per 2x2 noise block. */
  noiseDensity: number;
  caPasses: number;
  /** Carved in array order; exactly one entry should be primary. */
  arteries: ArterySpec[];
  shafts: ShaftParams;
  chambers: ChamberParams;
  /** Spawn chamber disc radius at (WIDTH/2, tunnelY[WIDTH/2]). */
  spawnRadius: number;
  stalactites: StalactiteParams;
  speckPasses: number;
  /** Chance to strip a wall speck with exactly one 4-neighbor. */
  speckLoneChance: number;
}

/* ============================================================
 * New skeleton params (not yet wired to any biome — GEN maps
 * everything to baseline; a later step flips them per biome)
 * ============================================================ */

export interface FungalParams {
  /** Wall probability of the background noise fill. */
  fillDensity: number;
  chains: number;
  links: number;
  rMin: number;
  rMax: number;
  throatW: number;
  artery: ArterySpec;
  /** CA passes run AFTER carving for organic blending. */
  caPasses: number;
  spawnRadius: number;
  minArea: number;
  tunnelRadius: number;
}

export interface CrevasseParams {
  field: { scaleX: number; scaleY: number; octaves: number; threshold: number };
  tunnels: {
    countMin: number;
    countMax: number;
    radiusMin: number;
    radiusMax: number;
    turn: number;
    gravityBias: number;
    branchChance: number;
    maxBranches: number;
    steps: number;
    xMargin: number;
  };
  shelves: { count: number; lenMin: number; lenMax: number; radius: number };
  spawnRadius: number;
  minArea: number;
  tunnelRadius: number;
}

export interface GalleryParams {
  fillDensity: number;
  fillCAPasses: number;
  /** Stacked low-amplitude wide arteries, top to bottom. */
  galleries: ArterySpec[];
  /** Flattened chambers (rx >> ry). */
  chambers: ChamberParams;
  sumps: { count: number; rMin: number; rMax: number; yFracMin: number; yFracMax: number };
  shafts: ShaftParams;
  spawnRadius: number;
  minArea: number;
  tunnelRadius: number;
}

export interface ScaffoldParams {
  grid: {
    cellW: number;
    cellH: number;
    jitter: number;
    roomWFrac: number;
    roomHFrac: number;
    corridorW: number;
    skipChance: number;
  };
  /** Chance per cell to flip wall/open before the roughening CA passes. */
  sprinkle: number;
  caPasses: number;
  /** Vertical shafts at every Nth grid column. */
  shaftEvery: number;
  shaftHalfW: number;
  spawnRadius: number;
  minArea: number;
  tunnelRadius: number;
}

export interface VaultParams {
  fillDensity: number;
  caPasses: number;
  vaults: {
    countMin: number;
    countMax: number;
    rxMin: number;
    rxMax: number;
    ryMin: number;
    ryMax: number;
    yFracMin: number;
    yFracMax: number;
    xMargin: number;
  };
  pillars: {
    wMin: number;
    wMax: number;
    spacingMin: number;
    spacingMax: number;
    /** Pillar height as a fraction of the vault ellipse column height. */
    heightFrac: number;
  };
  arteries: ArterySpec[];
  shafts: ShaftParams;
  spawnRadius: number;
  minArea: number;
  tunnelRadius: number;
}

export interface TubeParams {
  fillDensity: number;
  caPasses: number;
  walkers: {
    countMin: number;
    countMax: number;
    steps: number;
    radiusMin: number;
    radiusMax: number;
    turn: number;
    gravityBias: number;
    branchChance: number;
    maxBranches: number;
    xMargin: number;
    yFracMin: number;
    yFracMax: number;
  };
  chambers: {
    count: number;
    rMin: number;
    rMax: number;
    lobes: number;
    xMargin: number;
    yMin: number;
    ySpanOff: number;
  };
  spawnRadius: number;
  minArea: number;
  tunnelRadius: number;
}

export type SkeletonSpec =
  | { kind: 'baseline'; params: BaselineSkeletonParams }
  | { kind: 'fungalPockets'; params: FungalParams }
  | { kind: 'frozenCrevasses'; params: CrevasseParams }
  | { kind: 'floodedGalleries'; params: GalleryParams }
  | { kind: 'timberScaffold'; params: ScaffoldParams }
  | { kind: 'crystalVaults'; params: VaultParams }
  | { kind: 'volcanicTubes'; params: TubeParams };

/** Authored-prefab placement budget for one biome's levels. */
export interface PrefabBudget {
  /** Slots rolled per level: rng.int within [min, max] inclusive. */
  count: [number, number];
  /** Registry tags eligible for this biome (any-of match). */
  tags: string[];
  /** Minimum center distance (cells) between two placed prefabs. */
  minSpacing: number;
  /** Minimum center distance (cells) from the spawn chamber. */
  minSpawnDist: number;
}

export interface GenDef {
  skeleton: SkeletonSpec;
  /** Discrete gold pocket count (decoration stage). */
  goldPockets: number;
  /** Placement attempts cap for gold pockets. */
  goldTriesCap: number;
  /** Combustible seed pocket count (oil/gunpowder). */
  seedPockets: number;
  /** Authored prefab placement budget (worldgen pass after the region graph). */
  prefabs: PrefabBudget;
}

/* ============================================================
 * Default param factories (fresh objects per call so tuning one
 * biome can never silently retune another)
 * ============================================================ */

/** The original earthen skeleton, literal for literal. GOLDEN-HASH LOCKED. */
export function baselineSkeletonParams(): BaselineSkeletonParams {
  return {
    noiseDensity: 0.54,
    caPasses: 5,
    arteries: [
      // Primary meandering artery (defines tunnelY / the spawn chamber row).
      {
        baseFrac: 0.4,
        baseJitter: 64,
        amp1: 88,
        freq1: 0.0075,
        amp2: 116,
        freq2: 0.0021,
        clampLo: { kind: 'abs', v: 60 },
        clampHi: { kind: 'floorOff', v: 92 },
        radius: 16,
        carveEvery: 4,
        primary: true,
      },
      // Lower meandering artery.
      {
        baseFrac: 0.74,
        baseJitter: 0,
        amp1: 52,
        freq1: 0.0065,
        amp2: 68,
        freq2: 0.0025,
        clampLo: { kind: 'hfrac', v: 0.58 },
        clampHi: { kind: 'floorOff', v: 28 },
        radius: 14,
        carveEvery: 4,
      },
      // Upper gallery artery.
      {
        baseFrac: 0.14,
        baseJitter: 0,
        amp1: 36,
        freq1: 0.0085,
        amp2: 44,
        freq2: 0.003,
        clampLo: { kind: 'abs', v: 32 },
        clampHi: { kind: 'hfrac', v: 0.26 },
        radius: 14,
        carveEvery: 4,
      },
      // Mid gallery artery.
      {
        baseFrac: 0.57,
        baseJitter: 0,
        amp1: 48,
        freq1: 0.007,
        amp2: 60,
        freq2: 0.0024,
        clampLo: { kind: 'hfrac', v: 0.46 },
        clampHi: { kind: 'hfrac', v: 0.68 },
        radius: 14,
        carveEvery: 4,
      },
    ],
    shafts: {
      fracs: [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92],
      xJitter: 36,
      ampBase: 24,
      ampRand: 32,
      yStart: 20,
      yStep: 3,
      floorMargin: 6,
      walkStep: 4.6,
      walkClamp: 28,
      freq: 0.0125,
      xClamp: 20,
      radius: 11,
    },
    chambers: {
      count: 18,
      xMargin: 48,
      yMin: 80,
      ySpanOff: 144,
      rxBase: 26,
      rxRand: 20,
      ryBase: 17,
      ryRand: 13,
    },
    spawnRadius: 24,
    stalactites: {
      xMargin: 8,
      ceilMaxOff: 62,
      probeDepth: 90,
      minDepth: 52,
      chance: 0.35,
      lenBase: 11,
      lenRandCap: 13,
      lenDepthOff: 36,
      hwFrac: 0.42,
      wobChance: 0.3,
      taperChance: 0.75,
      stalagChance: 0.4,
      stalagMinDepth: 70,
      stalagLenBase: 6,
      stalagLenRand: 7,
      stalagHwFrac: 0.7,
      stalagTaperChance: 0.8,
      skipBase: 24,
      skipRand: 30,
    },
    speckPasses: 2,
    speckLoneChance: 0.7,
  };
}

export function fungalParams(): FungalParams {
  return {
    // denser-than-baseline base rock so the BUBBLES read as the level;
    // CA-blended noise voids are large enough to join the web (minArea)
    // instead of stippling it with drill tunnels
    fillDensity: 0.62,
    chains: 14,
    links: 6,
    rMin: 12,
    rMax: 24,
    throatW: 8,
    artery: {
      baseFrac: 0.5,
      baseJitter: 60,
      amp1: 60,
      freq1: 0.006,
      amp2: 40,
      freq2: 0.0019,
      clampLo: { kind: 'abs', v: 70 },
      clampHi: { kind: 'floorOff', v: 60 },
      radius: 13,
      carveEvery: 4,
    },
    caPasses: 5,
    spawnRadius: 26,
    minArea: 350,
    tunnelRadius: 6,
  };
}

export function crevasseParams(): CrevasseParams {
  return {
    field: { scaleX: 0.05, scaleY: 0.008, octaves: 2, threshold: 0.52 },
    tunnels: {
      countMin: 6,
      countMax: 9,
      radiusMin: 6,
      radiusMax: 9,
      turn: 0.9,
      gravityBias: 1.3,
      branchChance: 0.015,
      maxBranches: 4,
      steps: 420,
      xMargin: 110,
    },
    shelves: { count: 26, lenMin: 26, lenMax: 60, radius: 4 },
    spawnRadius: 26,
    minArea: 500,
    tunnelRadius: 6,
  };
}

export function galleryParams(): GalleryParams {
  const gallery = (baseFrac: number, radius: number): ArterySpec => ({
    baseFrac,
    baseJitter: 22,
    amp1: 16,
    freq1: 0.0045,
    amp2: 10,
    freq2: 0.0016,
    clampLo: { kind: 'abs', v: 40 },
    clampHi: { kind: 'floorOff', v: 26 },
    radius,
    carveEvery: 4,
  });
  return {
    // denser fill + extra CA passes: stray noise pockets close up, so the
    // open space is dominated by the galleries themselves (the full-res
    // connectivity contract needs >= 70% of open cells on the main web)
    fillDensity: 0.66,
    fillCAPasses: 5,
    galleries: [gallery(0.16, 18), gallery(0.3, 19), gallery(0.44, 20), gallery(0.58, 21), gallery(0.72, 22)],
    chambers: {
      count: 14,
      xMargin: 70,
      yMin: 110,
      ySpanOff: 240,
      rxBase: 32,
      rxRand: 16,
      ryBase: 7,
      ryRand: 6,
    },
    sumps: { count: 7, rMin: 10, rMax: 16, yFracMin: 0.76, yFracMax: 0.84 },
    shafts: {
      fracs: [0.16, 0.4, 0.6, 0.86],
      xJitter: 30,
      ampBase: 12,
      ampRand: 16,
      yStart: 30,
      yStep: 3,
      floorMargin: 6,
      walkStep: 4.0,
      walkClamp: 22,
      freq: 0.009,
      xClamp: 20,
      radius: 13,
    },
    spawnRadius: 26,
    minArea: 300,
    tunnelRadius: 7,
  };
}

export function scaffoldParams(): ScaffoldParams {
  return {
    grid: {
      cellW: 130,
      cellH: 90,
      jitter: 22,
      roomWFrac: 0.62,
      roomHFrac: 0.55,
      corridorW: 9,
      skipChance: 0.1,
    },
    sprinkle: 0.05,
    caPasses: 2,
    shaftEvery: 2,
    shaftHalfW: 5,
    spawnRadius: 26,
    minArea: 500,
    tunnelRadius: 6,
  };
}

export function vaultParams(): VaultParams {
  return {
    // denser-than-baseline rock so the tall vaults ARE the level (0.5 read
    // as murky half-open noise that drowned them); the extra CA passes
    // consolidate noise voids into blobs big enough to join the web
    fillDensity: 0.62,
    caPasses: 6,
    vaults: {
      countMin: 8,
      countMax: 12,
      rxMin: 18,
      rxMax: 30,
      ryMin: 40,
      ryMax: 70,
      yFracMin: 0.26,
      yFracMax: 0.62,
      xMargin: 90,
    },
    pillars: { wMin: 3, wMax: 5, spacingMin: 24, spacingMax: 40, heightFrac: 0.9 },
    arteries: [
      {
        baseFrac: 0.3,
        baseJitter: 40,
        amp1: 40,
        freq1: 0.006,
        amp2: 30,
        freq2: 0.0018,
        clampLo: { kind: 'abs', v: 60 },
        clampHi: { kind: 'floorOff', v: 80 },
        radius: 12,
        carveEvery: 4,
      },
      {
        baseFrac: 0.62,
        baseJitter: 40,
        amp1: 36,
        freq1: 0.0055,
        amp2: 28,
        freq2: 0.002,
        clampLo: { kind: 'hfrac', v: 0.5 },
        clampHi: { kind: 'floorOff', v: 40 },
        radius: 12,
        carveEvery: 4,
      },
    ],
    shafts: {
      fracs: [0.18, 0.5, 0.82],
      xJitter: 30,
      ampBase: 18,
      ampRand: 24,
      yStart: 24,
      yStep: 3,
      floorMargin: 6,
      walkStep: 4.2,
      walkClamp: 24,
      freq: 0.011,
      xClamp: 20,
      radius: 10,
    },
    spawnRadius: 26,
    // CA-consolidated geode blobs cluster just under 500 cells — join them
    minArea: 220,
    tunnelRadius: 6,
  };
}

export function tubeParams(): TubeParams {
  return {
    fillDensity: 0.62,
    caPasses: 3,
    // denser web reaching closer to the borders: locks placed near the
    // edges (progressive relaxation goes there on tight seeds) must land
    // within connectToCaves' walk range of a connected region
    walkers: {
      countMin: 10,
      countMax: 14,
      steps: 360,
      radiusMin: 8,
      radiusMax: 14,
      turn: 0.7,
      gravityBias: 0.35,
      branchChance: 0.045,
      maxBranches: 8,
      xMargin: 90,
      yFracMin: 0.08,
      yFracMax: 0.3,
    },
    chambers: { count: 20, rMin: 9, rMax: 16, lobes: 4, xMargin: 60, yMin: 100, ySpanOff: 180 },
    spawnRadius: 26,
    minArea: 300,
    tunnelRadius: 7,
  };
}

/** Default spec instance per skeleton kind (used by structural tests). */
export function defaultSkeletonSpec(kind: SkeletonSpec['kind']): SkeletonSpec {
  switch (kind) {
    case 'baseline':
      return { kind, params: baselineSkeletonParams() };
    case 'fungalPockets':
      return { kind, params: fungalParams() };
    case 'frozenCrevasses':
      return { kind, params: crevasseParams() };
    case 'floodedGalleries':
      return { kind, params: galleryParams() };
    case 'timberScaffold':
      return { kind, params: scaffoldParams() };
    case 'crystalVaults':
      return { kind, params: vaultParams() };
    case 'volcanicTubes':
      return { kind, params: tubeParams() };
  }
}

function defaultPrefabBudget(): PrefabBudget {
  return {
    count: [1, 3],
    tags: ['vault', 'shrine', 'setpiece'],
    minSpacing: 180,
    minSpawnDist: 200,
  };
}

function baselineDef(): GenDef {
  return {
    skeleton: { kind: 'baseline', params: baselineSkeletonParams() },
    goldPockets: 100,
    goldTriesCap: 30000,
    seedPockets: 60,
    prefabs: defaultPrefabBudget(),
  };
}

/**
 * Per-biome skeleton selection. earthen (the golden-hash-locked baseline)
 * and scorched keep the original cave shape; the other six run bespoke
 * topologies — a DELIBERATE generation change (old seeds produce new worlds
 * on those depths; the expedition genVersion guard retires stale saves).
 */
export const GEN: Record<BiomeId, GenDef> = {
  // d1 keeps a lighter prefab budget — the onboarding depth stays readable.
  earthen: { ...baselineDef(), prefabs: { ...defaultPrefabBudget(), count: [1, 2] } },
  frozen: { ...baselineDef(), skeleton: { kind: 'frozenCrevasses', params: crevasseParams() } },
  flooded: { ...baselineDef(), skeleton: { kind: 'floodedGalleries', params: galleryParams() } },
  timber: { ...baselineDef(), skeleton: { kind: 'timberScaffold', params: scaffoldParams() } },
  scorched: baselineDef(),
  fungal: { ...baselineDef(), skeleton: { kind: 'fungalPockets', params: fungalParams() } },
  crystal: { ...baselineDef(), skeleton: { kind: 'crystalVaults', params: vaultParams() } },
  volcanic: { ...baselineDef(), skeleton: { kind: 'volcanicTubes', params: tubeParams() } },
};

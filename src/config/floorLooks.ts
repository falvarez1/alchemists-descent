import type { BiomeId, Ctx } from '@/core/types';

/**
 * Per-floor presentation: how the shared Living Descent material kit (the
 * terrain atlas, the chalk lip, the refinery backdrop) is graded on each
 * floor, so every floor reads as the same refinery in a different organ —
 * lungs (the Bellows), gut (the Rot Gardens), veins (the Drowned Cisterns),
 * heart (the Kiln Heart).
 *
 * PRESENTATION ONLY. Nothing here reaches cell types, cell colors, saves,
 * lighting or collision. The CPU sampler (render/TerrainArt.terrainAlbedo),
 * the WebGL2 compose shader and the CPU/GPU backdrop grade all read these
 * values, so the three paths cannot drift. The earthen look is the exact
 * identity the atlas shipped with: the hand-built D1 Works never shifts.
 *
 * Floors 2–4 carry a `natural` block: material follows the terrain's shape
 * (masonry on built faces, the floor's own rock elsewhere), cores sink,
 * and the backdrop steps back. On those floors the top-level gain/lift grade
 * the masonry, timber and copper; the panel and rock-row fields serve only
 * the classic sampler.
 */
export type Rgb = readonly [number, number, number];

export interface FloorLook {
  /** Atlas albedo = atlas texel * gain + lift (0–255 space). */
  readonly gain: Rgb;
  readonly lift: Rgb;
  /** Exposed top/left lip color (D1's worn chalk). */
  readonly lip: Rgb;
  /** Multiplier on terrain cells with air directly beneath. */
  readonly under: Rgb;
  /** Multiplicative stain that creeps down from exposed tops (128 = none). */
  readonly crown: Rgb;
  /** 0 disables the crown band. */
  readonly crownStrength: number;
  /** Deepest crown reach in cells (each column is jagged within it). */
  readonly crownDepth: number;
  /**
   * Classic sampler only: how many of 16 wall panels (64×64 world cells, one
   * atlas repeat) draw the built masonry quadrant; the rest draw the mineral
   * rock quadrant. 16 is D1's all-masonry rule.
   */
  readonly masonryPanels: number;
  /** Stone below this row draws the rock quadrant; -1 = always rock. */
  readonly rockRow: number;
  /** Water albedo: the exposed, supported surface row and the body below. */
  readonly waterSurface: Rgb;
  readonly waterBody: Rgb;
  /** Backdrop grade applied after the player's own grade (0–1 space). */
  readonly backdropMul: Rgb;
  readonly backdropLift: Rgb;
  /** Composition variant: horizontal offset (backdrop px) and mirroring. */
  readonly backdropOffsetX: number;
  readonly backdropMirror: boolean;
  /** Opacity multiplier for the copper machinery layer. */
  readonly machinery: number;
  /** The title card's line under the floor name (house tone: dry, brief). */
  readonly epigraph: string;
  /**
   * Shape-aware dressing (render/terrainArtPlane): masonry only on built
   * faces, this floor's natural rock everywhere else, sunk cores, attached
   * undersides, a contact shadow on the backdrop. Null keeps the classic
   * sampler — the hand-built Works (floor 1) and the off-spine looks.
   */
  readonly natural: NaturalLook | null;
}

export interface NaturalLook {
  /** Quadrant of the procedural floor tile sheet (render/floorTiles). */
  readonly tile: 0 | 1 | 2 | 3;
  /** Natural rock albedo = tile texel * rockGain + rockLift (0–255 space). */
  readonly rockGain: Rgb;
  readonly rockLift: Rgb;
  /** Straight exposed run (cells) that reads as a built face. */
  readonly builtRun: number;
  /** Masonry lining thickness behind a built face (cells). */
  readonly lining: number;
  /** Interior darkening: full brightness to aoNear cells deep, aoCore at aoFar. */
  readonly aoNear: number;
  readonly aoFar: number;
  readonly aoCore: Rgb;
  /** Pixel-art banding: the inset falls in this many steps (0 = smooth)... */
  readonly aoSteps: number;
  /** ...whose edges wander with the texture: cells of depth per unit texel luminance. */
  readonly aoGrain: number;
  /** Walkable-top lip colour, its replace weight, and the left-lip weight. */
  readonly lip: Rgb;
  readonly lipMix: number;
  readonly sideMix: number;
  /** Sparse lit flecks along top lips (spores, wet glints, embers); rate of 16. */
  readonly speck: Rgb;
  readonly speckRate: number;
  /** Multiplier on faces open to the right (the shadow side). */
  readonly rightShade: number;
  /** Tile-mask feature colour, strength and depth window (cells). */
  readonly feature: Rgb;
  readonly featureStrength: number;
  readonly featureNear: number;
  readonly featureFar: number;
  /** Feature strength at the top of the world (1 = uniform; heat rises toward the depths). */
  readonly featureTop: number;
  /** Underside band: multiplier reached at the face, streaking up to 3 cells. */
  readonly drip: Rgb;
  /** Glassy rim fired onto rock that touches lava (crazed); mix 0 disables. */
  readonly glaze: Rgb;
  readonly glazeMix: number;
  /** Backdrop contact shadow: darkest multiplier at a face, reach in cells. */
  readonly contact: number;
  readonly contactReach: number;
  /** Backdrop saturation multiplier and haze (mixed after the floor tint). */
  readonly backdropSat: number;
  readonly backdropHaze: Rgb;
  readonly backdropHazeMix: number;
}

/** D1 — THE BELLOWS. The identity: exactly the values the atlas shipped with. */
const BELLOWS: FloorLook = {
  gain: [1.28, 1.28, 1.28],
  lift: [15, 20, 21],
  lip: [115, 111, 94],
  under: [0.62, 0.62, 0.67],
  crown: [128, 128, 128],
  crownStrength: 0,
  crownDepth: 1,
  masonryPanels: 16,
  rockRow: 810,
  waterSurface: [101, 142, 148],
  waterBody: [49, 91, 103],
  backdropMul: [1, 1, 1],
  backdropLift: [0, 0, 0],
  backdropOffsetX: 0,
  backdropMirror: false,
  machinery: 1,
  epigraph: 'The Works draw breath. Mind the pressure.',
  natural: null,
};

/** THE ROT GARDENS (fungal) — the gut: sickly teal-green, lichen lips, moss creep. */
const ROT_GARDENS: FloorLook = {
  gain: [1.25, 1.45, 1.3],
  lift: [14, 22, 16],
  lip: [120, 146, 108],
  under: [0.52, 0.62, 0.58],
  crown: [72, 190, 124],
  crownStrength: 0.95,
  crownDepth: 3,
  masonryPanels: 5,
  rockRow: -1,
  waterSurface: [98, 134, 104],
  waterBody: [36, 68, 54],
  backdropMul: [0.62, 0.88, 0.78],
  backdropLift: [0, 0.004, 0.003],
  backdropOffsetX: 380,
  backdropMirror: true,
  machinery: 0.7,
  epigraph: 'Where the refinery digests. Do not linger.',
  natural: {
    tile: 0,
    rockGain: [1.75, 1.7, 1.6],
    rockLift: [6, 7, 5],
    builtRun: 40,
    lining: 7,
    aoNear: 3,
    aoFar: 17,
    aoCore: [0.36, 0.47, 0.42],
    aoSteps: 4,
    aoGrain: 10,
    lip: [150, 185, 120],
    lipMix: 0.55,
    sideMix: 0.3,
    speck: [178, 222, 150],
    speckRate: 3,
    rightShade: 0.82,
    feature: [150, 132, 96],
    featureStrength: 1.0,
    featureNear: 1,
    featureFar: 11,
    featureTop: 1,
    drip: [0.55, 0.6, 0.5],
    glaze: [0, 0, 0],
    glazeMix: 0,
    contact: 0.45,
    contactReach: 7,
    backdropSat: 0.5,
    backdropHaze: [0.015, 0.03, 0.028],
    backdropHazeMix: 0.3,
  },
};

/** THE DROWNED CISTERNS (flooded) — the veins: deep blue-green, wet highlights. */
const DROWNED_CISTERNS: FloorLook = {
  gain: [1.2, 1.4, 1.5],
  lift: [10, 20, 26],
  lip: [132, 172, 182],
  under: [0.48, 0.6, 0.72],
  crown: [92, 150, 152],
  crownStrength: 0.55,
  crownDepth: 3,
  masonryPanels: 12,
  rockRow: -1,
  waterSurface: [92, 148, 164],
  waterBody: [26, 66, 88],
  backdropMul: [0.6, 0.82, 1.0],
  backdropLift: [0, 0.004, 0.01],
  backdropOffsetX: 760,
  backdropMirror: false,
  machinery: 1.15,
  epigraph: 'The veins run cold. Something large keeps them company.',
  natural: {
    tile: 1,
    rockGain: [1.82, 1.88, 1.94],
    rockLift: [6, 8, 10],
    builtRun: 16,
    lining: 12,
    aoNear: 3,
    aoFar: 18,
    aoCore: [0.56, 0.62, 0.68],
    aoSteps: 4,
    aoGrain: 10,
    lip: [165, 205, 212],
    lipMix: 0.55,
    sideMix: 0.35,
    speck: [210, 235, 240],
    speckRate: 1,
    rightShade: 0.8,
    feature: [132, 176, 184],
    featureStrength: 0.6,
    featureNear: 1,
    featureFar: 12,
    featureTop: 1,
    drip: [0.5, 0.6, 0.66],
    glaze: [0, 0, 0],
    glazeMix: 0,
    contact: 0.4,
    contactReach: 8,
    backdropSat: 0.5,
    backdropHaze: [0.01, 0.03, 0.045],
    backdropHazeMix: 0.3,
  },
};

/** THE KILN HEART (volcanic) — the heart: soot-dark brick, ash lips, ember-warm grade.
 *  Its backdrop is ember-LIT, not stepped back: the far refinery and its copper
 *  machinery glow warm through a thin smoke haze, and a deep contact shadow
 *  stands the rock in front of it (QA: it read as floating slabs on flat black). */
const KILN_HEART: FloorLook = {
  gain: [1.35, 1.15, 1.05],
  lift: [16, 9, 7],
  lip: [152, 132, 118],
  under: [0.42, 0.32, 0.3],
  crown: [204, 96, 62],
  crownStrength: 0.6,
  crownDepth: 3,
  masonryPanels: 9,
  rockRow: -1,
  waterSurface: [118, 128, 126],
  waterBody: [48, 60, 64],
  backdropMul: [1.6, 0.88, 0.56],
  backdropLift: [0.03, 0.01, 0.002],
  backdropOffsetX: 1160,
  backdropMirror: true,
  machinery: 1.75,
  epigraph: 'The heart still burns. It would rather you did not.',
  natural: {
    tile: 2,
    rockGain: [1.8, 1.65, 1.6],
    rockLift: [6, 4, 4],
    builtRun: 36,
    lining: 8,
    aoNear: 3,
    aoFar: 16,
    aoCore: [0.46, 0.4, 0.38],
    aoSteps: 4,
    aoGrain: 10,
    lip: [190, 158, 128],
    lipMix: 0.5,
    sideMix: 0.28,
    speck: [255, 150, 70],
    speckRate: 1,
    rightShade: 0.8,
    feature: [255, 96, 30],
    featureStrength: 0.9,
    featureNear: 3,
    featureFar: 20,
    featureTop: 0.35,
    drip: [0.45, 0.38, 0.36],
    glaze: [132, 66, 30],
    glazeMix: 0.62,
    contact: 0.3,
    contactReach: 10,
    backdropSat: 0.9,
    backdropHaze: [0.12, 0.045, 0.02],
    backdropHazeMix: 0.18,
  },
};

/** Off-spine biomes (test arenas, the Vault, legacy floors) keep a restrained grade. */
export const FLOOR_LOOKS: Readonly<Record<BiomeId, FloorLook>> = {
  earthen: BELLOWS,
  fungal: ROT_GARDENS,
  flooded: DROWNED_CISTERNS,
  volcanic: KILN_HEART,
  frozen: {
    ...BELLOWS,
    gain: [1.14, 1.26, 1.42], lift: [16, 24, 34], lip: [206, 220, 238], under: [0.56, 0.62, 0.74],
    crown: [150, 176, 214], crownStrength: 0.6, crownDepth: 3, masonryPanels: 8, rockRow: -1,
    backdropMul: [0.76, 0.9, 1.14], backdropLift: [0.004, 0.01, 0.024], backdropOffsetX: 540,
    epigraph: 'The cold keeps everything. Including you, if you stop.',
  },
  timber: {
    ...BELLOWS,
    gain: [1.28, 1.18, 1.06], lift: [18, 16, 12], lip: [140, 122, 90], crown: [110, 150, 104],
    crownStrength: 0.45, crownDepth: 3, masonryPanels: 14, rockRow: -1,
    backdropMul: [1.04, 0.94, 0.8], backdropOffsetX: 220, backdropMirror: true,
    epigraph: 'Timber, pitch and old scaffolding. Keep fire at arm’s length.',
  },
  crystal: {
    ...BELLOWS,
    gain: [1.12, 1.08, 1.38], lift: [15, 13, 28], lip: [168, 160, 206], crown: [146, 136, 212],
    crownStrength: 0.45, crownDepth: 3, masonryPanels: 6, rockRow: -1,
    backdropMul: [0.88, 0.8, 1.14], backdropLift: [0.01, 0.004, 0.024], backdropOffsetX: 960,
    epigraph: 'The rock remembers light. It hums when you pass.',
  },
  scorched: {
    ...BELLOWS,
    gain: [1.24, 1.06, 0.94], lift: [18, 12, 8], lip: [150, 128, 104], under: [0.5, 0.42, 0.4],
    crown: [158, 112, 82], crownStrength: 0.5, crownDepth: 3, masonryPanels: 8, rockRow: -1,
    backdropMul: [1.08, 0.84, 0.7], backdropLift: [0.014, 0.004, 0], backdropOffsetX: 640, backdropMirror: true,
    epigraph: 'Everything here has burned once already.',
  },
  gilded: {
    ...BELLOWS,
    gain: [1.3, 1.18, 0.98], lift: [20, 16, 8], lip: [186, 158, 102], masonryPanels: 14, rockRow: -1,
    backdropMul: [1.1, 0.98, 0.78], backdropLift: [0.016, 0.01, 0],
    epigraph: 'Somebody hoarded all of this. Somebody may want it back.',
  },
};

/** The look for the level on screen. The hand-built Works always uses the identity. */
export function floorLookFor(ctx: Pick<Ctx, 'levels'>): FloorLook {
  const runtime = ctx.levels?.current;
  if (!runtime || runtime.living) return BELLOWS;
  return FLOOR_LOOKS[runtime.def.biome] ?? BELLOWS;
}

/**
 * Whether one 64-cell wall panel draws masonry. Integer-only (the GLSL port in
 * ComposeShader mirrors it exactly); small operands so no path can overflow.
 */
export function masonryPanel(panelX: number, panelY: number, masonryPanels: number): boolean {
  if (masonryPanels >= 16) return true;
  const h = (panelX * 37 + panelY * 61 + panelX * panelY * 11 + (panelX ^ panelY) * 7) & 15;
  return h < masonryPanels;
}

/** Crown reach for one column: jagged between 1 and crownDepth cells. */
export function crownReach(x: number, crownDepth: number): number {
  const jag = (x * 13 + (x >> 2) * 7) & 3;
  return Math.max(1, crownDepth - jag);
}

/** Underside streak reach for one column (1–3 cells): drips, root hairs, soot. */
export function dripReach(x: number): number {
  const h = (x * 7 + (x >> 3) * 13) & 7;
  return h < 3 ? 1 : h < 6 ? 2 : 3;
}

/** Whether a top-lip cell carries a lit fleck (rate of 16). Small integer operands. */
export function lipSpeck(x: number, y: number, rate: number): boolean {
  return ((x * 13 + y * 7 + (x >> 2) * 5) & 15) < rate;
}

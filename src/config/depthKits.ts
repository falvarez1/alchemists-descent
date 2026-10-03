import type { BiomeId } from '@/core/types';
import { FLOOR_LOOKS } from '@/config/floorLooks';

/**
 * DEPTH KITS — the layered scenery behind (and in front of) the play layer,
 * one kit per biome with a generic fallback, so a biome nobody has written a
 * kit for yet still renders with depth (graded from its floor look).
 *
 * A kit is 3–5 background planes ordered FAR → NEAR, a light-shaft plane
 * among them, a foreground occluder plane (parallax > 1) and depth
 * particles. Planes are either authored PNGs (the Living Descent refinery
 * plates) or procedural silhouettes painted at load in the game's pixel grain
 * (render/depth/kitArt). Atmospheric perspective is data: each plane's haze
 * mix and kept contrast, so far planes read lighter, cooler and flatter.
 *
 * PRESENTATION ONLY: nothing here reaches cells, collision, lighting or saves.
 * The planes ride the compositors' existing five backdrop slots (CPU,
 * WebGL2 and WebGPU read the same bitmaps and settings), the foreground is a
 * separate presentation quad, and the particles draw into the sprite overlay.
 */

export type Rgb = readonly [number, number, number];

export type DepthKitId = 'bellows' | 'rot' | 'cisterns' | 'kiln' | 'cold' | 'glass' | 'generic';

/** Colours an art builder paints with (0–255). The generic kit derives them from a floor look. */
export interface KitPalette {
  /** Far haze / fog: the colour distance fades into. */
  readonly haze: Rgb;
  /** Fog-bank highlight in the far fill. */
  readonly fog: Rgb;
  /** Darkest far-fill value. */
  readonly deep: Rgb;
  /** Silhouette body colour of mid/near structures. */
  readonly body: Rgb;
  /** Light-facing rim on silhouettes. */
  readonly rim: Rgb;
  /** Secondary material (copper, mushroom caps, brick). */
  readonly accent: Rgb;
  /** Emissive accents (windows, spores, kiln mouths). */
  readonly glow: Rgb;
  /** Light-shaft colour. */
  readonly shaft: Rgb;
  /** Foreground silhouette (near-black, tinted). */
  readonly fg: Rgb;
  /** Foreground rim (a faint catch of the floor's light). */
  readonly fgRim: Rgb;
  /** Direction toward the light in texels: [-1,-1] upper-left, [0,1] from below (the kiln). */
  readonly light: readonly [number, number];
  /** Soft tinted light (prism spill, glass panes): M_TINT + k in the plane art. */
  readonly tints?: readonly Rgb[];
  /** The kit's value/colour ramp, dark (0) to its brightest light (1): lit silhouettes live on it. */
  readonly ramp?: readonly (readonly [number, Rgb])[];
  /** Where the kit's light comes from (render/depth/lightArt). */
  readonly lightField?: KitLight;
}

/** A soft light source in plane fractions, with an elliptical falloff. */
export interface LightCore {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly k: number;
}

/**
 * A kit's light: a vertical profile ([row fraction, light] stops, first and
 * last equal so the plane wraps), soft cores with a power falloff (a hot core,
 * not a flat wash), and a slow smoke modulation.
 */
export interface KitLight {
  readonly rows: readonly (readonly [number, number])[];
  readonly cores: readonly LightCore[];
  readonly falloff: number;
  readonly smoke: number;
  readonly smokeCell: number;
}

export type DepthPlaneSource =
  | { readonly kind: 'art'; readonly art: string; readonly width: number; readonly height: number }
  | { readonly kind: 'image'; readonly src: string };

export interface DepthPlaneSpec {
  readonly label: string;
  readonly source: DepthPlaneSource;
  /** Camera multiplier (0 = pinned at infinity, 1 = moves with the play layer). */
  readonly parallax: number;
  /** World cells per texel (1 = the game's cell grain; 0.5 = the 2× refinery plates). */
  readonly scale: number;
  readonly opacity: number;
  /** How much real light (lantern, wand, lava glow) reaches the plane: ~0.1 far … 1 near. */
  readonly lit: number;
  /** Atmospheric perspective baked into the plane at load. */
  readonly haze: { readonly mix: number; readonly contrast: number; readonly saturation?: number; readonly mist?: number };
  readonly offsetX?: number;
  readonly offsetY?: number;
  /** Texture drift in texels per tick (heat rising through a plume plane: y > 0 moves the art up). */
  readonly scroll?: { readonly x: number; readonly y: number };
  /** Breathing opacity (light shafts): opacity × (1 - amp + amp·(0.5 + 0.5 sin)). */
  readonly pulse?: { readonly amp: number; readonly period: number };
  /** This plane is light shafts: the particles brighten inside them. */
  readonly shafts?: boolean;
}

export interface ForegroundSpec {
  /** > 1: the plane moves faster than the play layer (it is nearer than the camera's focus). */
  readonly parallax: number;
  /** World cells per texel (1.5 = 3×3 canvas pixels: a touch coarser than the play layer). */
  readonly scale: number;
  /** Peak opacity of the silhouettes. */
  readonly opacity: number;
  /** Art builder id (render/depth/kitArt FOREGROUND_ART). */
  readonly art: string;
}

export type ParticleLight = 'open' | 'light';

export interface DepthParticleSpec {
  readonly label: string;
  /** Plane speed: far < 1 (behind the play layer), near > 1 (in front of it). */
  readonly parallax: number;
  /** Particles per screen. */
  readonly count: number;
  /** Additive colour (0–1 linear-ish, like addPx). */
  readonly color: Rgb;
  /** Point size in fine pixels (half a cell each): far motes 1–2, near motes 2–3. */
  readonly size: 1 | 2 | 3;
  /** Drift in cells per tick (plane space). */
  readonly drift: readonly [number, number];
  /** Sideways wander amplitude (cells) and rate. */
  readonly sway: number;
  readonly twinkle: number;
  /** Only over open air (hidden by terrain): true for everything behind the play layer. */
  readonly behind: boolean;
  /** 'open': only the designed darkness dims it; 'light': it also catches real light (lantern motes). */
  readonly light: ParticleLight;
  /** Brightness multiplier inside the kit's light shafts. */
  readonly inShafts?: number;
}

/**
 * The floor's backdrop grade while a kit is active (0–1 space, like FloorLook's
 * backdropMul/Lift and natural haze). Kits bake their own colour, so this is
 * normally neutral; the natural floors' contact shadow still applies.
 */
export interface KitFloorGrade {
  readonly mul: Rgb;
  readonly lift: Rgb;
  readonly sat: number;
  readonly haze: Rgb;
  readonly hazeMix: number;
}

export interface DepthKit {
  readonly id: DepthKitId;
  readonly label: string;
  readonly palette: KitPalette;
  /** FAR → NEAR, at most five (the compositors' backdrop slots). */
  readonly planes: readonly DepthPlaneSpec[];
  readonly foreground: ForegroundSpec | null;
  readonly particles: readonly DepthParticleSpec[];
  readonly grade: KitFloorGrade;
  /** Seed for the procedural art (fixed per kit: every run sees the same scenery). */
  readonly seed: number;
}

export const MAX_DEPTH_PLANES = 5;

const NEUTRAL_GRADE: KitFloorGrade = { mul: [1, 1, 1], lift: [0, 0, 0], sat: 1, haze: [0, 0, 0], hazeMix: 0 };
const ASSET = (file: string): string => `${import.meta.env.BASE_URL}assets/living-descent/${file}`;

/* ------------------------------------------------------------------ *
 * THE BELLOWS — the refinery's lungs. The accepted refinery plate stays
 * the far wall; a hazy hall of pressure stacks, high-grate light shafts,
 * the copper machinery and a near plane of girders, chains and the great
 * bellows step it forward. Mist-blue air, copper rims, amber windows.
 * ------------------------------------------------------------------ */
const BELLOWS: DepthKit = {
  id: 'bellows',
  label: 'The Bellows',
  seed: 0xbe11,
  palette: {
    haze: [66, 86, 100], fog: [96, 116, 126], deep: [16, 22, 28],
    body: [30, 40, 48], rim: [92, 104, 104], accent: [96, 66, 44], glow: [196, 138, 70],
    shaft: [170, 188, 192], fg: [8, 10, 12], fgRim: [62, 66, 62], light: [-1, -1],
    // Mist-blue slate, lit from high grates.
    ramp: [[0, [9, 13, 17]], [0.3, [24, 34, 42]], [0.55, [50, 68, 80]], [0.8, [92, 112, 122]], [1, [150, 168, 172]]],
    lightField: {
      rows: [[0, 0.32], [0.4, 0.22], [0.8, 0.28], [1, 0.32]],
      cores: [{ x: 0.3, y: 0.2, rx: 0.24, ry: 0.45, k: 0.4 }, { x: 0.74, y: 0.28, rx: 0.2, ry: 0.4, k: 0.35 }],
      falloff: 1.5, smoke: 0.3, smokeCell: 70,
    },
  },
  planes: [
    { label: 'Distant refinery', source: { kind: 'image', src: ASSET('refinery-waterworks.webp') }, parallax: 0.08, scale: 0.46,
      opacity: 1, lit: 0.12, haze: { mix: 0.08, contrast: 1.05, mist: 0.12 } },
    { label: 'Stack hall', source: { kind: 'art', art: 'bellows-hall', width: 1024, height: 512 }, parallax: 0.14, scale: 1,
      opacity: 0.32, lit: 0.25, haze: { mix: 0, contrast: 1 } },
    { label: 'Grate light', source: { kind: 'art', art: 'bellows-shafts', width: 1024, height: 512 }, parallax: 0.14, scale: 1,
      opacity: 1, lit: 0, haze: { mix: 0, contrast: 1 }, pulse: { amp: 0.35, period: 420 }, shafts: true },
    { label: 'Copper machinery', source: { kind: 'image', src: ASSET('refinery-machinery-rich.webp') }, parallax: 0.2, scale: 0.5,
      opacity: 0.52, lit: 0.7, haze: { mix: 0.06, contrast: 0.95 } },
    { label: 'Girders and chains', source: { kind: 'art', art: 'bellows-near', width: 1024, height: 640 }, parallax: 0.32, scale: 1,
      opacity: 1, lit: 0.9, haze: { mix: 0, contrast: 1 } },
  ],
  foreground: { parallax: 1.4, scale: 1.5, opacity: 0.94, art: 'bellows-fg' },
  particles: [
    { label: 'far drips', parallax: 0.14, count: 48, color: [0.25, 0.3, 0.325], size: 2, drift: [0, 0.55], sway: 0, twinkle: 0.2,
      behind: true, light: 'open', inShafts: 2.4 },
    { label: 'mist motes', parallax: 0.32, count: 83, color: [0.175, 0.2, 0.2], size: 1, drift: [0.04, -0.03], sway: 5, twinkle: 0.6,
      behind: true, light: 'open', inShafts: 3.2 },
    { label: 'near dust', parallax: 1.25, count: 38, color: [0.325, 0.288, 0.238], size: 1, drift: [0.05, 0.02], sway: 7, twinkle: 0.8,
      behind: false, light: 'light' },
  ],
  grade: { ...NEUTRAL_GRADE, mul: [1.65, 1.65, 1.55] },
};

/* ------------------------------------------------------------------ *
 * THE ROT GARDENS — the gut. Towering mushroom stalks recede into a
 * sickly green-gold spore haze; root curtains hang from the dark; spores
 * drift at every depth.
 * ------------------------------------------------------------------ */
const ROT: DepthKit = {
  id: 'rot',
  label: 'The Rot Gardens',
  seed: 0x5107,
  palette: {
    haze: [96, 118, 74], fog: [170, 184, 106], deep: [22, 36, 28],
    body: [44, 60, 46], rim: [134, 160, 98], accent: [96, 74, 56], glow: [170, 232, 130],
    shaft: [176, 196, 112], fg: [7, 10, 8], fgRim: [58, 72, 44], light: [0, -1],
    // Sickly gut-green to spore-gold; pools of spore light float at mid height.
    ramp: [[0, [8, 14, 10]], [0.22, [24, 40, 27]], [0.45, [56, 80, 44]], [0.66, [104, 128, 62]], [0.84, [164, 180, 96]], [1, [216, 224, 150]]],
    lightField: {
      rows: [[0, 0.3], [0.45, 0.42], [0.62, 0.4], [1, 0.3]],
      cores: [{ x: 0.18, y: 0.5, rx: 0.22, ry: 0.34, k: 1 }, { x: 0.56, y: 0.42, rx: 0.16, ry: 0.28, k: 0.8 },
        { x: 0.86, y: 0.56, rx: 0.15, ry: 0.26, k: 0.75 }],
      falloff: 1.6, smoke: 0.4, smokeCell: 64,
    },
  },
  planes: [
    { label: 'Spore gardens', source: { kind: 'image', src: ASSET('rot-gardens-rich.webp') }, parallax: 0.05, scale: 0.46,
      opacity: 1, lit: 0.1, haze: { mix: 0.07, contrast: 0.95, mist: 0.12 } },
    { label: 'Far stalks', source: { kind: 'art', art: 'rot-stalks-far', width: 1024, height: 512 }, parallax: 0.12, scale: 1,
      opacity: 0.38, lit: 0.22, haze: { mix: 0, contrast: 1 } },
    { label: 'Spore light', source: { kind: 'art', art: 'rot-shafts', width: 1024, height: 512 }, parallax: 0.12, scale: 1,
      opacity: 1, lit: 0, haze: { mix: 0, contrast: 1 }, pulse: { amp: 0.4, period: 520 }, shafts: true },
    { label: 'Mid garden', source: { kind: 'art', art: 'rot-mid', width: 1024, height: 576 }, parallax: 0.22, scale: 1,
      opacity: 1, lit: 0.55, haze: { mix: 0, contrast: 1 } },
    { label: 'Near stalks and roots', source: { kind: 'art', art: 'rot-near', width: 1024, height: 640 }, parallax: 0.34, scale: 1,
      opacity: 1, lit: 0.9, haze: { mix: 0, contrast: 1 } },
  ],
  foreground: { parallax: 1.4, scale: 1.5, opacity: 0.94, art: 'rot-fg' },
  particles: [
    { label: 'far spores', parallax: 0.12, count: 70, color: [0.2, 0.325, 0.15], size: 2, drift: [0.02, -0.05], sway: 4, twinkle: 0.7,
      behind: true, light: 'open', inShafts: 2.6 },
    { label: 'mid spores', parallax: 0.3, count: 64, color: [0.25, 0.425, 0.175], size: 2, drift: [0.03, -0.09], sway: 6, twinkle: 0.9,
      behind: true, light: 'open', inShafts: 2.2 },
    { label: 'near spores', parallax: 1.3, count: 38, color: [0.3, 0.475, 0.2], size: 3, drift: [0.04, -0.12], sway: 8, twinkle: 1,
      behind: false, light: 'light' },
  ],
  grade: NEUTRAL_GRADE,
};

/* ------------------------------------------------------------------ *
 * THE DROWNED CISTERNS — the veins. Arcades recede into blue-green murk;
 * drowned statues keep their vigil; light falls from somewhere above.
 * ------------------------------------------------------------------ */
const CISTERNS: DepthKit = {
  id: 'cisterns',
  label: 'The Drowned Cisterns',
  seed: 0xc157,
  palette: {
    haze: [68, 116, 124], fog: [118, 172, 172], deep: [12, 28, 36],
    body: [34, 60, 70], rim: [124, 176, 180], accent: [48, 86, 82], glow: [140, 230, 215],
    shaft: [156, 214, 216], fg: [5, 11, 14], fgRim: [48, 78, 84], light: [0, -1],
    // Blue-green murk under light wells from the surface.
    ramp: [[0, [5, 12, 16]], [0.22, [12, 33, 41]], [0.45, [29, 70, 78]], [0.68, [64, 122, 126]], [0.86, [128, 184, 182]], [1, [194, 226, 218]]],
    lightField: {
      rows: [[0, 0.52], [0.25, 0.38], [0.6, 0.2], [0.85, 0.16], [1, 0.52]],
      cores: [{ x: 0.28, y: 0, rx: 0.13, ry: 0.8, k: 0.95 }, { x: 0.7, y: 0.02, rx: 0.11, ry: 0.65, k: 0.8 }],
      falloff: 1.4, smoke: 0.35, smokeCell: 70,
    },
  },
  planes: [
    { label: 'Flooded waterworks', source: { kind: 'image', src: ASSET('refinery-waterworks.webp') }, parallax: 0.05, scale: 0.46,
      opacity: 1, lit: 0.1, haze: { mix: 0.18, contrast: 0.85, mist: 0.22 } },
    { label: 'Far arcades', source: { kind: 'art', art: 'cistern-arcade-far', width: 960, height: 512 }, parallax: 0.11, scale: 1,
      opacity: 0.4, lit: 0.2, haze: { mix: 0, contrast: 1 } },
    { label: 'Surface light', source: { kind: 'art', art: 'cistern-shafts', width: 960, height: 512 }, parallax: 0.11, scale: 1,
      opacity: 1, lit: 0, haze: { mix: 0, contrast: 1 }, pulse: { amp: 0.45, period: 360 }, shafts: true },
    { label: 'Drowned statuary', source: { kind: 'art', art: 'cistern-mid', width: 1024, height: 576 }, parallax: 0.21, scale: 1,
      opacity: 1, lit: 0.55, haze: { mix: 0, contrast: 1 } },
    { label: 'Columns and kelp', source: { kind: 'art', art: 'cistern-near', width: 1024, height: 640 }, parallax: 0.33, scale: 1,
      opacity: 1, lit: 0.9, haze: { mix: 0, contrast: 1 } },
  ],
  foreground: { parallax: 1.4, scale: 1.5, opacity: 0.94, art: 'cistern-fg' },
  particles: [
    { label: 'far bubbles', parallax: 0.11, count: 54, color: [0.175, 0.3, 0.325], size: 2, drift: [0, -0.22], sway: 2, twinkle: 0.3,
      behind: true, light: 'open', inShafts: 2.5 },
    { label: 'silt', parallax: 0.3, count: 77, color: [0.125, 0.213, 0.213], size: 2, drift: [0.05, 0.015], sway: 5, twinkle: 0.5,
      behind: true, light: 'open', inShafts: 3 },
    { label: 'near motes', parallax: 1.25, count: 42, color: [0.225, 0.325, 0.325], size: 3, drift: [0.03, -0.05], sway: 6, twinkle: 0.7,
      behind: false, light: 'light' },
  ],
  // The distance steps back behind the play layer (fix4b): the arcades matched
  // the drowned rock in hue and value, so the rock read as one more plane.
  // Darker, flatter and hazed toward the deep teal (keeping the teal the rock
  // lacks), the planes sit behind; the light wells keep their pull.
  grade: { mul: [0.72, 0.84, 0.84], lift: [0, 0.003, 0.004], sat: 0.85, haze: [0.02, 0.055, 0.058], hazeMix: 0.2 },
};

/* ------------------------------------------------------------------ *
 * THE KILN HEART — the heart. Chimneys and basalt stand black against a
 * furnace glow from below; heat rises in plumes; embers climb.
 * ------------------------------------------------------------------ */
const KILN: DepthKit = {
  id: 'kiln',
  label: 'The Kiln Heart',
  seed: 0x4111,
  palette: {
    haze: [150, 64, 32], fog: [236, 122, 50], deep: [20, 9, 8],
    body: [38, 22, 19], rim: [214, 106, 48], accent: [72, 38, 28], glow: [255, 164, 72],
    shaft: [244, 124, 54], fg: [9, 5, 4], fgRim: [104, 46, 22], light: [0, 1],
    // Soot → ember red → furnace orange → a white-hot core, low on the screen.
    ramp: [[0, [9, 4, 4]], [0.18, [34, 11, 8]], [0.38, [92, 28, 13]], [0.58, [170, 66, 24]], [0.76, [232, 124, 48]],
      [0.9, [255, 184, 96]], [1, [255, 226, 164]]],
    lightField: {
      rows: [[0, 0.16], [0.3, 0.2], [0.55, 0.3], [0.68, 0.36], [0.8, 0.22], [1, 0.16]],
      cores: [{ x: 0.2, y: 0.62, rx: 0.34, ry: 0.38, k: 1 }, { x: 0.55, y: 0.66, rx: 0.24, ry: 0.3, k: 0.75 },
        { x: 0.85, y: 0.58, rx: 0.22, ry: 0.32, k: 0.85 }],
      falloff: 1.7, smoke: 0.3, smokeCell: 56,
    },
  },
  planes: [
    { label: 'Furnace halls', source: { kind: 'image', src: ASSET('kiln-heart-rich.webp') }, parallax: 0.05, scale: 0.46,
      opacity: 1, lit: 0.1, haze: { mix: 0.06, contrast: 1, mist: 0.12 } },
    { label: 'Chimney stacks', source: { kind: 'art', art: 'kiln-stacks', width: 1024, height: 512 }, parallax: 0.12, scale: 1,
      opacity: 0.38, lit: 0.22, haze: { mix: 0, contrast: 1 } },
    { label: 'Heat plumes', source: { kind: 'art', art: 'kiln-plumes', width: 1024, height: 512 }, parallax: 0.12, scale: 1,
      opacity: 1, lit: 0, haze: { mix: 0, contrast: 1 }, pulse: { amp: 0.25, period: 240 }, scroll: { x: 0, y: 0.3 }, shafts: true },
    { label: 'Kiln tunnels', source: { kind: 'art', art: 'kiln-mid', width: 1024, height: 576 }, parallax: 0.21, scale: 1,
      opacity: 1, lit: 0.55, haze: { mix: 0, contrast: 1 } },
    { label: 'Basalt and chains', source: { kind: 'art', art: 'kiln-near', width: 1024, height: 640 }, parallax: 0.33, scale: 1,
      opacity: 1, lit: 0.9, haze: { mix: 0, contrast: 1 } },
  ],
  foreground: { parallax: 1.4, scale: 1.5, opacity: 0.95, art: 'kiln-fg' },
  particles: [
    { label: 'far embers', parallax: 0.12, count: 64, color: [0.688, 0.25, 0.063], size: 2, drift: [0.02, -0.3], sway: 3, twinkle: 1,
      behind: true, light: 'open', inShafts: 1.8 },
    { label: 'drifting embers', parallax: 0.28, count: 44, color: [0.5, 0.19, 0.05], size: 2, drift: [0.02, -0.18], sway: 6, twinkle: 0.8,
      behind: true, light: 'open', inShafts: 1.6 },
    { label: 'near sparks', parallax: 1.3, count: 29, color: [1, 0.4, 0.1], size: 3, drift: [0.03, -0.4], sway: 5, twinkle: 1,
      behind: false, light: 'open' },
  ],
  grade: NEUTRAL_GRADE,
};

/* ------------------------------------------------------------------ *
 * THE COLD STORE — the refinery's refrigeration wing. Brine tanks and
 * cooling-coil banks recede into frost haze under a cold blue-white light
 * from the high vents; carcass rails and meat hooks hang in the dark; snow
 * drifts at every depth.
 * ------------------------------------------------------------------ */
const COLD: DepthKit = {
  id: 'cold',
  label: 'The Cold Store',
  seed: 0xc01d,
  palette: {
    haze: [70, 96, 124], fog: [150, 176, 204], deep: [8, 14, 24],
    body: [30, 42, 58], rim: [200, 220, 240], accent: [120, 150, 180], glow: [200, 230, 255],
    shaft: [196, 220, 240], fg: [5, 8, 13], fgRim: [70, 92, 116], light: [0, -1],
    // Navy dark to slate blue to frost white: a cold light from above.
    ramp: [[0, [6, 11, 20]], [0.22, [16, 30, 48]], [0.45, [40, 64, 92]], [0.68, [92, 124, 158]], [0.86, [168, 196, 224]], [1, [226, 238, 250]]],
    lightField: {
      rows: [[0, 0.5], [0.25, 0.4], [0.6, 0.22], [0.85, 0.18], [1, 0.5]],
      cores: [{ x: 0.22, y: 0, rx: 0.14, ry: 0.7, k: 0.8 }, { x: 0.62, y: 0.02, rx: 0.12, ry: 0.6, k: 0.7 },
        { x: 0.88, y: 0, rx: 0.1, ry: 0.5, k: 0.55 }],
      falloff: 1.5, smoke: 0.3, smokeCell: 72,
    },
  },
  planes: [
    { label: 'Tank hall in frost haze', source: { kind: 'art', art: 'cold-far', width: 896, height: 512 }, parallax: 0.05, scale: 1,
      opacity: 1, lit: 0.1, haze: { mix: 0, contrast: 1 } },
    { label: 'Coil banks and rails', source: { kind: 'art', art: 'cold-racks', width: 1024, height: 512 }, parallax: 0.12, scale: 1,
      opacity: 1, lit: 0.22, haze: { mix: 0, contrast: 1 } },
    { label: 'Vent light', source: { kind: 'art', art: 'cold-shafts', width: 1024, height: 512 }, parallax: 0.12, scale: 1,
      opacity: 1, lit: 0, haze: { mix: 0, contrast: 1 }, pulse: { amp: 0.3, period: 520 }, shafts: true },
    { label: 'Brine tanks and grates', source: { kind: 'art', art: 'cold-mid', width: 1024, height: 576 }, parallax: 0.21, scale: 1,
      opacity: 1, lit: 0.55, haze: { mix: 0, contrast: 1 } },
    { label: 'Frosted pipes and hooks', source: { kind: 'art', art: 'cold-near', width: 1024, height: 640 }, parallax: 0.33, scale: 1,
      opacity: 1, lit: 0.9, haze: { mix: 0, contrast: 1 } },
  ],
  foreground: { parallax: 1.4, scale: 1.5, opacity: 0.94, art: 'cold-fg' },
  particles: [
    { label: 'far snow', parallax: 0.12, count: 70, color: [0.2, 0.24, 0.3], size: 1, drift: [0.03, 0.2], sway: 5, twinkle: 0.3,
      behind: true, light: 'open', inShafts: 2.4 },
    { label: 'mid snow', parallax: 0.3, count: 60, color: [0.26, 0.3, 0.36], size: 2, drift: [0.05, 0.32], sway: 8, twinkle: 0.2,
      behind: true, light: 'open', inShafts: 2 },
    { label: 'near flakes', parallax: 1.3, count: 30, color: [0.34, 0.38, 0.44], size: 3, drift: [0.07, 0.45], sway: 10, twinkle: 0.2,
      behind: false, light: 'light' },
  ],
  grade: NEUTRAL_GRADE,
};

/* ------------------------------------------------------------------ *
 * THE GLASS GALLERIES — the lens-grinding halls. Dark by design (its light
 * puzzles own every beam): tall glazed arcades, display cases, lens racks
 * and hanging prisms stand in a deep violet dusk, lit only by broad, dim
 * pools of prism spill. NO light shafts: nothing here may read as a beam or
 * a bright spot near the floor's optics.
 * ------------------------------------------------------------------ */
const GLASS: DepthKit = {
  id: 'glass',
  label: 'The Glass Galleries',
  seed: 0x9a55,
  palette: {
    haze: [52, 44, 82], fog: [104, 92, 146], deep: [8, 6, 16],
    body: [28, 24, 44], rim: [176, 164, 220], accent: [96, 84, 140], glow: [150, 136, 200],
    shaft: [120, 110, 170], fg: [6, 5, 11], fgRim: [60, 54, 88], light: [0, -1],
    ramp: [[0, [6, 5, 12]], [0.24, [16, 13, 30]], [0.48, [36, 30, 62]], [0.7, [70, 60, 110]], [0.88, [120, 108, 166]], [1, [168, 158, 206]]],
    // Prism spill (violet, teal, amber) and the panes' faint glaze.
    tints: [[92, 70, 150], [56, 108, 120], [128, 96, 60], [84, 80, 124]],
    lightField: {
      rows: [[0, 0.3], [0.4, 0.4], [0.65, 0.36], [1, 0.3]],
      cores: [{ x: 0.3, y: 0.45, rx: 0.24, ry: 0.4, k: 0.5 }, { x: 0.78, y: 0.5, rx: 0.2, ry: 0.34, k: 0.42 }],
      falloff: 2, smoke: 0.25, smokeCell: 80,
    },
  },
  planes: [
    { label: 'Dusk hall and prism spill', source: { kind: 'art', art: 'glass-far', width: 896, height: 512 }, parallax: 0.05, scale: 1,
      opacity: 1, lit: 0.1, haze: { mix: 0, contrast: 1 } },
    { label: 'Glazed arcades', source: { kind: 'art', art: 'glass-arcade', width: 960, height: 512 }, parallax: 0.12, scale: 1,
      opacity: 1, lit: 0.22, haze: { mix: 0, contrast: 1 } },
    { label: 'Cases, racks and prisms', source: { kind: 'art', art: 'glass-mid', width: 1024, height: 576 }, parallax: 0.21, scale: 1,
      opacity: 1, lit: 0.55, haze: { mix: 0, contrast: 1 } },
    { label: 'Columns and a great lens', source: { kind: 'art', art: 'glass-near', width: 1024, height: 640 }, parallax: 0.33, scale: 1,
      opacity: 1, lit: 0.9, haze: { mix: 0, contrast: 1 } },
  ],
  foreground: { parallax: 1.4, scale: 1.5, opacity: 0.92, art: 'glass-fg' },
  particles: [
    { label: 'far dust', parallax: 0.12, count: 40, color: [0.1, 0.09, 0.15], size: 1, drift: [0.02, -0.03], sway: 4, twinkle: 0.5,
      behind: true, light: 'open' },
    { label: 'glints', parallax: 0.3, count: 22, color: [0.16, 0.14, 0.24], size: 1, drift: [0.01, 0.01], sway: 3, twinkle: 1,
      behind: true, light: 'open' },
    { label: 'near dust', parallax: 1.25, count: 24, color: [0.16, 0.15, 0.2], size: 2, drift: [0.03, 0.02], sway: 6, twinkle: 0.7,
      behind: false, light: 'light' },
  ],
  grade: NEUTRAL_GRADE,
};

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
const scale3 = (c: Rgb, k: number, lift: Rgb = [0, 0, 0]): Rgb => [clamp255(c[0] * k + lift[0]), clamp255(c[1] * k + lift[1]), clamp255(c[2] * k + lift[2])];

/**
 * The generic kit for a biome without its own: the refinery's arcades,
 * columns and chains, recoloured from the floor look (its backdrop tint and
 * lip colour), so a new biome renders with depth on day one.
 */
export function genericKit(biome: BiomeId): DepthKit {
  const look = FLOOR_LOOKS[biome] ?? FLOOR_LOOKS.earthen;
  const tint = look.backdropMul;
  const base: Rgb = [58 * tint[0], 76 * tint[1], 90 * tint[2]];
  const lip = look.lip;
  const palette: KitPalette = {
    haze: scale3(base, 1),
    fog: scale3(base, 1.45),
    deep: scale3(base, 0.22),
    body: scale3(base, 0.52),
    rim: scale3(lip, 0.62),
    accent: scale3(lip, 0.36),
    glow: scale3(lip, 1.1, [20, 20, 20]),
    shaft: scale3(base, 2.3, [20, 20, 20]),
    fg: scale3(base, 0.1),
    fgRim: scale3(lip, 0.26),
    light: [-1, -1],
  };
  return {
    id: 'generic',
    label: `Generic (${biome})`,
    seed: 0x6e0 + biome.length * 97 + biome.charCodeAt(0),
    palette,
    planes: [
      { label: 'Far murk', source: { kind: 'art', art: 'generic-far', width: 768, height: 512 }, parallax: 0.05, scale: 1,
        opacity: 1, lit: 0.1, haze: { mix: 0, contrast: 1 } },
      { label: 'Far arcades', source: { kind: 'art', art: 'generic-arcade', width: 960, height: 512 }, parallax: 0.12, scale: 1,
        opacity: 0.92, lit: 0.22, haze: { mix: 0, contrast: 1 } },
      { label: 'Light', source: { kind: 'art', art: 'generic-shafts', width: 960, height: 512 }, parallax: 0.12, scale: 1,
        opacity: 1, lit: 0, haze: { mix: 0, contrast: 1 }, pulse: { amp: 0.35, period: 420 }, shafts: true },
      { label: 'Near columns', source: { kind: 'art', art: 'generic-near', width: 1024, height: 640 }, parallax: 0.3, scale: 1,
        opacity: 1, lit: 0.85, haze: { mix: 0, contrast: 1 } },
    ],
    foreground: { parallax: 1.4, scale: 1.5, opacity: 0.9, art: 'generic-fg' },
    particles: [
      { label: 'far motes', parallax: 0.12, count: 54, color: [0.175, 0.2, 0.225], size: 2, drift: [0.02, -0.04], sway: 4, twinkle: 0.6,
        behind: true, light: 'open', inShafts: 2.6 },
      { label: 'near dust', parallax: 1.25, count: 42, color: [0.25, 0.25, 0.25], size: 3, drift: [0.04, 0.02], sway: 7, twinkle: 0.8,
        behind: false, light: 'light' },
    ],
    grade: NEUTRAL_GRADE,
  };
}

/** The authored kits, by biome. Anything missing falls back to genericKit(biome). */
export const DEPTH_KITS: Readonly<Partial<Record<BiomeId, DepthKit>>> = {
  earthen: BELLOWS,
  fungal: ROT,
  flooded: CISTERNS,
  volcanic: KILN,
  frozen: COLD,
  crystal: GLASS,
};

const genericCache = new Map<BiomeId, DepthKit>();

/** The kit for a biome: its own if authored, else the (cached) generic fallback. */
export function depthKitFor(biome: BiomeId | null | undefined): DepthKit {
  const id = biome ?? 'earthen';
  const own = DEPTH_KITS[id];
  if (own) return own;
  let kit = genericCache.get(id);
  if (!kit) {
    kit = genericKit(id);
    genericCache.set(id, kit);
  }
  return kit;
}

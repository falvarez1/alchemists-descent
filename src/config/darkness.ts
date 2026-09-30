/**
 * LIGHT AND DARK AS MECHANICS (Breathing Works wave 2, WS-L).
 *
 * Darkness is a place you enter, never a filter over the whole game. Every
 * floor has a small designed base darkness (an "ordinary cave" reads ~0.3,
 * the lamp-lit Works reads 0) and a handful of DEEP-DARK ZONES — authored on
 * floor 1, placed by worldgen on floors 2–4 — where ambient light falls to
 * near black and the sprite/terrain brightness floor drops away, so rock and
 * creatures vanish unless something real lights them. The wand's beam, a
 * fire you start, a glowshroom colony: the grid explains every lit pixel.
 *
 * Like config/params.ts these are live-tuning dials (mutable on purpose).
 * FEEL.md §10 records the shipped values and why.
 */

/** A floor's darkness character. */
export interface DarknessProfile {
  /** Designed darkness everywhere on the floor, 0 (open Works) … 1 (black). */
  base: number;
  /** Strength of this floor's deep-dark zones at their core (1 = black). */
  deep: number;
}

/** Keyed by LevelDef.id; unknown/custom levels are fully readable. */
export const FLOOR_DARKNESS: Record<string, DarknessProfile> = {
  // The Bellows is a lamp-lit refinery; only the Undertow is dark by design.
  d1: { base: 0, deep: 1 },
  // The Rot Gardens and the Drowned Cisterns are caves proper.
  d2: { base: 0.3, deep: 1 },
  d3: { base: 0.3, deep: 1 },
  // The Kiln glows red from its own lava; its dark is shallower.
  d4: { base: 0.18, deep: 0.94 },
  // The second doors (wave 3). The Cold Store's snow and ice throw back what
  // little light there is; the Glass Galleries are dark by design — light is
  // the floor's whole subject, and a lens wants a dark room.
  d2b: { base: 0.12, deep: 1 },
  d3b: { base: 0.36, deep: 1 },
};

export const DEFAULT_DARKNESS: DarknessProfile = { base: 0, deep: 0 };

export const DARKNESS = {
  /**
   * How the gameplay darkness d (0..1) becomes RENDER darkness: d^gamma, so a
   * floor's base 0.3 barely dims unlit rock (0.3^2 = 0.09) while a zone's core
   * (1.0) goes all the way. Gameplay (sight, eyeshine) reads d linearly.
   */
  renderGamma: 2,
  /** Render darkness at a zone's core removes this much of ambient + floor. */
  renderStrength: 0.965,
  /** High-readability lighting keeps this fraction of the render darkness —
   *  darkness still reads as a place, but nobody is locked out by it. */
  readabilityScale: 0.5,
  /** Soft edge of a zone, in cells (smoothstep from the rim inward). */
  feather: 30,
  /** The rim wanders this many cells in and out (core/darkness rimWobble). Levels review
   *  #16: at 10 a dark room's edge ran nearly straight and read as an unrendered chunk;
   *  16 lets the fade line billow a few dozen cells like a cave the light gave up on. */
  rimNoise: 16,
  /**
   * FOLLOWING THE ROCK (core/darkness bakeZoneFollowingRock): from a zone's
   * core the dark travels only through what connects it. Along open air it
   * holds full for this many cells of (feathered) depth…
   */
  airHold: 16, // 8 before the rim wandered 16: the room mouths stay dark (light-query tests)
  /** …then fades over this many more, so a doorway or a cave mouth dims
   *  gradually (fix4b: 40 → 52 — across a room the dark read as a curtain
   *  drawn at one line; now it thins out like a place the light gave up on)… */
  airFade: 52,
  /** …and into rock this many times slower, so a room's walls go dark some
   *  cells deep while the rock beyond, and any cave the zone's box merely
   *  overlaps, keep their light (fix4b: 3 → 2.2 — at 3 the walls stayed lit
   *  to within a couple of cells of the face, so a dark room read as a black
   *  rectangle cut out of lit rock). */
  rockSoak: 2.2,
  /** How far the fade's line wanders, × rimNoise: in open air (fix4b: 1 →
   *  1.6, so the fade across a tall room is never a straight vertical) and
   *  in rock (a cell of rock is `rockSoak` cells of travel, so without the
   *  larger wobble a straight wall's dark would run parallel to it; more
   *  than ~1.8 reads as a toothed fringe). */
  airWander: 1.6,
  rockWander: 1.8,
  /** Dark-map resolution: one texel per this many cells (the light field's own grain). */
  mapCell: 2,
  /** Per-build smoothing of the darkness under the player (light builds every 2 frames). */
  playerEase: 0.1,
  /** Darkness under the player that counts as having stepped into the dark, and
   *  the level it must fall back under before it counts as having left (hysteresis). */
  enterDark: 0.72,
  leaveDark: 0.4,
} as const;

/**
 * The lantern in the dark. The wand's omni spill shrinks as the player stands
 * in darkness (you see your footing, not the room) while the aimed beam keeps
 * its reach and loses less per cell of air — so in a black cave the world is
 * where you point.
 */
export const LANTERN = {
  /** Omni wand radius multiplier at full darkness under the player. */
  darkOmniRadius: 0.62,
  /** Non-occluded glow cone radius multiplier at full darkness. */
  darkGlowRadius: 0.55,
  /** Beam per-half-cell air transmission in full darkness (open Works: 0.976). */
  darkBeamStepAir: 0.985,
  /** Beam intensity multiplier at full darkness (a touch brighter: pupils open). */
  darkBeamIntensity: 1.12,
  /** HOODED: the omni becomes an ember this fraction of its radius … */
  hoodRadius: 0.16,
  /** … and this fraction of its intensity. The beam and glow cone go out. */
  hoodIntensity: 0.3,
  /** The wizard's own fill light while hooded. */
  hoodFill: 0.45,
  /** Per-light-build ease of the hood shutter (≈ 8 builds ≈ 16 ticks to settle). */
  hoodEase: 0.26,
  /** Beam coverage below this reads as "not on it" for gameplay (≈ where the
   *  beam's lit patch fades out on screen, ~170 cells down a clear corridor). */
  beamOn: 0.05,
} as const;

/** Eyeshine and glow markings (render/creatures/eyeshine). */
export const EYESHINE = {
  /** Self-glow of an open eye at full darkness (additive, fine pixels). */
  base: 0.62,
  /** Retroreflective flash gain when the wand's light lands on a facing eye. */
  retro: 1.9,
  /** wandLight at the eye that saturates the retro flash. */
  retroFull: 0.35,
  /** Eyes only glow where it is at least this dark (gameplay darkness). */
  minDark: 0.18,
  /** Glow markings' extra glow at full darkness. */
  marking: 0.7,
  /** Reveal: rise per tick while lit, fall per tick when the light leaves. */
  revealRise: 0.16,
  revealFall: 0.035,
  /** wandLight / level at the body that counts as "lit enough to see". */
  revealLit: 0.1,
} as const;

/** Perception: how far a creature sees the alchemist, by the light on him. */
export const SIGHT = {
  /** Visibility of an unhooded, ordinary-lit alchemist (the shipped 0.7). */
  lantern: 0.7,
  /** Torchbearer: the lantern blazes. */
  torch: 1,
  /** An unhooded lantern in the dark is a beacon: visibility rises by this × darkness. */
  beacon: 0.3,
  /** Sight-range multiplier for a fully unseen (hooded, deep-dark) alchemist. */
  darkRange: 0.16,
  /** Velvet Hood boon: while hooded, the dark around the alchemist counts this many times deeper (a lit room still lights him). */
  velvet: 1.6,
  /** Beam coverage on a creature that tells it exactly where the lantern is. */
  litFix: 0.07,
} as const;

/** Creatures answer the light (creatures/lightResponse). */
export const LIGHT_RESPONSE = {
  /** Beam coverage that makes a photophobe flinch. */
  flinchAt: 0.07,
  /** Weaver: back-off ticks after a flinch; flinch cooldown. */
  weaverRetreat: 46,
  weaverFlinch: 14,
  weaverCooldown: 34,
  /** Ticks of beam (within the habituation window) before a Weaver stops flinching and charges. */
  weaverHabit: 150,
  /** Habituation leaks at this rate per tick out of the beam. */
  habitLeak: 0.5,
  /** Bats: roost wakes at this beam; a flier's panic lasts this many ticks. */
  batScatter: 60,
  /** Root Loper: wand light that freezes it; creep speed multiplier in the dark. */
  lurkerFreeze: 0.06,
  lurkerCreep: 1.45,
  /** Ticks a Root Loper stays frozen after the light leaves it (it listens first). */
  lurkerHold: 22,
  /** Slimes drift toward a beam spot within this many cells. */
  slimeLure: 120,
} as const;

/** Light devices (game/LightDevices, Mechanisms 'light' sensors). */
export const PHOTOCELL = {
  /** Beam coverage on the lens that charges it. */
  beam: 0.07,
  /** Or any light this bright (a fire beside it, a lava pool). */
  blaze: 1.05,
  /** Ticks of light to latch (~1.5 s). */
  chargeTicks: 90,
  /** Charge lost per tick in the dark (it cools, it does not reset). */
  drain: 0.35,
} as const;

export const LUMEN = {
  /** Beam coverage / light level at the heart that opens a bloom. */
  beam: 0.06,
  blaze: 1.0,
  /** Openness gained per tick while lit (full in ~0.7 s). */
  openRate: 0.024,
  /** Openness lost per tick in the dark (full bridge furls over ~6 s). */
  furlRate: 0.0028,
  /** Hold at full before furling begins, ticks. */
  hold: 70,
} as const;

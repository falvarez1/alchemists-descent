/**
 * Pure mix math for the procedural audio engine: volume curves, bus levels
 * and where a world sound sits in the stereo field. No WebAudio in here, so
 * every number is unit-testable (tests/audio-mix.test.ts).
 */

/** Where a sound is summed before the master chain. */
export type AudioBus = 'fx' | 'voices' | 'ambience' | 'ui';

/** The three player-facing volume sliders. */
export type VolumeChannel = 'master' | 'effects' | 'ambience';

/** Slider positions, 0..1 each (the UI shows them as percentages). */
export interface VolumeSettings {
  master: number;
  effects: number;
  ambience: number;
}

export const DEFAULT_VOLUMES: Readonly<VolumeSettings> = Object.freeze({ master: 0.8, effects: 1, ambience: 0.8 });

export const AUDIO_BUSES: readonly AudioBus[] = ['fx', 'voices', 'ambience', 'ui'];

/**
 * Designed level of each bus at full slider. Creature voices sit just under
 * the player's own effects so a wand shot always reads over a chirr; the
 * cave's own life is a bed, not a lead; UI stingers are rewards and cut
 * through, but never louder than a blast.
 */
export const BUS_BASE: Readonly<Record<AudioBus, number>> = Object.freeze({ fx: 1, voices: 0.9, ambience: 0.72, ui: 0.85 });

/** Which slider scales each bus. Creature voices and stingers are effects. */
export const BUS_CHANNEL: Readonly<Record<AudioBus, Exclude<VolumeChannel, 'master'>>> = Object.freeze({
  fx: 'effects',
  voices: 'effects',
  ambience: 'ambience',
  ui: 'effects',
});

/**
 * Pre-compressor trim. The sum used to hit the speakers at 0.4; the glue
 * compressor's make-up gain brings the default mix back to that loudness
 * while the limiter keeps a room full of explosions from clipping.
 */
export const MIX_TRIM = 0.46;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Validate a stored slider value: finite, 0..1, else the default. */
function volumeOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp01(value) : fallback;
}

/** Sanitize persisted volumes (missing, corrupted or out-of-range values fall back per channel). */
export function sanitizeVolumes(value: unknown): VolumeSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Record<VolumeChannel, unknown>>;
  return {
    master: volumeOr(v.master, DEFAULT_VOLUMES.master),
    effects: volumeOr(v.effects, DEFAULT_VOLUMES.effects),
    ambience: volumeOr(v.ambience, DEFAULT_VOLUMES.ambience),
  };
}

/**
 * Slider position → linear gain. A squared taper: loudness is perceived
 * roughly logarithmically, so a linear slider crams all the audible change
 * into its bottom quarter. Half-way is -12 dB, which feels like "half".
 */
export function volumeToGain(v: number): number {
  const x = clamp01(v);
  return x * x;
}

/** The linear gain a bus node should hold for these slider positions. */
export function busGain(bus: AudioBus, volumes: VolumeSettings): number {
  return BUS_BASE[bus] * volumeToGain(volumes[BUS_CHANNEL[bus]]);
}

/** Half the view width in cells: a source at the screen edge pans to MAX_PAN. */
export const PAN_SPAN = 320;
/** Never hard-pan: a creature off to one side still reaches both ears a little. */
export const MAX_PAN = 0.85;
/** Vertical distance counts more than horizontal (the view is 16:9, so "off the top" is nearer than "off the side"). */
export const VERTICAL_WEIGHT = 1.35;

export interface Placement {
  /** StereoPanner value, -MAX_PAN..MAX_PAN. */
  pan: number;
  /** Linear gain multiplier, 0..1. */
  gain: number;
  /** Lowpass cutoff in Hz for distance air-absorption, or 0 for none. */
  muffleHz: number;
}

/**
 * Where a sound at offset (dx, dy) cells from the listener sits in the mix,
 * or null when it is beyond `range` and should not play at all.
 *
 * - Pan follows the screen: centre is centre, the view edge is MAX_PAN.
 * - Gain holds full inside a near plateau (so the player's neighbourhood is
 *   not a volume gradient), then falls smoothly to silence at `range`.
 * - Distant sounds lose their top end the way sound through air and rock
 *   does: a blast across the cavern is a thud, not a hiss.
 */
export function placeSound(dx: number, dy: number, range = 380): Placement | null {
  const distance = Math.hypot(dx, dy * VERTICAL_WEIGHT);
  if (!(distance < range)) return null;
  const pan = Math.max(-MAX_PAN, Math.min(MAX_PAN, (dx / PAN_SPAN) * MAX_PAN));
  const near = Math.min(70, range * 0.18);
  const t = distance <= near ? 0 : (distance - near) / (range - near);
  const gain = (1 - t) ** 1.8;
  // Air absorption starts past a quarter of the way out; nothing below ~650 Hz is ever removed.
  const muffleHz = t < 0.25 ? 0 : Math.max(650, Math.round(16000 * (1 - (t - 0.25) / 0.75) ** 2.4));
  return { pan, gain, muffleHz };
}

/**
 * Alchemy-kill chime pitch: a major-pentatonic ladder that climbs one step
 * per link in the chain (so a chain *sounds* like it is going somewhere) and
 * tops out two octaves up. Returns a frequency ratio against the base note.
 */
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
export function chainPitch(chain: number): number {
  const step = Math.max(0, Math.min(PENTATONIC.length - 1, Math.floor(chain) - 1));
  return 2 ** (PENTATONIC[step] / 12);
}

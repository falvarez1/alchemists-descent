/**
 * Player options that live beside the original preferences (ui/PlayerSettings
 * owns the dialog and persists everything under `ad-player-preferences-v1`).
 *
 * This file is the pure half: the allowed choices, the defaults, the narrow
 * ranges, and the sanitizers that turn whatever storage held (nothing, a saved
 * object from an older build, corrupt or hostile values) into one of them.
 * No DOM and no game imports, so each option is unit-tested on its own.
 *
 * Two rules every option follows:
 *  - the default leaves the game exactly as it shipped (except pauseOnBlur);
 *  - a value is always clamped into a band the art direction would accept, so
 *    the designed darkness survives every slider's extremes.
 */

export const SHAKE_LEVELS = ['off', 'half', 'full'] as const;
export type ShakeLevel = (typeof SHAKE_LEVELS)[number];
/** What each level multiplies the camera shake by (Renderer, WebGpuRenderBackend). */
export const SHAKE_SCALE: Readonly<Record<ShakeLevel, number>> = { off: 0, half: 0.5, full: 1 };

export const COLOR_ASSISTS = ['off', 'red-green', 'blue-yellow'] as const;
export type ColorAssist = (typeof COLOR_ASSISTS)[number];

export const HINT_MODES = ['first', 'always', 'off'] as const;
export type HintMode = (typeof HINT_MODES)[number];

export const AIM_ASSISTS = ['off', 'light', 'strong'] as const;
export type AimAssistLevel = (typeof AIM_ASSISTS)[number];

export const QUALITY_PRESETS = ['standard', 'low'] as const;
export type QualityPreset = (typeof QUALITY_PRESETS)[number];

/** A slider: the closed band it may sit in, its grid, and the shipped value. */
export interface Band { readonly min: number; readonly max: number; readonly step: number; readonly fallback: number }

/**
 * Presentation sliders. Each band is narrow on purpose: from the shipped value the most a
 * player can do is about a quarter brighter or a sixth dimmer, so a dark floor stays dark
 * and a bright floor stays lit. The shipped values are params.ts createDefaultPostFxSettings
 * (gain 1, vignette 0.28, bloomStrength 0.18, grain 0.006); a test pins them together.
 * Brightness is postFx.gain (the post pass), not postFx.exposure: exposure never reached
 * the WebGL picture.
 */
export const PRESENTATION = {
  brightness: { min: 0.85, max: 1.25, step: 0.05, fallback: 1 },
  vignette: { min: 0.08, max: 0.44, step: 0.04, fallback: 0.28 },
  bloom: { min: 0.06, max: 0.36, step: 0.03, fallback: 0.18 },
  grain: { min: 0, max: 0.018, step: 0.003, fallback: 0.006 },
} as const satisfies Record<string, Band>;
export type PresentationKey = keyof typeof PRESENTATION;

export const HUD_SCALE: Band = { min: 0.8, max: 1.3, step: 0.05, fallback: 1 };
export const HUD_OPACITY: Band = { min: 0.5, max: 1, step: 0.05, fallback: 1 };
/** Stick dead zone (how far the stick must move before it counts). 0.2 is the shipped feel. */
export const PAD_DEADZONE: Band = { min: 0.05, max: 0.45, step: 0.05, fallback: 0.2 };

/** Snap a number onto a band's grid and keep it inside the band. Float noise is trimmed. */
export function snapToBand(value: number, band: Band): number {
  const steps = Math.round((value - band.min) / band.step);
  const snapped = band.min + steps * band.step;
  return Number(Math.min(band.max, Math.max(band.min, snapped)).toFixed(4));
}

/** A required slider: anything that is not a finite number falls back to the shipped value. */
export function sanitizeBand(saved: unknown, band: Band): number {
  return typeof saved === 'number' && Number.isFinite(saved) ? snapToBand(saved, band) : band.fallback;
}

/** An optional slider: null means "never touched", so the game's own value is left alone. */
export function sanitizeOptionalBand(saved: unknown, band: Band): number | null {
  return typeof saved === 'number' && Number.isFinite(saved) ? snapToBand(saved, band) : null;
}

/** How many grid steps a value is from the shipped one (the slider's "+2" / "-1" readout). */
export function stepsFromDefault(value: number, band: Band): number {
  return Math.round((value - band.fallback) / band.step);
}

/** What a slider's readout says: the shipped position is "Default", others count grid steps either side ("+2", "-1"). */
export function bandReadout(value: number, band: Band, zeroLabel?: string): string {
  if (zeroLabel !== undefined && value <= band.min && band.min === 0) return zeroLabel;
  const steps = stepsFromDefault(value, band);
  return steps === 0 ? 'Default' : steps > 0 ? `+${steps}` : `−${-steps}`;
}

export function sanitizeChoice<T extends string>(saved: unknown, allowed: readonly T[], fallback: T): T {
  return typeof saved === 'string' && (allowed as readonly string[]).includes(saved) ? (saved as T) : fallback;
}

/**
 * Shake used to be an on/off checkbox (`cameraShake: boolean`). An old save's
 * `false` is Off, its `true` is Full; anything else is Full (the shipped feel).
 */
export function sanitizeShake(saved: unknown): ShakeLevel {
  if (saved === false) return 'off';
  return sanitizeChoice(saved, SHAKE_LEVELS, 'full');
}

/** The gamepad thresholds one dead-zone value implies. At the shipped 0.2 they are the original numbers. */
export function padThresholds(deadzone: number): { move: number; up: number; down: number; aim: number } {
  const d = sanitizeBand(deadzone, PAD_DEADZONE);
  return { move: d, up: Number((d + 0.15).toFixed(4)), down: Number((d + 0.2).toFixed(4)), aim: Number((d + 0.05).toFixed(4)) };
}

/** The options added after the first preference set. Every field has a default that changes nothing, bar pauseOnBlur. */
export interface ExtraPreferences {
  /** Pause when the window or tab loses focus (never mid-dialogue, in a cinematic, on the title, or in the Builder). */
  pauseOnBlur: boolean;
  /** A dark plate behind narrator captions and callouts. */
  captionBacking: boolean;
  /** Show 110 / 110 beside the HP and mana bars. */
  numericVitals: boolean;
  colorAssist: ColorAssist;
  /** Teaching cards: first time only (shipped), once per floor, or never. */
  hintMode: HintMode;
  /** The four presentation sliders; null = the game's own value. */
  brightness: number | null;
  vignette: number | null;
  bloom: number | null;
  grain: number | null;
  hudScale: number;
  hudOpacity: number;
  /** Thin health bars and damage numbers over enemies (readouts only). */
  showEnemyHp: boolean;
  aimAssist: AimAssistLevel;
  padDeadzone: number;
  padRumble: boolean;
  quality: QualityPreset;
}

export const DEFAULT_EXTRAS: Readonly<ExtraPreferences> = {
  pauseOnBlur: true,
  captionBacking: false,
  numericVitals: false,
  colorAssist: 'off',
  hintMode: 'first',
  brightness: null,
  vignette: null,
  bloom: null,
  grain: null,
  hudScale: HUD_SCALE.fallback,
  hudOpacity: HUD_OPACITY.fallback,
  showEnemyHp: false,
  aimAssist: 'off',
  padDeadzone: PAD_DEADZONE.fallback,
  padRumble: false,
  quality: 'standard',
};

/** Read the extra options out of whatever was saved. Never throws; unknown or wrong-typed fields take their defaults. */
export function sanitizeExtras(raw: unknown): ExtraPreferences {
  const saved = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_EXTRAS;
  return {
    pauseOnBlur: saved.pauseOnBlur === false ? false : d.pauseOnBlur,
    captionBacking: saved.captionBacking === true,
    numericVitals: saved.numericVitals === true,
    colorAssist: sanitizeChoice(saved.colorAssist, COLOR_ASSISTS, d.colorAssist),
    hintMode: sanitizeChoice(saved.hintMode, HINT_MODES, d.hintMode),
    brightness: sanitizeOptionalBand(saved.brightness, PRESENTATION.brightness),
    vignette: sanitizeOptionalBand(saved.vignette, PRESENTATION.vignette),
    bloom: sanitizeOptionalBand(saved.bloom, PRESENTATION.bloom),
    grain: sanitizeOptionalBand(saved.grain, PRESENTATION.grain),
    hudScale: sanitizeBand(saved.hudScale, HUD_SCALE),
    hudOpacity: sanitizeBand(saved.hudOpacity, HUD_OPACITY),
    showEnemyHp: saved.showEnemyHp === true,
    aimAssist: sanitizeChoice(saved.aimAssist, AIM_ASSISTS, d.aimAssist),
    padDeadzone: sanitizeBand(saved.padDeadzone, PAD_DEADZONE),
    padRumble: saved.padRumble === true,
    quality: sanitizeChoice(saved.quality, QUALITY_PRESETS, d.quality),
  };
}

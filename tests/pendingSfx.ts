/**
 * Cues that are in the catalog (src/content/audio/sfxCues.ts), have a prompt
 * (scripts/audio/sfx-prompts.mjs) and a procedural fallback (src/audio/sfxFallbacks.ts),
 * but have not been RECORDED yet: the generator is paid and runs once, at the end of a
 * wave, by the integrator. Until then the game plays the fallback. tests/audio-sfx.test.ts
 * lets exactly these ids lack files on disk, and fails if one of them gains files and is
 * left on this list: delete the id here when its takes land.
 */
export const PENDING_SFX_RECORDING: readonly string[] = [
  // (none: recorded 2026-10-01; add a cue here when it ships with only a prompt and a fallback)
];

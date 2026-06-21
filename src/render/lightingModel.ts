/**
 * Shared render-tuning constants for the lighting/compose pass.
 *
 * The compose runs in TWO mirrored implementations — the GPU fragment shader
 * (`ComposeShader.ts`) and the CPU fallback (`FrameComposer.ts`) — which must
 * stay pixel-identical. Any constant duplicated across them is a silent drift
 * hazard: change one, forget the other, and the two paths diverge. Constants
 * that genuinely live in BOTH belong here so there is ONE source of truth.
 *
 * `VIGNETTE_BASE` is the proven case — it lived in the shader default, the CPU
 * `Lighting` vignette array, AND the `FrameComposer` rescale denominator, and
 * had to be hand-synced. It is now imported by all three.
 *
 * Keep the per-cell lighting-law constants here too. They are injected into the
 * GPU shader source and used directly by the CPU fallback, so changing them in
 * one place keeps compose parity reviewable.
 */

/** Screen-vignette strength baked into the CPU `Lighting.vignette` array, used as
 *  the GPU `uVignette` uniform default, and the `FrameComposer` rescale base.
 *  `postFx.vignette` tunes it live; this is the shipped reference value. */
export const VIGNETTE_BASE = 0.52;

/**
 * Distortion pad around the view window. Shockwave offset is bounded by
 * |strength| <= 16 (singularity ring -16, explosions +12); the lens offset by
 * K*1.221 per axis with K = 4 + vortexRad*0.16 and vortexRad capped at 140
 * (collapseLimit) -> ~33 cells. One wave + one max lens ~= 49; 64 leaves
 * headroom for two stacked wave fronts.
 */
export const COMPOSE_PAD = 64;

export const LIGHT_CLAMP = 2.2;
export const LIGHT_READABILITY_FLOOR = 0.06;
export const SELF_GLOW_BASE = 0.45;
export const SELF_GLOW_SCALE = 1.55;
export const LIGHT_KNEE_START = 1.25;
export const LIGHT_KNEE_SLOPE = 0.3;
export const LIGHT_KNEE_MAX = 2.0;

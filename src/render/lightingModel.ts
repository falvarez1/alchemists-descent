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
import type { Ctx } from '@/core/types';

export function renderAmbient(ctx: Ctx): number {
  return ctx.state.highReadability ? Math.max(0.85, ctx.params.global.ambient) : ctx.params.global.ambient;
}

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
export const LIGHT_READABILITY_FLOOR = 0.40;
export const SELF_GLOW_BASE = 0.45;
export const SELF_GLOW_SCALE = 1.55;
export const LIGHT_KNEE_START = 1.25;
export const LIGHT_KNEE_SLOPE = 0.3;
export const LIGHT_KNEE_MAX = 2.0;

/**
 * Designed darkness (config/darkness): the light texture's alpha / the CPU
 * `lightOpen` factor multiplies ambient and the readability floor. What an
 * unlit surface keeps at FULL darkness is this cold "wet slate" remainder
 * (an albedo multiplier per channel), so a deep-dark cave is near black with
 * a blue-grey breath rather than a dead RGB zero; open air keeps the absolute
 * DARK_AIR tint. Shared by all three compose paths.
 */
export const DARK_FLOOR_R = 0.012;
export const DARK_FLOOR_G = 0.016;
export const DARK_FLOOR_B = 0.026;
export const DARK_AIR_R = 0.0022;
export const DARK_AIR_G = 0.0032;
export const DARK_AIR_B = 0.0055;
/**
 * Eye adaptation in designed darkness: the squared light law (lit = lf^2)
 * swallows every weak light, so in a black cave a failing lamp or a
 * glowshroom colony would light nothing. As the place darkens a linear term
 * fades in (lit = lf^2 + DARK_ADAPT * shut * lf): dim pools become visible
 * while the lantern's bright core is unchanged. Zero in readable places.
 */
export const DARK_ADAPT = 0.42;
/** In designed darkness the air's own glow near a light (the dust a lantern
 *  hangs in) is this many times stronger: the halo reads as a place. */
export const DARK_AIR_GLOW = 1.4;

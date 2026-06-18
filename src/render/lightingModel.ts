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
 * The per-cell lighting-law magic numbers (the 0.06 floor, 0.45/1.55 self-glow,
 * the 1.25/0.3 knee, the 2.2 clamp, the backdrop 0.62/0.022/0.72 terms) are also
 * duplicated across the two files but have never been tuned since the port — if
 * you ever DO touch them, lift them here and reference from both sides rather
 * than editing two places.
 */

/** Screen-vignette strength baked into the CPU `Lighting.vignette` array, used as
 *  the GPU `uVignette` uniform default, and the `FrameComposer` rescale base.
 *  `postFx.vignette` tunes it live; this is the shipped reference value. */
export const VIGNETTE_BASE = 0.52;

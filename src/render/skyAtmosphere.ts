import { VIEW_H, VIEW_W } from '@/config/constants';

/**
 * D1 surface-intro daytime sky — THE single source of truth for every tuning
 * number in the "open sky" branch of the frame compositor. Both compose paths
 * read from here so they can never drift:
 *   - FrameComposer (CPU) imports SKY and reads the fields directly in its loop.
 *   - ComposeShader (GPU) interpolates SKY.* into its GLSL template string
 *     (see `skyGlsl()` below, which generates the cloud sum from `clouds.octaves`
 *     so the GPU unroll and the CPU loop are provably the same math).
 *
 * They drifted once — the cloud tint was 0.93/0.95/0.98 on the GPU but
 * 0.96/0.97/0.99 on the CPU — which is exactly what centralizing here prevents.
 *
 * The shared math, for an Empty cell above the horizon row `skyLine`, with
 * t = wy / skyLine (0 overhead → 1 at the horizon):
 *   1. vertical gradient — channel = base + horizon * t
 *   2. distant sun       — pinned to a screen position (parallax-infinity)
 *   3. drifting clouds   — layered 2-D sines in a mid-sky band, drift = skyPhase
 *   4. two hill ridges   — far then near, each rising from the horizon at its
 *                          own slow parallax (near is taller/darker, drawn last)
 */
export const SKY = {
  /**
   * Cloud drift rate: skyPhase = (frameCount * DRIFT_SPEED) mod 2pi. Added per
   * sine term (not scaled by the term's frequency) so a 2pi wrap is seamless.
   */
  DRIFT_SPEED: 0.004,

  /** Vertical gradient: channel = base + horizon * t. */
  gradient: {
    rBase: 0.36,
    rHorizon: 0.28,
    gBase: 0.53,
    gHorizon: 0.06,
    bBase: 0.78,
    bHorizon: -0.28,
  },

  /** Distant sun, pinned to a fixed screen position so it never slides as the camera pans. */
  sun: {
    screenX: VIEW_W * 0.72,
    screenY: VIEW_H * 0.17,
    haloRadius: 150,
    haloPower: 2.4,
    haloStrength: 0.55,
    coreEdge0: 13, // smoothstep(coreEdge0, coreEdge1, dist): 0 outside coreEdge0 …
    coreEdge1: 6, // … 1 inside coreEdge1 (descending edges → bright disc)
    r: 1.0,
    g: 0.96,
    b: 0.85,
  },

  /**
   * Drifting clouds: a sum of layered 2-D sines (in cax = cpx*freqX, cay = wy*freqY)
   * normalized to ~0..1, thresholded into soft puffs, and confined to a mid-sky
   * band so the zenith and horizon stay clear. `drift` octaves carry skyPhase.
   */
  clouds: {
    parallax: 0.82, // cpx = wx - camX * parallax (clouds lag the foreground)
    freqX: 0.02,
    freqY: 0.05,
    octaves: [
      { amp: 0.5, fx: 1.0, fy: 0.0, drift: true },
      { amp: 0.3, fx: 2.2, fy: 1.0, drift: true },
      { amp: 0.22, fx: 0.7, fy: -1.4, drift: false },
      { amp: 0.1, fx: 4.3, fy: 0.7, drift: false },
    ],
    bandRiseLo: 0.12, // smoothstep rise-in across the upper sky …
    bandRiseHi: 0.3,
    bandFadeLo: 0.46, // … and fade-out before the horizon
    bandFadeHi: 0.66,
    threshLo: 0.58, // smoothstep on the normalized density → patchy coverage
    threshHi: 0.82,
    r: 0.93,
    g: 0.95,
    b: 0.98,
    opacity: 0.45,
  },

  /** Far hill ridge: ridgeTop = skyLine - (base + amp * lump(x)). */
  hillFar: {
    parallax: 0.5,
    base: 26,
    amp: 16,
    freq: 0.01,
    phase: 1.7,
    freq2: 0.027,
    amp2: 0.4,
    edge: 2, // smoothstep softness around the ridgeline
    opacity: 0.8,
    r: 0.5,
    g: 0.57,
    b: 0.68,
  },

  /** Near hill ridge: taller, darker, drawn last so it occludes the far ridge. */
  hillNear: {
    parallax: 0.32,
    base: 40,
    amp: 26,
    freq: 0.013,
    phase: 2.3,
    freq2: 0.031,
    amp2: 0.45,
    edge: 2,
    opacity: 0.9,
    r: 0.36,
    g: 0.46,
    b: 0.54,
  },
} as const;

/** Format a JS number as a GLSL float literal (guarantees a decimal point). */
export function glslFloat(n: number): string {
  const s = String(n);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
}

/**
 * The cloud density sum, generated from `SKY.clouds.octaves` as a GLSL
 * expression in `cax`, `cay`, and `uPhaseSky`. Generating it (rather than
 * hand-writing it) guarantees the GPU unroll matches the CPU loop term-for-term.
 */
export function cloudSumGlsl(): string {
  return SKY.clouds.octaves
    .map((o) => {
      const fy = o.fy === 0 ? '' : ` ${o.fy >= 0 ? '+' : '-'} cay * ${glslFloat(Math.abs(o.fy))}`;
      const drift = o.drift ? ' + uPhaseSky' : '';
      return `${glslFloat(o.amp)} * sin(cax * ${glslFloat(o.fx)}${fy}${drift})`;
    })
    .join('\n                 + ');
}

import type { Ctx } from '@/core/types';

/**
 * Render-layer interfaces. Sprites, the frame composer, lighting, background,
 * and the Three.js renderer reference each other only through these, so the
 * concrete modules stay independent.
 */

/** The two pixel primitives every sprite/particle/beam renderer draws with. */
export interface PixelSurface {
  /** Write one RGB pixel (alpha 1) at world coords; camera-relative, view-culled. */
  setPx(wx: number, wy: number, r: number, g: number, b: number): void;
  /** Additively blend RGB at world coords (alpha untouched). */
  addPx(wx: number, wy: number, r: number, g: number, b: number): void;
}

export interface LightSample {
  r: number;
  g: number;
  b: number;
}

/**
 * Half-resolution RGB light field (original buildLighting/sampleSpriteLight).
 * Indexed `(vy >> 1) * LW + (vx >> 1)` in view space.
 */
export interface LightField {
  readonly LW: number;
  readonly LH: number;
  readonly lightR: Float32Array;
  readonly lightG: Float32Array;
  readonly lightB: Float32Array;
  readonly lightAtt: Float32Array;
  /** Full-resolution radial darkening, baked once: 1 - 0.52 * r^2. */
  readonly vignette: Float32Array;
  build(ctx: Ctx): void;
  /**
   * Squared, clamped lit factors at a world position (original sampleSpriteLight).
   * Returns a REUSED object — consume immediately, never store it.
   */
  sample(wx: number, wy: number): LightSample;
}

/** Parallax backdrop layers baked at world size (bgFar 0.35x, bgNear 0.62x scroll). */
export interface ParallaxLayers {
  readonly bgFar: Float32Array;
  readonly bgNear: Float32Array;
}

/** The CPU-side framebuffer the composer writes into (owned by the Three.js renderer). */
export interface RenderTarget {
  /** Float RGBA, VIEW_W x VIEW_H, Y-flipped rows for GL texture orientation. */
  readonly pixelData: Float32Array;
  /** Flag the GPU texture for re-upload after the buffer was written. */
  markTextureDirty(): void;
}

import type { BackdropLayerId, Ctx, RenderBackendMode, RenderSettings } from '@/core/types';

/**
 * Render-layer interfaces. Sprites, the frame composer, lighting, background,
 * and the Three.js renderer reference each other only through these, so the
 * concrete modules stay independent.
 */

export type ActualRenderBackend = 'webgpu' | 'webgl2' | 'webgl' | 'none';
export type RenderBackendHealth = 'active' | 'lost' | 'recovering' | 'recovered' | 'failed';

export interface RenderBackendFeatureFlags {
  compose: boolean;
  lighting: boolean;
  particles: boolean;
  post: boolean;
}

export interface RenderBackendWebGpuStatus {
  navigatorGpu: boolean;
  secureContext: boolean;
  backendImplemented: boolean;
  adapter: 'unchecked' | 'available' | 'unavailable' | 'failed';
  device: 'unchecked' | 'available' | 'unavailable' | 'failed' | 'lost' | 'recovered';
  deviceFeatures: string[];
  deviceLimits: Record<string, number> | null;
  timestampQueryAvailable: boolean | null;
  lostCount: number;
  lastLossReason: string | null;
  lastLossMessage: string | null;
}

export interface RenderBackendWebGlStatus {
  available: boolean;
  webgl2: boolean;
  contextLost: boolean;
  lostCount: number;
  restoredCount: number;
}

export interface RenderBackendStatus {
  requested: RenderBackendMode;
  actual: ActualRenderBackend;
  implementation: 'WebGLRenderBackend' | 'WebGPURenderBackend' | 'none';
  health: RenderBackendHealth;
  reason: string;
  fallback: boolean;
  canvas: { width: number; height: number; connected: boolean };
  features: RenderBackendFeatureFlags;
  webgpu: RenderBackendWebGpuStatus;
  webgl: RenderBackendWebGlStatus;
}

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

export interface ParallaxBitmapLayer {
  readonly id: BackdropLayerId;
  readonly label: string;
  readonly file: string;
  readonly src: string;
  readonly defaultSpeed: number;
  version: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  loaded: boolean;
}

/** Image-backed parallax backdrop layers. Each PNG carries its own alpha. */
export interface ParallaxLayers {
  readonly backdropLayers: readonly ParallaxBitmapLayer[];
  readonly ready: boolean;
}

/** A black-hole image lens as the composer feeds it to the distortion pass. */
export interface CompositorLens {
  cx: number;
  cy: number;
  /** Influence radius (vortexRad * 2.1). */
  R: number;
  /** Pinch strength (4 + vortexRad * 0.16). */
  K: number;
}

/**
 * The sprite layer of a GPU-composed frame (perf ticket #8). Same Float RGBA
 * layout and Y-flipped indexing as `pixelData`; alpha 1 = "setPx replaced the
 * terrain here", alpha 0 = additive only. Writers must `mark()` every pixel
 * they touch — only marked pixels are cleared next frame and uploaded.
 */
export interface OverlaySurface {
  /** Float RGBA staging, VIEW_W x VIEW_H, Y-flipped rows. */
  readonly data: Float32Array;
  /** Record a touched pixel (pixel index, not float offset). Idempotent. */
  mark(pixelIdx: number): void;
}

/** The CPU-side framebuffer the composer writes into (owned by the Three.js renderer). */
export interface RenderTarget {
  /** Float RGBA, VIEW_W x VIEW_H, Y-flipped rows for GL texture orientation. */
  readonly pixelData: Float32Array;
  /** Flag the GPU texture for re-upload after the buffer was written (CPU path). */
  markTextureDirty(): void;
  /** WebGL2 + shader path usable; false = the CPU loop is the permanent fallback. */
  readonly gpuComposeAvailable: boolean;
  /**
   * Start a GPU-composed frame: packs the world window texture, feeds the
   * lighting/LUT/distortion uniforms, and clears last frame's overlay writes.
   * Returns the overlay surface this frame's sprites draw into.
   */
  beginGpuCompose(
    ctx: Ctx,
    light: LightField,
    layers: ParallaxLayers,
    lenses: readonly CompositorLens[],
    lightRebuilt: boolean,
  ): OverlaySurface;
  /** Finish a GPU-composed frame: stage written overlay pixels for upload. */
  commitGpuCompose(): void;
}

export interface RendererBackend extends RenderTarget {
  readonly domElement: HTMLCanvasElement;
  syncSettings(settings: RenderSettings): void;
  render(ctx: Ctx): void;
  getBackendStatus(): RenderBackendStatus;
  dispose(): void;
}

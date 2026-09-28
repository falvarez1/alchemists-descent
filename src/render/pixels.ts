import type { BackdropLayerId, BackdropProfile, Ctx, RenderBackendMode, RenderSettings } from '@/core/types';
import type { GpuInfo } from '@/render/gpuInfo';

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
  compose: RenderBackendWebGpuComposeStatus;
}

export interface RenderBackendWebGpuComposeStatus {
  /** Runtime production compose remains false until parity and timing gates pass. */
  productionAvailable: boolean;
  bridge: 'unrequested' | 'initializing' | 'validated' | 'failed' | 'unsupported';
  reason: string;
  outputStorage: RenderBackendWebGpuComposeStorageStatus | null;
  rawWgslWrite: RenderBackendWebGpuComposeRawWgslStatus;
  liveMetrics?: RenderBackendWebGpuComposeLiveMetrics | null;
}

export interface RenderBackendWebGpuComposeStorageStatus {
  format: string;
  width: number | null;
  height: number | null;
  mipLevelCount: number | null;
  usage: number | null;
  source: string;
}

export interface RenderBackendWebGpuComposeRawWgslStatus {
  status: 'unrequested' | 'validated' | 'failed';
  reason: string;
  maxDelta: number | null;
  mismatchPct: number | null;
  exactPct: number | null;
  meanDelta: number | null;
  gpuSubmitReadbackWallMs: number | null;
}

export interface RenderBackendWebGpuComposeLiveMetrics {
  frameId: number;
  outputPixels: number;
  dispatchWorkgroupsX: number;
  dispatchWorkgroupsY: number;
  beginFrameCpuMs: number;
  commitCpuMs: number;
  packWindowCpuMs: number;
  packWindowBytes: number;
  worldWindowLogicalUploadBytes: number;
  worldWindowSubmittedUploadBytes: number;
  worldWindowUploadCpuMs: number;
  lightUploadedThisFrame: boolean;
  lightPackCpuMs: number;
  lightLogicalUploadBytes: number;
  lightSubmittedUploadBytes: number;
  lightUploadCpuMs: number;
  lutPackCpuMs: number;
  lutLogicalUploadBytes: number;
  lutSubmittedUploadBytes: number;
  lutUploadCpuMs: number;
  paramsUploadBytes: number;
  paramsUploadCpuMs: number;
  backdropTextureUploads: number;
  backdropLogicalUploadBytes: number;
  backdropSubmittedUploadBytes: number;
  backdropUploadCpuMs: number;
  overlayTouchedPixels: number;
  overlayPackCpuMs: number;
  overlayLogicalUploadBytes: number;
  overlaySubmittedUploadBytes: number;
  overlayUploadCpuMs: number;
  commandEncodeSubmitCpuMs: number;
  totalLogicalUploadBytes: number;
  totalSubmittedUploadBytes: number;
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
  /** The adapter the browser actually gave us (integrated vs discrete). */
  gpu?: GpuInfo;
}

/** The two pixel primitives every sprite/particle/beam renderer draws with. */
export interface PixelSurface {
  /** Smallest presentation step in world units, independent of collision. */
  readonly pixelStep?: number;
  /** Draw one presentation pixel. Legacy surfaces fall back to setPx. */
  setFinePx?(wx: number, wy: number, r: number, g: number, b: number): void;
  /** Add light at the same fine presentation resolution. */
  addFinePx?(wx: number, wy: number, r: number, g: number, b: number): void;
  /**
   * Premultiplied alpha-over at fine resolution: the terrain (and anything
   * already drawn) shows through by (1 - a). Gel, jelly bells and wing
   * membranes use it; surfaces without it fall back to an opaque setFinePx.
   */
  blendFinePx?(wx: number, wy: number, r: number, g: number, b: number, a: number): void;
  /**
   * Bulk write of a fine-resolution block whose pixel grid is exactly the
   * surface's (`pixelStep`): origin (x0, y0) in world units, `w`×`h` pixels.
   * `rgb` holds premultiplied colour, `a` the coverage (0 skip, 1 opaque,
   * between = alpha-over), `glow` optional additive light (or null).
   */
  blitFine?(x0: number, y0: number, w: number, h: number, rgb: Float32Array, a: Float32Array, glow: Float32Array | null): void;
  /** Write one RGB pixel (alpha 1) at world coords; camera-relative, view-culled. */
  setPx(wx: number, wy: number, r: number, g: number, b: number): void;
  /** Additively blend RGB at world coords (alpha untouched). */
  addPx(wx: number, wy: number, r: number, g: number, b: number): void;
}

export interface LightSample {
  r: number;
  g: number;
  b: number;
  /** Designed-darkness render factor at the point (1 = readable; see Lighting.lightOpen). */
  open?: number;
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
  /**
   * Designed darkness per light texel as a render factor (1 = shipped look,
   * → 0 = deep dark): scales ambient and the readability floor in every
   * compose path. Absent = all ones (builder/test fields).
   */
  readonly lightOpen?: Float32Array;
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
  /**
   * How much real light (lantern, wand, lava glow) reaches this layer, 0–1
   * (render/depth: far planes ~0.1, near planes ~0.9). Absent = 1: the
   * classic backdrop takes the full light term.
   */
  lit?: number;
}

/**
 * The floor's backdrop grade (config/floorLooks: tint, composition variant,
 * machinery opacity, natural-floor saturation and haze) as a depth kit
 * substitutes it: kits bake their own colour, so they neutralize the tint.
 * The natural floors' contact shadow is unaffected.
 */
export interface BackdropFloorGrade {
  readonly mul: readonly [number, number, number];
  readonly lift: readonly [number, number, number];
  readonly offsetX: number;
  readonly mirror: boolean;
  readonly machinery: number;
  readonly sat: number;
  readonly haze: readonly [number, number, number];
  readonly hazeMix: number;
}

/** Where a depth particle pass draws: behind the play layer's sprites, or in front of everything. */
export type DepthParticlePass = 'behind' | 'front';

/**
 * Image-backed parallax backdrop layers. Each PNG carries its own alpha.
 * A depth scene (render/depth/DepthScene) also supplies the frame's layer
 * settings and floor grade, and draws its depth particles into the overlay.
 */
export interface ParallaxLayers {
  readonly backdropLayers: readonly ParallaxBitmapLayer[];
  readonly ready: boolean;
  /** This frame's layer settings (a depth kit's planes); null/absent = resolve from params.backdrop. */
  readonly profile?: BackdropProfile | null;
  /** Substitute floor grade while a kit is active; null/absent = the floor look's. */
  readonly grade?: BackdropFloorGrade | null;
  /** Per-frame update, called by the composer once the frame's camera is known. */
  sync?(ctx: Ctx): void;
  /** Presentation-only particles at several depths, drawn through the sprite surface. */
  drawParticles?(out: PixelSurface, light: LightField, ctx: Ctx, pass: DepthParticlePass): void;
}

/**
 * The foreground occluder plane (render/depth) as the presentation backends
 * draw it: a quad over the composed frame, before bloom and the lens pass.
 * The plane texel under view point v is floor((renderCam + v + cam·(P − 1)) / scale);
 * its alpha is scaled by the reveal field (R = allowance, G = light catch),
 * sampled across the view.
 */
export interface ForegroundSource {
  readonly enabled: boolean;
  readonly bitmap: { readonly width: number; readonly height: number; readonly pixels: Uint8ClampedArray } | null;
  /** Bumps whenever `bitmap` changes (texture re-upload). */
  readonly version: number;
  readonly parallax: number;
  readonly scale: number;
  readonly opacity: number;
  readonly reveal: { readonly w: number; readonly h: number; readonly bytes: Uint8Array; readonly version: number };
  /** The kit's depth particle fields (drawn as GL points where the backend can). */
  readonly particles: DepthParticleFrame;
}

/** One depth particle field as the GL point pass draws it (config/depthKits DepthParticleSpec). */
export interface DepthParticleField {
  readonly parallax: number;
  readonly count: number;
  readonly color: readonly [number, number, number];
  readonly size: 1 | 2 | 3;
  readonly drift: readonly [number, number];
  readonly sway: number;
  readonly twinkle: number;
  readonly behind: boolean;
  readonly light: 'open' | 'light';
  readonly inShafts?: number;
}

/** The depth particles' live state: fields, seed, and the shaft plane they glint in. */
export interface DepthParticleFrame {
  readonly enabled: boolean;
  /** Bumps when the fields or the shaft plane change (geometry / texture rebuild). */
  readonly version: number;
  readonly seed: number;
  readonly fields: readonly DepthParticleField[];
  readonly shaft: {
    readonly bitmap: { readonly width: number; readonly height: number; readonly pixels: Uint8ClampedArray };
    readonly parallax: number;
    readonly scale: number;
    readonly opacity: number;
  } | null;
}

/** An image-distortion lens as the composer feeds it to the distortion pass:
 *  a black-hole swirl, or (K < 0) a telekinetic heat-haze shimmer. */
export interface CompositorLens {
  cx: number;
  cy: number;
  /** Influence radius (vortexRad * 2.1 for a swirl; body-size + pad for haze). */
  R: number;
  /** Pinch strength (4 + vortexRad * 0.16). A NEGATIVE K marks a heat-haze
   *  shimmer instead of a swirl: |K| is the warp amplitude in cells. */
  K: number;
}

/**
 * The sprite layer of a GPU-composed frame (perf ticket #8). Same Float RGBA
 * layout and Y-flipped indexing as `pixelData`; alpha 1 = "setPx replaced the
 * terrain here", alpha 0 = additive only. Writers must `mark()` every pixel
 * they touch — only marked pixels are cleared next frame and uploaded.
 */
export interface OverlaySurface {
  /** Presentation pixels per material cell; omitted by legacy backends. */
  readonly scale?: number;
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
  /**
   * The presentation draws the depth particles itself (GL points masked by
   * the frame's backdrop alpha), so the composer must not draw them into the
   * sprite overlay. Absent/false: the composer draws them (WebGPU, tests).
   */
  readonly nativeDepthParticles?: boolean;
}

export interface RendererBackend extends RenderTarget {
  readonly domElement: HTMLCanvasElement;
  syncSettings(settings: RenderSettings): void;
  render(ctx: Ctx): void;
  getBackendStatus(): RenderBackendStatus;
  dispose(): void;
}

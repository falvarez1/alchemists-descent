import {
  ACESFilmicToneMapping,
  DataTexture,
  FloatType,
  NearestFilter,
  NoColorSpace,
  NoToneMapping,
  RGBAFormat,
  RenderPipeline,
  SRGBColorSpace,
  StorageTexture,
  Vector2,
  WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
  clamp,
  dot,
  float,
  fract,
  max,
  mix,
  renderOutput,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

import { RENDER_H, RENDER_W, VIEW_H, VIEW_W } from '@/config/constants';
import type { Ctx, RenderSettings } from '@/core/types';
import type {
  CompositorLens,
  LightField,
  OverlaySurface,
  ParallaxLayers,
  RenderBackendFeatureFlags,
  RenderBackendHealth,
  RenderBackendStatus,
  RenderBackendWebGpuComposeStatus,
  RendererBackend,
} from '@/render/pixels';
import { WebGpuComposeBridge, webGpuComposeUnrequestedStatus } from '@/render/WebGpuComposeBridge';
import { WebGpuDeviceLifecycle } from '@/render/WebGpuDeviceLifecycle';
import { WebGpuLiveCompose } from '@/render/WebGpuLiveCompose';

interface NavigatorWithGpu {
  gpu?: {
    requestAdapter(): Promise<unknown | null>;
  };
}

interface ThreeGpuBackendProbe {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  compatibilityMode?: boolean;
  device?: {
    features?: Set<string>;
    limits?: Record<string, number>;
    lost?: Promise<{ reason?: string; message?: string }>;
    destroy?(): void;
    queue?: { onSubmittedWorkDone?(): Promise<void> };
  };
}

const WEBGPU_COMPOSE_LIMIT_KEYS = [
  'maxTextureDimension2D',
  'maxBindGroups',
  'maxBindingsPerBindGroup',
  'maxSampledTexturesPerShaderStage',
  'maxSamplersPerShaderStage',
  'maxStorageTexturesPerShaderStage',
  'maxStorageBuffersPerShaderStage',
  'maxUniformBufferBindingSize',
  'maxStorageBufferBindingSize',
  'maxBufferSize',
] as const;

type TslUvNode = NonNullable<Parameters<typeof texture>[1]>;
type TslRgbNode = ReturnType<typeof texture>['rgb'];
type ToneMappingMode = typeof ACESFilmicToneMapping | typeof NoToneMapping;

function backendName(renderer: WebGPURenderer): 'webgpu' | 'webgl2' | 'unknown' {
  const backend = renderer.backend as unknown as ThreeGpuBackendProbe;
  if (backend.isWebGPUBackend) return 'webgpu';
  if (backend.isWebGLBackend) return 'webgl2';
  return 'unknown';
}

function featureFlags(settings: RenderSettings): RenderBackendFeatureFlags {
  return {
    compose: settings.compose,
    lighting: settings.lighting,
    particles: settings.particles,
    post: settings.post,
  };
}

function secureContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true;
}

function navigatorGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && Boolean((navigator as NavigatorWithGpu).gpu);
}

function hasLifecycleDevice(
  device: ThreeGpuBackendProbe['device'],
): device is { lost: Promise<{ reason?: string; message?: string }>; destroy?(): void } {
  return Boolean(device?.lost);
}

function shouldSimulateInitFailure(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('simulateWebGpuInitFailure') === '1'
  );
}

function shouldValidateComposeBridge(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('validateWebGpuComposeBridge') === '1'
  );
}

function shouldValidateComposeRawWgsl(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('validateWebGpuComposeRawWgsl') === '1'
  );
}

function collectWebGpuFeatures(device: ThreeGpuBackendProbe['device']): string[] {
  return Array.from(device?.features ?? []).sort();
}

function collectWebGpuLimits(device: ThreeGpuBackendProbe['device']): Record<string, number> | null {
  const limits = device?.limits;
  if (!limits) return null;
  const result: Record<string, number> = {};
  for (const key of WEBGPU_COMPOSE_LIMIT_KEYS) {
    const value = limits[key];
    if (typeof value === 'number') result[key] = value;
  }
  return result;
}

function liveComposeRuntimeStatus(
  bridge: 'initializing' | 'failed',
  reason: string,
): RenderBackendWebGpuComposeStatus {
  return {
    productionAvailable: false,
    bridge,
    reason,
    outputStorage: null,
    rawWgslWrite: {
      status: 'unrequested',
      reason: 'webgpu-live-compose-raw-wgsl-readback-not-requested',
      maxDelta: null,
      mismatchPct: null,
      exactPct: null,
      meanDelta: null,
      gpuSubmitReadbackWallMs: null,
    },
  };
}

/**
 * Phase 3 WebGPU presentation backend. It deliberately keeps terrain
 * composition on the existing CPU path; Phase 4 owns the WebGPU compose port.
 * The value here is proving the canvas, WebGPURenderer, TSL post chain, and
 * input ownership can coexist with the current game loop.
 */
export class WebGpuRenderBackend implements RendererBackend {
  /** Float RGBA, VIEW_W x VIEW_H, Y-flipped rows to match the WebGL reference buffer. */
  readonly pixelData: Float32Array<ArrayBuffer>;

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGPURenderer;
  private readonly texture: DataTexture;
  private readonly basePipeline: RenderPipeline;
  private readonly basePipelineNoTone: RenderPipeline;
  private readonly postPipeline: RenderPipeline;
  private readonly postPipelineNoTone: RenderPipeline;
  private readonly deviceLifecycle = new WebGpuDeviceLifecycle();
  private requestedBackend: RenderSettings['backend'];
  private flags: RenderBackendFeatureFlags;
  private initState: RenderBackendHealth = 'recovering';
  private initReason = 'webgpu-initializing';
  private initError: string | null = null;
  private actualBackend: 'webgpu' | 'webgl2' | 'unknown' = 'unknown';
  private deviceFeatures: string[] = [];
  private deviceLimits: Record<string, number> | null = null;
  private timestampQueryAvailable: boolean | null = null;
  private composeBridge: WebGpuComposeBridge | null = null;
  private liveCompose: WebGpuLiveCompose | null = null;
  private liveComposeInitPromise: Promise<void> | null = null;
  private liveComposeInitFailure: string | null = null;
  private liveComposeBasePipeline: RenderPipeline | null = null;
  private liveComposeBasePipelineNoTone: RenderPipeline | null = null;
  private liveComposePostPipeline: RenderPipeline | null = null;
  private liveComposePostPipelineNoTone: RenderPipeline | null = null;
  private liveComposeFrame = false;
  private disposed = false;
  private initGeneration = 0;

  private readonly bloomEnabled = uniform(1);
  private readonly lensEnabled = uniform(1);
  private readonly exposure = uniform(1.0);
  private readonly bloomStrength = uniform(0.35);
  private readonly bloomThreshold = uniform(0.85);
  private readonly bloomRadius = uniform(0.28);
  private readonly aberration = uniform(0.0005);
  private readonly grain = uniform(0.028);
  private readonly hurt = uniform(0);
  private readonly time = uniform(0);
  private readonly quadOffset = uniform(new Vector2(0, 0));
  private readonly quadScale = uniform(new Vector2(1 + 4 / VIEW_W, 1 + 4 / VIEW_H));

  constructor(holder: HTMLElement, settings: RenderSettings) {
    this.requestedBackend = settings.backend;
    this.flags = featureFlags(settings);
    this.canvas = document.createElement('canvas');
    this.canvas.width = RENDER_W;
    this.canvas.height = RENDER_H;
    this.canvas.dataset.renderBackend = 'webgpu';
    this.canvas.style.imageRendering = 'pixelated';
    holder.appendChild(this.canvas);

    this.pixelData = new Float32Array(VIEW_W * VIEW_H * 4);
    this.texture = new DataTexture(
      this.pixelData,
      VIEW_W,
      VIEW_H,
      RGBAFormat,
      FloatType,
      undefined,
      undefined,
      undefined,
      NearestFilter,
      NearestFilter,
      undefined,
      NoColorSpace,
    );
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;

    this.renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      forceWebGL: false,
      powerPreference: 'high-performance',
      trackTimestamp: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(RENDER_W, RENDER_H, false);
    this.renderer.outputColorSpace = SRGBColorSpace;
    // RenderPipeline nodes below call renderOutput(..., ACES, SRGB) explicitly.
    // Keep renderer globals neutral so WebGPU does not drift from WebGL via
    // backend-level tone/color defaults.
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.basePipeline = new RenderPipeline(this.renderer, this.buildBaseOutputNode());
    this.basePipeline.outputColorTransform = false;
    this.basePipelineNoTone = new RenderPipeline(this.renderer, this.buildBaseOutputNode(NoToneMapping));
    this.basePipelineNoTone.outputColorTransform = false;
    this.postPipeline = new RenderPipeline(this.renderer, this.buildPostOutputNode());
    this.postPipeline.outputColorTransform = false;
    this.postPipelineNoTone = new RenderPipeline(this.renderer, this.buildPostOutputNode(NoToneMapping));
    this.postPipelineNoTone.outputColorTransform = false;

    void this.initialize();
  }

  get initializationFailed(): boolean {
    return this.initState === 'failed';
  }

  get deviceLost(): boolean {
    return this.deviceLifecycle.status().state === 'lost';
  }

  get deviceLossReason(): string {
    const lifecycle = this.deviceLifecycle.status();
    const detail = lifecycle.lastLossReason ?? lifecycle.lastLossMessage;
    return detail ? `webgpu-device-lost-webgl-fallback: ${detail}` : 'webgpu-device-lost-webgl-fallback';
  }

  get failureReason(): string | null {
    return this.initError ? `${this.initReason}: ${this.initError}` : this.initReason;
  }

  releaseCanvasForWebGlFallback(reuseCanvas: boolean): HTMLCanvasElement | undefined {
    if (this.disposed) return reuseCanvas ? this.canvas : undefined;
    this.disposed = true;
    this.initGeneration++;
    this.basePipeline.dispose();
    this.basePipelineNoTone.dispose();
    this.postPipeline.dispose();
    this.postPipelineNoTone.dispose();
    this.composeBridge?.dispose();
    this.composeBridge = null;
    this.liveComposeBasePipeline?.dispose();
    this.liveComposeBasePipeline = null;
    this.liveComposeBasePipelineNoTone?.dispose();
    this.liveComposeBasePipelineNoTone = null;
    this.liveComposePostPipeline?.dispose();
    this.liveComposePostPipeline = null;
    this.liveComposePostPipelineNoTone?.dispose();
    this.liveComposePostPipelineNoTone = null;
    this.liveCompose?.dispose();
    this.liveCompose = null;
    this.texture.dispose();
    this.renderer.dispose();
    if (reuseCanvas) {
      this.canvas.dataset.renderBackend = 'webgl-fallback';
      return this.canvas;
    }
    this.canvas.remove();
    return undefined;
  }

  private initStale(generation: number): boolean {
    return this.disposed || generation !== this.initGeneration;
  }

  private pixelUv() {
    const p = uv();
    const ndc = p.mul(2).sub(1);
    return ndc.sub(this.quadOffset).div(this.quadScale).mul(0.5).add(0.5).flipY();
  }

  // Single source of truth for the base/post-FX TSL, parameterized only by how the
  // source pixels are sampled. The DataTexture path samples `this.texture`; the
  // GPU-compose path samples a StorageTexture. Both must stay identical, so they
  // share these builders rather than maintaining two copies (see buildPostOutputNodeFrom).
  private buildBaseOutputNodeFrom(
    sampleRgb: (sampleUv: TslUvNode) => TslRgbNode,
    toneMapping: ToneMappingMode = ACESFilmicToneMapping,
  ): ReturnType<typeof renderOutput> {
    const baseColor = Fn(() => vec4(sampleRgb(this.pixelUv()), 1.0))();
    return renderOutput(baseColor, toneMapping, SRGBColorSpace);
  }

  private buildPostOutputNodeFrom(
    sampleRgb: (sampleUv: TslUvNode) => TslRgbNode,
    toneMapping: ToneMappingMode = ACESFilmicToneMapping,
  ): ReturnType<typeof renderOutput> {
    const texel = vec2(1 / VIEW_W, 1 / VIEW_H);
    const brightness = (rgb: TslRgbNode) =>
      max(max(rgb.r, rgb.g), rgb.b).sub(this.bloomThreshold).max(0);
    const brightColor = (rgb: TslRgbNode) => rgb.mul(brightness(rgb));
    const tap1 = texel.mul(this.bloomRadius.mul(4.0).add(1.0));
    const tap2 = tap1.mul(2.0);

    const postColor = Fn(() => {
      const p = this.pixelUv();
      const base = sampleRgb(p);
      const centered = p.sub(0.5);
      const r2 = dot(centered, centered);
      const aberrationShift = centered.mul(r2.mul(this.aberration).mul(40.0));
      const aberrated = vec3(
        sampleRgb(p.sub(aberrationShift)).r,
        base.g,
        sampleRgb(p.add(aberrationShift)).b,
      );

      const c0 = brightColor(base).mul(0.28);
      const c1 = brightColor(sampleRgb(p.add(vec2(tap1.x, 0)))).mul(0.12);
      const c2 = brightColor(sampleRgb(p.sub(vec2(tap1.x, 0)))).mul(0.12);
      const c3 = brightColor(sampleRgb(p.add(vec2(0, tap1.y)))).mul(0.12);
      const c4 = brightColor(sampleRgb(p.sub(vec2(0, tap1.y)))).mul(0.12);
      const c5 = brightColor(sampleRgb(p.add(tap2))).mul(0.06);
      const c6 = brightColor(sampleRgb(p.sub(tap2))).mul(0.06);
      const bloom = c0
        .add(c1)
        .add(c2)
        .add(c3)
        .add(c4)
        .add(c5)
        .add(c6)
        .mul(this.bloomStrength)
        .mul(this.bloomEnabled);

      const bloomBase = base.add(bloom);
      const lensBase = aberrated.add(bloom);
      const grainHash = fract(
        sin(dot(p.mul(vec2(RENDER_W, RENDER_H)).add(this.time.mul(17.0)), vec2(12.9898, 78.233)))
          .mul(43758.5453),
      ).sub(0.5);
      const lumaWeight = float(0.4).add(
        clamp(float(1).sub(dot(lensBase, vec3(0.333))), 0, 1).mul(0.6),
      );
      const withGrain = lensBase.add(grainHash.mul(this.grain).mul(lumaWeight));
      const hurtMix = this.hurt
        .mul(smoothstep(0.18, 0.55, r2))
        .mul(sin(this.time.mul(0.12)).mul(0.25).add(0.75))
        .mul(0.6);
      const lensed = mix(withGrain, vec3(0.45, 0.02, 0.04), hurtMix);
      const post = mix(bloomBase, lensed, this.lensEnabled).mul(this.exposure);
      return vec4(post, 1.0);
    })();

    return renderOutput(postColor, toneMapping, SRGBColorSpace);
  }

  private buildBaseOutputNode(toneMapping: ToneMappingMode = ACESFilmicToneMapping): ReturnType<typeof renderOutput> {
    return this.buildBaseOutputNodeFrom((sampleUv) => texture(this.texture, sampleUv).rgb, toneMapping);
  }

  private storageSampleRgb(storageTexture: StorageTexture, sampleUv: TslUvNode) {
    return texture(storageTexture, sampleUv).rgb;
  }

  private buildStorageBaseOutputNode(
    storageTexture: StorageTexture,
    toneMapping: ToneMappingMode = ACESFilmicToneMapping,
  ): ReturnType<typeof renderOutput> {
    return this.buildBaseOutputNodeFrom((sampleUv) => this.storageSampleRgb(storageTexture, sampleUv), toneMapping);
  }

  private buildPostOutputNode(toneMapping: ToneMappingMode = ACESFilmicToneMapping): ReturnType<typeof renderOutput> {
    return this.buildPostOutputNodeFrom((sampleUv) => texture(this.texture, sampleUv).rgb, toneMapping);
  }

  private buildStoragePostOutputNode(
    storageTexture: StorageTexture,
    toneMapping: ToneMappingMode = ACESFilmicToneMapping,
  ): ReturnType<typeof renderOutput> {
    return this.buildPostOutputNodeFrom((sampleUv) => this.storageSampleRgb(storageTexture, sampleUv), toneMapping);
  }

  private async ensureLiveComposeDiagnostic(): Promise<void> {
    if (this.disposed) return;
    if (this.liveCompose !== null) return;
    if (this.liveComposeInitPromise) return this.liveComposeInitPromise;
    if (this.actualBackend !== 'webgpu') return;
    this.liveComposeInitFailure = null;
    this.liveComposeInitPromise = this.initializeLiveComposeDiagnostic().finally(() => {
      this.liveComposeInitPromise = null;
    });
    return this.liveComposeInitPromise;
  }

  private async initializeLiveComposeDiagnostic(): Promise<void> {
    const liveCompose = new WebGpuLiveCompose(this.renderer);
    this.liveCompose = liveCompose;
    try {
      const composeStatus = await liveCompose.initialize();
      if (this.disposed || this.liveCompose !== liveCompose) {
        liveCompose.dispose();
        return;
      }
      if (composeStatus.bridge !== 'validated') {
        console.warn('WebGPU live compose diagnostic initialization failed', composeStatus.reason);
        this.liveComposeInitFailure = composeStatus.reason;
        liveCompose.dispose();
        this.liveCompose = null;
        return;
      }
      this.liveComposeBasePipeline = new RenderPipeline(
        this.renderer,
        this.buildStorageBaseOutputNode(liveCompose.outputTexture),
      );
      this.liveComposeBasePipeline.outputColorTransform = false;
      this.liveComposeBasePipelineNoTone = new RenderPipeline(
        this.renderer,
        this.buildStorageBaseOutputNode(liveCompose.outputTexture, NoToneMapping),
      );
      this.liveComposeBasePipelineNoTone.outputColorTransform = false;
      this.liveComposePostPipeline = new RenderPipeline(
        this.renderer,
        this.buildStoragePostOutputNode(liveCompose.outputTexture),
      );
      this.liveComposePostPipeline.outputColorTransform = false;
      this.liveComposePostPipelineNoTone = new RenderPipeline(
        this.renderer,
        this.buildStoragePostOutputNode(liveCompose.outputTexture, NoToneMapping),
      );
      this.liveComposePostPipelineNoTone.outputColorTransform = false;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.liveComposeInitFailure = reason;
      console.warn('WebGPU live compose diagnostic initialization failed', error);
      liveCompose.dispose();
      this.liveCompose = null;
      this.liveComposeBasePipeline?.dispose();
      this.liveComposeBasePipeline = null;
      this.liveComposeBasePipelineNoTone?.dispose();
      this.liveComposeBasePipelineNoTone = null;
      this.liveComposePostPipeline?.dispose();
      this.liveComposePostPipeline = null;
      this.liveComposePostPipelineNoTone?.dispose();
      this.liveComposePostPipelineNoTone = null;
    }
  }

  private async initialize(): Promise<void> {
    const generation = ++this.initGeneration;
    try {
      if (shouldSimulateInitFailure()) {
        throw new Error('simulated WebGPU init failure');
      }
      if (!secureContext()) {
        throw new Error('WebGPU requires a secure context');
      }
      if (!navigatorGpuAvailable()) {
        throw new Error('navigator.gpu unavailable');
      }
      await this.renderer.init();
      if (this.initStale(generation)) return;
      this.actualBackend = backendName(this.renderer);
      const backend = this.renderer.backend as unknown as ThreeGpuBackendProbe;
      this.deviceFeatures = collectWebGpuFeatures(backend.device);
      this.deviceLimits = collectWebGpuLimits(backend.device);
      this.timestampQueryAvailable = this.deviceFeatures.includes('timestamp-query');
      if (this.actualBackend === 'webgpu' && hasLifecycleDevice(backend.device)) {
        this.deviceLifecycle.trackDevice(backend.device);
      }
      if (this.actualBackend === 'webgpu' && this.flags.compose) {
        await this.ensureLiveComposeDiagnostic();
        if (this.initStale(generation)) return;
      }
      if (this.actualBackend === 'webgpu' && !this.flags.compose && shouldValidateComposeBridge()) {
        this.composeBridge = new WebGpuComposeBridge(this.renderer);
        const composeStatus = await this.composeBridge.initialize();
        if (this.initStale(generation)) {
          this.composeBridge?.dispose();
          this.composeBridge = null;
          return;
        }
        if (composeStatus.bridge !== 'validated') {
          console.warn('WebGPU compose runtime bridge validation failed', composeStatus.reason);
        }
        if (composeStatus.bridge === 'validated' && shouldValidateComposeRawWgsl()) {
          const rawWgslStatus = await this.composeBridge.validateRawWgslWrite();
          if (this.initStale(generation)) return;
          if (rawWgslStatus.status !== 'validated') {
            console.warn('WebGPU compose raw WGSL runtime write validation failed', rawWgslStatus.reason);
          }
        }
      }
      this.initState = 'active';
      this.initReason =
        this.actualBackend === 'webgpu' ? 'webgpu-presentation-active' : 'webgpu-renderer-webgl2-fallback';
    } catch (error) {
      if (this.initStale(generation)) return;
      this.initState = 'failed';
      this.initReason = 'webgpu-init-failed';
      this.initError = error instanceof Error ? error.message : String(error);
      console.warn('WebGPU presentation backend failed to initialize', error);
    }
  }

  syncSettings(settings: RenderSettings): void {
    if (this.disposed) return;
    this.requestedBackend = settings.backend;
    this.flags = featureFlags(settings);
    if (this.flags.compose && this.initState === 'active' && this.actualBackend === 'webgpu') {
      void this.ensureLiveComposeDiagnostic();
    }
  }

  markTextureDirty(): void {
    this.texture.needsUpdate = true;
    this.liveComposeFrame = false;
  }

  get gpuComposeAvailable(): boolean {
    return (
      this.flags.compose &&
      this.initState === 'active' &&
      this.actualBackend === 'webgpu' &&
      this.deviceLifecycle.status().state !== 'lost' &&
      this.liveCompose?.available === true &&
      this.liveComposeBasePipeline !== null &&
      this.liveComposeBasePipelineNoTone !== null &&
      this.liveComposePostPipeline !== null &&
      this.liveComposePostPipelineNoTone !== null
    );
  }

  beginGpuCompose(
    ctx: Ctx,
    light: LightField,
    layers: ParallaxLayers,
    lenses: readonly CompositorLens[],
    lightRebuilt: boolean,
  ): OverlaySurface {
    if (!this.flags.compose) {
      throw new Error('WebGPU live compose diagnostic is disabled');
    }
    if (!this.liveCompose?.available) {
      throw new Error('WebGPU live compose diagnostic is not initialized');
    }
    this.liveComposeFrame = true;
    return this.liveCompose.beginFrame(ctx, light, layers, lenses, lightRebuilt);
  }

  commitGpuCompose(): void {
    if (!this.liveCompose?.available) {
      throw new Error('WebGPU live compose diagnostic is not initialized');
    }
    this.liveCompose.commit();
    this.liveComposeFrame = true;
  }

  get domElement(): HTMLCanvasElement {
    return this.canvas;
  }

  private composeStatus(lifecycle: ReturnType<WebGpuDeviceLifecycle['status']>) {
    if (lifecycle.state === 'lost') {
      return {
        productionAvailable: false,
        bridge: 'unsupported' as const,
        reason: 'webgpu-compose-runtime-bridge-invalidated-by-device-loss',
        outputStorage: null,
        rawWgslWrite: {
          status: 'failed' as const,
          reason: 'webgpu-compose-raw-wgsl-write-invalidated-by-device-loss',
          maxDelta: null,
          mismatchPct: null,
          exactPct: null,
          meanDelta: null,
          gpuSubmitReadbackWallMs: null,
        },
      };
    }
    if (this.liveCompose) return this.liveCompose.getStatus();
    if (this.liveComposeInitPromise) {
      return liveComposeRuntimeStatus('initializing', 'webgpu-live-compose-runtime-initializing');
    }
    if (this.liveComposeInitFailure) {
      return liveComposeRuntimeStatus('failed', this.liveComposeInitFailure);
    }
    return this.composeBridge?.getStatus() ?? webGpuComposeUnrequestedStatus(
      this.actualBackend === 'webgpu'
        ? 'webgpu-compose-runtime-bridge-not-requested'
        : 'webgpu-compose-runtime-bridge-requires-actual-webgpu-backend',
    );
  }

  getBackendStatus(): RenderBackendStatus {
    const lifecycle = this.deviceLifecycle.status();
    const webgpuActive = this.actualBackend === 'webgpu' && this.initState !== 'failed';
    const webglFallback = this.actualBackend === 'webgl2';
    return {
      requested: this.requestedBackend,
      actual: webgpuActive ? 'webgpu' : webglFallback ? 'webgl2' : 'none',
      implementation: 'WebGPURenderBackend',
      health: lifecycle.state === 'lost' ? 'lost' : this.initState,
      reason: this.initError ? `${this.initReason}: ${this.initError}` : this.initReason,
      fallback: webglFallback,
      canvas: {
        width: this.canvas.width,
        height: this.canvas.height,
        connected: this.canvas.isConnected,
      },
      features: { ...this.flags },
      webgpu: {
        navigatorGpu: navigatorGpuAvailable(),
        secureContext: secureContext(),
        backendImplemented: true,
        adapter: navigatorGpuAvailable() ? 'available' : 'unavailable',
        device: lifecycle.state === 'lost' ? 'lost' : webgpuActive ? 'available' : this.initState === 'failed' ? 'failed' : 'unchecked',
        deviceFeatures: this.deviceFeatures,
        deviceLimits: this.deviceLimits,
        timestampQueryAvailable: this.timestampQueryAvailable,
        lostCount: lifecycle.lostCount,
        lastLossReason: lifecycle.lastLossReason,
        lastLossMessage: lifecycle.lastLossMessage,
        compose: this.composeStatus(lifecycle),
      },
      webgl: {
        available: webglFallback,
        webgl2: webglFallback,
        contextLost: false,
        lostCount: 0,
        restoredCount: 0,
      },
    };
  }

  render(ctx: Ctx): void {
    if (this.disposed) return;
    if (this.initState !== 'active') return;
    let ox = -(ctx.camera.x - Math.floor(ctx.camera.x)) * (2 / VIEW_W);
    let oy = (ctx.camera.y - Math.floor(ctx.camera.y)) * (2 / VIEW_H);
    if (ctx.fx.screenShake > 0.0005) {
      ox += (Math.random() - 0.5) * 2 * ctx.fx.screenShake;
      oy += (Math.random() - 0.5) * 2 * ctx.fx.screenShake;
      ctx.fx.screenShake *= 0.88;
    } else {
      ctx.fx.screenShake = 0;
    }

    const post = ctx.state.postFx;
    this.bloomEnabled.value = post.enabled && post.bloomEnabled ? 1 : 0;
    this.lensEnabled.value = post.enabled && post.lensEnabled ? 1 : 0;
    this.exposure.value = post.enabled ? post.exposure : 1.0;
    this.bloomStrength.value = post.bloomStrength + ctx.fx.bloomKick * post.bloomKickScale;
    this.bloomThreshold.value = post.bloomThreshold;
    this.bloomRadius.value = post.bloomRadius;
    this.aberration.value =
      post.aberration + ctx.fx.bloomKick * post.aberrationKick + ctx.fx.screenShake * post.shakeAberration;
    this.grain.value = post.grain;
    this.time.value = ctx.state.frameCount;
    this.hurt.value =
      ctx.state.mode === 'play' && !ctx.player.dead
        ? (Math.max(0, 0.35 - ctx.player.hp / ctx.player.maxHp) / 0.35) * post.hurtPulse
        : 0;

    if (ctx.fx.bloomKick > 0.001) ctx.fx.bloomKick *= 0.86;
    else ctx.fx.bloomKick = 0;
    this.quadOffset.value.set(ox * ctx.camera.zoom, oy * ctx.camera.zoom);
    this.quadScale.value.set(
      (1 + 4 / VIEW_W) * ctx.camera.zoom,
      (1 + 4 / VIEW_H) * ctx.camera.zoom,
    );

    const liveComposePipeline =
      this.liveComposeFrame &&
      this.liveComposeBasePipeline !== null &&
      this.liveComposeBasePipelineNoTone !== null &&
      this.liveComposePostPipeline !== null &&
      this.liveComposePostPipelineNoTone !== null;
    if (liveComposePipeline) {
      if (post.enabled) (post.tonemap ? this.liveComposePostPipeline : this.liveComposePostPipelineNoTone)!.render();
      else (post.tonemap ? this.liveComposeBasePipeline : this.liveComposeBasePipelineNoTone)!.render();
    } else if (post.enabled) (post.tonemap ? this.postPipeline : this.postPipelineNoTone).render();
    else (post.tonemap ? this.basePipeline : this.basePipelineNoTone).render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.initGeneration++;
    this.basePipeline.dispose();
    this.basePipelineNoTone.dispose();
    this.postPipeline.dispose();
    this.postPipelineNoTone.dispose();
    this.composeBridge?.dispose();
    this.composeBridge = null;
    this.liveComposeBasePipeline?.dispose();
    this.liveComposeBasePipeline = null;
    this.liveComposeBasePipelineNoTone?.dispose();
    this.liveComposeBasePipelineNoTone = null;
    this.liveComposePostPipeline?.dispose();
    this.liveComposePostPipeline = null;
    this.liveComposePostPipelineNoTone?.dispose();
    this.liveComposePostPipelineNoTone = null;
    this.liveCompose?.dispose();
    this.liveCompose = null;
    this.texture.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

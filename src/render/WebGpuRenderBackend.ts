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
  RendererBackend,
} from '@/render/pixels';
import { WebGpuDeviceLifecycle } from '@/render/WebGpuDeviceLifecycle';

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
  private readonly postPipeline: RenderPipeline;
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
    this.postPipeline = new RenderPipeline(this.renderer, this.buildPostOutputNode());
    this.postPipeline.outputColorTransform = false;

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
    this.basePipeline.dispose();
    this.postPipeline.dispose();
    this.texture.dispose();
    this.renderer.dispose();
    if (reuseCanvas) {
      this.canvas.dataset.renderBackend = 'webgl-fallback';
      return this.canvas;
    }
    this.canvas.remove();
    return undefined;
  }

  private pixelUv() {
    const p = uv();
    const ndc = p.mul(2).sub(1);
    return ndc.sub(this.quadOffset).div(this.quadScale).mul(0.5).add(0.5).flipY();
  }

  private buildBaseOutputNode(): ReturnType<typeof renderOutput> {
    const baseColor = Fn(() => vec4(texture(this.texture, this.pixelUv()).rgb, 1.0))();
    return renderOutput(baseColor, ACESFilmicToneMapping, SRGBColorSpace);
  }

  private buildPostOutputNode(): ReturnType<typeof renderOutput> {
    const source = this.texture;
    const texel = vec2(1 / VIEW_W, 1 / VIEW_H);

    const sampleRgb = (sampleUv: TslUvNode) => texture(source, sampleUv).rgb;
    const brightness = (rgb: TslRgbNode) =>
      max(max(rgb.r, rgb.g), rgb.b).sub(this.bloomThreshold).max(0);
    const brightColor = (rgb: TslRgbNode) => rgb.mul(brightness(rgb));
    const tap1 = texel.mul(this.bloomRadius.mul(4.0).add(1.0));
    const tap2 = tap1.mul(2.0);

    const postColor = Fn(() => {
      const p = this.pixelUv();
      const base = texture(source, p).rgb;
      const centered = p.sub(0.5);
      const r2 = dot(centered, centered);
      const aberrationShift = centered.mul(r2.mul(this.aberration).mul(40.0));
      const aberrated = vec3(
        texture(source, p.sub(aberrationShift)).r,
        base.g,
        texture(source, p.add(aberrationShift)).b,
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

    return renderOutput(postColor, ACESFilmicToneMapping, SRGBColorSpace);
  }

  private async initialize(): Promise<void> {
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
      this.actualBackend = backendName(this.renderer);
      const backend = this.renderer.backend as unknown as ThreeGpuBackendProbe;
      this.deviceFeatures = collectWebGpuFeatures(backend.device);
      this.deviceLimits = collectWebGpuLimits(backend.device);
      this.timestampQueryAvailable = this.deviceFeatures.includes('timestamp-query');
      if (this.actualBackend === 'webgpu' && hasLifecycleDevice(backend.device)) {
        this.deviceLifecycle.trackDevice(backend.device);
      }
      this.initState = 'active';
      this.initReason =
        this.actualBackend === 'webgpu' ? 'webgpu-presentation-active' : 'webgpu-renderer-webgl2-fallback';
    } catch (error) {
      this.initState = 'failed';
      this.initReason = 'webgpu-init-failed';
      this.initError = error instanceof Error ? error.message : String(error);
      console.warn('WebGPU presentation backend failed to initialize', error);
    }
  }

  syncSettings(settings: RenderSettings): void {
    this.requestedBackend = settings.backend;
    this.flags = featureFlags(settings);
  }

  markTextureDirty(): void {
    this.texture.needsUpdate = true;
  }

  get gpuComposeAvailable(): boolean {
    return false;
  }

  beginGpuCompose(
    _ctx: Ctx,
    _light: LightField,
    _layers: ParallaxLayers,
    _lenses: readonly CompositorLens[],
    _lightRebuilt: boolean,
  ): OverlaySurface {
    throw new Error('WebGPU terrain compose is Phase 4; Phase 3 uses CPU compose');
  }

  commitGpuCompose(): void {
    throw new Error('WebGPU terrain compose is Phase 4; Phase 3 uses CPU compose');
  }

  get domElement(): HTMLCanvasElement {
    return this.canvas;
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

    if (post.enabled) this.postPipeline.render();
    else this.basePipeline.render();
  }

  dispose(): void {
    this.basePipeline.dispose();
    this.postPipeline.dispose();
    this.texture.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

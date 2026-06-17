import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { RENDER_H, RENDER_W, VIEW_H, VIEW_W } from '@/config/constants';
import type { Ctx, RenderSettings } from '@/core/types';
import { chooseRenderBackend } from '@/render/backendSelection';
import { GpuCompose } from '@/render/ComposeShader';
import { PostFx } from '@/render/PostFx';
import { WebGpuRenderBackend } from '@/render/WebGpuRenderBackend';
import type {
  CompositorLens,
  LightField,
  OverlaySurface,
  ParallaxLayers,
  RenderBackendFeatureFlags,
  RenderBackendStatus,
  RenderTarget,
  RendererBackend,
} from '@/render/pixels';
import { webGpuComposeUnrequestedStatus } from '@/render/WebGpuComposeBridge';

/**
 * Three.js WebGL presentation layer: a full-screen orthographic quad textured
 * with the CPU-composed pixel buffer, post-processed through an ACES tonemap
 * and UnrealBloom. The frame composer writes `pixelData` and calls
 * `markTextureDirty()` before `render(ctx)` runs each frame.
 */
class WebGLRenderBackend implements RendererBackend {
  /** Float RGBA, VIEW_W x VIEW_H, Y-flipped rows for GL texture orientation. */
  readonly pixelData: Float32Array<ArrayBuffer>;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly texture: THREE.DataTexture;
  private readonly quadMesh: THREE.Mesh;
  private readonly basicMaterial: THREE.MeshBasicMaterial;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly postFx: PostFx;
  private readonly floatTextureSupported: boolean;
  private requestedBackend: RenderSettings['backend'];
  private featureFlags: RenderBackendFeatureFlags;
  private fallbackReason: string | null;
  private contextLost = false;
  private contextLostCount = 0;
  private contextRestoredCount = 0;
  /** GPU frame composition (perf ticket #8) — built on first use of the flag. */
  private gpu: GpuCompose | null = null;
  /** True while the current frame was composed by the shader path. */
  private gpuFrame = false;

  constructor(
    holder: HTMLElement,
    settings: RenderSettings,
    canvas?: HTMLCanvasElement,
    fallbackReason: string | null = null,
  ) {
    this.requestedBackend = settings.backend;
    this.fallbackReason = fallbackReason;
    this.featureFlags = {
      compose: settings.compose,
      lighting: settings.lighting,
      particles: settings.particles,
      post: settings.post,
    };
    // ===================== Three.js WebGL Setup =====================
    // A 2D quad pipeline needs no depth/stencil/alpha on the default
    // framebuffer (the composer owns its own targets), and the discrete GPU
    // is worth asking for on dual-GPU laptops.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(RENDER_W, RENDER_H);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    if (this.renderer.domElement.parentElement !== holder) {
      holder.appendChild(this.renderer.domElement);
    }
    this.floatTextureSupported =
      this.renderer.capabilities.isWebGL2 || Boolean(this.renderer.extensions.get('OES_texture_float'));

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.pixelData = new Float32Array(VIEW_W * VIEW_H * 4);
    this.texture = new THREE.DataTexture(
      this.pixelData,
      VIEW_W,
      VIEW_H,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.texture.needsUpdate = true;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    this.basicMaterial = new THREE.MeshBasicMaterial({ map: this.texture });
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.quadMesh = new THREE.Mesh(geometry, this.basicMaterial);
    this.quadMesh.scale.set(1 + 4 / VIEW_W, 1 + 4 / VIEW_H, 1); // overscan hides sub-cell camera offsets
    this.scene.add(this.quadMesh);

    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Tighter than the original 1.5/0.4: emissive cells should glow against
    // the rock they light, not swallow it in a screen-space halo.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(RENDER_W, RENDER_H), 1.2, 0.28, 1.0);
    this.composer.addPass(this.bloomPass);

    // Lens layer: chromatic aberration, grain, vignette, low-health pulse.
    this.postFx = new PostFx();
    this.composer.addPass(this.postFx.pass);
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.contextLostCount++;
    this.gpu?.dispose();
    this.gpu = null;
    this.gpuFrame = false;
  };

  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    this.contextRestoredCount++;
    this.texture.needsUpdate = true;
    this.gpu?.dispose();
    this.gpu = null;
    this.gpuFrame = false;
  };

  syncSettings(settings: RenderSettings): void {
    this.requestedBackend = settings.backend;
    this.featureFlags = {
      compose: settings.compose,
      lighting: settings.lighting,
      particles: settings.particles,
      post: settings.post,
    };
  }

  /** Flag the GPU texture for re-upload after the buffer was written. */
  markTextureDirty(): void {
    this.texture.needsUpdate = true;
    this.gpuFrame = false;
  }

  /** WebGL2 is required (integer textures, R8/R32F); CPU path is the fallback. */
  get gpuComposeAvailable(): boolean {
    return this.renderer.capabilities.isWebGL2;
  }

  beginGpuCompose(
    ctx: Ctx,
    light: LightField,
    layers: ParallaxLayers,
    lenses: readonly CompositorLens[],
    lightRebuilt: boolean,
  ): OverlaySurface {
    this.gpu ??= new GpuCompose(this.renderer, layers, light);
    this.gpuFrame = true;
    return this.gpu.beginFrame(ctx, light, lenses, lightRebuilt);
  }

  commitGpuCompose(): void {
    this.gpu?.commit();
  }

  /** The WebGL canvas (the input module attaches its mouse listeners here). */
  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  getBackendStatus(): RenderBackendStatus {
    const webgl2 = this.renderer.capabilities.isWebGL2;
    const webglAvailable = !this.contextLost && this.floatTextureSupported;
    const navigatorGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const secureContext = typeof window === 'undefined' ? false : window.isSecureContext === true;
    const decision = chooseRenderBackend({
      requested: this.requestedBackend,
      webglAvailable,
      webgl2Available: webgl2,
      navigatorGpu,
      secureContext,
      adapterAvailable: navigatorGpu,
      deviceAvailable: navigatorGpu,
      webgpuBackendAvailable: false,
      forceWebGL: this.requestedBackend === 'webgl',
      webgpuDisabled: this.requestedBackend === 'webgl',
      webgpuLost: false,
      webgpuRecovered: false,
    });
    return {
      requested: this.requestedBackend,
      actual: this.contextLost ? 'none' : decision.actual,
      implementation: 'WebGLRenderBackend',
      health: this.contextLost ? 'lost' : this.contextRestoredCount > 0 ? 'recovered' : 'active',
      reason: this.contextLost
        ? 'webgl-context-lost'
        : !this.floatTextureSupported
          ? 'webgl-float-texture-unavailable'
          : this.fallbackReason ?? decision.reason,
      fallback: this.fallbackReason !== null || decision.fallback,
      canvas: {
        width: this.renderer.domElement.width,
        height: this.renderer.domElement.height,
        connected: this.renderer.domElement.isConnected,
      },
      features: { ...this.featureFlags },
      webgpu: {
        navigatorGpu,
        secureContext,
        backendImplemented: false,
        adapter: navigatorGpu ? 'unchecked' : 'unavailable',
        device: navigatorGpu ? 'unchecked' : 'unavailable',
        deviceFeatures: [],
        deviceLimits: null,
        timestampQueryAvailable: null,
        lostCount: 0,
        lastLossReason: null,
        lastLossMessage: null,
        compose: webGpuComposeUnrequestedStatus('webgpu-compose-unavailable-on-webgl-render-backend'),
      },
      webgl: {
        available: webglAvailable,
        webgl2,
        contextLost: this.contextLost,
        lostCount: this.contextLostCount,
        restoredCount: this.contextRestoredCount,
      },
    };
  }

  render(ctx: Ctx): void {
    // Quad material follows however this frame was composed (the flag is
    // runtime-flippable for same-session A/B). The overscan geometry,
    // sub-cell offset, shake jitter, and zoom transform below are shared.
    this.quadMesh.material =
      this.gpuFrame && this.gpu !== null ? this.gpu.material : this.basicMaterial;

    // Sub-cell camera smoothing + screen shake + idle zoom on the render quad
    let ox = -(ctx.camera.x - Math.floor(ctx.camera.x)) * (2 / VIEW_W);
    let oy = (ctx.camera.y - Math.floor(ctx.camera.y)) * (2 / VIEW_H);
    if (ctx.fx.screenShake > 0.0005) {
      ox += (Math.random() - 0.5) * 2 * ctx.fx.screenShake;
      oy += (Math.random() - 0.5) * 2 * ctx.fx.screenShake;
      ctx.fx.screenShake *= 0.88;
    } else {
      ctx.fx.screenShake = 0;
    }
    this.quadMesh.position.x = ox * ctx.camera.zoom;
    this.quadMesh.position.y = oy * ctx.camera.zoom;
    this.quadMesh.scale.set(
      (1 + 4 / VIEW_W) * ctx.camera.zoom,
      (1 + 4 / VIEW_H) * ctx.camera.zoom,
      1,
    );

    // Blast-wave bloom surge decays back to baseline. PostFx reads
    // bloomKick/screenShake BEFORE decay so kicks land this frame.
    const post = ctx.state.postFx;
    this.renderer.toneMapping = post.tonemap ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = post.enabled ? post.exposure : 1.0;
    this.bloomPass.enabled = post.enabled && post.bloomEnabled;
    this.bloomPass.strength = post.bloomStrength + ctx.fx.bloomKick * post.bloomKickScale;
    this.bloomPass.radius = post.bloomRadius;
    this.bloomPass.threshold = post.bloomThreshold;
    this.postFx.pass.enabled = post.enabled && post.lensEnabled;
    this.postFx.update(ctx);
    if (ctx.fx.bloomKick > 0.001) ctx.fx.bloomKick *= 0.86;
    else ctx.fx.bloomKick = 0;

    if (post.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.gpu?.dispose();
    this.gpu = null;
    this.texture.dispose();
    this.basicMaterial.dispose();
    this.quadMesh.geometry.dispose();
    this.bloomPass.dispose();
    this.postFx.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export class Renderer implements RenderTarget {
  private backend: RendererBackend;
  private readonly holder: HTMLElement;

  constructor(holder: HTMLElement, settings: RenderSettings) {
    this.holder = holder;
    this.backend = this.createBackend(settings);
  }

  private canAttemptWebGpu(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.isSecureContext === true &&
      typeof navigator !== 'undefined' &&
      'gpu' in navigator
    );
  }

  private createBackend(settings: RenderSettings): RendererBackend {
    if (settings.backend === 'webgl') {
      return new WebGLRenderBackend(this.holder, settings);
    }
    if (!this.canAttemptWebGpu()) {
      const reason =
        typeof window !== 'undefined' && window.isSecureContext !== true
          ? 'webgpu-insecure-context-webgl-fallback'
          : 'navigator-gpu-absent-webgl-fallback';
      return new WebGLRenderBackend(this.holder, settings, undefined, reason);
    }
    return new WebGpuRenderBackend(this.holder, settings);
  }

  private fallBackFromFailedWebGpu(settings: RenderSettings): void {
    if (!(this.backend instanceof WebGpuRenderBackend) || !this.backend.initializationFailed) return;
    const canvas = this.backend.releaseCanvasForWebGlFallback(true);
    this.backend = new WebGLRenderBackend(
      this.holder,
      settings,
      canvas,
      this.backend.failureReason ?? 'webgpu-init-failed-webgl-fallback',
    );
  }

  private fallBackFromLostWebGpu(settings: RenderSettings): void {
    if (!(this.backend instanceof WebGpuRenderBackend) || !this.backend.deviceLost) return;
    const reason = this.backend.deviceLossReason;
    const canvas = this.backend.releaseCanvasForWebGlFallback(false);
    this.backend = new WebGLRenderBackend(this.holder, settings, canvas, reason);
    this.emitCanvasChanged();
  }

  private emitCanvasChanged(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('renderer-canvas-changed', { detail: { canvas: this.backend.domElement } }));
  }

  get pixelData(): Float32Array {
    return this.backend.pixelData;
  }

  markTextureDirty(): void {
    this.backend.markTextureDirty();
  }

  get gpuComposeAvailable(): boolean {
    return this.backend.gpuComposeAvailable;
  }

  beginGpuCompose(
    ctx: Ctx,
    light: LightField,
    layers: ParallaxLayers,
    lenses: readonly CompositorLens[],
    lightRebuilt: boolean,
  ): OverlaySurface {
    this.backend.syncSettings(ctx.state.render);
    return this.backend.beginGpuCompose(ctx, light, layers, lenses, lightRebuilt);
  }

  commitGpuCompose(): void {
    this.backend.commitGpuCompose();
  }

  get domElement(): HTMLCanvasElement {
    return this.backend.domElement;
  }

  render(ctx: Ctx): void {
    // The fallback helpers may swap this.backend (WebGPU -> WebGL); sync the
    // active backend exactly once, after any swap, so we don't sync a backend
    // that is about to be discarded.
    this.fallBackFromFailedWebGpu(ctx.state.render);
    this.fallBackFromLostWebGpu(ctx.state.render);
    this.backend.syncSettings(ctx.state.render);
    this.backend.render(ctx);
  }

  getBackendStatus(): RenderBackendStatus {
    return this.backend.getBackendStatus();
  }

  dispose(): void {
    this.backend.dispose();
  }
}

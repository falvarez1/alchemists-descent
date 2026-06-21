import type { Ctx, Enemy, RuntimeDecor } from '@/core/types';
import type {
  CompositorLens,
  LightField,
  OverlaySurface,
  ParallaxLayers,
  PixelSurface,
  RenderTarget,
} from '@/render/pixels';
import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import { resolveBackdropProfileForRuntime } from '@/config/backdrop';
import { COMPOSE_MAX_LENSES, COMPOSE_MAX_WAVES } from '@/render/composeLimits';
import {
  LIGHT_CLAMP,
  LIGHT_KNEE_MAX,
  LIGHT_KNEE_SLOPE,
  LIGHT_KNEE_START,
  LIGHT_READABILITY_FLOOR,
  SELF_GLOW_BASE,
  SELF_GLOW_SCALE,
  VIGNETTE_BASE,
} from '@/render/lightingModel';
import { PICKUP_COLOR } from '@/core/pickupDefs';
import { blocksEntity, Cell, isLiquid, isSoftGrowth } from '@/sim/CellType';
import { COLOR_FN, unpackB, unpackG, unpackR } from '@/sim/colors';
import { drawMechanismSprite, drawRuneGlyphSprite } from '@/render/sprites/MechanismSprites';
import {
  drawDigBeam,
  drawLightningArcs,
  drawParticles,
  drawProjectiles,
} from '@/render/sprites/FxSprites';

/** Reusable per-frame descriptor for a visible backdrop layer (see activeBackdropLayers). */
interface ActiveBackdropLayer {
  pixels: Uint8ClampedArray;
  width: number;
  opacity: number;
  xSamples: Int32Array;
  ySamples: Int32Array;
}

// Inert sentinels so the pooled descriptors start with valid-typed fields
// before the first compose populates them (they are never sampled while inert).
const EMPTY_BACKDROP_PIXELS = new Uint8ClampedArray(0);
const EMPTY_SAMPLES = new Int32Array(0);

/**
 * Composes each frame's CPU-side pixel buffer (original updateWebGLBuffers):
 * the lit world window with shockwave/black-hole refraction and parallax
 * background, then overlays particles, lightning, projectiles, enemies, the
 * dig beam and the player sprite. Also provides the setPx/addPx pixel
 * primitives every sprite renderer draws with.
 */
export class FrameComposer implements PixelSurface {
  /** Integer camera snapshot for the current frame (original renderCamX/renderCamY). */
  private renderCamX = 0;
  private renderCamY = 0;
  private lastLightBuildFrame = -1;
  private lastLightBuildRenderX = Number.NaN;
  private lastLightBuildRenderY = Number.NaN;
  private lastLightBuildGpuCompose = false;

  /**
   * Non-null while composing a GPU frame (postFx.gpuCompose): the terrain
   * loop ran as a fragment shader and setPx/addPx write the sprite overlay
   * instead of pixelData. Null = the original CPU path, byte for byte.
   */
  private overlay: OverlaySurface | null = null;
  private readonly backdropSampleX = Array.from({ length: 5 }, () => new Int32Array(VIEW_W));
  private readonly backdropSampleY = Array.from({ length: 5 }, () => new Int32Array(VIEW_H));

  // Per-frame compose scratch, reset (not reallocated) each frame to keep the
  // hot render path allocation-free (mirrors the backdropSampleX/Y pattern).
  // The lens pool reuses CompositorLens objects up to a high-water mark; the
  // backdrop-layer pool reuses the same wrapper objects each frame.
  private readonly lensPool: CompositorLens[] = [];
  private readonly lenses: CompositorLens[] = [];
  private readonly backdropLayerPool: ActiveBackdropLayer[] = Array.from(
    { length: 5 },
    () => ({ pixels: EMPTY_BACKDROP_PIXELS, width: 0, opacity: 0, xSamples: EMPTY_SAMPLES, ySamples: EMPTY_SAMPLES }),
  );
  private readonly activeBackdropLayers: ActiveBackdropLayer[] = [];

  constructor(
    private readonly target: RenderTarget,
    private readonly light: LightField,
    private readonly layers: ParallaxLayers,
    private readonly drawPlayer: (s: PixelSurface, light: LightField, ctx: Ctx) => void,
    private readonly drawEnemy: (s: PixelSurface, light: LightField, ctx: Ctx, e: Enemy) => void,
    private readonly drawDecorFn: (
      s: PixelSurface,
      light: LightField,
      ctx: Ctx,
      d: RuntimeDecor,
    ) => void,
  ) {}

  // ===================== Render Buffer + Pixel Sprites =====================
  // setPx writes rgb + a=1, addPx accumulates rgb and leaves a alone. On the
  // GPU path the same writes land in the overlay (a=1 tells the shader to
  // drop the terrain underneath — exactly what overwriting the buffer did).
  setPx(x: number, y: number, r: number, g: number, b: number): void {
    const vx = Math.round(x) - this.renderCamX,
      vy = Math.round(y) - this.renderCamY;
    if (vx < 0 || vx >= VIEW_W || vy < 0 || vy >= VIEW_H) return;
    const pi = (VIEW_H - 1 - vy) * VIEW_W + vx;
    const idx = pi * 4;
    const overlay = this.overlay;
    if (overlay !== null) {
      const d = overlay.data;
      d[idx] = r;
      d[idx + 1] = g;
      d[idx + 2] = b;
      d[idx + 3] = 1.0;
      overlay.mark(pi);
      return;
    }
    const pixelData = this.target.pixelData;
    pixelData[idx] = r;
    pixelData[idx + 1] = g;
    pixelData[idx + 2] = b;
    pixelData[idx + 3] = 1.0;
  }

  addPx(x: number, y: number, r: number, g: number, b: number): void {
    const vx = Math.round(x) - this.renderCamX,
      vy = Math.round(y) - this.renderCamY;
    if (vx < 0 || vx >= VIEW_W || vy < 0 || vy >= VIEW_H) return;
    const pi = (VIEW_H - 1 - vy) * VIEW_W + vx;
    const idx = pi * 4;
    const overlay = this.overlay;
    if (overlay !== null) {
      const d = overlay.data;
      d[idx] += r;
      d[idx + 1] += g;
      d[idx + 2] += b;
      overlay.mark(pi);
      return;
    }
    const pixelData = this.target.pixelData;
    pixelData[idx] += r;
    pixelData[idx + 1] += g;
    pixelData[idx + 2] += b;
  }

  // Channel-at-a-time unpack to 0..1 — scalar helpers instead of a {r,g,b}
  // object so per-pixel/per-strand draw loops allocate nothing (the callers
  // hold the three values as locals; some hold two unpacks live at once).
  private unpackR01(c: number): number {
    return unpackR(c) / 255;
  }
  private unpackG01(c: number): number {
    return unpackG(c) / 255;
  }
  private unpackB01(c: number): number {
    return unpackB(c) / 255;
  }

  /** Acquire a pooled CompositorLens (reset by the caller). */
  private acquireLens(): CompositorLens {
    const pool = this.lensPool;
    const idx = this.lenses.length;
    let lens = pool[idx];
    if (lens === undefined) {
      lens = { cx: 0, cy: 0, R: 0, K: 0 };
      pool[idx] = lens;
    }
    return lens;
  }

  private isHotCell(t: number): boolean {
    return t === Cell.Fire || t === Cell.Lava || t === Cell.Ember;
  }

  private isBrewableMass(t: number): boolean {
    return isLiquid(t) || t === Cell.Sand || t === Cell.Gold || t === Cell.Gunpowder;
  }

  private drawDottedLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    steps: number,
    phase: number,
    r: number,
    g: number,
    b: number,
  ): void {
    for (let k = 0; k < steps; k++) {
      const t = (k + phase) / steps;
      const wobble = Math.sin(t * Math.PI * 2 + phase * 4) * 0.7;
      this.addPx(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + wobble, r, g, b);
    }
  }

  compose(ctx: Ctx): void {
    ctx.camera.renderX = Math.floor(ctx.camera.x);
    ctx.camera.renderY = Math.floor(ctx.camera.y);
    this.renderCamX = ctx.camera.renderX;
    this.renderCamY = ctx.camera.renderY;

    const frameCount = ctx.state.frameCount;
    // Active singularities bend the image around them (inward pull + swirl).
    // Reuse a pooled lens array + pooled lens objects so the common (no black
    // hole) frame allocates nothing on the per-frame compose path.
    const lenses = this.lenses;
    lenses.length = 0;
    for (const pr of ctx.projectiles) {
      if (pr.type === 'blackhole' && lenses.length < COMPOSE_MAX_LENSES) {
        const lens = this.acquireLens();
        lens.cx = pr.x;
        lens.cy = pr.y;
        lens.R = pr.vortexRad! * 2.1;
        lens.K = 4 + pr.vortexRad! * 0.16;
        lenses.push(lens);
      }
    }
    // A telekinetically-held body warps the air around it — a heat-haze shimmer
    // (negative-K lens). Burning cargo shimmers harder; a cold hold ripples gently.
    const heldBody = ctx.rigidBodies.heldBody();
    if (heldBody && lenses.length < COMPOSE_MAX_LENSES) {
      const r =
        heldBody.shape.kind === 'circle'
          ? heldBody.shape.radius
          : Math.hypot(heldBody.shape.halfW, heldBody.shape.halfH);
      const lens = this.acquireLens();
      lens.cx = heldBody.x;
      lens.cy = heldBody.y - r * 0.4; // bias upward — heat rises
      lens.R = r + 11;
      lens.K = -(heldBody.burnT && heldBody.burnT > 0 ? 6.5 : 4.2);
      lenses.push(lens);
    }
    const lightBuildDue = frameCount % 2 === 0 || frameCount < 5;
    const webGpuLiveComposeDisabled = ctx.state.render?.backend === 'webgpu' && !ctx.state.render.compose;
    const gpuComposeRequested =
      ctx.state.postFx.gpuCompose && !webGpuLiveComposeDisabled && this.target.gpuComposeAvailable;
    const lightRebuilt =
      lightBuildDue &&
      (this.lastLightBuildFrame !== frameCount ||
        this.lastLightBuildRenderX !== this.renderCamX ||
        this.lastLightBuildRenderY !== this.renderCamY ||
        this.lastLightBuildGpuCompose !== gpuComposeRequested);
    if (lightRebuilt) {
      this.light.build(ctx);
      this.lastLightBuildFrame = frameCount;
      this.lastLightBuildRenderX = this.renderCamX;
      this.lastLightBuildRenderY = this.renderCamY;
      this.lastLightBuildGpuCompose = gpuComposeRequested;
    }

    // GPU frame composition (perf ticket #8): the terrain pass runs as a
    // fragment/compute shader; sprites keep drawing through setPx/addPx into
    // the overlay. WebGPU live compose has its own runtime gate because the
    // renderer syncs settings after composition, not before it.
    if (gpuComposeRequested) {
      try {
        this.overlay = this.target.beginGpuCompose(ctx, this.light, this.layers, lenses, lightRebuilt);
      } catch (error) {
        ctx.state.postFx.gpuCompose = false;
        ctx.events.emit('toast', { text: 'GPU COMPOSE FAILED - CPU FALLBACK ACTIVE' });
        console.warn('GPU compose disabled after setup failure', error);
        this.overlay = null;
        this.composeTerrainCpu(ctx, lenses);
      }
    } else {
      this.overlay = null;
      this.composeTerrainCpu(ctx, lenses);
    }

    this.composeOverlays(ctx);

    if (this.overlay !== null) {
      try {
        this.target.commitGpuCompose();
      } catch (error) {
        ctx.state.postFx.gpuCompose = false;
        ctx.events.emit('toast', { text: 'GPU COMPOSE COMMIT FAILED - CPU FALLBACK ACTIVE' });
        console.warn('GPU compose disabled after commit failure', error);
        const failedOverlay = this.overlay;
        this.overlay = null;
        this.composeTerrainCpu(ctx, lenses);
        this.compositeOverlayToCpu(failedOverlay);
        this.target.markTextureDirty();
      }
    } else {
      this.target.markTextureDirty();
    }
  }

  private compositeOverlayToCpu(overlay: OverlaySurface): void {
    const src = overlay.data;
    const dst = this.target.pixelData;
    for (let i = 0; i < src.length; i += 4) {
      const r = src[i];
      const g = src[i + 1];
      const b = src[i + 2];
      if (src[i + 3] > 0.5) {
        dst[i] = r;
        dst[i + 1] = g;
        dst[i + 2] = b;
        dst[i + 3] = 1;
      } else if (r !== 0 || g !== 0 || b !== 0) {
        dst[i] += r;
        dst[i + 1] += g;
        dst[i + 2] += b;
      }
    }
  }

  /**
   * The original CPU terrain pass — THE reference implementation of the look
   * (the GPU shader in render/ComposeShader.ts is held pixel-equal to this
   * loop, never the reverse; fix look bugs here first, then re-port).
   */
  private composeTerrainCpu(ctx: Ctx, lenses: readonly CompositorLens[]): void {
    const renderCamX = this.renderCamX;
    const renderCamY = this.renderCamY;
    const frameCount = ctx.state.frameCount;
    const ambient = ctx.params.global.ambient;
    const world = ctx.world;
    const types = world.types;
    const cellColors = world.colors;
    const charge = world.charge;
    const materials = ctx.params.materials;
    const { lightR, lightG, lightB, vignette, LW } = this.light;
    // The vignette[] array bakes the shipped 0.52 strength; rescale per-frame so
    // postFx.vignette tunes it (mirrors the GPU compose's uVignette uniform).
    const vigScale = ctx.state.postFx.vignette / VIGNETTE_BASE;
    const backdropLayers = this.layers.backdropLayers;
    const backdropProfile = resolveBackdropProfileForRuntime(ctx.params.backdrop, ctx.levels.current);
    const backdropSettings = backdropProfile.layers;
    const backdropGrade = backdropProfile.grade;
    const backdropExposure = 2 ** backdropGrade.exposure;
    const backdropBrightness = backdropGrade.brightness;
    const backdropContrast = backdropGrade.contrast;
    const backdropInvGamma = 1 / backdropGrade.gamma;
    const backdropSaturation = backdropGrade.saturation;
    // Reuse the pooled descriptor array + objects (reset, not reallocated) so
    // the per-frame compose path stays allocation-free (see field declaration).
    const activeBackdropLayers = this.activeBackdropLayers;
    activeBackdropLayers.length = 0;
    for (let i = 0; i < backdropLayers.length; i++) {
      const layer = backdropLayers[i];
      const setting = backdropSettings[layer.id];
      if (!setting.visible || setting.opacity <= 0 || layer.width <= 0 || layer.height <= 0) continue;
      const scale = Math.max(0.25, setting.scale);
      const xSamples = this.backdropSampleX[i];
      const ySamples = this.backdropSampleY[i];
      const camX = Math.floor(renderCamX * setting.speed);
      const camY = Math.floor(renderCamY * setting.speed);
      for (let vx = 0; vx < VIEW_W; vx++) {
        let sx = Math.floor((camX + vx) / scale + setting.offsetX) % layer.width;
        if (sx < 0) sx += layer.width;
        xSamples[vx] = sx;
      }
      for (let vy = 0; vy < VIEW_H; vy++) {
        let sy = Math.floor((camY + vy) / scale + setting.offsetY) % layer.height;
        if (sy < 0) sy += layer.height;
        ySamples[vy] = sy;
      }
      const descriptor = this.backdropLayerPool[activeBackdropLayers.length];
      descriptor.pixels = layer.pixels;
      descriptor.width = layer.width;
      descriptor.opacity = setting.opacity;
      descriptor.xSamples = xSamples;
      descriptor.ySamples = ySamples;
      activeBackdropLayers.push(descriptor);
    }
    const pixelData = this.target.pixelData;
    const wavesLen = Math.min(ctx.shockwaves.length, COMPOSE_MAX_WAVES);
    const lensLen = Math.min(lenses.length, COMPOSE_MAX_LENSES);
    const boostG = ctx.params.global.maxBrightness;

    for (let vy = 0; vy < VIEW_H; vy++) {
      const wy = renderCamY + vy;
      for (let vx = 0; vx < VIEW_W; vx++) {
        const wx = renderCamX + vx;
        let lookupX = wx,
          lookupY = wy;
        let ringGlow = 0;

        if (wavesLen > 0) {
          for (let i = 0; i < wavesLen; i++) {
            const w = ctx.shockwaves[i];
            const dx = wx - w.cx,
              dy = wy - w.cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const front = w.currentRadius,
              thick = 9;
            if (dist > front - thick && dist < front + thick) {
              const edgeFactor = 1.0 - Math.abs(dist - front) / thick;
              const decayFactor = 1.0 - w.currentRadius / w.maxRadius;
              const offset = Math.sin(edgeFactor * Math.PI) * w.strength * decayFactor;
              ringGlow += Math.sin(edgeFactor * Math.PI) * decayFactor;
              if (dist > 0) {
                lookupX -= Math.floor((dx / dist) * offset);
                lookupY -= Math.floor((dy / dist) * offset);
              }
            }
          }
          if (lookupX < 0) lookupX = 0;
          else if (lookupX >= WIDTH) lookupX = WIDTH - 1;
          if (lookupY < 0) lookupY = 0;
          else if (lookupY >= HEIGHT) lookupY = HEIGHT - 1;
        }

        // Heat-haze shimmer offset (haze lenses only) — applied to BOTH the
        // terrain lookup and the backdrop sample below, so the hot air bends the
        // distant cave behind a held object too, not just the foreground rock.
        let hazeX = 0,
          hazeY = 0;
        if (lensLen > 0) {
          for (let li = 0; li < lensLen; li++) {
            const L = lenses[li];
            const ldx = wx - L.cx,
              ldy = wy - L.cy;
            const ld2 = ldx * ldx + ldy * ldy;
            if (ld2 > L.R * L.R || ld2 < 1) continue;
            const ld = Math.sqrt(ld2);
            const pull = 1 - ld / L.R;
            if (L.K < 0) {
              // heat-haze: animated horizontal shimmer (+ a little vertical),
              // fading at the edge. Phase matches uPhaseWater / p(6u) on the GPU.
              const amp = -L.K;
              const ph = frameCount * 0.16;
              const hx = Math.floor(Math.sin(wy * 0.55 + ph + L.cx) * amp * pull);
              const hy = Math.floor(Math.cos(wx * 0.7 + ph * 0.8) * amp * 0.4 * pull);
              lookupX += hx;
              lookupY += hy;
              hazeX += hx;
              hazeY += hy;
            } else {
              const k = pull * pull * L.K;
              // sample from further out (pinch) with a tangential swirl
              lookupX += Math.floor((ldx / ld) * k - (ldy / ld) * k * 0.7);
              lookupY += Math.floor((ldy / ld) * k + (ldx / ld) * k * 0.7);
            }
          }
          if (lookupX < 0) lookupX = 0;
          else if (lookupX >= WIDTH) lookupX = WIDTH - 1;
          if (lookupY < 0) lookupY = 0;
          else if (lookupY >= HEIGHT) lookupY = HEIGHT - 1;
        }

        const bufferIdx = ((VIEW_H - 1 - vy) * VIEW_W + vx) * 4;
        const ci = lookupX + lookupY * WIDTH;
        const type = types[ci];

        let r: number, g: number, b: number;
        if (type === Cell.Empty) {
          // Ordered PNG parallax composite. Every layer carries its own alpha
          // and scrolls with its own multiplier, so texture and cutout never
          // drift apart.
          r = 0.004;
          g = 0.005;
          b = 0.009;
          // shift the backdrop sample column/row by the heat-haze offset so the
          // distant cave shimmers behind a held (hot) object, like the terrain does
          const bvx = hazeX !== 0 ? (vx + hazeX < 0 ? 0 : vx + hazeX >= VIEW_W ? VIEW_W - 1 : vx + hazeX) : vx;
          const bvy = hazeY !== 0 ? (vy + hazeY < 0 ? 0 : vy + hazeY >= VIEW_H ? VIEW_H - 1 : vy + hazeY) : vy;
          for (const active of activeBackdropLayers) {
            const si = (active.ySamples[bvy] * active.width + active.xSamples[bvx]) * 4;
            const a = (active.pixels[si + 3] / 255) * active.opacity;
            if (a <= 0.001) continue;
            const ia = 1 - a;
            r = r * ia + (active.pixels[si] / 255) * a;
            g = g * ia + (active.pixels[si + 1] / 255) * a;
            b = b * ia + (active.pixels[si + 2] / 255) * a;
          }
          r = (r * backdropExposure + backdropBrightness - 0.5) * backdropContrast + 0.5;
          g = (g * backdropExposure + backdropBrightness - 0.5) * backdropContrast + 0.5;
          b = (b * backdropExposure + backdropBrightness - 0.5) * backdropContrast + 0.5;
          const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
          r = luma + (r - luma) * backdropSaturation;
          g = luma + (g - luma) * backdropSaturation;
          b = luma + (b - luma) * backdropSaturation;
          r = r <= 0 ? 0 : r >= 1 ? 1 : r ** backdropInvGamma;
          g = g <= 0 ? 0 : g >= 1 ? 1 : g ** backdropInvGamma;
          b = b <= 0 ? 0 : b >= 1 ? 1 : b ** backdropInvGamma;
          const depthShade = 0.78 + 0.22 * (1 - wy / HEIGHT);
          r *= depthShade;
          g *= depthShade;
          b *= depthShade;
          {
            const li = (vy >> 1) * LW + (vx >> 1);
            const vg = 1 - vigScale * (1 - vignette[vy * VIEW_W + vx]);
            let lf0 = Math.min(LIGHT_CLAMP, lightR[li]) * vg;
            r = (r * 0.62 + ambient * 0.022) * vg + r * lf0 * lf0 * 0.72;
            lf0 = Math.min(LIGHT_CLAMP, lightG[li]) * vg;
            g = (g * 0.62 + ambient * 0.022) * vg + g * lf0 * lf0 * 0.72;
            lf0 = Math.min(LIGHT_CLAMP, lightB[li]) * vg;
            b = (b * 0.62 + ambient * 0.032) * vg + b * lf0 * lf0 * 0.72;
            // air itself catches the glow near strong light
            r += Math.max(0, lightR[li] - 0.25) * 0.045 * vg;
            g += Math.max(0, lightG[li] - 0.25) * 0.04 * vg;
            b += Math.max(0, lightB[li] - 0.25) * 0.035 * vg;
          }
          if (ringGlow > 0) {
            r += ringGlow * 0.55;
            g += ringGlow * 0.42;
            b += ringGlow * 0.26;
          }
          pixelData[bufferIdx] = r;
          pixelData[bufferIdx + 1] = g;
          pixelData[bufferIdx + 2] = b;
          pixelData[bufferIdx + 3] = 1.0;
          continue;
        }

        const rgb = cellColors[ci];
        r = unpackR(rgb) / 255;
        g = unpackG(rgb) / 255;
        b = unpackB(rgb) / 255;

        // Living flame: per-frame flicker on hot cells
        if (type === Cell.Fire) {
          const fl = 0.75 + Math.random() * 0.5;
          r *= fl;
          g *= fl;
          b *= fl;
        } else if (type === Cell.Lava) {
          r *= 0.96 + Math.random() * 0.08;
          g *= 0.8 + Math.random() * 0.35;
        } else if (type === Cell.Ember) {
          const fl = 0.7 + Math.random() * 0.55;
          r *= fl;
          g *= fl * 0.95;
        } else if ((type === Cell.Water || type === Cell.Healium || type === Cell.Teleportium) && wy > 0 && lookupY > 0 && types[ci - WIDTH] === Cell.Empty) {
          const wave = 0.88 + Math.sin(frameCount * 0.16 + wx * 0.42) * 0.12;
          r *= wave;
          g *= 0.94 + (wave - 0.88) * 0.45;
          b *= 1.08 + (wave - 0.88) * 0.55;
        } else if (type === Cell.Crystal) {
          if (((wx * 17 + wy * 31 + frameCount) % 97) === 0) {
            r *= 1.65;
            g *= 1.45;
            b *= 1.95;
          }
        } else if (type === Cell.Glowshroom) {
          const breath = 0.9 + Math.sin(frameCount * 0.045 + wx * 0.21 + wy * 0.17) * 0.16;
          r *= breath;
          g *= 1.02 + (breath - 0.9) * 0.9;
          b *= breath;
        } else if (type === Cell.Vines || type === Cell.Moss || type === Cell.Fungus) {
          const living = 0.94 + Math.sin(frameCount * 0.035 + wx * 0.13 + wy * 0.29) * 0.08;
          g *= living;
        }

        let scalar = 0.0;
        const mat = materials[type];
        if (mat?.bloomWeight !== undefined) {
          scalar = mat.bloomWeight;
        }
        let intensity = 1.0 + (boostG - 1.0) * scalar;

        if (charge[ci] > 0) {
          r = 0.2;
          g = 0.75;
          b = 1.0;
          // crackle strobe + DIM metal glow (its bright bloom killed the look; the
          // liquid pool stays bright). Matches the shaders.
          const chargeGlow = type === Cell.Metal ? boostG * 0.35 : boostG * 1.2;
          intensity = chargeGlow * (0.3 + Math.random() * 1.1);
        }

        {
          const li = (vy >> 1) * LW + (vx >> 1);
          const vg = 1 - vigScale * (1 - vignette[vy * VIEW_W + vx]);
          // squared: compensates the sRGB output curve so darkness reads as darkness.
          // The small additive floor keeps shadowed rock readable as silhouette
          // (the BFS rim shading baked into cell colors carries the detail).
          const floor = LIGHT_READABILITY_FLOOR * vg;
          // Emissive cells are LIGHT SOURCES: their own brightness must not be
          // crushed by the screen vignette (it sits inside the squared light
          // factor, so corners rendered at ~23% and bloom only fired near the
          // center). The vignette-free self-glow floor keeps lava/fire/crystal
          // equally bloom-bright across the whole frame.
          const selfGlow = scalar > 0 ? SELF_GLOW_BASE + scalar * SELF_GLOW_SCALE : 0;
          // Soft knee on lit (non-emissive) cells: strong light keeps its REACH
          // but the top end compresses, so the wand no longer blows nearby
          // floor into a white bloom wash that swallows levers and pickups.
          let lf = (ambient + Math.min(LIGHT_CLAMP, lightR[li])) * vg;
          let lit = lf * lf;
          if (lit > LIGHT_KNEE_START) lit = Math.min(LIGHT_KNEE_MAX, LIGHT_KNEE_START + (lit - LIGHT_KNEE_START) * LIGHT_KNEE_SLOPE);
          r = r * Math.max(lit, selfGlow) + r * floor;
          lf = (ambient + Math.min(LIGHT_CLAMP, lightG[li])) * vg;
          lit = lf * lf;
          if (lit > LIGHT_KNEE_START) lit = Math.min(LIGHT_KNEE_MAX, LIGHT_KNEE_START + (lit - LIGHT_KNEE_START) * LIGHT_KNEE_SLOPE);
          g = g * Math.max(lit, selfGlow) + g * floor;
          lf = (ambient + Math.min(LIGHT_CLAMP, lightB[li])) * vg;
          lit = lf * lf;
          if (lit > LIGHT_KNEE_START) lit = Math.min(LIGHT_KNEE_MAX, LIGHT_KNEE_START + (lit - LIGHT_KNEE_START) * LIGHT_KNEE_SLOPE);
          b = b * Math.max(lit, selfGlow) + b * floor;
        }
        pixelData[bufferIdx] = r * intensity + ringGlow * 0.55;
        pixelData[bufferIdx + 1] = g * intensity + ringGlow * 0.42;
        pixelData[bufferIdx + 2] = b * intensity + ringGlow * 0.26;
        pixelData[bufferIdx + 3] = 1.0;
      }
    }
  }

  /**
   * Particles, arcs, projectiles, decor, landmarks, mechanisms, critters,
   * enemies, beams, the player — the irregular overlay pass. It touches a few
   * thousand pixels, reads game state, and mutates entity animation fields
   * (EnemySprites/PlayerSprite contract): this stays CPU on BOTH compose paths.
   */
  private composeOverlays(ctx: Ctx): void {
    // Ballistic debris / embers / coins, lightning arcs, projectiles — the
    // combat FX overlays live in sprites/FxSprites (shared with the gallery).
    drawParticles(this, this.light, ctx);
    drawLightningArcs(this, ctx);
    drawProjectiles(this, ctx);

    // Animated decor first among the overlays: visual-only set dressing sits
    // just above terrain and UNDER every gameplay-readable overlay — a torch
    // sprite must never mask a pickup glyph, a portal ring, or a lever arm.
    this.drawDecors(ctx);
    this.drawVineStrands(ctx, 'den');
    // Landmarks, pickups + the exit portal (under entities so foes read on top)
    this.drawLandmarks(ctx);
    this.drawPickupsAndPortal(ctx);
    this.drawMechanismsAndRunes(ctx);
    this.drawCritters(ctx);
    this.drawFlaskEffects(ctx);
    this.drawRigidBodies(ctx);
    this.drawVineStrands(ctx, 'foreground');

    // Entities on top
    for (const e of ctx.enemies) {
      if (this.enemyInRenderView(ctx, e)) this.drawEnemy(this, this.light, ctx, e);
    }
    // Excavation beam: white-hot core, tight amber sheath, light cast onto nearby rock
    drawDigBeam(this, ctx);

    if (ctx.state.mode === 'play') this.drawPlayer(this, this.light, ctx);
    this.drawPlayerRagdoll(ctx);
  }

  private enemyInRenderView(ctx: Ctx, e: Enemy): boolean {
    const def = ctx.enemyCtl.defs[e.kind];
    const pad = e.kind === 'weaver' ? 120 : e.kind === 'leviathan' ? 96 : 48;
    const halfW = (def?.halfW ?? 12) + pad;
    const height = (def?.h ?? 24) + pad;
    return (
      e.x + halfW >= this.renderCamX &&
      e.x - halfW <= this.renderCamX + VIEW_W &&
      e.y + pad >= this.renderCamY &&
      e.y - height <= this.renderCamY + VIEW_H
    );
  }

  /** Rigid bodies: rotated boxes and circles, flat-shaded with a darker rim for
   *  read and (on circles) a radial spoke so spin is visible. Lit by the ambient
   *  field like the rest of the world. */
  private drawRigidBodies(ctx: Ctx): void {
    if (ctx.state.mode !== 'play') return;
    const frame = ctx.state.frameCount;
    for (const b of ctx.rigidBodies.bodies) {
      if (b.tag === 'player-corpse') continue; // drawn as a limp wizard in drawPlayerRagdoll
      let r = ((b.color >> 16) & 0xff) / 255;
      let g = ((b.color >> 8) & 0xff) / 255;
      let bl = (b.color & 0xff) / 255;
      const lt = this.light.sample(b.x, b.y);
      let lr = Math.max(0.06, lt.r);
      let lg = Math.max(0.06, lt.g);
      let lb = Math.max(0.06, lt.b);
      if (b.burnT && b.burnT > 0) {
        // burning: flickering orange that self-illuminates (ignores scene dark)
        const flick = 0.55 + 0.45 * Math.sin(frame * 0.6 + b.id);
        r = Math.min(1, r * 0.4 + 0.9 * flick);
        g = Math.min(1, g * 0.3 + 0.4 * flick);
        bl *= 0.2;
        lr = Math.max(lr, 0.85);
        lg = Math.max(lg, 0.5);
        lb = Math.max(lb, 0.18);
      } else if (b.frozenT && b.frozenT > 0) {
        // frozen: rimed pale blue
        r = r * 0.55 + 0.18;
        g = g * 0.7 + 0.28;
        bl = Math.min(1, bl * 0.8 + 0.55);
      }
      const cos = Math.cos(b.angle);
      const sin = Math.sin(b.angle);
      const reach = b.shape.kind === 'circle' ? b.shape.radius : Math.hypot(b.shape.halfW, b.shape.halfH);
      // Coarse off-screen cull (matches the landmark/decor draws).
      if (
        b.x + reach < this.renderCamX ||
        b.x - reach > this.renderCamX + VIEW_W ||
        b.y + reach < this.renderCamY ||
        b.y - reach > this.renderCamY + VIEW_H
      )
        continue;
      const x0 = Math.floor(b.x - reach);
      const x1 = Math.ceil(b.x + reach);
      const y0 = Math.floor(b.y - reach);
      const y1 = Math.ceil(b.y + reach);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx + 0.5 - b.x;
          const dy = yy + 0.5 - b.y;
          const lx = dx * cos + dy * sin; // into the body's local frame
          const ly = -dx * sin + dy * cos;
          let edge = 1;
          if (b.shape.kind === 'circle') {
            const rad = b.shape.radius;
            if (dx * dx + dy * dy > rad * rad) continue;
            if (dx * dx + dy * dy > (rad - 1) * (rad - 1)) edge = 0.6;
            // a single spoke toward local +x makes the roll legible
            else if (lx > 0 && Math.abs(ly) < 0.9) edge = 0.5;
          } else {
            const { halfW, halfH } = b.shape;
            if (Math.abs(lx) > halfW || Math.abs(ly) > halfH) continue;
            if (Math.abs(lx) > halfW - 1 || Math.abs(ly) > halfH - 1) edge = 0.6;
          }
          this.setPx(xx, yy, r * lr * edge, g * lg * edge, bl * lb * edge);
        }
      }
    }
  }

  /** The death ragdoll: an ARTICULATED limp wizard (head, torso, two arms, two
   *  legs, hat) hanging off the corpse body. Limbs flail with the body's spin +
   *  speed so it tumbles like a ragdoll, not a rigid log; a tombstone rises once
   *  it settles. Replaces the live player sprite. */
  private drawPlayerRagdoll(ctx: Ctx): void {
    if (ctx.state.mode !== 'play') return;
    const corpse = ctx.rigidBodies.playerCorpse;
    if (!corpse || corpse.shape.kind !== 'box') return;
    const cx = corpse.x;
    const cy = corpse.y;
    const ang = corpse.angle;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    // body-local -> world (local −y is the head end, +y the feet)
    const wx = (lx: number, ly: number): number => cx + lx * cos - ly * sin;
    const wy = (lx: number, ly: number): number => cy + lx * sin + ly * cos;
    const lt = this.light.sample(cx, cy);
    const lr = Math.max(0.16, lt.r);
    const lg = Math.max(0.16, lt.g);
    const lb = Math.max(0.2, lt.b);
    const ROBE: [number, number, number] = [0.24 * lr, 0.44 * lg, 0.86 * lb];
    const ROBE_D: [number, number, number] = [0.09 * lr, 0.18 * lg, 0.42 * lb];
    const SKIN: [number, number, number] = [0.86 * lr, 0.7 * lg, 0.52 * lb];
    const HAT: [number, number, number] = [0.5 * lr, 0.26 * lg, 0.8 * lb];
    const HAT_D: [number, number, number] = [0.22 * lr, 0.1 * lg, 0.42 * lb];
    const BOOT: [number, number, number] = [0.14 * lr, 0.12 * lg, 0.2 * lb];

    const fc = ctx.state.frameCount;
    const settled = corpse.data?.settled === true || corpse.sleeping;
    const va = corpse.va ?? 0;
    const speed = Math.hypot(corpse.vx ?? 0, corpse.vy ?? 0);
    // how hard the limbs flail: driven by spin + travel, easing to a limp droop at rest
    const flail = settled ? 0.06 : Math.min(1.4, Math.abs(va) * 5 + speed * 0.22);

    const dot = (x: number, y: number, c: [number, number, number], k = 1): void => {
      this.setPx(x, y, c[0] * k, c[1] * k, c[2] * k);
      this.setPx(x + 1, y, c[0] * 0.78 * k, c[1] * 0.78 * k, c[2] * 0.78 * k);
    };
    const seg = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]): void => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let i = 0; i <= n; i++) dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
    };
    // a 2-segment limb (with an elbow/knee) hanging from a body-local joint. The
    // limb stays anchored to the body but LAGS its spin and wobbles — that lag is
    // exactly what reads as a joint instead of a welded plank.
    const limb = (jx: number, jy: number, spread: number, len: number, phase: number, tip: [number, number, number]): void => {
      const jwx = wx(jx, jy);
      const jwy = wy(jx, jy);
      const a1 = ang + Math.PI / 2 + spread + va * 4 + Math.sin(fc * 0.22 + phase) * flail;
      const kx = jwx + Math.cos(a1) * len * 0.55;
      const ky = jwy + Math.sin(a1) * len * 0.55;
      const a2 = a1 + 0.45 + Math.sin(fc * 0.3 + phase + 1.3) * flail * 0.7;
      const ex = kx + Math.cos(a2) * len * 0.5;
      const ey = ky + Math.sin(a2) * len * 0.5;
      seg(jwx, jwy, kx, ky, ROBE_D);
      seg(kx, ky, ex, ey, ROBE_D);
      dot(ex, ey, tip);
      dot(ex, ey + 1, tip, 0.85);
    };

    // draw order: legs + arms BEHIND, torso over the shoulders, then head + hat
    limb(-1.4, 5, 0.32, 8, 0.0, BOOT); // left leg
    limb(1.4, 5, -0.32, 8, 2.1, BOOT); // right leg
    limb(-2, -1, 0.55, 6, 1.0, SKIN); // left arm
    limb(2, -1, -0.55, 6, 3.3, SKIN); // right arm
    // TORSO — a robe slab, darker rim, purple hood up top (−y)
    for (let ly = -3; ly <= 5; ly++) {
      for (let lx = -2; lx <= 2; lx++) {
        const edge = Math.abs(lx) >= 2 || ly >= 5 ? 0.6 : 1;
        const c = ly <= -2 ? ROBE_D : ROBE;
        this.setPx(wx(lx, ly), wy(lx, ly), c[0] * edge, c[1] * edge, c[2] * edge);
      }
    }
    // HEAD — a small round skin blob above the torso
    for (let ly = -8; ly <= -4; ly++) {
      const r = ly === -8 || ly === -4 ? 1 : 2;
      for (let lx = -r; lx <= r; lx++) {
        const shade = lx * (va >= 0 ? 1 : -1) > 0 ? 1 : 0.82;
        this.setPx(wx(lx, ly), wy(lx, ly), SKIN[0] * shade, SKIN[1] * shade, SKIN[2] * shade);
      }
    }
    // HAT — purple cone + brim beyond the head, tumbling with the skull
    for (let dx = -5; dx <= 5; dx++) this.setPx(wx(dx, -9), wy(dx, -9), HAT[0], HAT[1], HAT[2]);
    for (let dx = -6; dx <= 6; dx++) this.setPx(wx(dx, -8), wy(dx, -8), HAT_D[0], HAT_D[1], HAT_D[2]);
    for (let t = 1; t <= 5; t++) {
      const w = Math.max(0, 4 - Math.floor(t * 0.7));
      for (let dx = -w; dx <= w; dx++) this.setPx(wx(dx, -9 - t), wy(dx, -9 - t), HAT[0], HAT[1], HAT[2]);
    }
    // TOMBSTONE — rises once the corpse settles (world-upright marker + cross)
    if (settled) this.drawTombstone(cx, cy - 21);
  }

  /** A small arched grey headstone with a darker cross, dimly lit, world-upright. */
  private drawTombstone(cx: number, topY: number): void {
    const lt = this.light.sample(cx, topY + 6);
    const lr = Math.max(0.24, lt.r);
    const lg = Math.max(0.24, lt.g);
    const lb = Math.max(0.26, lt.b);
    for (let dy = 0; dy <= 12; dy++) {
      const halfW = dy < 4 ? Math.floor(2 + dy * 0.7) : 5;
      for (let dx = -halfW; dx <= halfW; dx++) {
        const edge = Math.abs(dx) >= halfW || dy >= 12 ? 0.7 : 1;
        this.setPx(cx + dx, topY + dy, 0.5 * lr * edge, 0.5 * lg * edge, 0.52 * lb * edge);
      }
    }
    for (let dy = 3; dy <= 9; dy++) this.setPx(cx, topY + dy, 0.28 * lr, 0.28 * lg, 0.3 * lb);
    for (let dx = -2; dx <= 2; dx++) this.setPx(cx + dx, topY + 5, 0.28 * lr, 0.28 * lg, 0.3 * lb);
  }

  private drawVineStrands(ctx: Ctx, layer: 'den' | 'foreground'): void {
    const strands = ctx.vineStrands?.strands;
    if (!strands?.length) return;
    const drawDen = layer === 'den';
    const world = ctx.world;
    const camX = this.renderCamX;
    const camY = this.renderCamY;
    for (const strand of strands) {
      if ((strand.denWeb === true) !== drawDen) continue;
      const baseR = this.unpackR01(strand.color);
      const baseG = this.unpackG01(strand.color);
      const baseB = this.unpackB01(strand.color);
      const half = ((strand.thickness ?? 1) - 1) / 2;
      for (const segment of strand.segments) {
        const a = strand.nodes[segment.a];
        const b = strand.nodes[segment.b];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        if (
          Math.max(a.x, b.x) < camX - 2 ||
          Math.min(a.x, b.x) > camX + VIEW_W + 2 ||
          Math.max(a.y, b.y) < camY - 2 ||
          Math.min(a.y, b.y) > camY + VIEW_H + 2
        )
          continue;
        const perpX = -dy / len; // unit perpendicular, for thickness
        const perpY = dx / len;
        const steps = Math.max(1, Math.ceil(len * 1.8));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = a.x + dx * t;
          const y = a.y + dy * t;
          if (x < camX - 2 || x > camX + VIEW_W + 2 || y < camY - 2 || y > camY + VIEW_H + 2) continue;
          if (strand.web === true) {
            const cx = Math.floor(x);
            const cy = Math.floor(y);
            if (!world.inBounds(cx, cy)) continue;
            const cell = world.types[world.idx(cx, cy)];
            if (blocksEntity(cell) && !isSoftGrowth(cell)) continue;
          }
          const lt = this.light.sample(x, y);
          const webGlow = strand.web === true ? 0.22 : 0;
          const denMul = strand.denWeb === true ? 0.42 : 1;
          const r = baseR * (Math.max(0.16, lt.r) * 1.05 + webGlow * 0.45) * denMul;
          const g = baseG * (Math.max(0.18, lt.g) * 1.1 + webGlow) * denMul;
          const b2 = baseB * (Math.max(0.14, lt.b) + webGlow * 0.45) * denMul;
          for (let w = -half; w <= half + 1e-6; w += 1) {
            if (strand.denWeb === true) this.addPx(x + perpX * w, y + perpY * w, r, g, b2);
            else this.setPx(x + perpX * w, y + perpY * w, r, g, b2);
          }
        }
      }
      if (strand.segments.length === 0) {
        for (const node of strand.nodes) {
          if (node.x < camX - 2 || node.x > camX + VIEW_W + 2 || node.y < camY - 2 || node.y > camY + VIEW_H + 2)
            continue;
          const lt = this.light.sample(node.x, node.y);
          this.setPx(
            node.x,
            node.y,
            baseR * Math.max(0.16, lt.r),
            baseG * Math.max(0.18, lt.g),
            baseB * Math.max(0.14, lt.b),
          );
        }
      }
    }
  }

  /** Animated sprite decor (visual-only; per-decor culling in drawDecor). */
  private drawDecors(ctx: Ctx): void {
    const runtime = ctx.levels.current;
    if (!runtime?.decors || ctx.state.mode !== 'play') return;
    for (const d of runtime.decors) this.drawDecorFn(this, this.light, ctx, d);
  }

  /** Checkpoints, cauldrons, and the exit well get small state-readable motion. */
  private drawLandmarks(ctx: Ctx): void {
    const runtime = ctx.levels.current;
    if (!runtime || ctx.state.mode !== 'play') return;
    const frame = ctx.state.frameCount;
    const camX = ctx.camera.renderX,
      camY = ctx.camera.renderY;

    for (const ws of runtime.waystones) {
      // Tall runestone: wide cull so the stele/flame above the bowl isn't clipped.
      if (ws.x < camX - 40 || ws.x > camX + VIEW_W + 40 || ws.y < camY - 48 || ws.y > camY + VIEW_H + 16)
        continue;
      this.drawRunestone(ctx, ws);
    }

    const cauldron = runtime.cauldron;
    if (cauldron && cauldron.x >= camX - 28 && cauldron.x <= camX + VIEW_W + 28 && cauldron.y >= camY - 22 && cauldron.y <= camY + VIEW_H + 28) {
      this.drawCauldronBowl(ctx, cauldron);
    }

    const exit = runtime.exit;
    if (exit && exit.x >= camX - 24 && exit.x <= camX + VIEW_W + 24 && exit.sealY >= camY - 24 && exit.sealY <= camY + VIEW_H + 24) {
      const mouthY = exit.sealY - 8;
      for (let k = 0; k < 4; k++) {
        const drift = ((frame + k * 19) % 90) / 90;
        const x = exit.x + Math.round(Math.sin(frame * 0.025 + k * 1.9) * (exit.halfW + 4));
        const y = mouthY - Math.round(drift * 12);
        this.addPx(x, y, 0.07, 0.06, 0.05);
      }
      if (frame % 48 < 12) this.addPx(exit.x, exit.sealY - 12, 0.16, 0.12, 0.06);
    }

    // Hint tier 1: a bobbing amber chevron over whatever interactable the
    // HintSystem is currently pointing the player at (light = information).
    const hint = ctx.hints.current?.world;
    if (hint && hint.x >= camX - 4 && hint.x <= camX + VIEW_W + 4 && hint.y >= camY - 12 && hint.y <= camY + VIEW_H + 4) {
      const bob = Math.round(Math.sin(frame * 0.16) * 1.5);
      const top = hint.y - 8 + bob;
      const pulse = 0.55 + Math.sin(frame * 0.16) * 0.3;
      this.addPx(hint.x, top, 0.95 * pulse, 0.72 * pulse, 0.18 * pulse);
      this.addPx(hint.x - 1, top - 1, 0.7 * pulse, 0.52 * pulse, 0.12 * pulse);
      this.addPx(hint.x + 1, top - 1, 0.7 * pulse, 0.52 * pulse, 0.12 * pulse);
    }
  }

  /**
   * The waystone as a RUNESTONE WITH FIRE: a tall carved stele rising behind the
   * brazier dish, an ancient hieroglyph glowing/pulsing on its face, and a tall
   * bright flame when lit. The playable fire bowl stays at (ws.y) — the lighting
   * still reads real fire cells; everything here is the monument around it.
   */
  private drawRunestone(ctx: Ctx, ws: { x: number; y: number; lit: boolean; heat?: number }): void {
    const frame = ctx.state.frameCount;
    const world = ctx.world;
    const cx = ws.x;
    let hot = 0;
    // Match Levels.updateWaystones: the bowl rect is the cup floor + 2 above.
    for (let dy = -2; dy <= 0; dy++)
      for (let dx = -2; dx <= 2; dx++)
        if (world.inBounds(cx + dx, ws.y + dy) && this.isHotCell(world.types[world.idx(cx + dx, ws.y + dy)])) hot++;
    const lit = ws.lit;
    const heat = lit ? 1 : (ws.heat ?? 0);
    const litPulse = 0.72 + Math.sin(frame * 0.07 + cx) * 0.22;

    // --- the STELE: a tall carved monolith with a rounded crown + carved grooves ---
    const topY = ws.y - 32;
    const halfW = 6;
    for (let y = topY; y <= ws.y; y++) {
      const fromTop = y - topY;
      const hw = fromTop < 4 ? halfW - (4 - fromTop) : halfW; // rounded crown
      if (hw < 0) continue;
      for (let dx = -hw; dx <= hw; dx++) {
        let v = 0.28 + dx * 0.007 - fromTop * 0.0009; // faint left-shadow / top-light
        if (Math.abs(dx) === hw) v = 0.12; // dark outline
        else if (Math.abs(dx) >= hw - 1) v = 0.2; // bevel
        if (fromTop % 7 === 3) v *= 0.72; // carved horizontal groove
        const warm = lit ? 0.1 * litPulse : heat * 0.06; // lit braziers warm the stone
        this.setPx(cx + dx, y, v + warm, v * 0.95 + warm * 0.65, v * 0.82 + warm * 0.2);
      }
    }

    // --- the HIEROGLYPH: a glowing carved glyph mid-face (gold lit / cyan dormant) ---
    const glyphY = ws.y - 19;
    const gp = lit
      ? 0.5 + 0.5 * litPulse
      : 0.12 + heat * 0.5 + Math.sin(frame * 0.05 + cx) * 0.05;
    const glyph: ReadonlyArray<readonly [number, number]> = [
      [0, -4], [-1, -3], [1, -3], [-2, -1], [2, -1], [-2, 1], [2, 1], [-1, 3], [1, 3], [0, 4], // ring
      [0, -1], [0, 0], [0, 1], // pupil bar
      [-3, -4], [3, -4], [-3, 4], [3, 4], // corner ticks
    ];
    const gr = lit ? 1.0 : 0.5, gg = lit ? 0.78 : 0.85, gb = lit ? 0.3 : 0.95;
    for (const [dx, dy] of glyph) this.addPx(cx + dx, glyphY + dy, gr * gp, gg * gp, gb * gp);
    if (lit && frame % 96 < 28) {
      // a spark of light crawls up a carved edge groove
      const sy = ws.y - 2 - (frame % 96);
      this.addPx(cx - halfW + 1, sy, 0.6 * litPulse, 0.42 * litPulse, 0.14);
    }

    // --- the BRAZIER DISH at the foot (the real fire bowl) ---
    for (let dx = -5; dx <= 5; dx++) this.setPx(cx + dx, ws.y + 1, 0.22, 0.2, 0.17); // lip
    for (let dx = -4; dx <= 4; dx++) this.setPx(cx + dx, ws.y, 0.16 + heat * 0.28, 0.14 + heat * 0.12, 0.12);
    this.setPx(cx - 5, ws.y, 0.14, 0.13, 0.11);
    this.setPx(cx + 5, ws.y, 0.14, 0.13, 0.11);

    // --- the FLAME ---
    if (lit) {
      const tall = 16;
      const sway = Math.sin(frame * 0.06 + cx) * 0.9;
      for (let t = 0; t <= tall; t++) {
        const up = 1 - t / (tall + 2);
        const fx = cx + Math.round(sway * (t / tall) + Math.sin(frame * 0.2 + t * 0.5) * 0.5 * up);
        const w = t < 3 ? 2 : t < 9 ? 1 : 0;
        for (let dx = -w; dx <= w; dx++) {
          const core = dx === 0 ? 1 : 0.6;
          this.addPx(fx + dx, ws.y - 1 - t, (0.8 + 0.35 * up) * litPulse * core, (0.5 + 0.2 * up) * litPulse * core, (0.1 + (1 - up) * 0.5) * core);
        }
      }
      this.addPx(cx, ws.y - 2, 0.95, 0.95 * litPulse, 0.85 * litPulse); // white-hot heart
      this.addPx(cx, ws.y - 3, 0.92, 0.82 * litPulse, 0.5 * litPulse);
      for (let k = 0; k < 5; k++) {
        const ey = ws.y - 4 - ((frame + k * 17) % 40) / 2;
        this.addPx(cx + ((k % 3) - 1) + Math.round(Math.sin(frame * 0.1 + k) * 2), ey, 0.6 * litPulse, 0.3 * litPulse, 0.06);
      }
      const halo = 0.1 + Math.sin(frame * 0.08 + ws.y) * 0.04;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        this.addPx(cx + Math.round(Math.cos(ang) * 6), ws.y - 5 + Math.round(Math.sin(ang) * 4), halo * 0.45, halo * 0.65, halo);
      }
    } else if (hot > 0) {
      const heatPulse = Math.min(1, hot / 8) * (0.55 + Math.sin(frame * 0.2 + ws.y) * 0.25);
      for (let k = 0; k < Math.min(6, hot + 1); k++) {
        const y = ws.y - 2 - ((frame + k * 5) % 14) / 3;
        this.addPx(cx + ((k % 3) - 1), y, 0.75 * heatPulse, 0.42 * heatPulse, 0.08);
      }
      const rim = Math.round(heat * 4);
      for (let t = 0; t < rim; t++) {
        this.addPx(cx - 5, ws.y - t, 0.7, 0.4, 0.08);
        this.addPx(cx + 5, ws.y - t, 0.7, 0.4, 0.08);
      }
    } else {
      // Unlit + cold: the empty bowl BREATHES a faint amber "feed me fire" glow
      // so the eye lands on the dish — not the glyph or the crown. This is the
      // spot you bring fire to; make the affordance unmistakable.
      const pulse = 0.16 + Math.sin(frame * 0.08 + cx) * 0.08;
      this.addPx(cx, ws.y - 1, pulse, pulse * 0.6, pulse * 0.2);
      this.addPx(cx - 1, ws.y - 1, pulse * 0.7, pulse * 0.42, pulse * 0.14);
      this.addPx(cx + 1, ws.y - 1, pulse * 0.7, pulse * 0.42, pulse * 0.14);
      this.addPx(cx, ws.y - 2, pulse * 0.55, pulse * 0.33, pulse * 0.1);
    }

    // objective chevron pointing DOWN at the bowl when unlit + player near —
    // the actionable spot is the dish at the foot, so lead the eye there (the
    // tall stele + lit flame are the long-range landmark on their own).
    if (!lit) {
      const pdx = ws.x - ctx.player.x, pdy = ws.y - ctx.player.y;
      if (pdx * pdx + pdy * pdy < 80 * 80) {
        const bob = Math.round(Math.sin(frame * 0.12) * 1.5);
        const ay = ws.y - 8 + bob;
        const c = 0.6 + Math.sin(frame * 0.12) * 0.28;
        this.addPx(cx - 2, ay, c, c * 0.85, c * 0.35);
        this.addPx(cx + 2, ay, c, c * 0.85, c * 0.35);
        this.addPx(cx - 1, ay + 1, c, c * 0.85, c * 0.35);
        this.addPx(cx + 1, ay + 1, c, c * 0.85, c * 0.35);
        this.addPx(cx, ay + 2, c, c * 0.85, c * 0.35);
      }
    }
  }

  /**
   * The cauldron as a LARGE ornate brewing vessel: a wide U-bowl with rolled-handle
   * rim, curved legs, and a stepped stone pedestal — the brew liquid sloshes and
   * simmers inside. The playable brew basin stays at (cauldron.y) — brewing still
   * reads the real cells; this is the vessel rendered around them.
   */
  private drawCauldronBowl(ctx: Ctx, cauldron: { x: number; y: number }): void {
    const frame = ctx.state.frameCount;
    const world = ctx.world;
    const cx = cauldron.x, cy = cauldron.y;
    // brew mass + heat, sampled from the real basin cells
    let mass = 0, sumR = 0, sumG = 0, sumB = 0;
    for (let dy = -2; dy <= 0; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        if (!world.inBounds(cx + dx, cy + dy)) continue;
        const t = world.types[world.idx(cx + dx, cy + dy)];
        if (!this.isBrewableMass(t)) continue;
        const col = world.colors[world.idx(cx + dx, cy + dy)];
        sumR += this.unpackR01(col); sumG += this.unpackG01(col); sumB += this.unpackB01(col); mass++;
      }
    let heated = false;
    for (let dy = -2; dy <= 4 && !heated; dy++)
      for (let dx = -8; dx <= 8 && !heated; dx++) {
        if (Math.abs(dx) <= 3 && dy >= -2 && dy <= 0) continue;
        if (world.inBounds(cx + dx, cy + dy) && this.isHotCell(world.types[world.idx(cx + dx, cy + dy)])) heated = true;
      }

    // The vessel RISES from the ground basin: a wide rim high above (the wizard
    // stands in it and pours over the lip), tapering to a rounded base on feet.
    const rimY = cy - 12;     // tall rim, well above the ground floor
    const baseY = cy + 2;     // rounded base on the floor
    const span = baseY - rimY;
    const rimHW = 13;
    const baseHW = 4;
    const hwAt = (y: number): number => {
      const tt = (y - rimY) / span; // 0 at rim (widest) → 1 at base (narrow)
      return Math.round(baseHW + (rimHW - baseHW) * Math.sqrt(Math.max(0, 1 - tt * tt)));
    };
    const sheen = ((frame * 0.5) % (rimHW * 2 + 6)) - rimHW - 3; // a highlight travels the rim
    // cool steel — write the three channels directly (no per-pixel tuple alloc)
    const setSteel = (x: number, y: number, v: number): void => this.setPx(x, y, v * 0.86, v * 0.93, v);

    // --- bowl walls (2px): a wide cup tapering to a rounded base ---
    for (let y = rimY; y <= baseY; y++) {
      const hw = hwAt(y);
      if (hw < 1) continue;
      for (const side of [-1, 1] as const) {
        for (let wpx = 0; wpx < 2; wpx++) {
          const x = cx + side * (hw - wpx);
          let v = 0.32 + (side > 0 ? 0.06 : -0.03) - (y - rimY) * 0.004;
          if (Math.abs(x - cx - sheen) < 1.3) v += 0.2; // traveling sheen
          setSteel(x, y, v);
        }
      }
    }
    // close the rounded base
    const hwB = hwAt(baseY);
    for (let dx = -hwB; dx <= hwB; dx++) setSteel(cx + dx, baseY, 0.28);
    // rim band + rolled handles (the curled ends)
    for (let dx = -rimHW; dx <= rimHW; dx++) {
      setSteel(cx + dx, rimY - 1, 0.47);
      setSteel(cx + dx, rimY, 0.38);
    }
    for (const side of [-1, 1] as const) {
      const hx = cx + side * (rimHW + 1);
      setSteel(hx, rimY - 2, 0.42);
      setSteel(hx + side, rimY - 2, 0.36);
      setSteel(hx + side, rimY - 1, 0.32);
    }
    // splayed feet on the floor
    for (const side of [-1, 1] as const) {
      for (let t = 0; t <= 2; t++) setSteel(cx + side * (baseHW + t), baseY + 1 + (t >> 1), 0.26 - t * 0.03);
    }

    // --- the BREW: pools low in the big bowl (real basin level near cy) ---
    if (mass > 0) {
      const inv = 1 / mass;
      const r = sumR * inv, g = sumG * inv, b = sumB * inv;
      const simmer = heated ? 0.9 + Math.sin(frame * 0.22) * 0.25 : 0.72 + Math.sin(frame * 0.06) * 0.12;
      const surfY = cy - 2; // surface sits low, near the real basin cells
      for (let y = surfY; y <= baseY - 1; y++) {
        const hw = Math.max(0, hwAt(y) - 2);
        const slosh = y === surfY ? Math.round(Math.sin(frame * 0.12) * (heated ? 1 : 0.4)) : 0;
        for (let dx = -hw; dx <= hw; dx++) this.setPx(cx + dx, y + slosh, r * simmer, g * simmer, b * simmer);
      }
      if (heated) {
        for (let k = 0; k < 6; k++) {
          const lift = ((frame + k * 11) % 40) / 3;
          this.addPx(cx - 6 + k * 3, surfY - 1 - lift, r * 0.3, g * 0.3, b * 0.3); // vapor climbs the bowl
        }
        if (frame % 7 < 3) this.addPx(cx + ((frame >> 1) % 13) - 6, surfY, r * 0.5 + 0.2, g * 0.5 + 0.12, b * 0.5); // bubble glint
        for (let dx = -baseHW - 2; dx <= baseHW + 2; dx++) this.addPx(cx + dx, baseY, 0.42, 0.18, 0.04); // ember glow under the base
      }
    }
  }

  /** Hand-tool tells: flask siphon/pour beams and the bottle in flight. */
  private drawFlaskEffects(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || ctx.player.dead) return;
    const frame = ctx.state.frameCount;
    const flask = ctx.flask.state;
    const mat = flask.material;
    const tintCol = mat === null ? 0 : COLOR_FN[mat]();
    const tintR = mat === null ? 0.45 : this.unpackR01(tintCol);
    const tintG = mat === null ? 0.72 : this.unpackG01(tintCol);
    const tintB = mat === null ? 1.0 : this.unpackB01(tintCol);
    const tip = ctx.spells.wandTip();

    if (ctx.input.siphonHeld) {
      const target = ctx.input.mouse;
      const reach = Math.hypot(target.x - ctx.player.x, target.y - (ctx.player.y - 9));
      if (reach < 72) {
        const phase = (frame % 12) / 12;
        // Bright, dense pull-line so the siphon reads against the lit terrain.
        this.drawDottedLine(target.x, target.y, ctx.player.x, ctx.player.y - 9, 16, phase, tintR * 0.6 + 0.05, tintG * 0.75 + 0.08, tintB * 0.9 + 0.12);
        // A pulsing node on the cursor marks the patch being drained.
        const pulse = 0.65 + Math.sin(frame * 0.4) * 0.35;
        this.addPx(target.x, target.y, tintR * pulse, tintG * pulse, tintB * pulse);
        const arm = tintR * pulse * 0.6,
          arg = tintG * pulse * 0.6,
          ab = tintB * pulse * 0.6;
        this.addPx(target.x + 1, target.y, arm, arg, ab);
        this.addPx(target.x - 1, target.y, arm, arg, ab);
        this.addPx(target.x, target.y + 1, arm, arg, ab);
        this.addPx(target.x, target.y - 1, arm, arg, ab);
      }
    }

    if (ctx.input.pourHeld && mat !== null && flask.count > 0) {
      const a = ctx.player.aimAngle;
      for (let k = 0; k < 8; k++) {
        const t = (k + ((frame % 6) / 6)) / 8;
        this.addPx(
          tip.x + Math.cos(a) * (2 + t * 10),
          tip.y + Math.sin(a) * (2 + t * 10) + t * t * 3,
          tintR * (0.3 - t * 0.18),
          tintG * (0.3 - t * 0.18),
          tintB * (0.3 - t * 0.18),
        );
      }
    }

    const bottle = ctx.flask.bottleView();
    if (!bottle) return;
    const bottleMat = bottle.material;
    const bottleCol = bottleMat === null ? 0 : COLOR_FN[bottleMat]();
    const bottleTintR = bottleMat === null ? tintR : this.unpackR01(bottleCol);
    const bottleTintG = bottleMat === null ? tintG : this.unpackG01(bottleCol);
    const bottleTintB = bottleMat === null ? tintB : this.unpackB01(bottleCol);
    const x = Math.round(bottle.x),
      y = Math.round(bottle.y);
    const spin = frame * 0.5 + bottle.x * 0.03;
    const sx = Math.round(Math.cos(spin));
    const sy = Math.round(Math.sin(spin));
    this.setPx(x, y, 0.72, 0.9, 1.0);
    this.setPx(x + sx, y + sy, 0.45, 0.65, 0.8);
    this.setPx(x - sx, y - sy, 0.18, 0.28, 0.36);
    if (bottleMat !== null) this.addPx(x, y + 1, bottleTintR * 0.55, bottleTintG * 0.55, bottleTintB * 0.55);
  }

  /** Wave F: the critter layer — tiny, alive, mostly ignorable. */
  private drawCritters(ctx: Ctx): void {
    if (ctx.state.mode !== 'play') return;
    const frame = ctx.state.frameCount;
    for (const c of ctx.critters.list) {
      const x = Math.round(c.x),
        y = Math.round(c.y);
      if (c.kind === 'moth') {
        // pale dusty wings, alternating beat
        const beat = frame % 6 < 3 ? 1 : 0;
        this.setPx(x, y, 0.62, 0.58, 0.46);
        this.setPx(x - 1, y - beat, 0.45, 0.42, 0.33);
        this.setPx(x + 1, y - (1 - beat), 0.45, 0.42, 0.33);
      } else if (c.kind === 'firefly') {
        // dark speck, bright abdomen on the pulse
        const pulse = Math.max(0, Math.sin(c.phase * 0.45));
        this.setPx(x, y, 0.1, 0.12, 0.06);
        if (pulse > 0.25) this.addPx(x, y + 1, 0.5 * pulse, 1.4 * pulse, 0.25 * pulse);
      } else if (c.kind === 'fish') {
        const tail = Math.sin(c.phase * 1.6) > 0 ? 1 : 0;
        this.setPx(x, y, 0.5, 0.6, 0.62);
        this.setPx(x - c.facing, y, 0.36, 0.46, 0.5);
        this.setPx(x - c.facing * 2, y + tail - 0, 0.26, 0.36, 0.4);
      } else if (c.kind === 'beetle') {
        this.setPx(x, y, 0.16, 0.13, 0.1);
        this.setPx(x + c.facing, y, 0.22, 0.18, 0.12);
      } else if (c.kind === 'fly') {
        this.setPx(x, y, 0.12, 0.11, 0.09);
        if (frame % 4 < 2) this.addPx(x, y - 1, 0.08, 0.08, 0.07);
      }
    }
  }

  /** Lever arms, pressed-plate glows, machine states, floating rune glyphs
   *  — the per-mechanism pixel art lives in render/sprites/MechanismSprites
   *  so the Builder gallery previews animate with the SAME code. */
  private drawMechanismsAndRunes(ctx: Ctx): void {
    const runtime = ctx.levels.current;
    if (!runtime || ctx.state.mode !== 'play') return;
    const frame = ctx.state.frameCount;
    const bst = ctx.params.global.maxBrightness;
    const camX = ctx.camera.renderX,
      camY = ctx.camera.renderY;

    for (const m of runtime.mechanisms) {
      if (m.x < camX - 12 || m.x > camX + VIEW_W + 12 || m.y < camY - 12 || m.y > camY + VIEW_H + 12)
        continue;
      drawMechanismSprite(this, m, frame);
    }

    for (const v of runtime.runeVaults) {
      if (v.rx < camX - 8 || v.rx > camX + VIEW_W + 8 || v.ry < camY - 8 || v.ry > camY + VIEW_H + 8)
        continue;
      drawRuneGlyphSprite(this, v, frame, bst);
    }
  }

  /** Bobbing treasure glyphs + the swirling exit gate (all self-lit). */
  private drawPickupsAndPortal(ctx: Ctx): void {
    const runtime = ctx.levels.current;
    if (!runtime || ctx.state.mode !== 'play') return;
    const frame = ctx.state.frameCount;

    for (const p of runtime.pickups) {
      if (p.taken) continue;
      const bob = Math.sin(frame * 0.08 + p.x * 0.7) * 1.4;
      const x = Math.round(p.x);
      const y = Math.round(p.y + bob) - 2;
      const c = PICKUP_COLOR[p.kind];
      const r = ((c >> 16) & 0xff) / 255;
      const g = ((c >> 8) & 0xff) / 255;
      const b = (c & 0xff) / 255;
      const pulse = 0.8 + Math.sin(frame * 0.12 + p.y) * 0.25;
      if (p.kind === 'chest') {
        // squat banded coffer; the lid twitches when the alchemist is close
        const near =
          (ctx.player.x - p.x) * (ctx.player.x - p.x) + (ctx.player.y - p.y) * (ctx.player.y - p.y) < 44 * 44;
        const lid = near && frame % 40 < 8 ? -1 : 0;
        for (let dx = -2; dx <= 2; dx++) {
          this.setPx(x + dx, y + lid, r * 0.8, g * 0.8, b * 0.8);
          this.setPx(x + dx, y + 1, r * 0.55, g * 0.5, b * 0.4);
        }
        this.setPx(x, y + lid, 1.2, 1.1, 0.5); // clasp glint
      } else if (p.kind === 'key') {
        // bright sparkling key; its bow twitches like it wants the portal
        const twitch = frame % 50 < 6 ? Math.round(Math.sin(frame * 1.7)) : 0;
        const dir = runtime.portal && runtime.portal.x < p.x ? -1 : 1;
        this.setPx(x - dir + twitch, y - 1, r * pulse * 1.5, g * pulse * 1.45, b * pulse * 0.8);
        this.setPx(x + twitch, y - 1, r * pulse * 1.5, g * pulse * 1.45, b * pulse * 0.8);
        for (let s = 0; s < 4; s++) this.setPx(x + dir * s + twitch, y, r * pulse * 1.35, g * pulse * 1.3, b * 0.7);
        this.setPx(x + dir * 3 + twitch, y + 1, r, g * 0.9, b * 0.45);
        if (frame % 14 < 3) this.addPx(x + dir * 4, y - 2, 0.8, 0.8, 0.6);
      } else if (p.kind === 'heart') {
        // double-beat heart: a quick lub-dub instead of a generic bobbing gem
        const beat = (frame + Math.floor(p.x)) % 70;
        const thump = beat < 6 || (beat > 13 && beat < 19) ? 1.35 : 1.0;
        this.setPx(x - 1, y - 1, r * thump, g * 0.7 * thump, b * 0.8 * thump);
        this.setPx(x + 1, y - 1, r * thump, g * 0.7 * thump, b * 0.8 * thump);
        this.setPx(x - 2, y, r * 0.9 * thump, g * 0.45 * thump, b * 0.55 * thump);
        this.setPx(x, y, r * 1.4 * thump, g * 0.75 * thump, b * 0.8 * thump);
        this.setPx(x + 2, y, r * 0.9 * thump, g * 0.45 * thump, b * 0.55 * thump);
        this.setPx(x, y + 1, r * 0.85 * thump, g * 0.35 * thump, b * 0.45 * thump);
      } else if (p.kind === 'tome') {
        // page flutter: the spell book is awake before you pick it up
        const flip = Math.sin(frame * 0.18 + p.x) > 0 ? 1 : 0;
        this.setPx(x - 2, y, r * 0.55, g * 0.65, b * 0.8);
        this.setPx(x - 1, y - flip, r * pulse, g * pulse, b * pulse);
        this.setPx(x, y, 0.08, 0.12, 0.22);
        this.setPx(x + 1, y - (1 - flip), r * pulse, g * pulse, b * pulse);
        this.setPx(x + 2, y, r * 0.45, g * 0.55, b * 0.75);
        if (frame % 24 < 4) this.addPx(x, y - 2, 0.16, 0.28, 0.45);
      } else if (p.kind === 'potion') {
        // tiny flask: glass outline, colored liquid sloshing one cell side to side
        const slosh = Math.round(Math.sin(frame * 0.15 + p.x));
        this.setPx(x, y - 2, 0.65, 0.82, 0.95);
        this.setPx(x - 1, y - 1, 0.45, 0.6, 0.75);
        this.setPx(x + 1, y - 1, 0.45, 0.6, 0.75);
        this.setPx(x - 1, y, r * pulse, g * pulse, b * pulse);
        this.setPx(x + slosh, y, r * pulse * 1.3, g * pulse * 1.3, b * pulse * 1.3);
        this.setPx(x + 1, y, r * 0.7, g * 0.7, b * 0.7);
        this.addPx(x - slosh, y - 1, 0.1, 0.13, 0.16);
      } else if (p.kind === 'goldpile') {
        // coin tumble: a tiny pile flashes edge-on every few frames
        const spin = (frame + Math.floor(p.x)) % 24;
        const narrow = spin < 5 || spin > 18;
        const hw = narrow ? 1 : 2;
        for (let dx = -hw; dx <= hw; dx++) this.setPx(x + dx, y, r * pulse * 1.3, g * pulse * 1.15, b * 0.7);
        this.setPx(x - 1, y + 1, r * 0.7, g * 0.5, b * 0.22);
        this.setPx(x + 1, y + 1, r * 0.8, g * 0.55, b * 0.25);
      } else {
        // diamond glyph (heart/tome/potion/goldpile)
        this.setPx(x, y, r * pulse * 1.4, g * pulse * 1.4, b * pulse * 1.4);
        this.setPx(x + 1, y, r * pulse * 0.8, g * pulse * 0.8, b * pulse * 0.8);
        this.setPx(x - 1, y, r * pulse * 0.8, g * pulse * 0.8, b * pulse * 0.8);
        this.setPx(x, y - 1, r * pulse * 0.9, g * pulse * 0.9, b * pulse * 0.9);
        this.setPx(x, y + 1, r * pulse * 0.6, g * pulse * 0.6, b * pulse * 0.6);
      }
    }

    const portal = runtime.portal;
    if (portal) {
      const pdx = ctx.player.x - portal.x,
        pdy = ctx.player.y - 6 - portal.y;
      const near = pdx * pdx + pdy * pdy < 70 * 70;
      const lit = runtime.keyTaken ? (near ? 2.0 : 1.6) : near ? 0.75 : 0.5;
      const ringR = 6 + (runtime.keyTaken ? Math.sin(frame * 0.08) * 0.7 : frame % 120 < 8 ? 1 : 0);
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2 + frame * (runtime.keyTaken ? 0.065 : 0.025);
        const twitch = runtime.keyTaken ? 0 : Math.sin(frame * 0.11 + k) * 0.7;
        const px = Math.round(portal.x + Math.cos(a) * (ringR + twitch));
        const py = Math.round(portal.y - 4 + Math.sin(a) * (ringR + 2));
        const tw = 0.6 + Math.sin(frame * 0.2 + k) * 0.4;
        this.setPx(px, py, 0.55 * lit * tw, 0.18 * lit * tw, 0.95 * lit * tw);
      }
      if (runtime.keyTaken && near) {
        this.drawDottedLine(ctx.player.x, ctx.player.y - 8, portal.x, portal.y - 4, 9, (frame % 18) / 18, 0.16, 0.05, 0.28);
      }
      if (runtime.keyTaken && frame % 3 === 0) {
        this.addPx(
          portal.x + Math.round((Math.random() - 0.5) * 8),
          portal.y - 4 + Math.round((Math.random() - 0.5) * 10),
          0.3,
          0.1,
          0.5,
        );
      }
    }
  }
}

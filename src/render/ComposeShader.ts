import * as THREE from 'three';
import { DataUtils } from 'three';

import { HEIGHT, VIEW_H, VIEW_W, WIDTH } from '@/config/constants';
import type { Ctx, MaterialParams } from '@/core/types';
import type {
  CompositorLens,
  LightField,
  OverlaySurface,
  ParallaxLayers,
} from '@/render/pixels';
import { Cell } from '@/sim/CellType';
import type { World } from '@/sim/World';

/* ===================== GPU Frame Composition (perf ticket #8) =====================
 * The FrameComposer terrain loop, ported formula-for-formula into a fragment
 * shader (docs/GPU-COMPOSE-PLAN.md). THE CPU LOOP IS THE LOOK: every constant
 * below mirrors FrameComposer.compose exactly — knee curve, squared light,
 * vignette-free selfGlow, additive air glow. Do not "improve" while porting.
 *
 * Inputs per frame:
 *  - world window  : RGBA8UI, (VIEW+2*PAD)^2, RGB = cell color bytes,
 *                    A = type | 0x80 charge bit (ids <= 127; documented next
 *                    to CELL_COUNT in sim/CellType.ts)
 *  - light field   : RGBA32F at half view res, re-fed only when light.build ran
 *  - bloom LUT     : R32F 256x1, re-fed every frame (params are live-tunable)
 *  - parallax      : bgFar R8 / bgNear R32F at world size, uploaded once
 *  - overlay       : RGBA16F sprite layer (CPU setPx/addPx writes, see pixels.ts)
 *  - distortion    : shockwave + black-hole lens uniform arrays
 */

/**
 * Distortion pad around the view window. Shockwave offset is bounded by
 * |strength| <= 16 (singularity ring −16, explosions +12); the lens offset by
 * K·1.221 per axis with K = 4 + vortexRad·0.16 and vortexRad capped at 140
 * (collapseLimit) → ~33 cells. One wave + one max lens ≈ 49; 64 leaves head-
 * room for two stacked wave fronts. The shader clamps lookups to the window,
 * so distortions beyond the pad diverge from the CPU (which clamps to world
 * bounds) — the parity probe asserts a max-size black hole at the view edge.
 */
export const COMPOSE_PAD = 64;

const WIN_W = VIEW_W + 2 * COMPOSE_PAD;
const WIN_H = VIEW_H + 2 * COMPOSE_PAD;
const MAX_WAVES = 8;
const MAX_LENSES = 4;
const TWO_PI = Math.PI * 2;

/** Vignette bake constants — must match Lighting's baked table exactly. */
const VIG_CX = VIEW_W / 2;
const VIG_CY = VIEW_H / 2;
const VIG_MAXR2 = VIG_CX * VIG_CX + VIG_CY * VIG_CY;

const vertexShader = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
precision highp int;
precision highp usampler2D;

// Under glslVersion: GLSL3 three.js does NOT inject the output declaration
// it adds for auto-converted GLSL1 materials — declare it ourselves so the
// tonemapping/colorspace chunks (which write gl_FragColor) compile.
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor

#define C_PI 3.141592653589793

uniform usampler2D uWin;
uniform sampler2D uLight;
uniform sampler2D uLut;
uniform sampler2D uBgFar;
uniform sampler2D uBgNear;
uniform sampler2D uOverlay;

uniform ivec2 uCam;        // integer camera snapshot (renderCamX/Y)
uniform ivec2 uWinOrigin;  // world coords of window texel (0,0)
uniform ivec2 uFarOff;     // floor(cam * 0.35)
uniform ivec2 uNearOff;    // floor(cam * 0.62)
uniform float uAmbient;
uniform float uBoost;      // maxBrightness
uniform int uGlintFrame;   // frameCount % 97 (crystal glint is integer math)
uniform float uPhaseWater;  // (frameCount * 0.16)  mod 2pi
uniform float uPhaseShroom; // (frameCount * 0.045) mod 2pi
uniform float uPhaseSway;   // (frameCount * 0.035) mod 2pi
uniform float uFlickerSeed; // re-rolled per frame
uniform float uFlickerMid;  // debug: 1 = freeze stochastic flicker at 0.5
uniform vec4 uWaveA[${MAX_WAVES}];  // cx, cy, currentRadius, maxRadius
uniform float uWaveS[${MAX_WAVES}]; // strength (negative = implosion)
uniform int uWaveCount;
uniform vec4 uLens[${MAX_LENSES}];  // cx, cy, R, K
uniform int uLensCount;

in vec2 vUv;

// Same hash family as PostFx's film grain — uniform enough for flicker, and
// re-rolled per frame via uFlickerSeed. Distribution-identical to the CPU's
// Math.random() is the bar here, not bit equality (verified by the parity
// probe's mean/variance bands).
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float flickerRand(vec2 p, float salt) {
  if (uFlickerMid > 0.5) return 0.5;
  return hash12(p + uFlickerSeed * salt);
}

void main() {
  int col = clamp(int(vUv.x * ${VIEW_W.toFixed(1)}), 0, ${VIEW_W - 1});
  int rowB = clamp(int(vUv.y * ${VIEW_H.toFixed(1)}), 0, ${VIEW_H - 1});
  int vx = col;
  int vy = ${VIEW_H - 1} - rowB; // view y from the top (buffer rows are Y-flipped)

  // Overlay first: a setPx'd pixel replaces terrain outright, so all terrain
  // work can be skipped (exact CPU semantics: setPx overwrote the buffer).
  vec4 ov = texelFetch(uOverlay, ivec2(col, rowB), 0);

  vec3 c = vec3(0.0);
  if (ov.a <= 0.5) {
    int wx = uCam.x + vx;
    int wy = uCam.y + vy;

    // --- Distorted lookup: shockwave ring refraction + black-hole lenses ---
    int lookupX = wx;
    int lookupY = wy;
    float ringGlow = 0.0;
    if (uWaveCount > 0) {
      for (int i = 0; i < uWaveCount; i++) {
        vec4 w = uWaveA[i];
        float dx = float(wx) - w.x;
        float dy = float(wy) - w.y;
        float dist = sqrt(dx * dx + dy * dy);
        float front = w.z;
        if (dist > front - 9.0 && dist < front + 9.0) {
          float edgeFactor = 1.0 - abs(dist - front) / 9.0;
          float decayFactor = 1.0 - w.z / w.w;
          float offset = sin(edgeFactor * C_PI) * uWaveS[i] * decayFactor;
          ringGlow += sin(edgeFactor * C_PI) * decayFactor;
          if (dist > 0.0) {
            lookupX -= int(floor(dx / dist * offset));
            lookupY -= int(floor(dy / dist * offset));
          }
        }
      }
      lookupX = clamp(lookupX, 0, ${WIDTH - 1});
      lookupY = clamp(lookupY, 0, ${HEIGHT - 1});
    }
    if (uLensCount > 0) {
      for (int i = 0; i < uLensCount; i++) {
        vec4 L = uLens[i];
        float ldx = float(wx) - L.x;
        float ldy = float(wy) - L.y;
        float ld2 = ldx * ldx + ldy * ldy;
        if (ld2 > L.z * L.z || ld2 < 1.0) continue;
        float ld = sqrt(ld2);
        float pull = 1.0 - ld / L.z;
        float k = pull * pull * L.w;
        // sample from further out (pinch) with a tangential swirl
        lookupX += int(floor(ldx / ld * k - ldy / ld * k * 0.7));
        lookupY += int(floor(ldy / ld * k + ldx / ld * k * 0.7));
      }
      lookupX = clamp(lookupX, 0, ${WIDTH - 1});
      lookupY = clamp(lookupY, 0, ${HEIGHT - 1});
    }

    // Window-space lookup (clamped to the pad — see COMPOSE_PAD).
    int lx = clamp(lookupX - uWinOrigin.x, 0, ${WIN_W - 1});
    int ly = clamp(lookupY - uWinOrigin.y, 0, ${WIN_H - 1});
    uvec4 cell = texelFetch(uWin, ivec2(lx, ly), 0);
    int type = int(cell.a & 0x7Fu);
    bool charged = (cell.a & 0x80u) != 0u;

    vec3 light = texelFetch(uLight, ivec2(vx >> 1, vy >> 1), 0).rgb;
    float dxv = float(vx) - ${VIG_CX.toFixed(1)};
    float dyv = float(vy) - ${VIG_CY.toFixed(1)};
    float vg = 1.0 - 0.52 * ((dxv * dxv + dyv * dyv) / ${VIG_MAXR2.toFixed(1)});

    if (type == ${Cell.Empty}) {
      // Parallax composite: near rock texture, carved darker by far silhouettes
      float nearTex = texelFetch(uBgNear, ivec2(uNearOff.x + vx, uNearOff.y + vy), 0).r;
      float farTex = texelFetch(uBgFar, ivec2(uFarOff.x + vx, uFarOff.y + vy), 0).r;
      float base = 0.022 + nearTex * 0.085;
      if (farTex > 0.5) base *= 0.4;
      base *= 0.86 + 0.14 * (1.0 - float(wy) / ${HEIGHT.toFixed(1)});
      float r = base * 0.8;
      float g = base * 0.9;
      float b = base * 1.25;
      float lf0 = min(2.2, light.r) * vg;
      r = (r * 0.45 + uAmbient * 0.03) * vg + r * lf0 * lf0;
      lf0 = min(2.2, light.g) * vg;
      g = (g * 0.45 + uAmbient * 0.03) * vg + g * lf0 * lf0;
      lf0 = min(2.2, light.b) * vg;
      b = (b * 0.45 + uAmbient * 0.06) * vg + b * lf0 * lf0;
      // air itself catches the glow near strong light
      r += max(0.0, light.r - 0.25) * 0.1 * vg;
      g += max(0.0, light.g - 0.25) * 0.085 * vg;
      b += max(0.0, light.b - 0.25) * 0.07 * vg;
      c = vec3(r, g, b) + ringGlow * vec3(0.55, 0.42, 0.26);
    } else {
      float r = float(cell.r) / 255.0;
      float g = float(cell.g) / 255.0;
      float b = float(cell.b) / 255.0;

      // Living flame: per-frame flicker on hot cells (stochastic, hash-rolled)
      if (type == ${Cell.Fire}) {
        float fl = 0.75 + flickerRand(vec2(float(wx), float(wy)), 1.0) * 0.5;
        r *= fl; g *= fl; b *= fl;
      } else if (type == ${Cell.Lava}) {
        r *= 0.96 + flickerRand(vec2(float(wx), float(wy)), 1.0) * 0.08;
        g *= 0.8 + flickerRand(vec2(float(wy), float(wx)), 1.618034) * 0.35;
      } else if (type == ${Cell.Ember}) {
        float fl = 0.7 + flickerRand(vec2(float(wx), float(wy)), 1.0) * 0.55;
        r *= fl; g *= fl * 0.95;
      } else if ((type == ${Cell.Water} || type == ${Cell.Healium} || type == ${Cell.Teleportium})
                 && wy > 0 && ly > 0
                 && (texelFetch(uWin, ivec2(lx, ly - 1), 0).a & 0x7Fu) == ${Cell.Empty}u) {
        // liquid surface shimmer — deterministic in (frameCount, wx)
        float wave = 0.88 + sin(uPhaseWater + float(wx) * 0.42) * 0.12;
        r *= wave;
        g *= 0.94 + (wave - 0.88) * 0.45;
        b *= 1.08 + (wave - 0.88) * 0.55;
      } else if (type == ${Cell.Crystal}) {
        // glint is INTEGER arithmetic — float % would drift off the CPU's lattice
        if ((wx * 17 + wy * 31 + uGlintFrame) % 97 == 0) {
          r *= 1.65; g *= 1.45; b *= 1.95;
        }
      } else if (type == ${Cell.Glowshroom}) {
        float breath = 0.9 + sin(uPhaseShroom + float(wx) * 0.21 + float(wy) * 0.17) * 0.16;
        r *= breath;
        g *= 1.02 + (breath - 0.9) * 0.9;
        b *= breath;
      } else if (type == ${Cell.Vines} || type == ${Cell.Moss} || type == ${Cell.Fungus}) {
        float living = 0.94 + sin(uPhaseSway + float(wx) * 0.13 + float(wy) * 0.29) * 0.08;
        g *= living;
      }

      float scalar = texelFetch(uLut, ivec2(type, 0), 0).r;
      float intensity = 1.0 + (uBoost - 1.0) * scalar;
      if (charged) {
        r = 0.2; g = 0.75; b = 1.0;
        intensity = uBoost * 1.2;
      }

      // The lighting law (per channel): vignette, ambient, clamp 2.2, square,
      // soft knee above 1.25, vignette-free selfGlow for emissives, plus the
      // 0.06 readability floor. Ported verbatim from FrameComposer.
      float floorL = 0.06 * vg;
      float selfGlow = scalar > 0.0 ? 0.45 + scalar * 1.55 : 0.0;
      float lf = (uAmbient + min(2.2, light.r)) * vg;
      float lit = lf * lf;
      if (lit > 1.25) lit = min(2.0, 1.25 + (lit - 1.25) * 0.3);
      r = r * max(lit, selfGlow) + r * floorL;
      lf = (uAmbient + min(2.2, light.g)) * vg;
      lit = lf * lf;
      if (lit > 1.25) lit = min(2.0, 1.25 + (lit - 1.25) * 0.3);
      g = g * max(lit, selfGlow) + g * floorL;
      lf = (uAmbient + min(2.2, light.b)) * vg;
      lit = lf * lf;
      if (lit > 1.25) lit = min(2.0, 1.25 + (lit - 1.25) * 0.3);
      b = b * max(lit, selfGlow) + b * floorL;

      c = vec3(r, g, b) * intensity + ringGlow * vec3(0.55, 0.42, 0.26);
    }
  }

  // Overlay combine: setPx (a=1) replaced terrain above; addPx is additive.
  gl_FragColor = vec4(c + ov.rgb, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Pack one cell: little-endian RGBA bytes = color R,G,B + type/charge in A. */
function packCellValue(
  types: Uint8Array,
  colors: Uint32Array,
  charge: Uint8Array,
  ci: number,
): number {
  const c = colors[ci];
  return (
    (((c >>> 16) & 0xff) | (c & 0xff00) | ((c & 0xff) << 16) |
      ((types[ci] | (charge[ci] !== 0 ? 0x80 : 0)) << 24)) >>>
    0
  );
}

/**
 * The sprite overlay: float staging the composer's setPx/addPx write into
 * (exact CPU semantics, no quantized accumulation), converted to half floats
 * for upload — but ONLY the pixels written this frame. Sprites touch a few
 * thousand pixels; the full-buffer JS f16 conversion that was rejected for
 * the old 187k-pixel path is ~1/30th the work here.
 */
class Overlay implements OverlaySurface {
  readonly data = new Float32Array(VIEW_W * VIEW_H * 4);
  readonly half = new Uint16Array(VIEW_W * VIEW_H * 4);
  private readonly touched = new Uint8Array(VIEW_W * VIEW_H);
  private written = new Uint32Array(8192);
  private count = 0;
  /** Set when last frame's pixels were zeroed (upload needed even with 0 new writes). */
  private clearedThisFrame = false;

  mark(pixelIdx: number): void {
    if (this.touched[pixelIdx] !== 0) return;
    this.touched[pixelIdx] = 1;
    if (this.count === this.written.length) {
      const grown = new Uint32Array(this.written.length * 2);
      grown.set(this.written);
      this.written = grown;
    }
    this.written[this.count++] = pixelIdx;
  }

  /** Zero only last frame's written pixels (full-buffer fill was the slow path). */
  clear(): void {
    const { data, half, touched, written } = this;
    for (let k = 0; k < this.count; k++) {
      const pi = written[k];
      const b = pi * 4;
      data[b] = 0;
      data[b + 1] = 0;
      data[b + 2] = 0;
      data[b + 3] = 0;
      half[b] = 0;
      half[b + 1] = 0;
      half[b + 2] = 0;
      half[b + 3] = 0;
      touched[pi] = 0;
    }
    this.clearedThisFrame = this.count > 0;
    this.count = 0;
  }

  /** Convert this frame's written pixels to f16. Returns true if upload needed. */
  commit(): boolean {
    const { data, half, written } = this;
    for (let k = 0; k < this.count; k++) {
      const b = written[k] * 4;
      half[b] = DataUtils.toHalfFloat(data[b]);
      half[b + 1] = DataUtils.toHalfFloat(data[b + 1]);
      half[b + 2] = DataUtils.toHalfFloat(data[b + 2]);
      half[b + 3] = DataUtils.toHalfFloat(data[b + 3]);
    }
    const dirty = this.clearedThisFrame || this.count > 0;
    this.clearedThisFrame = false;
    return dirty;
  }
}

/** GLSL source, ShaderMaterial, window packer, and texture/uniform management. */
export class GpuCompose {
  readonly material: THREE.ShaderMaterial;

  private readonly winBytes = new Uint8Array(WIN_W * WIN_H * 4);
  private readonly win32 = new Uint32Array(this.winBytes.buffer);
  private readonly winTex: THREE.DataTexture;

  private readonly lightData: Float32Array<ArrayBuffer>;
  private readonly lightTex: THREE.DataTexture;

  private readonly lutData = new Float32Array(256);
  private readonly lutTex: THREE.DataTexture;

  private readonly overlayTex: THREE.DataTexture;
  private readonly overlay = new Overlay();

  private readonly waveA: THREE.Vector4[] = [];
  private readonly waveS = new Float32Array(MAX_WAVES);
  private readonly lensV: THREE.Vector4[] = [];

  constructor(layers: ParallaxLayers, light: LightField) {
    // World window: RGBA8UI so type/charge reads are exact integer fetches
    // and colors come back as the same float(n)/255 the CPU computes.
    this.winTex = new THREE.DataTexture(
      this.winBytes,
      WIN_W,
      WIN_H,
      THREE.RGBAIntegerFormat,
      THREE.UnsignedByteType,
    );
    this.winTex.internalFormat = 'RGBA8UI';
    this.winTex.minFilter = this.winTex.magFilter = THREE.NearestFilter;

    // Half-res light field as raw float32 — bit-identical to the CPU arrays.
    this.lightData = new Float32Array(light.LW * light.LH * 4);
    for (let i = 3; i < this.lightData.length; i += 4) this.lightData[i] = 1;
    this.lightTex = new THREE.DataTexture(
      this.lightData,
      light.LW,
      light.LH,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.lightTex.minFilter = this.lightTex.magFilter = THREE.NearestFilter;

    // bloomWeight LUT by type id — re-fed every frame (live-tunable params).
    this.lutTex = new THREE.DataTexture(
      this.lutData,
      256,
      1,
      THREE.RedFormat,
      THREE.FloatType,
    );
    this.lutTex.minFilter = this.lutTex.magFilter = THREE.NearestFilter;

    // Parallax layers: seed-independent statics, uploaded once at first use.
    // bgFar is binary (R8 exact); bgNear feeds `0.022 + near*0.085` so it
    // stays R32F to keep the empty-cell path bit-comparable to the CPU.
    const far8 = new Uint8Array(WIDTH * HEIGHT);
    for (let i = 0; i < far8.length; i++) far8[i] = layers.bgFar[i] > 0.5 ? 255 : 0;
    const bgFarTex = new THREE.DataTexture(far8, WIDTH, HEIGHT, THREE.RedFormat, THREE.UnsignedByteType);
    bgFarTex.minFilter = bgFarTex.magFilter = THREE.NearestFilter;
    bgFarTex.needsUpdate = true;
    const bgNearTex = new THREE.DataTexture(
      layers.bgNear as Float32Array<ArrayBuffer>,
      WIDTH,
      HEIGHT,
      THREE.RedFormat,
      THREE.FloatType,
    );
    bgNearTex.minFilter = bgNearTex.magFilter = THREE.NearestFilter;
    bgNearTex.needsUpdate = true;

    this.overlayTex = new THREE.DataTexture(
      this.overlay.half,
      VIEW_W,
      VIEW_H,
      THREE.RGBAFormat,
      THREE.HalfFloatType,
    );
    this.overlayTex.minFilter = this.overlayTex.magFilter = THREE.NearestFilter;
    this.overlayTex.needsUpdate = true;

    for (let i = 0; i < MAX_WAVES; i++) this.waveA.push(new THREE.Vector4());
    for (let i = 0; i < MAX_LENSES; i++) this.lensV.push(new THREE.Vector4());

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        uWin: { value: this.winTex },
        uLight: { value: this.lightTex },
        uLut: { value: this.lutTex },
        uBgFar: { value: bgFarTex },
        uBgNear: { value: bgNearTex },
        uOverlay: { value: this.overlayTex },
        uCam: { value: new THREE.Vector2() },
        uWinOrigin: { value: new THREE.Vector2() },
        uFarOff: { value: new THREE.Vector2() },
        uNearOff: { value: new THREE.Vector2() },
        uAmbient: { value: 0 },
        uBoost: { value: 1 },
        uGlintFrame: { value: 0 },
        uPhaseWater: { value: 0 },
        uPhaseShroom: { value: 0 },
        uPhaseSway: { value: 0 },
        uFlickerSeed: { value: 0 },
        uFlickerMid: { value: 0 },
        uWaveA: { value: this.waveA },
        uWaveS: { value: this.waveS },
        uWaveCount: { value: 0 },
        uLens: { value: this.lensV },
        uLensCount: { value: 0 },
      },
    });
    // Tone mapping + output colorspace ride the SAME renderer-driven chunks
    // MeshBasicMaterial uses, so CPU and GPU frames hit the canvas identically.
    this.material.toneMapped = true;
  }

  /** Feed everything the shader needs for this frame; clears the overlay. */
  beginFrame(
    ctx: Ctx,
    light: LightField,
    lenses: readonly CompositorLens[],
    lightRebuilt: boolean,
  ): OverlaySurface {
    const camX = ctx.camera.renderX;
    const camY = ctx.camera.renderY;
    this.packWindow(ctx.world, camX, camY);
    this.winTex.needsUpdate = true;

    if (lightRebuilt) this.uploadLight(light);
    this.updateLut(ctx.params.materials);

    const u = this.material.uniforms;
    (u.uCam.value as THREE.Vector2).set(camX, camY);
    (u.uWinOrigin.value as THREE.Vector2).set(camX - COMPOSE_PAD, camY - COMPOSE_PAD);
    (u.uFarOff.value as THREE.Vector2).set(Math.floor(camX * 0.35), Math.floor(camY * 0.35));
    (u.uNearOff.value as THREE.Vector2).set(Math.floor(camX * 0.62), Math.floor(camY * 0.62));
    u.uAmbient.value = ctx.params.global.ambient;
    u.uBoost.value = ctx.params.global.maxBrightness;

    const frameCount = ctx.state.frameCount;
    u.uGlintFrame.value = frameCount % 97;
    // Phases are reduced mod 2pi in f64 HERE so the f32 sin argument stays
    // small — hour-long sessions would otherwise drift the water shimmer.
    u.uPhaseWater.value = (frameCount * 0.16) % TWO_PI;
    u.uPhaseShroom.value = (frameCount * 0.045) % TWO_PI;
    u.uPhaseSway.value = (frameCount * 0.035) % TWO_PI;
    u.uFlickerSeed.value = Math.random() * 4096;
    const dbg = window as unknown as { __composeFlickerMid?: boolean };
    u.uFlickerMid.value = dbg.__composeFlickerMid === true ? 1 : 0;

    const waves = ctx.shockwaves;
    const wCount = Math.min(waves.length, MAX_WAVES);
    for (let i = 0; i < wCount; i++) {
      const w = waves[i];
      this.waveA[i].set(w.cx, w.cy, w.currentRadius, w.maxRadius);
      this.waveS[i] = w.strength;
    }
    u.uWaveCount.value = wCount;

    const lCount = Math.min(lenses.length, MAX_LENSES);
    for (let i = 0; i < lCount; i++) {
      const L = lenses[i];
      this.lensV[i].set(L.cx, L.cy, L.R, L.K);
    }
    u.uLensCount.value = lCount;

    this.overlay.clear();
    return this.overlay;
  }

  /** Stage this frame's overlay writes for upload. */
  commit(): void {
    if (this.overlay.commit()) this.overlayTex.needsUpdate = true;
  }

  /**
   * Pack the padded camera window: type + charge bit + color per cell into
   * RGBA8 via one 32-bit write each. Reads clamp to world bounds (replicated
   * edges), which reproduces the CPU loop's clamp-to-world lookups for any
   * distortion that stays inside the pad. Field loads are hoisted — V8 does
   * not hoist them past the call boundary on its own (perf lesson).
   */
  private packWindow(world: World, camX: number, camY: number): void {
    const types = world.types;
    const colors = world.colors;
    const charge = world.charge;
    const out = this.win32;
    const x0 = camX - COMPOSE_PAD;
    const y0 = camY - COMPOSE_PAD;
    // Columns left of / right of the world edge use a clamped repeat value,
    // so the hot middle loop runs branch-free.
    const leftN = Math.min(WIN_W, Math.max(0, -x0));
    const rightStart = Math.max(leftN, Math.min(WIN_W, WIDTH - x0));
    let o = 0;
    for (let row = 0; row < WIN_H; row++) {
      let wy = y0 + row;
      if (wy < 0) wy = 0;
      else if (wy >= HEIGHT) wy = HEIGHT - 1;
      const rowBase = wy * WIDTH;
      if (leftN > 0) {
        const v = packCellValue(types, colors, charge, rowBase);
        for (let i = 0; i < leftN; i++) out[o++] = v;
      }
      let ci = rowBase + x0 + leftN;
      for (let i = leftN; i < rightStart; i++, ci++) {
        const c = colors[ci];
        out[o++] =
          ((c >>> 16) & 0xff) |
          (c & 0xff00) |
          ((c & 0xff) << 16) |
          ((types[ci] | (charge[ci] !== 0 ? 0x80 : 0)) << 24);
      }
      if (rightStart < WIN_W) {
        const v = packCellValue(types, colors, charge, rowBase + WIDTH - 1);
        for (let i = rightStart; i < WIN_W; i++) out[o++] = v;
      }
    }
  }

  private uploadLight(light: LightField): void {
    const { lightR, lightG, lightB } = light;
    const out = this.lightData;
    const n = light.LW * light.LH;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      out[o] = lightR[i];
      out[o + 1] = lightG[i];
      out[o + 2] = lightB[i];
    }
    this.lightTex.needsUpdate = true;
  }

  private updateLut(materials: Record<number, MaterialParams>): void {
    const lut = this.lutData;
    for (let t = 0; t < 256; t++) {
      const m = materials[t];
      lut[t] = m?.bloomWeight !== undefined ? m.bloomWeight : 0;
    }
    this.lutTex.needsUpdate = true;
  }
}

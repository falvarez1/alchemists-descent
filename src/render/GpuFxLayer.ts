import * as THREE from 'three';

import { VIEW_H, VIEW_W } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { DARK_ADAPT, renderAmbient, VIGNETTE_BASE } from '@/render/lightingModel';
import { PIXEL_H, PIXEL_SCALE, PIXEL_W } from '@/render/presentation';
import type { ParticleSink } from '@/render/pixels';

/**
 * The GPU FX layer (WebGL GPU-compose frames only): a fine-resolution RGBA16F
 * target, the same size and orientation as the sprite overlay, that the
 * compose shader layers BETWEEN the terrain and the sprite overlay. Particles
 * were the first thing composeOverlays drew after falling water, under every
 * sprite, so that is exactly the draw order they keep.
 *
 * It follows the overlay's own combine rule: an opaque write (a = 1) replaces
 * the terrain under it — setPx semantics, the last write in list order wins
 * (a points draw call keeps primitive order) — and an additive write (a = 0)
 * adds light, addPx semantics.
 *
 * What moved to the GPU: the per-particle 2x2 fine-pixel writes, their dirty
 * tracking, the float->half conversion, the texture upload, and the
 * light-field sample for unlit motes (`Lighting.sample`, mirrored term for
 * term in the vertex shader from the same light texture the compose shader
 * reads). The CPU packs 16 bytes per visible particle.
 */

const S = PIXEL_SCALE;

const vertexShader = /* glsl */ `
precision highp float;
precision highp int;
// position.xy: particle position minus the render camera (cells). three's
// prefix declares \`position\` (vec3; the packed attribute has two components).
in vec4 aColor;  // rgb 0..1 (self-lit motes: pre-multiplied by glow); a = 1 -> light-sampled
uniform sampler2D uLight;
uniform float uAmbient;
uniform float uVignette;
uniform bool uDarkOn;
out vec3 vColor;

// core/darkness openAtCell, as ComposeShader's openAt: bilinear between the
// half-res texel centres around the cell's centre.
float openAt(int vx, int vy) {
  ivec2 hi = textureSize(uLight, 0) - ivec2(1);
  int x0 = (vx + 1) / 2 - 1;
  int y0 = (vy + 1) / 2 - 1;
  float tx = (vx & 1) == 1 ? 0.25 : 0.75;
  float ty = (vy & 1) == 1 ? 0.25 : 0.75;
  int xa = clamp(x0, 0, hi.x), xb = clamp(x0 + 1, 0, hi.x);
  int ya = clamp(y0, 0, hi.y), yb = clamp(y0 + 1, 0, hi.y);
  float top = mix(texelFetch(uLight, ivec2(xa, ya), 0).a, texelFetch(uLight, ivec2(xb, ya), 0).a, tx);
  float bot = mix(texelFetch(uLight, ivec2(xa, yb), 0).a, texelFetch(uLight, ivec2(xb, yb), 0).a, tx);
  return mix(top, bot, ty);
}

void main() {
  // setPx: Math.round(x) - renderCamX (the camera is integral).
  vec2 p = position.xy;
  int vx = int(floor(p.x + 0.5));
  int vy = int(floor(p.y + 0.5));
  vec3 rgb = aColor.rgb;
  if (aColor.a > 0.5) {
    // Lighting.sample: floor(x) - renderCamX, half-res texel, smooth darkness,
    // vignette rescaled by the live postFx.vignette, squared clamped law.
    int fx = int(floor(p.x));
    int fy = int(floor(p.y));
    vec3 L = vec3(0.0);
    ivec2 lsz = textureSize(uLight, 0);
    if (fx >= 0 && fy >= 0 && fx / 2 < lsz.x && fy / 2 < lsz.y) L = texelFetch(uLight, ivec2(fx / 2, fy / 2), 0).rgb;
    float open = uDarkOn ? openAt(fx, fy) : 1.0;
    float vg = 1.0;
    if (fx >= 0 && fx < ${VIEW_W} && fy >= 0 && fy < ${VIEW_H}) {
      float dx = float(fx) - ${(VIEW_W / 2).toFixed(1)};
      float dy = float(fy) - ${(VIEW_H / 2).toFixed(1)};
      float r2 = (dx * dx + dy * dy) / ${((VIEW_W / 2) ** 2 + (VIEW_H / 2) ** 2).toFixed(1)};
      vg = 1.0 - uVignette * r2;
    }
    float amb = uAmbient * open;
    float fl = 0.48 * vg * open;
    float adapt = ${DARK_ADAPT.toFixed(4)} * (1.0 - open);
    vec3 f = (vec3(amb) + min(vec3(2.2), L)) * vg;
    rgb *= max(vec3(fl), min(vec3(1.8), f * f + adapt * f));
  }
  vColor = rgb;
  // Cell (vx, vy) is the S x S fine block whose GL row counts from the bottom.
  float cx = (float(vx) + 0.5) * ${S.toFixed(1)};
  float cy = (float(${VIEW_H - 1} - vy) + 0.5) * ${S.toFixed(1)};
  gl_Position = vec4(cx * ${(2 / PIXEL_W).toFixed(8)} - 1.0, cy * ${(2 / PIXEL_H).toFixed(8)} - 1.0, 0.0, 1.0);
  gl_PointSize = ${S.toFixed(1)};
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
in vec3 vColor;
layout(location = 0) out highp vec4 fxColor;
void main() {
  fxColor = vec4(vColor, 1.0);
}
`;

export class GpuFxLayer implements ParticleSink {
  readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private capacity = 0;
  private pos = new Float32Array(0);
  private col = new Float32Array(0);
  private posAttr: THREE.BufferAttribute | null = null;
  private colAttr: THREE.BufferAttribute | null = null;
  private count = 0;
  /** The target holds last frame's content (so an empty frame must clear it). */
  private drawn = false;
  private readonly savedClear = new THREE.Color();

  constructor(private readonly renderer: THREE.WebGLRenderer, lightTex: THREE.Texture) {
    this.target = new THREE.WebGLRenderTarget(PIXEL_W, PIXEL_H, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        uLight: { value: lightTex },
        uAmbient: { value: 0 },
        uVignette: { value: VIGNETTE_BASE },
        uDarkOn: { value: false },
      },
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.ensureCapacity(4096);
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  /** True when this frame drew anything the compose shader must layer in. */
  get active(): boolean {
    return this.count > 0;
  }

  /** Start of a GPU-composed frame: nothing submitted yet. */
  beginFrame(): void {
    this.count = 0;
  }

  /**
   * Pack this frame's visible particles (FxSprites.drawParticles' job: the
   * same cull, colour and self-lit/light-sampled split). `offsetX/Y` is the
   * composer's sprite draw offset, which setPx would have added.
   */
  submitParticles(ctx: Ctx, offsetX = 0, offsetY = 0): void {
    const list = ctx.particles.list;
    this.ensureCapacity(list.length);
    const camX = ctx.camera.renderX, camY = ctx.camera.renderY;
    const pos = this.pos, col = this.col;
    let n = 0;
    for (let k = 0; k < list.length; k++) {
      const fp = list[k];
      const x = fp.x + offsetX, y = fp.y + offsetY;
      const vx = Math.round(x) - camX, vy = Math.round(y) - camY;
      if (vx < 0 || vx >= VIEW_W || vy < 0 || vy >= VIEW_H) continue;
      pos[n * 2] = x - camX;
      pos[n * 2 + 1] = y - camY;
      const c = fp.color, glow = fp.glow, o = n * 4;
      if (glow > 0) {
        col[o] = ((c >>> 16) & 0xff) / 255 * glow;
        col[o + 1] = ((c >>> 8) & 0xff) / 255 * glow;
        col[o + 2] = (c & 0xff) / 255 * glow;
        col[o + 3] = 0;
      } else {
        col[o] = ((c >>> 16) & 0xff) / 255;
        col[o + 1] = ((c >>> 8) & 0xff) / 255;
        col[o + 2] = (c & 0xff) / 255;
        col[o + 3] = 1;
      }
      n++;
    }
    this.count = n;
    const u = this.material.uniforms;
    u.uAmbient.value = renderAmbient(ctx);
    u.uVignette.value = ctx.state.postFx.vignette;
  }

  /** Darkness flag mirrors the compose shader's uDarkOn (openFlat skips the read). */
  setDarkOn(on: boolean): void {
    this.material.uniforms.uDarkOn.value = on;
  }

  /** Draw the submitted particles into the target (or clear it once when empty). */
  render(): void {
    if (this.count === 0 && !this.drawn) return;
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    renderer.getClearColor(this.savedClear);
    const previousAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    if (this.count > 0) {
      this.posAttr!.clearUpdateRanges();
      this.posAttr!.addUpdateRange(0, this.count * 2);
      this.posAttr!.needsUpdate = true;
      this.colAttr!.clearUpdateRanges();
      this.colAttr!.addUpdateRange(0, this.count * 4);
      this.colAttr!.needsUpdate = true;
      this.geometry.setDrawRange(0, this.count);
      renderer.render(this.scene, this.camera);
    }
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.savedClear, previousAlpha);
    this.drawn = this.count > 0;
  }

  dispose(): void {
    this.target.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    let cap = Math.max(4096, this.capacity);
    while (cap < n) cap *= 2;
    this.capacity = cap;
    this.pos = new Float32Array(cap * 2);
    this.col = new Float32Array(cap * 4);
    this.posAttr = new THREE.BufferAttribute(this.pos, 2).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aColor', this.colAttr);
    // three sizes a non-indexed draw from `position` (then clipped to the draw range).
  }
}

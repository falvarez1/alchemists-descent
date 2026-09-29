import * as THREE from 'three';

import { VIEW_H, VIEW_W } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { DARK_ADAPT, renderAmbient, VIGNETTE_BASE } from '@/render/lightingModel';
import { PIXEL_H, PIXEL_SCALE, PIXEL_W } from '@/render/presentation';
import type { OverlayCommandSink, ParticleSink } from '@/render/pixels';
import type { GpuSparkSim } from '@/render/GpuSparkSim';

/**
 * The GPU FX layer (WebGL GPU-compose frames): a fine-resolution RGBA16F
 * target, the size and orientation of the sprite overlay, that the compose
 * shader layers over the terrain. It holds premultiplied colour and COVERAGE:
 * the compose result is terrain * (1 - coverage) + rgb, so
 *
 *   replace (setPx / setFinePx)  = coverage 1
 *   add     (addPx / addFinePx)  = coverage 0
 *   blend   (blendFinePx, gel)   = coverage a
 *
 * and stacking writes is plain premultiplied alpha-over (ONE,
 * ONE_MINUS_SRC_ALPHA) on colour and coverage alike — the same algebra the
 * CPU overlay applied per pixel, in submission order (a draw call blends its
 * primitives in order).
 *
 * Two streams fill it:
 *
 *  - OVERLAY COMMANDS. Every sprite pixel the composer writes (FrameComposer's
 *    set/add/blend/blit writers) is appended here as one 20-byte record —
 *    fine-pixel index, rgb, coverage — instead of landing in the CPU float
 *    staging buffer that was then dirty-tracked, converted to half floats and
 *    uploaded as one bounding rectangle (up to the whole 1280x720 frame). The
 *    GPU scatters them as 1-pixel points.
 *  - PARTICLES. The ballistic particle list, packed 16 bytes per visible mote
 *    and drawn as cell-sized points; unlit motes sample the light field in the
 *    vertex shader (Lighting.sample, term for term, from the compose shader's
 *    own light texture).
 *
 * Particles were drawn right after falling water, before every other sprite,
 * so the command stream is split where they were submitted: commands before
 * the split, then the particles, then the rest — draw order is exact.
 */

const S = PIXEL_SCALE;

const particleVertex = /* glsl */ `
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

const particleFragment = /* glsl */ `
precision highp float;
in vec3 vColor;
layout(location = 0) out highp vec4 fxColor;
void main() {
  fxColor = vec4(vColor, 1.0); // setPx: opaque
}
`;

const commandVertex = /* glsl */ `
precision highp float;
precision highp int;
// position.x: the overlay pixel index, (PIXEL_H - 1 - row) * PIXEL_W + col —
// the CPU overlay's own layout (row 0 at the bottom, GL orientation).
in vec4 aColor;  // premultiplied rgb, coverage
out vec4 vColor;
void main() {
  int index = int(position.x);
  int row = index / ${PIXEL_W};
  int col = index - row * ${PIXEL_W};
  vColor = aColor;
  gl_Position = vec4((float(col) + 0.5) * ${(2 / PIXEL_W).toFixed(8)} - 1.0, (float(row) + 0.5) * ${(2 / PIXEL_H).toFixed(8)} - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;

const commandFragment = /* glsl */ `
precision highp float;
in vec4 vColor;
layout(location = 0) out highp vec4 fxColor;
void main() {
  fxColor = vColor;
}
`;

/** Premultiplied alpha-over on colour and coverage. */
function overBlending(material: THREE.ShaderMaterial): void {
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
}

/** A growable pair of dynamic vertex streams: `position` (itemSize n) + `aColor` (vec4). */
class PointStream {
  readonly geometry = new THREE.BufferGeometry();
  pos = new Float32Array(0);
  col = new Float32Array(0);
  capacity = 0;
  private posAttr: THREE.BufferAttribute | null = null;
  private colAttr: THREE.BufferAttribute | null = null;

  constructor(private readonly posSize: number, initial: number) {
    // A fixed bound: never culled, and three's draw-order sort must not walk
    // the (partly unused) position buffer to compute one.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.grow(initial);
  }

  grow(n: number): void {
    if (n <= this.capacity) return;
    let cap = Math.max(1024, this.capacity);
    while (cap < n) cap *= 2;
    const pos = new Float32Array(cap * this.posSize), col = new Float32Array(cap * 4);
    pos.set(this.pos); col.set(this.col);
    this.pos = pos; this.col = col; this.capacity = cap;
    // Replacing attributes must free the old GPU buffers (re-uploaded lazily).
    this.geometry.dispose();
    this.posAttr = new THREE.BufferAttribute(pos, this.posSize).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aColor', this.colAttr);
  }

  /** Stage the first `count` items for upload (once per frame). */
  upload(count: number): void {
    this.posAttr!.clearUpdateRanges();
    this.posAttr!.addUpdateRange(0, count * this.posSize);
    this.posAttr!.needsUpdate = true;
    this.colAttr!.clearUpdateRanges();
    this.colAttr!.addUpdateRange(0, count * 4);
    this.colAttr!.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

export class GpuFxLayer implements ParticleSink, OverlayCommandSink {
  readonly target: THREE.WebGLRenderTarget;
  /** False when the half-float target cannot be rendered to (compose keeps the CPU overlay). */
  readonly available: boolean;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly particleScene = new THREE.Scene();
  private readonly commandScene = new THREE.Scene();
  private readonly particleMaterial: THREE.ShaderMaterial;
  private readonly commandMaterial: THREE.ShaderMaterial;
  private readonly particles = new PointStream(2, 4096);
  private readonly commands = new PointStream(1, 65536);
  private particleCount = 0;
  private commandCount = 0;
  /** Commands issued before the particles were submitted (they draw first). */
  private commandSplit = 0;
  /** The target holds last frame's content (so an empty frame must clear it). */
  private drawn = false;
  private readonly savedClear = new THREE.Color();
  /** GPU sparks to draw this frame (null = none alive), with their draw inputs. */
  private sparks: GpuSparkSim | null = null;
  private sparkCamX = 0;
  private sparkCamY = 0;
  private sparkAmbient = 0;
  private sparkTick = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer, lightTex: THREE.Texture) {
    const ext = renderer.extensions;
    this.available = renderer.capabilities.isWebGL2 &&
      (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    this.target = new THREE.WebGLRenderTarget(PIXEL_W, PIXEL_H, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.particleMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: {
        uLight: { value: lightTex },
        uAmbient: { value: 0 },
        uVignette: { value: VIGNETTE_BASE },
        uDarkOn: { value: false },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.commandMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: commandVertex,
      fragmentShader: commandFragment,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    overBlending(this.particleMaterial);
    overBlending(this.commandMaterial);
    const particlePoints = new THREE.Points(this.particles.geometry, this.particleMaterial);
    particlePoints.frustumCulled = false;
    this.particleScene.add(particlePoints);
    const commandPoints = new THREE.Points(this.commands.geometry, this.commandMaterial);
    commandPoints.frustumCulled = false;
    this.commandScene.add(commandPoints);
  }

  /** True when this frame drew anything the compose shader must layer in. */
  get active(): boolean {
    return this.particleCount > 0 || this.commandCount > 0 || this.sparks !== null;
  }

  /** Draw these live sparks with the particles this frame (null: none). */
  setSparks(sim: GpuSparkSim | null, camX: number, camY: number, ambient: number, tick: number): void {
    this.sparks = sim;
    this.sparkCamX = camX; this.sparkCamY = camY; this.sparkAmbient = ambient; this.sparkTick = tick;
  }

  /** Start of a GPU-composed frame: nothing submitted yet. */
  beginFrame(): void {
    this.particleCount = 0;
    this.commandCount = 0;
    this.commandSplit = 0;
    this.sparks = null;
  }

  /** One overlay write (see the class comment for the coverage convention). */
  put(pixelIndex: number, r: number, g: number, b: number, coverage: number): void {
    const n = this.commandCount;
    if (n === this.commands.capacity) this.commands.grow(n + 1);
    this.commands.pos[n] = pixelIndex;
    const col = this.commands.col, o = n * 4;
    col[o] = r; col[o + 1] = g; col[o + 2] = b; col[o + 3] = coverage;
    this.commandCount = n + 1;
  }

  /**
   * Pack this frame's visible particles (FxSprites.drawParticles' job: the
   * same cull, colour and self-lit/light-sampled split). `offsetX/Y` is the
   * composer's sprite draw offset, which setPx would have added.
   */
  submitParticles(ctx: Ctx, offsetX = 0, offsetY = 0): void {
    this.commandSplit = this.commandCount;
    const list = ctx.particles.list;
    this.particles.grow(list.length);
    const camX = ctx.camera.renderX, camY = ctx.camera.renderY;
    const pos = this.particles.pos, col = this.particles.col;
    let n = 0;
    for (let k = 0; k < list.length; k++) {
      const fp = list[k];
      const x = fp.x + offsetX, y = fp.y + offsetY;
      const vx = Math.round(x) - camX, vy = Math.round(y) - camY;
      // Written as a positive test so a NaN position (which setPx silently
      // dropped: its pixel index was NaN) is culled here too.
      if (!(vx >= 0 && vx < VIEW_W && vy >= 0 && vy < VIEW_H)) continue;
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
    this.particleCount = n;
    const u = this.particleMaterial.uniforms;
    u.uAmbient.value = renderAmbient(ctx);
    u.uVignette.value = ctx.state.postFx.vignette;
  }

  /** Darkness flag mirrors the compose shader's uDarkOn (openFlat skips the read). */
  setDarkOn(on: boolean): void {
    this.particleMaterial.uniforms.uDarkOn.value = on;
  }

  /** Draw the frame's streams into the target (or clear it once when empty). */
  render(): void {
    if (!this.active && !this.drawn) return;
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.getClearColor(this.savedClear);
    const previousAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.autoClear = false;
    const nc = this.commandCount, split = this.commandSplit;
    if (nc > 0) this.commands.upload(nc);
    if (split > 0) this.drawCommands(0, split);
    if (this.particleCount > 0) {
      this.particles.upload(this.particleCount);
      this.particles.geometry.setDrawRange(0, this.particleCount);
      renderer.render(this.particleScene, this.camera);
    }
    // Sparks fly with the particles: over the terrain, under every sprite.
    if (this.sparks) this.sparks.draw(this.sparkCamX, this.sparkCamY, this.sparkAmbient, this.sparkTick);
    if (nc > split) this.drawCommands(split, nc - split);
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.savedClear, previousAlpha);
    this.drawn = this.active;
  }

  private drawCommands(start: number, count: number): void {
    this.commands.geometry.setDrawRange(start, count);
    this.renderer.render(this.commandScene, this.camera);
  }

  dispose(): void {
    this.target.dispose();
    this.particles.dispose();
    this.commands.dispose();
    this.particleMaterial.dispose();
    this.commandMaterial.dispose();
  }
}

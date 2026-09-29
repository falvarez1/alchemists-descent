import * as THREE from 'three';

import { VIEW_H, VIEW_W } from '@/config/constants';
import { Cell, blocksEntity, isLiquid } from '@/sim/CellType';
import { SPARK_QUEUE_MAX, SPARK_RECORD } from '@/particles/Sparks';
import { COMPOSE_PAD } from '@/render/lightingModel';
import { PIXEL_H, PIXEL_SCALE, PIXEL_W } from '@/render/presentation';

/**
 * GPU cosmetic sparks (see particles/Sparks). 65,536 slots live in two
 * ping-pong float render targets with two attachments each:
 *
 *   A = (x, y, vx, vy)                 world cells, cells per tick
 *   B = (life, lifeMax, kind + 4*glow100, colour 0xRRGGBB)
 *
 * One simulation pass per game tick (a frozen tick — hitstop, pause — freezes
 * them with everything else). New sparks land in a ring buffer through a small
 * spawn texture. Each step integrates gravity and drag per kind and collides
 * against the compose shader's own world window texture (RGBA8UI, type in the
 * low 7 bits of alpha): sparks bounce off solids and die in liquid. Drawn as
 * points into the GPU FX layer with the layer's premultiplied rule: additive
 * sparks and magic (coverage 0), opaque embers (coverage 1), smoke lit by the
 * light field and blended by its remaining life.
 */

const TEX = 256;
export const SPARK_SLOTS = TEX * TEX;
const SPAWN_W = 256;
const SPAWN_H = Math.ceil((SPARK_QUEUE_MAX * 2) / SPAWN_W);
const WIN_W = VIEW_W + 2 * COMPOSE_PAD;
const WIN_H = VIEW_H + 2 * COMPOSE_PAD;

function typeMask(pred: (t: number) => boolean): [number, number] {
  let lo = 0, hi = 0;
  for (let t = 0; t < 64; t++) {
    if (!pred(t)) continue;
    if (t < 32) lo |= 1 << t; else hi |= 1 << (t - 32);
  }
  return [lo >>> 0, hi >>> 0];
}
// Soft growth and gas are open air to a spark; rubble and powder are not.
const SOLID = typeMask((t) => blocksEntity(t) || t === Cell.Glass || t === Cell.Crystal);
const LIQUID = typeMask((t) => isLiquid(t));

const quadVertex = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const simFragment = /* glsl */ `
precision highp float;
precision highp int;
precision highp usampler2D;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uSpawn;
uniform int uSpawnStart;
uniform int uSpawnCount;
uniform usampler2D uWin;
uniform ivec2 uWinOrigin;
uniform uvec2 uSolid;
uniform uvec2 uLiquid;
uniform float uGrav[4];
uniform float uDrag[4];
uniform float uBounce[4];
layout(location = 0) out highp vec4 outA;
layout(location = 1) out highp vec4 outB;

bool inMask(uvec2 mask, uint t) {
  return t < 32u ? ((mask.x >> t) & 1u) != 0u : t < 64u ? ((mask.y >> (t - 32u)) & 1u) != 0u : false;
}
// -1 outside the window (no collision there), else the cell type.
int cellAt(vec2 p) {
  ivec2 c = ivec2(floor(p)) - uWinOrigin;
  if (c.x < 0 || c.y < 0 || c.x >= ${WIN_W} || c.y >= ${WIN_H}) return -1;
  return int(texelFetch(uWin, c, 0).a & 0x7fu);
}
bool solidAt(vec2 p) { int t = cellAt(p); return t >= 0 && inMask(uSolid, uint(t)); }

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int slot = px.y * ${TEX} + px.x;
  int k = slot - uSpawnStart;
  if (k < 0) k += ${SPARK_SLOTS};
  if (k < uSpawnCount) {
    int t0 = k * 2;
    vec4 r0 = texelFetch(uSpawn, ivec2(t0 % ${SPAWN_W}, t0 / ${SPAWN_W}), 0);
    vec4 r1 = texelFetch(uSpawn, ivec2((t0 + 1) % ${SPAWN_W}, (t0 + 1) / ${SPAWN_W}), 0);
    // record: x, y, vx, vy | life, kind, colour, glow
    outA = r0;
    outB = vec4(r1.x, r1.x, r1.y + 4.0 * floor(r1.w * 100.0 + 0.5), r1.z);
    return;
  }
  vec4 a = texelFetch(uA, px, 0);
  vec4 b = texelFetch(uB, px, 0);
  if (b.x <= 0.0) { outA = a; outB = vec4(0.0, b.yzw); return; }
  int kind = int(mod(b.z, 4.0));
  vec2 p = a.xy, v = a.zw;
  v.y += uGrav[kind];
  v *= 1.0 - uDrag[kind];
  vec2 np = p + v;
  float life = b.x - 1.0;
  int t = cellAt(np);
  if (t < 0 && (np.x < float(uWinOrigin.x) - 64.0 || np.y < float(uWinOrigin.y) - 64.0 ||
      np.x > float(uWinOrigin.x + ${WIN_W}) + 64.0 || np.y > float(uWinOrigin.y + ${WIN_H}) + 64.0)) life = 0.0;
  if (t >= 0 && inMask(uLiquid, uint(t)) && kind != 2) life = 0.0; // a spark hisses out in water
  else if (t >= 0 && inMask(uSolid, uint(t))) {
    float e = uBounce[kind];
    if (e <= 0.0) life = 0.0;
    bool hx = solidAt(vec2(p.x + v.x, p.y));
    bool hy = solidAt(vec2(p.x, p.y + v.y));
    if (hx) v.x = -v.x * e;
    if (hy) { v.y = -v.y * e; v.x *= 0.7; }
    if (!hx && !hy) v = -v * e;
    np = p;
  }
  outA = vec4(np, v);
  outB = vec4(life, b.yzw);
}
`;

const drawVertex = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uLight;
uniform ivec2 uCam;
uniform float uAmbient;
uniform float uTick;
out vec4 vColor;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

void main() {
  ivec2 px = ivec2(gl_VertexID % ${TEX}, gl_VertexID / ${TEX});
  vec4 b = texelFetch(uB, px, 0);
  gl_PointSize = 1.0;
  if (b.x <= 0.0) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); vColor = vec4(0.0); return; }
  vec4 a = texelFetch(uA, px, 0);
  int kind = int(mod(b.z, 4.0));
  float glow = floor(b.z / 4.0) / 100.0;
  float c = b.w;
  vec3 rgb = vec3(floor(c / 65536.0), mod(floor(c / 256.0), 256.0), mod(c, 256.0)) / 255.0;
  float f = clamp(b.x / max(1.0, b.y), 0.0, 1.0);
  float cover = 0.0;
  float size = 1.0;
  if (kind == 0) {          // spark: additive, cooling as it dies
    rgb *= glow * (0.35 + 0.65 * sqrt(f)) * 1.6;
  } else if (kind == 1) {   // ember: an opaque glowing mote that flickers
    rgb *= glow * (0.75 + 0.5 * hash(float(gl_VertexID) + floor(uTick * 0.25)));
    cover = 1.0; size = ${PIXEL_SCALE.toFixed(1)};
  } else if (kind == 2) {   // smoke: lit by the light field, thinning with age
    ivec2 v = ivec2(floor(a.xy)) - uCam;
    vec3 L = vec3(0.0);
    ivec2 lsz = textureSize(uLight, 0);
    if (v.x >= 0 && v.y >= 0 && v.x / 2 < lsz.x && v.y / 2 < lsz.y) L = texelFetch(uLight, ivec2(v.x / 2, v.y / 2), 0).rgb;
    vec3 lf = vec3(uAmbient) + min(vec3(2.2), L);
    cover = 0.42 * f;
    rgb *= clamp(lf * lf, vec3(0.06), vec3(1.6)) * cover;
    size = ${PIXEL_SCALE.toFixed(1)};
  } else {                  // magic: additive, twinkling
    rgb *= glow * (0.5 + 0.8 * hash(float(gl_VertexID) * 3.1 + uTick)) * f;
  }
  vColor = vec4(rgb, cover);
  gl_PointSize = size;
  vec2 fine = floor((a.xy - vec2(uCam)) * ${PIXEL_SCALE.toFixed(1)} + 0.5);
  if (size > 1.0) fine = floor(a.xy - vec2(uCam) + 0.5) * ${PIXEL_SCALE.toFixed(1)} + 0.5 * size - 0.5;
  // Fine pixel (fx, fy-from-top) -> GL clip (row 0 at the bottom).
  gl_Position = vec4((fine.x + 0.5) * ${(2 / PIXEL_W).toFixed(8)} - 1.0, (${PIXEL_H}.0 - fine.y - 0.5) * ${(2 / PIXEL_H).toFixed(8)} - 1.0, 0.0, 1.0);
}
`;

const drawFragment = /* glsl */ `
precision highp float;
in vec4 vColor;
layout(location = 0) out highp vec4 fxColor;
void main() { fxColor = vColor; }
`;

export class GpuSparkSim {
  /** False when float32 render targets are unavailable (sparks fall back to CPU particles). */
  readonly available: boolean;
  private readonly targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private current = 0;
  private readonly spawnData = new Float32Array(SPAWN_W * SPAWN_H * 4);
  private readonly spawnTex: THREE.DataTexture;
  private readonly simMaterial: THREE.ShaderMaterial;
  private readonly simScene = new THREE.Scene();
  private readonly drawMaterial: THREE.ShaderMaterial;
  private readonly drawScene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private head = 0;
  private pendingSpawn = 0;
  /** Ticks with no live spark left: the draw is skipped. */
  private liveUntilTick = -1;
  private lastTick = -1;

  constructor(private readonly renderer: THREE.WebGLRenderer, winTex: THREE.Texture, lightTex: THREE.Texture) {
    this.available = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
    const makeTarget = (): THREE.WebGLRenderTarget => new THREE.WebGLRenderTarget(TEX, TEX, {
      count: 2, type: THREE.FloatType, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    this.targets = [makeTarget(), makeTarget()];
    this.spawnTex = new THREE.DataTexture(this.spawnData, SPAWN_W, SPAWN_H, THREE.RGBAFormat, THREE.FloatType);
    this.spawnTex.minFilter = this.spawnTex.magFilter = THREE.NearestFilter;
    this.simMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: quadVertex,
      fragmentShader: simFragment,
      uniforms: {
        uA: { value: null }, uB: { value: null },
        uSpawn: { value: this.spawnTex }, uSpawnStart: { value: 0 }, uSpawnCount: { value: 0 },
        uWin: { value: winTex }, uWinOrigin: { value: new THREE.Vector2() },
        uSolid: { value: new THREE.Vector2(SOLID[0], SOLID[1]) },
        uLiquid: { value: new THREE.Vector2(LIQUID[0], LIQUID[1]) },
        // spark, ember, smoke, magic
        uGrav: { value: [0.14, -0.012, -0.018, 0.0] },
        uDrag: { value: [0.012, 0.03, 0.05, 0.06] },
        uBounce: { value: [0.42, 0.0, 0.05, 0.0] },
      },
      depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.simMaterial);
    quad.frustumCulled = false;
    this.simScene.add(quad);

    this.drawMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: drawVertex,
      fragmentShader: drawFragment,
      uniforms: {
        uA: { value: null }, uB: { value: null }, uLight: { value: lightTex },
        uCam: { value: new THREE.Vector2() }, uAmbient: { value: 0 }, uTick: { value: 0 },
      },
      depthTest: false, depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    // gl_VertexID drives the fetch; three still wants a sized position stream.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARK_SLOTS), 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const points = new THREE.Points(geometry, this.drawMaterial);
    points.frustumCulled = false;
    this.drawScene.add(points);
  }

  /** Queue this frame's spawn records into the spawn texture (consumed by the next step). */
  queue(records: Float32Array, count: number): void {
    const room = SPARK_QUEUE_MAX - this.pendingSpawn;
    const n = Math.min(count, room);
    if (n <= 0) return;
    // Record = 8 floats = 2 RGBA texels; the queue layout is the texture layout.
    this.spawnData.set(records.subarray(0, n * SPARK_RECORD), this.pendingSpawn * SPARK_RECORD);
    this.pendingSpawn += n;
  }

  /** True when a step is owed spawn records (the caller keeps them queued otherwise). */
  get hasRoom(): boolean {
    return this.pendingSpawn < SPARK_QUEUE_MAX;
  }

  /**
   * Advance the simulation to `tick` (one pass per elapsed game tick, at most
   * four — the fixed-step clock's own catch-up cap). Pending spawns enter on
   * the first pass.
   */
  step(tick: number, winOriginX: number, winOriginY: number): void {
    if (this.lastTick < 0) this.lastTick = tick;
    let steps = Math.min(4, Math.max(0, tick - this.lastTick));
    this.lastTick = tick;
    if (steps === 0) return;
    if (this.pendingSpawn === 0 && tick > this.liveUntilTick) return; // nothing alive, nothing new
    const u = this.simMaterial.uniforms;
    (u.uWinOrigin.value as THREE.Vector2).set(winOriginX, winOriginY);
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    while (steps-- > 0) {
      const src = this.targets[this.current], dst = this.targets[1 - this.current];
      u.uA.value = src.textures[0];
      u.uB.value = src.textures[1];
      if (this.pendingSpawn > 0) {
        this.spawnTex.needsUpdate = true;
        u.uSpawnStart.value = this.head;
        u.uSpawnCount.value = this.pendingSpawn;
        this.head = (this.head + this.pendingSpawn) % SPARK_SLOTS;
        // Longest possible life (records clamp to 1.3x the kind default ≤ 200).
        this.liveUntilTick = Math.max(this.liveUntilTick, tick + 400);
        this.pendingSpawn = 0;
      } else {
        u.uSpawnCount.value = 0;
      }
      renderer.setRenderTarget(dst);
      renderer.render(this.simScene, this.camera);
      this.current = 1 - this.current;
    }
    renderer.setRenderTarget(previousTarget);
  }

  /** True while any spark may be alive (the draw is worth issuing). */
  live(tick: number): boolean {
    return tick <= this.liveUntilTick;
  }

  /** Draw the live sparks into the currently bound FX target. */
  draw(camX: number, camY: number, ambient: number, tick: number): void {
    const u = this.drawMaterial.uniforms;
    const src = this.targets[this.current];
    u.uA.value = src.textures[0];
    u.uB.value = src.textures[1];
    (u.uCam.value as THREE.Vector2).set(camX, camY);
    u.uAmbient.value = ambient;
    u.uTick.value = tick;
    this.renderer.render(this.drawScene, this.camera);
  }

  /** Kill every spark (level change). */
  clear(): void {
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    for (const t of this.targets) {
      renderer.setRenderTarget(t);
      renderer.clear(true, false, false);
    }
    renderer.setRenderTarget(previousTarget);
    this.pendingSpawn = 0;
    this.liveUntilTick = -1;
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.spawnTex.dispose();
    this.simMaterial.dispose();
    this.drawMaterial.dispose();
  }
}

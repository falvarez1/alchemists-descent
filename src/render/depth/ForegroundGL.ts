import * as THREE from 'three';

import { VIEW_H, VIEW_W } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { PARTICLE_MARGIN, PARTICLE_SPAN_X, PARTICLE_SPAN_Y, particleSeeds } from '@/render/depth/depthParticles';
import { REVEAL_CELL } from '@/render/depth/reveal';
import type { DepthParticleField, ForegroundSource } from '@/render/pixels';

/**
 * The depth layers the WebGL backend draws over the composed frame, in order:
 *
 *   1. depth particles BEHIND the play layer — GL points blended with
 *      ONE_MINUS_DST_ALPHA, so they land only where the compose paths left
 *      the frame's alpha at 0 (open backdrop with no sprite on it);
 *   2. the foreground occluder plane — one quad, premultiplied-alpha over;
 *   3. depth particles IN FRONT (near motes) — additive points.
 *
 * All of it rides the compose quad's transform (sub-cell residual, shake,
 * zoom), so view cell v under a fragment is the cell the frame shows there.
 * Occluder plane texel = floor((renderCam + v + cam·(P − 1)) / scale) with the
 * continuous presentation camera, so the occluders glide at P×; their alpha
 * is coverage × opacity × the reveal field (render/depth/reveal). Points cost
 * a few hundred vertices; no sprite-overlay writes, so the GPU compose's
 * overlay upload stays as small as the sprites make it.
 */

const quadVertex = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const quadFragment = /* glsl */ `
precision highp float;
precision highp int;
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor

uniform sampler2D uFg;
uniform ivec2 uFgSize;
uniform sampler2D uReveal;
uniform vec2 uRevealSize;
uniform vec2 uRenderCam;
uniform vec2 uCam;
uniform float uParallax;
uniform float uScale;
uniform float uOpacity;
in vec2 vUv;

void main() {
  vec2 view = vec2(vUv.x * ${VIEW_W.toFixed(1)}, (1.0 - vUv.y) * ${VIEW_H.toFixed(1)});
  vec2 plane = uRenderCam + view + uCam * (uParallax - 1.0);
  ivec2 t = ivec2(floor(plane / uScale));
  if (t.x < 0 || t.y < 0 || t.x >= uFgSize.x || t.y >= uFgSize.y) discard;
  vec4 s = texelFetch(uFg, t, 0);
  if (s.a <= 0.0) discard;
  vec4 rv = texture(uReveal, (view / ${REVEAL_CELL.toFixed(1)} + 0.5) / uRevealSize);
  float a = s.a * uOpacity * rv.r;
  if (a <= 0.004) discard;
  // The rim's catch of the floor's light dims in designed darkness.
  vec3 col = s.rgb * (0.45 + 0.55 * rv.g);
  gl_FragColor = vec4(col * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const MAX_FIELDS = 4;

const pointVertex = /* glsl */ `
precision highp float;
in vec4 aSeed;   // u, v, phase, pace
in float aField;
uniform float uFrame;
uniform vec2 uRenderCam;
uniform vec2 uCam;
uniform float uZoom;
uniform float uPar[${MAX_FIELDS}];
uniform vec2 uDrift[${MAX_FIELDS}];
uniform float uSway[${MAX_FIELDS}];
uniform vec3 uColor[${MAX_FIELDS}];
uniform float uTwinkle[${MAX_FIELDS}];
uniform float uInShafts[${MAX_FIELDS}];
uniform float uLightMode[${MAX_FIELDS}];
uniform float uSize[${MAX_FIELDS}];
uniform sampler2D uReveal;
uniform vec2 uRevealSize;
uniform sampler2D uShaft;
uniform vec4 uShaftCfg; // parallax, scale, opacity, enabled
uniform ivec2 uShaftSize;
out vec3 vColor;

void main() {
  int f = int(aField + 0.5);
  float pace = aSeed.w, ph = aSeed.z;
  vec2 spanV = vec2(${PARTICLE_SPAN_X.toFixed(1)}, ${PARTICLE_SPAN_Y.toFixed(1)});
  vec2 p = aSeed.xy * spanV + uDrift[f] * uFrame * pace
    + vec2(sin(uFrame * 0.011 * pace + ph), cos(uFrame * 0.009 * pace + ph) * 0.5) * uSway[f];
  vec2 s = mod(p - uCam * uPar[f], spanV) - ${PARTICLE_MARGIN.toFixed(1)};
  // Texture-cell space of the compose quad (origin at the integer render camera).
  vec2 v = s + (uCam - uRenderCam);
  vColor = vec3(0.0);
  gl_PointSize = 0.0;
  gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  if (s.x < 0.0 || s.y < 0.0 || s.x >= ${VIEW_W.toFixed(1)} || s.y >= ${VIEW_H.toFixed(1)}) return;
  vec4 rv = texture(uReveal, (v / ${REVEAL_CELL.toFixed(1)} + 0.5) / uRevealSize);
  float level = rv.g * 1.4, open = rv.b;
  float k = uLightMode[f] > 0.5 ? 0.3 * open + level * 0.8 : open * open;
  k *= rv.a; // calm: no glints inside an optics zone (the Glass Galleries' puzzles)
  k *= 1.0 - uTwinkle[f] * 0.5 * (1.0 + sin(uFrame * 0.045 * pace + ph * 3.0));
  if (uShaftCfg.w > 0.5 && uInShafts[f] > 1.0) {
    // The shaft plane under this mote, as the compose draws it (parallax backdropOrigin).
    vec2 sp = floor((uCam * uShaftCfg.x + s) / uShaftCfg.y);
    ivec2 st = ivec2(mod(sp, vec2(uShaftSize)));
    float a = texelFetch(uShaft, st, 0).a * uShaftCfg.z;
    k *= 1.0 + (uInShafts[f] - 1.0) * min(1.0, a * 3.2);
  }
  if (k <= 0.02) return;
  vColor = uColor[f] * k;
  gl_PointSize = uSize[f] * uZoom;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(v.x / ${(VIEW_W / 2).toFixed(1)} - 1.0, 1.0 - v.y / ${(VIEW_H / 2).toFixed(1)}, 0.0, 1.0);
}
`;

const pointFragment = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
in vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function byteTexture(data: Uint8Array, w: number, h: number, filter: THREE.MagnificationTextureFilter): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = filter as THREE.MinificationTextureFilter;
  tex.magFilter = filter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** One pass of depth particles (behind or in front) as GL points. */
class ParticlePass {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private geometryVersion = -1;

  constructor(private readonly behind: boolean, reveal: THREE.DataTexture, revealSize: THREE.Vector2, shaft: THREE.DataTexture) {
    const zeros = (n: number): number[] => new Array<number>(n).fill(0);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: pointVertex,
      fragmentShader: pointFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      // Behind: add only where the frame's alpha is 0 (open backdrop, no sprite).
      blendSrc: behind ? THREE.OneMinusDstAlphaFactor : THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      uniforms: {
        uFrame: { value: 0 },
        uRenderCam: { value: new THREE.Vector2() },
        uCam: { value: new THREE.Vector2() },
        uZoom: { value: 1 },
        uPar: { value: zeros(MAX_FIELDS) },
        uDrift: { value: Array.from({ length: MAX_FIELDS }, () => new THREE.Vector2()) },
        uSway: { value: zeros(MAX_FIELDS) },
        uColor: { value: Array.from({ length: MAX_FIELDS }, () => new THREE.Vector3()) },
        uTwinkle: { value: zeros(MAX_FIELDS) },
        uInShafts: { value: zeros(MAX_FIELDS) },
        uLightMode: { value: zeros(MAX_FIELDS) },
        uSize: { value: zeros(MAX_FIELDS) },
        uReveal: { value: reveal },
        uRevealSize: { value: revealSize },
        uShaft: { value: shaft },
        uShaftCfg: { value: new THREE.Vector4() },
        uShaftSize: { value: new THREE.Vector2(1, 1) },
      },
    });
    this.material.toneMapped = true;
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.renderOrder = behind ? 5 : 15;
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** Rebuild the seed attributes when the kit's fields change. */
  private rebuild(fields: readonly DepthParticleField[], seed: number): void {
    const mine = fields.map((f, i) => ({ f, i })).filter(({ f }) => f.behind === this.behind).slice(0, MAX_FIELDS);
    const total = mine.reduce((n, { f }) => n + f.count, 0);
    const seeds = new Float32Array(total * 4), field = new Float32Array(total);
    let o = 0;
    mine.forEach(({ f, i }, slot) => {
      const salt = seed + i * 131;
      for (let k = 0; k < f.count; k++, o++) {
        const s = particleSeeds(k, salt);
        seeds.set(s, o * 4);
        field[o] = slot;
      }
      const u = this.material.uniforms;
      (u.uPar.value as number[])[slot] = f.parallax;
      (u.uDrift.value as THREE.Vector2[])[slot].set(f.drift[0], f.drift[1]);
      (u.uSway.value as number[])[slot] = f.sway;
      (u.uColor.value as THREE.Vector3[])[slot].set(f.color[0], f.color[1], f.color[2]);
      (u.uTwinkle.value as number[])[slot] = f.twinkle;
      (u.uInShafts.value as number[])[slot] = f.inShafts ?? 1;
      (u.uLightMode.value as number[])[slot] = f.light === 'light' ? 1 : 0;
      (u.uSize.value as number[])[slot] = f.size;
    });
    const geo = this.points.geometry;
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('aField', new THREE.BufferAttribute(field, 1));
    geo.setDrawRange(0, total);
    // Positions are computed in the vertex shader; three still wants a position attribute.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
  }

  update(ctx: Ctx, quad: THREE.Object3D, src: ForegroundSource, shaftSize: THREE.Vector2, shaftCfg: THREE.Vector4, on: boolean): void {
    const pf = src.particles;
    this.points.visible = on && pf.enabled && pf.fields.some((f) => f.behind === this.behind) && ctx.state.mode === 'play';
    if (!this.points.visible) return;
    if (this.geometryVersion !== pf.version) {
      this.geometryVersion = pf.version;
      this.rebuild(pf.fields, pf.seed);
    }
    this.points.position.copy(quad.position);
    this.points.scale.copy(quad.scale);
    const u = this.material.uniforms, cam = ctx.camera;
    u.uFrame.value = ctx.state.frameCount % 360000;
    (u.uRenderCam.value as THREE.Vector2).set(cam.renderX, cam.renderY);
    (u.uCam.value as THREE.Vector2).set(cam.presentationX ?? cam.x, cam.presentationY ?? cam.y);
    u.uZoom.value = cam.zoom;
    (u.uShaftSize.value as THREE.Vector2).copy(shaftSize);
    (u.uShaftCfg.value as THREE.Vector4).copy(shaftCfg);
  }

  dispose(): void {
    this.material.dispose();
    this.points.geometry.dispose();
  }
}

export class ForegroundLayerGL {
  /** Scene objects in draw order (behind particles, occluders, front particles). */
  readonly objects: THREE.Object3D[];
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private fgTex: THREE.DataTexture;
  private readonly revealTex: THREE.DataTexture;
  private shaftTex: THREE.DataTexture;
  private readonly shaftSize = new THREE.Vector2(1, 1);
  private readonly shaftCfg = new THREE.Vector4();
  private readonly behind: ParticlePass;
  private readonly front: ParticlePass;
  private fgVersion = -1;
  private revealVersion = -1;
  private particleVersion = -1;

  constructor(private readonly source: ForegroundSource) {
    this.fgTex = byteTexture(new Uint8Array(4), 1, 1, THREE.NearestFilter);
    this.shaftTex = byteTexture(new Uint8Array(4), 1, 1, THREE.NearestFilter);
    const reveal = source.reveal;
    this.revealTex = byteTexture(reveal.bytes, reveal.w, reveal.h, THREE.LinearFilter);
    const revealSize = new THREE.Vector2(reveal.w, reveal.h);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: quadVertex,
      fragmentShader: quadFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // Premultiplied over: the occluder covers; the frame's alpha is left alone.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      uniforms: {
        uFg: { value: this.fgTex },
        uFgSize: { value: new THREE.Vector2(1, 1) },
        uReveal: { value: this.revealTex },
        uRevealSize: { value: revealSize },
        uRenderCam: { value: new THREE.Vector2() },
        uCam: { value: new THREE.Vector2() },
        uParallax: { value: 1.4 },
        uScale: { value: 1.5 },
        uOpacity: { value: 0 },
      },
    });
    this.material.toneMapped = true;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.behind = new ParticlePass(true, this.revealTex, revealSize, this.shaftTex);
    this.front = new ParticlePass(false, this.revealTex, revealSize, this.shaftTex);
    this.objects = [this.behind.points, this.mesh, this.front.points];
  }

  /** Follow the compose quad and this frame's depth state (`particles` false: the composer draws them). */
  update(ctx: Ctx, quad: THREE.Object3D, particles = true): void {
    const src = this.source;
    if (this.revealVersion !== src.reveal.version) {
      this.revealVersion = src.reveal.version;
      this.revealTex.needsUpdate = true;
    }
    this.syncShaft();
    this.behind.update(ctx, quad, src, this.shaftSize, this.shaftCfg, particles);
    this.front.update(ctx, quad, src, this.shaftSize, this.shaftCfg, particles);
    const bmp = src.bitmap;
    this.mesh.visible = src.enabled && bmp !== null && src.opacity > 0;
    if (!this.mesh.visible || !bmp) return;
    this.mesh.position.copy(quad.position);
    this.mesh.scale.copy(quad.scale);
    const u = this.material.uniforms;
    if (this.fgVersion !== src.version) {
      this.fgVersion = src.version;
      this.fgTex.dispose();
      this.fgTex = byteTexture(new Uint8Array(bmp.pixels.buffer, bmp.pixels.byteOffset, bmp.pixels.byteLength),
        bmp.width, bmp.height, THREE.NearestFilter);
      u.uFg.value = this.fgTex;
      (u.uFgSize.value as THREE.Vector2).set(bmp.width, bmp.height);
    }
    const cam = ctx.camera;
    (u.uRenderCam.value as THREE.Vector2).set(cam.renderX, cam.renderY);
    (u.uCam.value as THREE.Vector2).set(cam.presentationX ?? cam.x, cam.presentationY ?? cam.y);
    u.uParallax.value = src.parallax;
    u.uScale.value = src.scale;
    u.uOpacity.value = src.opacity;
  }

  private syncShaft(): void {
    const pf = this.source.particles;
    if (this.particleVersion === pf.version) return;
    this.particleVersion = pf.version;
    const sh = pf.shaft;
    if (!sh) { this.shaftCfg.set(0, 1, 0, 0); return; }
    this.shaftTex.dispose();
    this.shaftTex = byteTexture(new Uint8Array(sh.bitmap.pixels.buffer, sh.bitmap.pixels.byteOffset, sh.bitmap.pixels.byteLength),
      sh.bitmap.width, sh.bitmap.height, THREE.NearestFilter);
    for (const pass of [this.behind, this.front]) {
      (pass.points.material as THREE.ShaderMaterial).uniforms.uShaft.value = this.shaftTex;
    }
    this.shaftSize.set(sh.bitmap.width, sh.bitmap.height);
    this.shaftCfg.set(sh.parallax, sh.scale, sh.opacity, 1);
  }

  /** Re-upload everything (after a lost/restored context). */
  invalidate(): void {
    this.fgVersion = -1;
    this.revealVersion = -1;
    this.particleVersion = -1;
  }

  dispose(): void {
    this.fgTex.dispose();
    this.revealTex.dispose();
    this.shaftTex.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.behind.dispose();
    this.front.dispose();
  }
}

import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import { RENDER_H, RENDER_W } from '@/config/constants';
import type { Ctx } from '@/core/types';
import { chillLens } from '@/render/chillLens';

/**
 * Final post-processing pass layered after bloom: chromatic aberration that
 * kicks with detonations, animated film grain, a gentle GPU vignette, and a
 * red low-health pulse. Tuned to stay subtle — the pixel art carries the look;
 * this pass adds the lens in front of it.
 */
const PostFxShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    /** Base + blast-kick chromatic aberration strength (uv offset at the rim). */
    uAberration: { value: 0.0005 },
    uGrain: { value: 0.028 },
    /** 0..1 — red edge pulse as the alchemist nears death. */
    uHurt: { value: 0 },
    /** 0..1 — the death grade: colour drains (reds hold), the vignette closes. */
    uDeath: { value: 0 },
    /** 0..1 — the chill's grade (render/chillLens): warmth and colour drain, the air goes blue. */
    uChill: { value: 0 },
    /** 0..1 — how far frost has grown in from the frame's edges. */
    uFrost: { value: 0 },
    /** Opacity ceiling of the frost (the play area must stay readable). */
    uFrostCap: { value: 0.55 },
    /** 1 = no sparkle at the frost's growing front (reduced flashes). */
    uCalm: { value: 0 },
    uRes: { value: [RENDER_W, RENDER_H] },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uHurt;
    uniform float uDeath;
    uniform float uChill;
    uniform float uFrost;
    uniform float uFrostCap;
    uniform float uCalm;
    uniform vec2 uRes;
    varying vec2 vUv;

    // Cheap animated hash noise for film grain.
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    // Value noise and its fractal sums, for the frost on the lens.
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int k = 0; k < 4; k++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 5.3); a *= 0.5; }
      return v;
    }
    // Ridged sum: thin bright veins where the noise crosses its middle —
    // warped and stretched, the branching needles of frost on a pane.
    float ridges(vec2 p) {
      float v = 0.0, a = 0.55;
      for (int k = 0; k < 4; k++) {
        float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
        v += a * n * n * n;
        p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(3.7, 9.1);
        a *= 0.55;
      }
      return v;
    }

    // A frond of frost: ridged veins stretched along one growth axis (a frame
    // edge's inward direction), warped so no two run straight.
    float frond(vec2 q, vec2 warp, vec2 dir) {
      vec2 b = q * 26.0 + warp * 2.2;
      return ridges(vec2(dot(b, dir), dot(b, vec2(-dir.y, dir.x)) * 2.4));
    }
    // Ice's own lattice: short needles on three fixed axes 60 degrees apart,
    // dashed at random along each lane — the barbs frost grows off its fronds.
    float barbs(vec2 q) {
      float b = 0.0;
      for (int k = 0; k < 3; k++) {
        float a = float(k) * 1.0472 + 0.26;
        vec2 d = vec2(cos(a), sin(a));
        vec2 p = q * 150.0;
        float across = dot(p, vec2(-d.y, d.x)), along = dot(p, d);
        float lane = floor(across);
        float line = 1.0 - smoothstep(0.12, 0.26, abs(fract(across) - 0.5));
        float seg = floor(along * 0.45 + hash(vec2(lane, float(k) * 7.0)) * 9.0);
        b = max(b, line * step(0.6, hash(vec2(seg + float(k) * 13.0, lane))));
      }
      return b;
    }

    // Distance (in frame heights) from a point to the frame's edge, rounded
    // into the corners (two edges' cold meet there, so frost reaches further).
    float edgeDist(vec2 uv, float aspect) {
      float ex = min(uv.x, 1.0 - uv.x) * aspect;
      float ey = min(uv.y, 1.0 - uv.y);
      float k = 0.06;
      return -k * log(exp(-ex / k) + exp(-ey / k));
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float r2 = dot(centered, centered);

      // Chromatic aberration: radial channel split, stronger toward the rim.
      vec2 shift = centered * r2 * uAberration * 40.0;
      float cr = texture2D(tDiffuse, vUv - shift).r;
      vec2 gb = texture2D(tDiffuse, vUv).gb;
      float cb = texture2D(tDiffuse, vUv + shift).b;
      vec3 col = vec3(cr, gb.x, cb);

      // Animated film grain (luma-preserving, centered around 0).
      // (No GPU vignette: the CPU light field already vignettes the frame —
      // doubling it crushed the screen edges into black.)
      float g = hash(vUv * vec2(1050.0, 714.0) + mod(uTime, 64.0) * 17.0) - 0.5;
      col += g * uGrain * (0.4 + 0.6 * clamp(1.0 - dot(col, vec3(0.333)), 0.0, 1.0));

      // Low-health pulse: red bleed creeping in from the edges.
      if (uHurt > 0.001) {
        float edge = smoothstep(0.18, 0.55, r2);
        float pulse = 0.75 + 0.25 * sin(uTime * 0.12);
        col = mix(col, vec3(0.45, 0.02, 0.04), uHurt * edge * pulse * 0.6);
      }

      // Death grade: the world drains to a cold grey — blood keeps its red —
      // and the dark closes in from the edges around the body.
      if (uDeath > 0.001) {
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        float red = clamp((col.r - max(col.g, col.b)) * 3.0, 0.0, 1.0);
        vec3 grey = vec3(lum) * vec3(0.93, 0.97, 1.06);
        col = mix(col, grey, uDeath * 0.88 * (1.0 - red * 0.8));
        float vig = smoothstep(0.06, 0.42, r2);
        col *= 1.0 - vig * uDeath * 0.72;
      }

      // THE CHILL (render/chillLens; docs/FEEL.md "The chill"): the body's
      // perception of the cold, never the world's colours — the frame drains
      // toward a cold blue-grey and the air in the shadows goes blue.
      if (uChill > 0.001) {
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 cold = vec3(lum) * vec3(0.84, 0.97, 1.2);
        col = mix(col, cold, uChill * 0.52);
        col *= mix(vec3(1.0), vec3(0.88, 0.97, 1.1), uChill);
        col += vec3(0.004, 0.012, 0.03) * uChill * (1.0 - clamp(lum * 2.0, 0.0, 1.0));
      }

      // Frost on the eyes: it grows in from the frame's edges along a ragged
      // front, milky where it has been longest (at the rim), a lace of
      // branching needles where it is still growing; behind it the view blurs
      // like frosted glass. The middle of the frame is never touched (a safe
      // ellipse), the reach tops out at a fifth of the frame's height, and
      // the opacity is capped (the play area stays readable).
      if (uFrost > 0.001) {
        float aspect = uRes.x / uRes.y;
        vec2 px = floor(vUv * uRes);
        vec2 uvp = (px + 0.5) / uRes;
        vec2 q = vec2(uvp.x * aspect, uvp.y);
        float reach = uFrost * 0.2;
        float dPix = edgeDist(uvp, aspect);
        float safe = smoothstep(1.0, 1.2, length((uvp - 0.5) / vec2(0.38, 0.33)));
        if (dPix < reach * 1.3 + 0.01 && safe > 0.0) {
          // The ragged front: the cold has got further in some places than others.
          float front = reach * (0.55 + 0.75 * fbm(q * 7.0 + 3.0)) - dPix;
          if (front > 0.0) {
            float age = clamp(front / max(0.02, reach * 0.55), 0.0, 1.0);
            float ex = min(uvp.x, 1.0 - uvp.x) * aspect, ey = min(uvp.y, 1.0 - uvp.y);
            // Fronds grow inward from the nearest edge: one set for the side
            // edges, one for top and bottom, cross-faded where they meet.
            vec2 warp = vec2(fbm(q * 6.0), fbm(q * 6.0 + 11.0)) - 0.5;
            float fr = mix(frond(q, warp, vec2(0.0, 1.0)), frond(q, warp, vec2(1.0, 0.0)), smoothstep(-0.04, 0.04, ey - ex));
            float needle = max(smoothstep(0.42, 0.78, fr), barbs(q + warp * 0.01) * smoothstep(0.26, 0.5, fr) * 0.85);
            float milk = age * age * (0.55 + 0.45 * fbm(q * 22.0));
            float frost = clamp(milk * 0.8 + needle * (0.9 - 0.5 * age) + (hash(px) - 0.5) * 0.1 * age, 0.0, 1.0);
            frost *= safe * smoothstep(0.0, 0.004, front);
            if (frost > 0.002) {
              // Frosted glass: what is behind it, softened.
              vec2 t = 2.5 / uRes;
              vec3 blur = (texture2D(tDiffuse, vUv + vec2(t.x, t.y)).rgb + texture2D(tDiffuse, vUv - vec2(t.x, t.y)).rgb
                + texture2D(tDiffuse, vUv + vec2(t.x, -t.y)).rgb + texture2D(tDiffuse, vUv - vec2(t.x, -t.y)).rgb) * 0.25;
              float bl = dot(blur, vec3(0.299, 0.587, 0.114));
              vec3 ice = mix(blur * vec3(0.9, 1.0, 1.12) + vec3(0.03, 0.045, 0.06), vec3(0.72, 0.84, 0.95), 0.35 + 0.35 * max(needle, age));
              // A few needles at the front catch the light as they form.
              if (uCalm < 0.5 && age < 0.25 && needle > 0.6 && hash(px + floor(uTime / 7.0)) > 0.985) ice = vec3(0.92, 0.97, 1.0);
              col = mix(col, ice, frost * uFrostCap * (0.75 + 0.25 * bl));
            }
          }
        }
      }

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFx {
  readonly pass: ShaderPass;

  constructor() {
    this.pass = new ShaderPass(PostFxShader);
  }

  update(ctx: Ctx): void {
    const u = this.pass.uniforms;
    const post = ctx.state.postFx;
    u.uTime.value = ctx.state.frameCount;
    // Detonations split the lens for a few frames (bloomKick already decays).
    u.uAberration.value =
      post.aberration + ctx.fx.bloomKick * post.aberrationKick + ctx.fx.screenShake * post.shakeAberration;
    u.uGrain.value = post.grain;
    // Creeps in below 35% HP; full pulse near death. Zero outside play mode.
    const hurt =
      ctx.state.mode === 'play' && !ctx.player.dead
        ? Math.max(0, 0.35 - ctx.player.hp / ctx.player.maxHp) / 0.35
        : 0;
    u.uHurt.value = hurt * post.hurtPulse;
    const t = ctx.state.mode === 'play' && ctx.player.dead ? ctx.fx.deathTime ?? 0 : 0;
    const d = Math.max(0, Math.min(1, (t - 0.1) / 2.4));
    u.uDeath.value = d * d * (3 - 2 * d);
    const lens = chillLens(ctx);
    u.uChill.value = lens.grade;
    u.uFrost.value = lens.frost;
    u.uFrostCap.value = lens.cap;
    u.uCalm.value = lens.calm ? 1 : 0;
  }

  dispose(): void {
    this.pass.dispose();
  }
}

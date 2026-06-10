import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import type { Ctx } from '@/core/types';

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
    uAberration: { value: 0.0012 },
    uGrain: { value: 0.045 },
    uVignette: { value: 0.16 },
    /** 0..1 — red edge pulse as the alchemist nears death. */
    uHurt: { value: 0 },
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
    uniform float uVignette;
    uniform float uHurt;
    varying vec2 vUv;

    // Cheap animated hash noise for film grain.
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
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
      float g = hash(vUv * vec2(1050.0, 714.0) + mod(uTime, 64.0) * 17.0) - 0.5;
      col += g * uGrain * (0.4 + 0.6 * clamp(1.0 - dot(col, vec3(0.333)), 0.0, 1.0));

      // Gentle vignette on top of the CPU-side one (composite depth).
      col *= 1.0 - uVignette * smoothstep(0.15, 0.65, r2);

      // Low-health pulse: red bleed creeping in from the edges.
      if (uHurt > 0.001) {
        float edge = smoothstep(0.18, 0.55, r2);
        float pulse = 0.75 + 0.25 * sin(uTime * 0.12);
        col = mix(col, vec3(0.45, 0.02, 0.04), uHurt * edge * pulse * 0.6);
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
    u.uTime.value = ctx.state.frameCount;
    // Detonations split the lens for a few frames (bloomKick already decays).
    u.uAberration.value = 0.0012 + ctx.fx.bloomKick * 0.006 + ctx.fx.screenShake * 0.05;
    // Creeps in below 35% HP; full pulse near death. Zero outside play mode.
    const hurt =
      ctx.state.mode === 'play' && !ctx.player.dead
        ? Math.max(0, 0.35 - ctx.player.hp / ctx.player.maxHp) / 0.35
        : 0;
    u.uHurt.value = hurt;
  }
}

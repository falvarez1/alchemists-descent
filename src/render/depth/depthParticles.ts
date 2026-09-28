import { VIEW_H, VIEW_W } from '@/config/constants';
import type { DepthKit, DepthParticleSpec } from '@/config/depthKits';
import type { Ctx } from '@/core/types';
import type { DepthParticlePass, LightField, PixelSurface } from '@/render/pixels';
import { backdropOrigin, backdropTexel, particleScreen } from '@/render/depth/parallax';
import { hash2, type Bitmap } from '@/render/depth/raster';
import { Cell } from '@/sim/CellType';

/**
 * Depth particles: dust, spores, bubbles, embers and ash at several depths,
 * each field moving with its own plane's parallax. Stateless — a particle's
 * position is a pure function of its seeds, the tick and the camera — so they
 * cost nothing to keep and never desync. They wrap within a screen-sized
 * span around the plane's camera, so the count per screen is constant.
 *
 * Behind-the-play-layer fields show only over open air (terrain and sprites
 * hide them) and dim with the designed darkness but ignore the lantern; near
 * fields catch real light (motes glint in the lantern's cone). Inside the
 * kit's light shafts the far motes brighten: dust drifting in the beams.
 *
 * The WebGL backend draws these as GL points (render/depth/ForegroundGL, the
 * same math in GLSL); this module is the reference and the path for backends
 * without it (WebGPU, tests), drawing through the sprite surface.
 */

export const PARTICLE_MARGIN = 24;
export const PARTICLE_SPAN_X = VIEW_W + PARTICLE_MARGIN * 2;
export const PARTICLE_SPAN_Y = VIEW_H + PARTICLE_MARGIN * 2;

/** A particle's fixed seeds: [u, v, phase, pace] (GL vertex attribute layout). */
export function particleSeeds(i: number, salt: number): [number, number, number, number] {
  return [hash2(i, salt, 11), hash2(i, salt, 23), hash2(i, salt, 37) * Math.PI * 2, 0.6 + 0.8 * hash2(i, salt, 41)];
}

/** Screen position (view cells from the continuous camera) of particle `i` at tick `t`. */
export function particlePosition(spec: DepthParticleSpec, seeds: readonly number[], t: number, camX: number, camY: number): [number, number] {
  const [u, v, ph, pace] = seeds;
  const px = u * PARTICLE_SPAN_X + spec.drift[0] * t * pace + Math.sin(t * 0.011 * pace + ph) * spec.sway;
  const py = v * PARTICLE_SPAN_Y + spec.drift[1] * t * pace + Math.cos(t * 0.009 * pace + ph) * spec.sway * 0.5;
  return [particleScreen(px, camX, spec.parallax, PARTICLE_SPAN_X, PARTICLE_MARGIN),
    particleScreen(py, camY, spec.parallax, PARTICLE_SPAN_Y, PARTICLE_MARGIN)];
}

/** The light-shaft plane the motes glint in (alpha only is read). */
export interface ShaftPlane {
  readonly bitmap: Bitmap;
  readonly parallax: number;
  readonly scale: number;
  readonly opacity: number;
}

/** The shaft plane's alpha at view position (vx, vy), sampled as the compositors draw it. */
function shaftAlpha(sh: ShaftPlane, camX: number, camY: number, presX: number, presY: number, vx: number, vy: number): number {
  const b = sh.bitmap;
  const sx = backdropTexel(backdropOrigin(camX, presX, sh.parallax), vx, sh.scale, 0, b.width);
  const sy = backdropTexel(backdropOrigin(camY, presY, sh.parallax), vy, sh.scale, 0, b.height);
  return (b.pixels[(sy * b.width + sx) * 4 + 3] / 255) * sh.opacity;
}

function drawField(out: PixelSurface, light: LightField, ctx: Ctx, spec: DepthParticleSpec, salt: number, shafts: ShaftPlane | null,
  calmAt: ((vx: number, vy: number) => number) | null): void {
  const t = ctx.state.frameCount % 360000;
  const camX = ctx.camera.renderX, camY = ctx.camera.renderY;
  const presX = ctx.camera.presentationX ?? camX, presY = ctx.camera.presentationY ?? camY;
  const world = ctx.world;
  const add = spec.size < 3 && out.addFinePx ? out.addFinePx.bind(out) : out.addPx.bind(out);
  for (let i = 0; i < spec.count; i++) {
    const seeds = particleSeeds(i, salt);
    const [sx, sy] = particlePosition(spec, seeds, t, presX, presY);
    if (sx < 0 || sy < 0 || sx >= VIEW_W || sy >= VIEW_H) continue;
    const wx = presX + sx, wy = presY + sy;
    const cx = Math.floor(wx), cy = Math.floor(wy);
    if (!world.inBounds(cx, cy)) continue;
    if (spec.behind && world.types[cx + cy * world.width] !== Cell.Empty) continue;
    const s = light.sample(wx, wy);
    const open = s.open ?? 1;
    let k = spec.light === 'open'
      ? open * open
      : 0.3 * open + Math.min(1.4, Math.max(s.r, s.g, s.b)) * 0.8;
    k *= 1 - spec.twinkle * 0.5 * (1 + Math.sin(t * 0.045 * seeds[3] + seeds[2] * 3));
    const vx = wx - camX, vy = wy - camY;
    if (shafts && spec.inShafts && spec.inShafts > 1) k *= 1 + (spec.inShafts - 1) * Math.min(1, shaftAlpha(shafts, camX, camY, presX, presY, vx, vy) * 3.2);
    if (calmAt) k *= calmAt(vx, vy);
    if (k <= 0.02) continue;
    add(wx, wy, spec.color[0] * k, spec.color[1] * k, spec.color[2] * k);
  }
}

/** Draw a kit's particle fields for one pass (behind the sprites, or in front of everything). */
export function drawDepthParticles(out: PixelSurface, light: LightField, ctx: Ctx, kit: DepthKit, pass: DepthParticlePass,
  shafts: ShaftPlane | null, calmAt: ((vx: number, vy: number) => number) | null = null): void {
  if (ctx.state.mode !== 'play') return;
  for (let k = 0; k < kit.particles.length; k++) {
    const spec = kit.particles[k];
    if ((pass === 'behind') !== spec.behind) continue;
    drawField(out, light, ctx, spec, kit.seed + k * 131, shafts, calmAt);
  }
}

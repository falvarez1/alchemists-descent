import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { BRASS, BRASS_D, INK, Pen, cameraView } from '@/render/sprites/FineArt';
import type { RGB } from '@/render/sprites/FineArt';
import { TUNING, cloudBox } from '@/fighters/kits/nox-calder-math';
import { Cell } from '@/sim/CellType';

/**
 * Nox Calder's pixels (presentation only: the smoke is real cells, the silhouettes are the shared reveal
 * ring plus a faint fill, the dark is the level's own bake). Four drawables, all pure functions of a small
 * view the kit keeps:
 *
 *  - the Blackglass canister in flight: a dark glass flask with a brass stopper, spinning, lit by the scene;
 *  - the smoke's veil: the sim draws a gas as a stipple you can see straight through, so a cloud of it reads as a
 *    mist; the veil lays a dim alpha-over on every Smoke cell of Nox's own clouds so it reads as the dense,
 *    vision-blocking thing it is (a foe standing in it is dimmed, and Soot Sight is what finds it again);
 *  - the Soot Sight pulse: a faint ring that goes out from her when the sense comes on, and the silhouettes
 *    it finds (a pale fill in the body's own ellipse, additive, so it reads in the dark and not in the lit);
 *  - the Long Night's dusk: an inky disc that closes outward from her ahead of the dark, with a clear hole
 *    around her so she is never lost in it.
 */

// ======================================================================== the canister

export interface CanisterView {
  live: boolean;
  x: number;
  y: number;
  /** Spin, radians. */
  angle: number;
  /** Ticks in flight (the fuse's tell: the stopper blinks as it runs down). */
  age: number;
}

export function newCanisterView(): CanisterView {
  return { live: false, x: 0, y: 0, angle: 0, age: 0 };
}

const GLASS: RGB = [0.13, 0.17, 0.25];
const GLASS_HI: RGB = [0.55, 0.68, 0.88];
const SOOT_INK: RGB = [0.03, 0.04, 0.06];

export function drawCanister(out: PixelSurface, field: LightField, ctx: Ctx, v: CanisterView): void {
  if (!v.live) return;
  const lit = field.sample(v.x, v.y);
  // Never lost in the dark: a thrown thing reads in the lantern's light and a little beyond it.
  const k = (n: number): number => Math.min(1.05, Math.max(0.6, n));
  const pen = new Pen(out, cameraView(ctx.camera, 12), [k(lit.r), k(lit.g), k(lit.b)]);
  if (!pen.inView(v.x - 6, v.y - 6, v.x + 6, v.y + 6)) return;
  const a = v.angle;
  const ax = Math.sin(a), ay = -Math.cos(a); // the bottle's neck axis
  pen.oval(v.x, v.y, 2.3, 3.2, GLASS, a, SOOT_INK, pen.step);
  // the neck and the brass stopper
  pen.line(v.x + ax * 2.6, v.y + ay * 2.6, v.x + ax * 4.2, v.y + ay * 4.2, GLASS, 1.2);
  pen.box(v.x + ax * 4.8, v.y + ay * 4.8, 1.4, 0.9, a, BRASS_D, INK);
  // a glint that stays upper-left (it belongs to the lamp, not to the spin)
  pen.raw(v.x - 1, v.y - 1.4, GLASS_HI, 0.95);
  pen.raw(v.x - 0.5, v.y - 1.9, GLASS_HI, 0.55);
  // the stopper blinks faster as the fuse runs down
  const left = TUNING.glass.fuse - v.age;
  const calm = ctx.state.reduceFlashes === true;
  const blink = !calm && left < 18 && ((ctx.state.frameCount >> (left < 8 ? 1 : 2)) & 1) === 1;
  if (blink) pen.glow(v.x + ax * 4.8, v.y + ay * 4.8, BRASS, 1.1);
}

// ======================================================================== Soot Sight

export interface SootView {
  /** The pulse ring: radius in cells (0 = none) and brightness. */
  r: number;
  k: number;
  /** The foes the sense is showing, refreshed by the kit: body centre, half width, height, and brightness. */
  foes: Array<{ x: number; y: number; halfW: number; h: number; k: number; phase: number }>;
  count: number;
}

export function newSootView(): SootView {
  return { r: 0, k: 0, foes: [], count: 0 };
}

export function drawSoot(out: PixelSurface, _field: LightField, ctx: Ctx, v: SootView): void {
  const px = out.addFinePx ?? out.addPx;
  const step = Math.max(out.pixelStep ?? 1, 0.5);
  const frame = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;
  const [cr, cg, cb] = TUNING.soot.rgb;
  const p = ctx.player;

  // ---- the pulse ----
  if (v.k > 0.01 && v.r > 1 && !p.dead) {
    const cx = p.x, cy = p.y - (p.crawling ? 4 : 9);
    const n = Math.max(48, Math.round(v.r * 3.4));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // The ring is a chase of brighter and dimmer arcs, so it reads as a wave through the dark, not a drawn circle.
      const gate = 0.5 + 0.5 * Math.cos(a * 9 - v.r * 0.25);
      const k = v.k * (0.35 + 0.65 * gate) * 0.55;
      px.call(out, cx + Math.cos(a) * v.r, cy + Math.sin(a) * v.r, cr * k, cg * k, cb * k);
      px.call(out, cx + Math.cos(a) * (v.r - step), cy + Math.sin(a) * (v.r - step), cr * k * 0.5, cg * k * 0.5, cb * k * 0.5);
    }
  }

  // ---- the silhouettes: a faint pale body-shape, dithered, breathing ----
  for (let f = 0; f < v.count; f++) {
    const s = v.foes[f];
    const rx = s.halfW + 1, ry = s.h * 0.5 + 1;
    const cx = s.x, cy = s.y - s.h * 0.5;
    const breathe = calm ? 0.85 : 0.8 + 0.2 * Math.sin(frame * 0.09 + s.phase * 6);
    for (let dy = -ry; dy <= ry; dy += step) {
      for (let dx = -rx; dx <= rx; dx += step) {
        const d2 = (dx / rx) * (dx / rx) + (dy / ry) * (dy / ry);
        if (d2 > 1) continue;
        // a checker dither: half the fine pixels, so it is a veil and not a block
        if ((((Math.floor(dx / step) + Math.floor(dy / step)) & 1) === 0)) continue;
        const k = 0.22 * s.k * breathe * (0.45 + 0.55 * (1 - d2));
        px.call(out, cx + dx, cy + dy, cr * k, cg * k, cb * k);
      }
    }
  }
}

// ======================================================================== Long Night

export interface DuskView {
  /** The dark front: 0..1 how far out it has gone (0 = none), and 0..1 how dark it is. */
  reach: number;
  dark: number;
}

export function newDuskView(): DuskView {
  return { reach: 0, dark: 0 };
}

/** The dusk's travelling edge: how thick it is, and how far a soft gradient trails inside it. */
const FRONT = 5;
const TRAIL = 12;

/**
 * The dusk: a ring of near-black (alpha-over, so it really darkens the frame) that travels outward from her
 * while the lamps go out, its leading edge crisp and a soft gradient trailing behind it, the edge wobbling a
 * little so it is ink and not a ruled circle. It is only ever the lead-in: the level's own dark takes over
 * where it ends. (A filled veil was tried and rejected: at the cost of a full disc a step coarser than the
 * world's grain it dithers.)
 */
export function drawDusk(out: PixelSurface, _field: LightField, ctx: Ctx, v: DuskView): void {
  const blend = out.blendFinePx;
  const p = ctx.player;
  if (!blend || v.dark <= 0.01 || v.reach <= 0.01 || p.dead) return;
  const step = Math.max(out.pixelStep ?? 1, 0.5);
  const cx = p.x, cy = p.y - 9;
  const R = TUNING.night.ringReach * v.reach;
  const view = cameraView(ctx.camera, 0);
  const frame = ctx.state.frameCount;
  const n = Math.ceil((Math.PI * 2 * R) / step);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const edge = R * (1 + 0.04 * Math.sin(a * 5 + frame * 0.06) + 0.025 * Math.sin(a * 11 - frame * 0.1));
    // skip the arc of the ring that is off screen
    const ex = cx + ca * edge, ey = cy + sa * edge;
    if (ex < view.x0 - TRAIL || ex > view.x1 + TRAIL || ey < view.y0 - TRAIL || ey > view.y1 + TRAIL) continue;
    for (let u = -FRONT; u <= TRAIL; u += step) {
      // u > 0 is inside the front, u < 0 outside it
      const r = edge - u;
      if (r < 6) break;
      const k = u < 0 ? 1 - (-u) / FRONT : 1 - u / TRAIL;
      const alpha = v.dark * 0.8 * k * k;
      if (alpha <= 0.01) continue;
      const x = cx + ca * r, y = cy + sa * r;
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      blend.call(out, x, y, 0.01 * alpha, 0.012 * alpha, 0.02 * alpha, alpha);
    }
  }
}

// ======================================================================== the smoke's veil

export interface VeilCloud {
  x: number;
  y: number;
  born: number;
}

/** How much of the light a cell of Blackglass takes out of what is behind it. */
const VEIL = 0.5;

/**
 * An alpha-over dim on every Smoke cell inside the live clouds' boxes (the cells are the cloud; the box only says
 * where to look), at the surface's own fine grain so it has no seams. Nothing here reads or writes anything but the
 * grid's types.
 */
export function drawVeil(out: PixelSurface, _field: LightField, ctx: Ctx, clouds: readonly VeilCloud[]): void {
  const blend = out.blendFinePx;
  if (!blend || clouds.length === 0) return;
  const w = ctx.world;
  const view = cameraView(ctx.camera, 0);
  const step = Math.max(out.pixelStep ?? 1, 0.5);
  const sub = Math.max(1, Math.round(1 / step));
  const frame = ctx.state.frameCount;
  for (const c of clouds) {
    const box = cloudBox(c.x, c.y, frame - c.born);
    const x0 = Math.max(Math.floor(view.x0), box.x0), x1 = Math.min(Math.ceil(view.x1), box.x1);
    const y0 = Math.max(Math.floor(view.y0), box.y0), y1 = Math.min(Math.ceil(view.y1), box.y1);
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= w.height) continue;
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= w.width || w.types[x + y * w.width] !== Cell.Smoke) continue;
        // a little deterministic grain, so the cloud has body and is not a flat tint
        const a = VEIL * (0.78 + 0.22 * ((((x * 73856093) ^ (y * 19349663)) & 7) / 7));
        for (let sy = 0; sy < sub; sy++) {
          for (let sx = 0; sx < sub; sx++) blend.call(out, x + sx * step + step * 0.5, y + sy * step + step * 0.5, 0.01 * a, 0.012 * a, 0.02 * a, a);
        }
      }
    }
  }
}

import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { hash2 } from '@/fighters/kits/father-thorne-grow';

/**
 * Father Thorne's drawn tells (nothing here is a cell; the vines, roots and moss are the real grid):
 *
 *  - LEAF MOTES while Rooted Camouflage is working: a few leaves that let go of nowhere in particular and
 *    turn slowly down past her, more of them the further the ramp has come. Pure functions of the frame and
 *    her position (no random stream: the same frame draws the same leaves, paused or not).
 *  - THE ZONE'S EDGE for the Overgrowth: a ring of green motes that sweeps out with the growth and then holds a
 *    faint dotted line at the zone's limit (the slow and the cover end there), thinning and flickering over the
 *    last second so the end is seen coming.
 */

export interface ZoneView {
  cx: number;
  cy: number;
  r: number;
  /** 0..1 how far the wave of growth has come. */
  grow: number;
  /** 1 .. 0 how much of the effect is left. */
  left: number;
}

/** A flash of green where she cast: drawn, not lit (an authored light would show her to every foe: see the kit). */
export interface Flare {
  x: number;
  y: number;
  born: number;
  r: number;
}

export const FLARE_TICKS = 16;

export interface ThorneView {
  /** Rooted Camouflage's ramp, 0..1. */
  camo: number;
  zone: ZoneView | null;
  flares: Flare[];
}

export const MOTES = 7;

type Put = (this: PixelSurface, wx: number, wy: number, r: number, g: number, b: number) => void;

/** Where mote `i` is at `frame`, and how bright it is (0..1): a leaf falling past her head to her feet and swaying as it goes. */
export function motePose(i: number, frame: number, px: number, py: number): { x: number; y: number; a: number } {
  const life = 90 + hash2(i, 1) * 60;
  const u = ((frame + hash2(i, 2) * life) % life) / life;
  const sway = Math.sin(u * Math.PI * 3 + hash2(i, 4) * 6.28) * 3;
  return {
    x: px + (hash2(i, 3) * 2 - 1) * 11 + sway,
    y: py - 27 + u * 29,
    a: Math.sin(u * Math.PI),
  };
}

export function drawThorneFx(out: PixelSurface, _field: LightField, ctx: Ctx, v: ThorneView): void {
  const add: Put = (out.addFinePx ?? out.addPx) as Put;
  const step = out.pixelStep ?? 1;
  const frame = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;

  // ---- leaf motes about her
  if (v.camo > 0.02 && !ctx.player.dead) {
    const p = ctx.player;
    const n = Math.max(1, Math.ceil(v.camo * MOTES));
    for (let i = 0; i < n; i++) {
      const m = motePose(i, frame, p.x, p.y);
      const k = m.a * (0.35 + 0.65 * v.camo) * (0.75 + 0.25 * hash2(i, 9));
      const warm = hash2(i, 5) < 0.3; // now and then an autumn leaf
      // a leaf: two cells on a lean
      for (let s = 0; s < 1; s += step) {
        add.call(out, m.x + s, m.y, (warm ? 0.9 : 0.42) * k, (warm ? 0.62 : 0.88) * k, (warm ? 0.18 : 0.3) * k);
        add.call(out, m.x + 1 + s, m.y + 0.6, (warm ? 0.7 : 0.3) * k, (warm ? 0.5 : 0.7) * k, (warm ? 0.14 : 0.22) * k);
      }
    }
  }

  // ---- the flash of a cast
  for (const f of v.flares) {
    const age = frame - f.born;
    if (age < 0 || age >= FLARE_TICKS) continue;
    const k = 1 - age / FLARE_TICKS;
    const r = f.r * (0.35 + 0.65 * (age / FLARE_TICKS));
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + age * 0.15;
      add.call(out, f.x + Math.cos(a) * r, f.y + Math.sin(a) * r * 0.8, 0.3 * k, 0.9 * k, 0.4 * k);
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add.call(out, f.x + dx, f.y + dy, 0.25 * k, 0.8 * k, 0.35 * k);
  }

  // ---- the zone's edge
  const z = v.zone;
  if (z) {
    const r = z.r * Math.min(1, z.grow);
    const sweeping = z.grow < 1;
    // dotted: a mote every ~4 cells of the arc, drifting round slowly; the sweep is brighter and denser
    const dots = Math.max(24, Math.round((Math.PI * 2 * r) / (sweeping ? 2.2 : 4.2)));
    const end = z.left < 0.125 ? (calm ? 0.5 : 0.35 + 0.65 * Math.abs(Math.sin(frame * 0.35))) * (z.left / 0.125) : 1;
    const base = (sweeping ? 0.5 : 0.16) * end;
    const drift = frame * 0.004;
    for (let i = 0; i < dots; i++) {
      const a = (i / dots) * Math.PI * 2 + drift;
      const gate = 0.55 + 0.45 * Math.sin(i * 1.7 + frame * (calm ? 0 : 0.05));
      const k = base * gate;
      if (k < 0.01) continue;
      add.call(out, z.cx + Math.cos(a) * r, z.cy + Math.sin(a) * r, 0.3 * k, 0.95 * k, 0.4 * k);
    }
  }
}

import type { Ctx, Enemy } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { blocksEntity } from '@/sim/CellType';
import {
  ARM_LEN, BELL_ROWS, CHAIN_LEN, POST_H, PURPLE, TUNING, bellVisibility, ringAge, rippleShape, waveRadius,
} from '@/fighters/kits/mara-quell-logic';
import type { Bell, RippleBook } from '@/fighters/kits/mara-quell-logic';

/**
 * Everything Mara Quell draws: the ripples of Keen Resonance, the brass bells and the pulse they ring,
 * the Dead Chime's wave and the tolls it leaves on the foes it slowed. Pure functions of the frame and
 * the kit's state: no randomness (a render-time draw would desync a replay), only a hash of the
 * coordinates, so a paused frame is the same frame every time.
 *
 * The rings are ADDITIVE fine pixels on the 'over' layer, drawn after the light, so they read through
 * rock and through darkness; the bell's body is lit like any prop on the 'under' layer.
 */

type Put = (this: PixelSurface, wx: number, wy: number, r: number, g: number, b: number) => void;

function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const TAU = Math.PI * 2;

/** One additive ring (an ellipse when rx != ry) of fine pixels, thickened over `thick` fine steps, with an optional per-angle gate. */
function ring(
  out: PixelSurface, add: Put, step: number,
  cx: number, cy: number, rx: number, ry: number,
  r: number, g: number, b: number, thick = 1,
  gate?: (angle: number) => number,
): void {
  const n = Math.max(12, Math.ceil((TAU * Math.max(rx, ry)) / step));
  for (let k = 0; k < thick; k++) {
    const grow = k * step;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const m = gate ? gate(a) : 1;
      if (m <= 0.01) continue;
      add.call(out, cx + Math.cos(a) * (rx + grow), cy + Math.sin(a) * (ry + grow), r * m, g * m, b * m);
    }
  }
}

// ----------------------------------------------------------------------------------- Keen Resonance

/** The faint ripples at the feet of foes she can hear and cannot see. */
export function drawRipples(out: PixelSurface, ctx: Ctx, book: RippleBook): void {
  const add = (out.addFinePx ?? out.addPx) as Put;
  const step = out.pixelStep ?? 1;
  const now = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;
  for (const rp of book.list) {
    const s = rippleShape(rp, now);
    if (!s) continue;
    const k = 1.4 * s.a;
    const gate = (a: number): number => (calm ? 1 : 0.62 + 0.38 * Math.cos(a * 5 + now * 0.12 + rp.born));
    ring(out, add, step, rp.x, rp.y + 0.5, s.rx, s.ry, PURPLE[0] * k, PURPLE[1] * k, PURPLE[2] * k, 2, gate);
    // The echo inside: a second, tighter ring a beat behind, so a footfall reads as a sound and not an outline.
    if (s.rx > 5) ring(out, add, step, rp.x, rp.y + 0.5, s.rx * 0.58, s.ry * 0.58, PURPLE[0] * k * 0.55, PURPLE[1] * k * 0.55, PURPLE[2] * k * 0.55, 1, gate);
  }
}

// ---------------------------------------------------------------------------------- Resonance Bell

const IRON = [0.3, 0.29, 0.32] as const;
const IRON_HI = [0.5, 0.48, 0.53] as const;
const BRASS_HI = [0.98, 0.78, 0.36] as const;
const BRASS = [0.72, 0.5, 0.17] as const;
const BRASS_LO = [0.36, 0.23, 0.08] as const;
const LIP = [1.0, 0.9, 0.52] as const;

/** Half-width of the bell's body on each of its 9 rows: the crown, the shoulders, the waist, the flare, the lip, the clapper. */
const HALF = [0, 1, 1, 2, 2, 2, 3, 3, 0] as const;

function fillCell(out: PixelSurface, put: Put, step: number, cx: number, cy: number, r: number, g: number, b: number): void {
  for (let fy = 0; fy < 1; fy += step) {
    for (let fx = 0; fx < 1; fx += step) put.call(out, cx + fx + step * 0.5, cy + fy + step * 0.5, r, g, b);
  }
}

/** How far the bell swings, in cells at its lip: a decaying ring after it is struck, a breath of sway while it listens. */
function swingOf(bell: Bell, now: number, calm: boolean): number {
  const age = ringAge(bell, now);
  if (age >= 0 && age < 70) return (calm ? 0.5 : 1) * Math.sin(age * 0.55) * Math.exp(-age / 17) * 3.2;
  if (now < bell.armedAt) return Math.sin((now - bell.born) * 0.5) * Math.exp(-(now - bell.born) / 8) * 2;
  return calm ? 0 : Math.sin(now * 0.04 + bell.id * 1.7) * 0.7;
}

function solidAt(ctx: Ctx, x: number, y: number): boolean {
  const w = ctx.world;
  return !w.inBounds(x, y) || blocksEntity(w.types[w.idx(x, y)]);
}

/** The bells' bodies: a bracket post or a chain, and the brass hanging from it, lit like any prop. */
export function drawBellBodies(out: PixelSurface, field: LightField, ctx: Ctx, bells: readonly Bell[]): void {
  const put = (out.setFinePx ?? out.setPx) as Put;
  const add = (out.addFinePx ?? out.addPx) as Put;
  const step = out.pixelStep ?? 1;
  const now = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;
  for (const bell of bells) {
    const vis = bellVisibility(bell, now);
    if (vis <= 0.01) continue;
    const listening = bell.retiredAt < 0 && now >= bell.armedAt && now >= bell.rearmAt;
    const age = ringAge(bell, now);
    const swing = swingOf(bell, now, calm);

    // A cell of iron or brass: dissolved out dither by dither as the bell is retired, lit by the level's light.
    const cell = (x: number, y: number, c: readonly number[], glow = 0): void => {
      if (vis < 0.999 && hash(x, y + bell.id * 31) > vis) return;
      const lt = field.sample(x, y);
      fillCell(out, put, step, x, y, c[0] * lt.r * 0.92 + glow * 0.5, c[1] * lt.g * 0.92 + glow * 0.28, c[2] * lt.b * 0.92 + glow * 0.95);
    };

    // ---- the mounting ----
    if (bell.mode === 'post') {
      const s = bell.side;
      for (let dx = -1; dx <= 1; dx++) if (!solidAt(ctx, bell.x + dx, bell.y)) cell(bell.x + dx, bell.y, dx === 0 ? IRON_HI : IRON); // the foot plate
      for (let h = 1; h <= POST_H; h++) cell(bell.x, bell.y - h, h % 5 === 0 ? IRON_HI : IRON); // the post, with a band every few cells
      for (let k = 1; k <= ARM_LEN; k++) cell(bell.x + s * k, bell.y - POST_H, k === ARM_LEN ? IRON_HI : IRON); // the arm
      cell(bell.x + s, bell.y - POST_H + 2, IRON); // the brace
      cell(bell.x + 2 * s, bell.y - POST_H + 1, IRON);
      cell(bell.cx, bell.top - 1, IRON_HI); // the hook
    } else {
      for (let dx = -1; dx <= 1; dx++) if (!solidAt(ctx, bell.x + dx, bell.y)) cell(bell.x + dx, bell.y, dx === 0 ? IRON_HI : IRON); // the ceiling plate
      for (let k = 1; k <= CHAIN_LEN; k++) cell(bell.x, bell.y + k, k % 2 ? IRON_HI : IRON); // the chain
    }

    // ---- the bell ----
    const lipGlow = listening ? 0.16 + (calm ? 0 : 0.05 * Math.sin(now * 0.09 + bell.id)) : 0;
    const struck = age >= 0 && age < 12 ? 1 - age / 12 : 0;
    for (let r = 0; r < BELL_ROWS; r++) {
      const y = bell.top + r;
      const sh = Math.round(swing * ((r + 1) / BELL_ROWS));
      const half = HALF[r];
      if (r === BELL_ROWS - 1) {
        // the clapper hangs a little behind the swing
        cell(bell.cx - Math.round(swing * 0.4), y, IRON_HI, struck * 0.6);
        continue;
      }
      for (let dx = -half; dx <= half; dx++) {
        const t = half === 0 ? 0.5 : (dx + half) / (2 * half);
        let col: readonly number[] = t < 0.34 ? BRASS_HI : t > 0.67 ? BRASS_LO : BRASS;
        if (r === 0) col = IRON_HI;
        else if (r === 7) col = t > 0.8 ? BRASS : LIP; // the lip: the bright rim, shadowed at its far end
        else if (r >= 3 && r <= 5 && dx === -1) col = BRASS_HI; // a stripe of light down the waist
        const glow = r === 7 ? lipGlow + struck * 0.9 : struck * 0.35;
        const dim = listening || bell.retiredAt >= 0 ? 1 : 0.8; // a bell that has rung is dull until it listens again
        cell(bell.cx + dx + sh, y, [col[0] * dim, col[1] * dim, col[2] * dim], glow);
      }
    }

    // ---- the glint when it begins to listen again ----
    const since = now - bell.rearmAt;
    if (bell.retiredAt < 0 && since >= 0 && since < 12 && bell.rungAt > 0) {
      const k = 0.9 * (1 - since / 12);
      const lx = bell.cx + 3, ly = bell.top + 7;
      for (let i = -3; i <= 3; i++) {
        add.call(out, lx + i * 0.8, ly + 0.5, PURPLE[0] * k * (1 - Math.abs(i) / 4), PURPLE[1] * k * (1 - Math.abs(i) / 4), PURPLE[2] * k * (1 - Math.abs(i) / 4));
        add.call(out, lx + 0.5, ly + i * 0.8, PURPLE[0] * k * (1 - Math.abs(i) / 4), PURPLE[1] * k * (1 - Math.abs(i) / 4), PURPLE[2] * k * (1 - Math.abs(i) / 4));
      }
    }
  }
}

/** The ring a bell sends out when it rings: out to the reach of its reveal, so the player SEES how far it listened. */
export function drawBellRings(out: PixelSurface, ctx: Ctx, bells: readonly Bell[]): void {
  const add = (out.addFinePx ?? out.addPx) as Put;
  const step = out.pixelStep ?? 1;
  const now = ctx.state.frameCount;
  const B = TUNING.bell;
  const calm = ctx.state.reduceFlashes === true;
  for (const bell of bells) {
    const age = ringAge(bell, now);
    if (age < 0 || age > B.ringTicks + 6) continue;
    const x = bell.cx + 0.5, y = bell.cy + 0.5;
    // The strike: a flash of violet round the bell for the first few ticks.
    if (age < 6 && !calm) {
      const k = 0.7 * (1 - age / 6);
      ring(out, add, step, x, y, 3 + age, 3 + age, PURPLE[0] * k, PURPLE[1] * k, PURPLE[2] * k, 3);
    }
    for (let e = 0; e < 3; e++) {
      const a = age - e * 4;
      if (a < 0 || a > B.ringTicks) continue;
      const u = a / B.ringTicks;
      const r = 4 + (B.revealRadius - 4) * (1 - Math.pow(1 - u, 2.2));
      const k = (e === 0 ? 0.8 : 0.4 / e) * Math.pow(1 - u, 1.3);
      const gate = (an: number): number => (calm ? 1 : 0.7 + 0.3 * Math.cos(an * 8 + a * 0.4));
      ring(out, add, step, x, y, r, r, PURPLE[0] * k, PURPLE[1] * k, PURPLE[2] * k, e === 0 ? 2 : 1, gate);
    }
  }
}

// ----------------------------------------------------------------------------------------- Dead Chime

export interface ChimeWave {
  x: number;
  y: number;
  born: number;
}

/** How long the wave stays drawn: its growth, then a short fade, so the end is seen. */
export const WAVE_SHOWN = TUNING.chime.expandTicks + 12;

/** The wave: a bright leading ring with two fading echoes behind it, over rock and dark alike. */
export function drawWave(out: PixelSurface, ctx: Ctx, w: ChimeWave): void {
  const add = (out.addFinePx ?? out.addPx) as Put;
  const step = out.pixelStep ?? 1;
  const now = ctx.state.frameCount;
  const C = TUNING.chime;
  const calm = ctx.state.reduceFlashes === true;
  const elapsed = now - w.born;
  if (elapsed < 0 || elapsed > WAVE_SHOWN) return;
  const grow = Math.min(1, elapsed / C.expandTicks);
  // Full strength while it travels, fading through its last ticks.
  const env = elapsed <= C.expandTicks ? 1 - 0.35 * grow : 0.65 * (1 - (elapsed - C.expandTicks) / 12);
  const x = w.x + 0.5, y = w.y + 0.5;
  const r = waveRadius(elapsed + 1);
  // The strike: a flash at her chest.
  if (elapsed < 7 && !calm) {
    const k = 0.95 * (1 - elapsed / 7);
    ring(out, add, step, x, y, 2 + elapsed * 1.5, 2 + elapsed * 1.5, 0.9 * k, 0.75 * k, 1.0 * k, 4);
  }
  const shimmer = (a: number): number => (calm ? 1 : 0.78 + 0.22 * Math.cos(a * 11 + elapsed * 0.8));
  // The echoes first (behind), then the leading ring on top.
  ring(out, add, step, x, y, r * 0.66, r * 0.66, PURPLE[0] * 0.2 * env, PURPLE[1] * 0.2 * env, PURPLE[2] * 0.2 * env, 1, shimmer);
  ring(out, add, step, x, y, r * 0.83, r * 0.83, PURPLE[0] * 0.36 * env, PURPLE[1] * 0.36 * env, PURPLE[2] * 0.36 * env, 2, shimmer);
  ring(out, add, step, x, y, r, r, 0.62 * env, 0.42 * env, 0.95 * env, 3, shimmer);
  ring(out, add, step, x, y, Math.max(0, r - step), Math.max(0, r - step), 0.55 * env, 0.5 * env, 0.6 * env, 1);
}

export interface Tolled {
  e: Enemy;
  slowUntil: number;
  stunUntil: number;
}

/** The mark the chime leaves on a foe: a slow violet ring at its feet while it is slowed, and stars orbiting a stunned caster's head. */
export function drawTolled(out: PixelSurface, ctx: Ctx, list: readonly Tolled[]): void {
  const add = (out.addFinePx ?? out.addPx) as Put;
  const step = out.pixelStep ?? 1;
  const now = ctx.state.frameCount;
  const defs = ctx.enemyCtl.defs;
  const calm = ctx.state.reduceFlashes === true;
  for (const t of list) {
    const e = t.e;
    const def = defs[e.kind];
    if (!def || e.hp <= 0) continue;
    if (now < t.slowUntil) {
      const fade = Math.min(1, (t.slowUntil - now) / 40);
      const beat = calm ? 0 : Math.sin(now * 0.1 + e.bobPhase * 4);
      const rx = def.halfW + 3 + beat * 1.5;
      const k = 0.5 * fade;
      ring(out, add, step, e.x, e.y + 0.5, rx, rx * 0.34, PURPLE[0] * k, PURPLE[1] * k, PURPLE[2] * k, 1, (a) => (calm ? 1 : 0.55 + 0.45 * Math.cos(a * 3 - now * 0.07)));
      // Motes drift up out of it, slowly: the foe is wading through sound.
      for (let m = 0; m < 3; m++) {
        const ph = (now * 0.35 + m * 9 + hash(e.bobPhase * 100 | 0, m) * 12) % 18;
        const mx = e.x + (hash(m, (e.bobPhase * 100) | 0) * 2 - 1) * def.halfW;
        const a = k * 1.4 * (1 - ph / 18);
        add.call(out, mx, e.y - ph, PURPLE[0] * a, PURPLE[1] * a, PURPLE[2] * a);
      }
    }
    if (now < t.stunUntil) {
      const fade = Math.min(1, (t.stunUntil - now) / 20);
      const hy = e.y - def.h - 5;
      for (let s = 0; s < 3; s++) {
        const ang = now * 0.13 + s * (TAU / 3);
        const sx = e.x + Math.cos(ang) * (def.halfW + 2), sy = hy + Math.sin(ang) * 2;
        const a = 0.85 * fade * (0.75 + 0.25 * Math.sin(now * 0.3 + s));
        add.call(out, sx, sy, 0.95 * a, 0.8 * a, 1.0 * a);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) add.call(out, sx + dx * step * 1.5, sy + dy * step * 1.5, PURPLE[0] * a * 0.6, PURPLE[1] * a * 0.6, PURPLE[2] * a * 0.6);
      }
    }
  }
}

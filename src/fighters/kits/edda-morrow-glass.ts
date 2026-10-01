import type { Ctx } from '@/core/types';
import { TUNING, fragmentOffset } from '@/fighters/kits/edda-morrow-logic';
import type { WindowLook } from '@/fighters/kits/edda-morrow-logic';
import type { LightField, PixelSurface } from '@/render/pixels';
import { INK, Pen, cameraView } from '@/render/sprites/FineArt';
import type { RGB, ViewRect } from '@/render/sprites/FineArt';

/**
 * Edda Morrow's glass, drawn (presentation only: what the shard and the window DO is in edda-morrow.ts
 * and edda-morrow-logic.ts). Three things:
 *
 *  - the Mercy Shard: a faceted shard of blue-white glass with gold edges, a halo and a short tail of
 *    glints, flying out and settling into an orbit (its position is the kit's, this only draws it);
 *  - Stored Light's shimmer: a few gold motes turning about her while she carries overshield;
 *  - the Rose Window: a round stained-glass window standing at her feet, eight sectors of coloured panes
 *    in two rings between gold tracery, a gold hub with a gem, a gold frame; the glass is lit from behind
 *    (it keeps its colour in the dark) and throws a soft prismatic wash on what is around it. It unfolds,
 *    carries a dotted ring at the healing radius and a pulse of light that crosses it, flares where a shot
 *    was turned, dims, cracks, and at the end its eight panes and its hub fly apart and fall.
 */

export const GOLD: RGB = [0.92, 0.77, 0.42];
const GOLD_L: RGB = [1.0, 0.93, 0.68];
const PALE: RGB = [0.82, 0.93, 1.0];
const HALO: RGB = [0.62, 0.8, 1.0];

/** The panes: ruby, sapphire, amber, emerald, violet, rose, cyan, pale gold. */
export const PANES: readonly RGB[] = [
  [0.92, 0.16, 0.22], [0.2, 0.38, 1.0], [1.0, 0.72, 0.18], [0.14, 0.8, 0.42],
  [0.68, 0.28, 0.94], [1.0, 0.46, 0.64], [0.24, 0.84, 0.92], [1.0, 0.92, 0.56],
];

const hex = (c: RGB): number => (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
/** The panes as packed colours, for the sparks and motes the kit throws. */
export const PANE_HEX: readonly number[] = PANES.map(hex);
export const GOLD_HEX: readonly number[] = [0xffe9a8, 0xffc050, 0xffffff, 0xf2c968];
export const GLASS_HEX: readonly number[] = [0xd8eeff, 0xa8d0ff, 0xffffff, 0x7fb4ff];

const TAU = Math.PI * 2;
const QUARTER = Math.PI / 4;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function hash2(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ====================================================================================== the shard

export interface ShardView {
  on: boolean;
  x: number;
  y: number;
  rot: number;
  /** 0 just sent .. 1 settled (the orbit's ellipse shows as it settles). */
  settle: number;
  /** 1 .. 0: it took a blow (a flare). */
  flash: number;
  /** Brightness, 1 steady .. 0 gone (it dissolves over its last ticks). */
  k: number;
  /** Blinking: it is about to go. */
  warn: boolean;
  /** Where it has been, newest first, x then y. */
  trail: number[];
  /** The ellipse's centre (the chest of the one it protects). */
  cx: number;
  cy: number;
}

export const SHARD_TRAIL = 9;

export function newShardView(): ShardView {
  return { on: false, x: 0, y: 0, rot: 0, settle: 0, flash: 0, k: 1, warn: false, trail: [], cx: 0, cy: 0 };
}

// A tall kite, point up, in cells; its facets meet at C.
const TIP: readonly [number, number] = [0, -5];
const SHR: readonly [number, number] = [1.9, -1.2];
const BOT: readonly [number, number] = [0.4, 4.2];
const LOW: readonly [number, number] = [-1.5, 1.6];
const SHL: readonly [number, number] = [-1.3, -2.2];
const CORE: readonly [number, number] = [0.1, 0.4];

/**
 * Is the shard on the far side of its orbit (the upper half of the ellipse: behind the one it guards)? It is drawn
 * under the fighter there and over her on the near side, so it goes round her instead of across her face. Out on
 * its flight it is always in front.
 */
export const shardBehind = (v: ShardView): boolean => v.settle >= 0.5 && v.y < v.cy - 0.5;

/** `behind` is which of the two passes this is (the kit adds one drawable on each layer); the shard is drawn only on its own side. */
export function drawShard(out: PixelSurface, field: LightField, ctx: Ctx, v: ShardView, behind: boolean): void {
  if (!v.on || ctx.player.dead || v.k <= 0.02 || shardBehind(v) !== behind) return;
  const sample = field.sample(v.x, v.y);
  // Held in her lantern's light but never lost in the dark, and never brighter than the sprite itself.
  const lit = (k: number): number => Math.min(1.08, Math.max(0.74, k));
  const pen = new Pen(out, cameraView(ctx.camera, 20), [lit(sample.r), lit(sample.g), lit(sample.b)]);
  if (!pen.inView(v.x - 14, v.y - 14, v.x + 14, v.y + 14)) return;
  const s = pen.step;
  const frame = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;
  const blink = v.warn && !calm && ((frame >> 2) & 1) === 1;
  const k = v.k * (blink ? 0.5 : 1);

  // Its orbit, faintly, once it has settled: the path it keeps.
  if (v.settle > 0.6) {
    const a = 0.1 * (v.settle - 0.6) / 0.4 * k;
    const n = 44;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU + frame * 0.004;
      pen.glow(v.cx + Math.cos(th) * TUNING.shard.orbitRx, v.cy + Math.sin(th) * TUNING.shard.orbitRy, HALO, a * (0.5 + 0.5 * Math.sin(th * 3 + frame * 0.05)));
    }
  }

  // The tail: glints where it has been.
  const tr = v.trail;
  for (let i = 0; i + 1 < tr.length; i += 2) {
    const f = 1 - i / tr.length;
    pen.glow(tr[i], tr[i + 1], PALE, 0.55 * f * f * k);
  }

  // The halo.
  const haloR = 7 + 3.5 * v.flash;
  for (let dy = -haloR; dy <= haloR; dy += s) {
    for (let dx = -haloR; dx <= haloR; dx += s) {
      const d = Math.hypot(dx, dy) / haloR;
      if (d > 1) continue;
      pen.glow(v.x + dx, v.y + dy, HALO, (1 - d) * (1 - d) * (0.42 + 0.5 * v.flash) * k);
    }
  }

  // The body: five facets about a bright core, a gold edge round the outside.
  const cs = Math.cos(v.rot), sn = Math.sin(v.rot);
  const sc = 1.3 * (1 + 0.2 * v.flash) * (0.55 + 0.45 * Math.min(1, v.k * 1.4));
  const P = (p: readonly [number, number]): [number, number] => [v.x + (p[0] * cs - p[1] * sn) * sc, v.y + (p[0] * sn + p[1] * cs) * sc];
  const tip = P(TIP), shr = P(SHR), bot = P(BOT), low = P(LOW), shl = P(SHL), core = P(CORE);
  const facet = (a: [number, number], b: [number, number], c: RGB, kk: number): void => {
    pen.polygon([a, b, core], c, kk * k);
  };
  facet(tip, shr, [0.93, 0.98, 1.0], 1.0);
  facet(shr, bot, [0.5, 0.72, 1.0], 0.95);
  facet(bot, low, [0.26, 0.44, 0.88], 0.95);
  facet(low, shl, [0.42, 0.62, 0.96], 0.95);
  facet(shl, tip, [1.0, 1.0, 1.0], 0.98);
  const edge = (a: [number, number], b: [number, number]): void => pen.line(a[0], a[1], b[0], b[1], GOLD, 0, 1.0 * k);
  edge(tip, shr); edge(shr, bot); edge(bot, low); edge(low, shl); edge(shl, tip);
  pen.raw(core[0], core[1], [1, 1, 1], 1.1 * k);
  // A star at the tip that breathes, and a white flare when a blow lands on the one it guards.
  const tw = calm ? 0.8 : 0.6 + 0.4 * Math.sin(frame * 0.2);
  for (let i = -2; i <= 2; i++) {
    const f = (1 - Math.abs(i) / 3) * tw;
    pen.glow(tip[0] + i * 0.6, tip[1], PALE, f * 0.8 * k);
    pen.glow(tip[0], tip[1] + i * 0.6, PALE, f * 0.8 * k);
  }
  if (v.flash > 0.04) {
    const rad = 2 + 3.5 * v.flash;
    for (let dy = -rad; dy <= rad; dy += s) {
      for (let dx = -rad; dx <= rad; dx += s) {
        const d = Math.hypot(dx, dy) / rad;
        if (d <= 1) pen.glow(v.x + dx, v.y + dy, [1, 1, 1], (1 - d) * v.flash * 0.9);
      }
    }
  }
}

// ====================================================================================== Stored Light's shimmer

/** A few gold motes turning about her while she carries overshield (`armor01` 0..1 of the pool): the passive's tell. */
export function drawShimmer(out: PixelSurface, _field: LightField, ctx: Ctx, armor01: number): void {
  const p = ctx.player;
  if (p.dead || armor01 <= 0.02) return;
  const pen = new Pen(out, cameraView(ctx.camera, 16));
  const frame = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;
  const cx = p.x, cy = p.y - (p.crawling ? 4 : 9);
  const ry = p.crawling ? 6 : 11.5;
  if (!pen.inView(cx - 12, cy - ry - 3, cx + 12, cy + ry + 3)) return;
  const n = Math.max(3, Math.ceil(armor01 * 9));
  for (let i = 0; i < n; i++) {
    const a = frame * 0.035 * (i % 2 === 0 ? 1 : -0.8) + (i / n) * TAU;
    const tw = calm ? 0.7 : 0.35 + 0.65 * Math.abs(Math.sin(frame * 0.13 + i * 1.9));
    const x = cx + Math.cos(a) * 7.2, y = cy + Math.sin(a) * ry * (0.9 + 0.1 * Math.sin(i + frame * 0.02));
    pen.glow(x, y, GOLD_L, 0.55 * tw * (0.5 + 0.5 * armor01));
    if (tw > 0.8) { pen.glow(x + 0.5, y, GOLD, 0.3); pen.glow(x - 0.5, y, GOLD, 0.3); pen.glow(x, y + 0.5, GOLD, 0.3); pen.glow(x, y - 0.5, GOLD, 0.3); }
  }
  // A thin film of gold on the silhouette, only while the pool is well filled.
  if (armor01 > 0.35) {
    const m = 36;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * TAU;
      pen.glow(cx + Math.cos(a) * 6.4, cy + Math.sin(a) * (ry - 0.5), GOLD, 0.07 * armor01 * (0.6 + 0.4 * Math.sin(a * 4 + frame * 0.06)));
    }
  }
}

// ====================================================================================== the Rose Window

export interface Glint {
  x: number;
  y: number;
  /** Ticks since it flared. */
  age: number;
}

export interface WindowView {
  /** The window's centre (world cells) and its drawn radius. */
  x: number;
  y: number;
  r: number;
  /** The radius that heals and turns shots, for the dotted ring. */
  reach: number;
  look: WindowLook;
  /** Ticks since it shattered, -1 while whole. */
  broke: number;
  /** The floor the glass stands on (world y): the pieces that fall to it are lost behind it. */
  floorY: number;
  /** 1 .. 0: a shot was turned; where on the ring it landed (absolute angle from the centre). */
  flash: number;
  flashAngle: number;
  /** A pulse of healing light crossing the radius: 0..1, -1 when none. */
  pulse: number;
  glints: Glint[];
}

export function newWindowView(x: number, y: number): WindowView {
  return {
    x, y, r: TUNING.window.glassR, reach: TUNING.window.radius,
    look: { scale: 0, spin: 0, glow: 1, crack: 0 }, broke: -1, floorY: y + TUNING.window.glassR, flash: 0, flashAngle: 0, pulse: -1, glints: [],
  };
}

type Blend = (x: number, y: number, r: number, g: number, b: number, a: number) => void;

const hue = (h: number, k: number, out: [number, number, number]): void => {
  out[0] = (0.5 + 0.5 * Math.cos(h)) * k;
  out[1] = (0.5 + 0.5 * Math.cos(h - 2.094)) * k;
  out[2] = (0.5 + 0.5 * Math.cos(h + 2.094)) * k;
};

export function drawRoseWindow(out: PixelSurface, field: LightField, ctx: Ctx, v: WindowView): void {
  const view = cameraView(ctx.camera, 6);
  const reach = v.reach + 4;
  if (v.x + reach < view.x0 || v.x - reach > view.x1 || v.y + reach < view.y0 || v.y - reach > view.y1) return;
  const step = out.pixelStep ?? 1;
  const put = (out.setFinePx ?? out.setPx).bind(out);
  const add = (out.addFinePx ?? out.addPx).bind(out);
  const blend = out.blendFinePx ? out.blendFinePx.bind(out) : null;
  const frame = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;

  if (v.broke < 0) {
    drawReach(add, view, v, frame, calm);
    drawWash(add, view, v, frame);
  }
  drawGlass(put, add, blend, step, view, field, v, frame);
  for (const g of v.glints) drawGlint(add, view, g);
}

/** The dotted ring at the healing radius (steadier than it is bright), and the pulse of light that crosses it. */
function drawReach(add: PixelSurface['addPx'], view: ViewRect, v: WindowView, frame: number, calm: boolean): void {
  const glow = v.look.glow;
  const n = 132;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + frame * 0.0015;
    const x = v.x + Math.cos(a) * v.reach, y = v.y + Math.sin(a) * v.reach;
    if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
    let k = 0.15 * glow * (calm ? 0.8 : 0.62 + 0.38 * Math.sin(a * 9 + frame * 0.04));
    if (v.flash > 0.02) {
      const d = Math.abs(Math.atan2(Math.sin(a - v.flashAngle), Math.cos(a - v.flashAngle)));
      if (d < 0.55) k += v.flash * 0.85 * (1 - d / 0.55);
    }
    add(x, y, 1.0 * k, 0.88 * k, 0.58 * k);
  }
  if (v.pulse >= 0 && v.pulse <= 1) {
    const e = 1 - (1 - v.pulse) ** 2;
    const rad = v.r + (v.reach - v.r) * e;
    const k = 0.2 * (1 - v.pulse) * glow;
    const m = Math.min(420, Math.ceil((TAU * rad) / 0.7));
    for (let i = 0; i < m; i++) {
      const a = (i / m) * TAU;
      const x = v.x + Math.cos(a) * rad, y = v.y + Math.sin(a) * rad;
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      add(x, y, 1.0 * k, 0.9 * k, 0.62 * k);
    }
  }
}

/** Light through the panes: a soft wash of the rose's colours on what is around it, turning slowly. */
function drawWash(add: PixelSurface['addPx'], view: ViewRect, v: WindowView, frame: number): void {
  const R = 30;
  const rgb: [number, number, number] = [0, 0, 0];
  const strength = v.look.glow * Math.min(1, v.look.scale);
  if (strength <= 0.02) return;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy) / R;
      if (d >= 1 || d < 0.1) continue;
      const x = v.x + dx + 0.5, y = v.y + dy + 0.5;
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      hue(Math.atan2(dy, dx) * 2 - frame * 0.012, strength * (1 - d) * (1 - d) * 0.075, rgb);
      add(x, y, rgb[0], rgb[1], rgb[2]);
    }
  }
}

/** A four-point flare where a shot was turned. */
function drawGlint(add: PixelSurface['addPx'], view: ViewRect, g: Glint): void {
  if (g.age > 12) return;
  const f = 1 - g.age / 12;
  const len = 1.5 + 4.5 * f;
  for (let t = -len; t <= len; t += 0.5) {
    const k = (1 - Math.abs(t) / len) * f * 0.95;
    for (const [x, y] of [[g.x + t, g.y], [g.x, g.y + t]] as const) {
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      add(x, y, 1.0 * k, 0.95 * k, 0.8 * k);
    }
  }
}

/**
 * The glass itself, evaluated pixel by pixel in the window's own polar frame: a gold frame, a scalloped
 * gold ring between an inner and an outer ring of panes, eight gold spokes, a gold hub and a gem. The panes
 * are alpha-blended over the world (the cave shows through the glass) and add their own colour (it is lit from
 * behind). While it shatters each of the eight sectors, and the hub, is carried off as a piece.
 */
function drawGlass(
  put: PixelSurface['setPx'], add: PixelSurface['addPx'], blend: Blend | null,
  step: number, view: ViewRect, field: LightField, v: WindowView, frame: number,
): void {
  const D = v.r;
  const k12 = D / 12; // the pattern was drawn at radius 12: every length scales with the window
  const sc = Math.max(0.06, v.look.scale);
  const rad = D * sc + 1.2;
  if (v.x + rad < view.x0 || v.x - rad > view.x1 || v.y + rad < view.y0 || v.y - rad > view.y1) return;
  const lt = field.sample(v.x, v.y);
  const lr = clamp(lt.r, 0.45, 1.1), lg = clamp(lt.g, 0.45, 1.1), lb = clamp(lt.b, 0.45, 1.1);
  const glow = v.look.glow;
  const spin = v.look.spin;
  const crack = v.look.crack;
  const broken = v.broke >= 0;
  const fade = broken ? Math.max(0, 1 - v.broke / TUNING.window.breakTicks) ** 1.4 : 1;
  if (fade <= 0.01) return;

  // Where each piece has got to.
  const off = new Float32Array(18);
  if (broken) {
    const o = { x: 0, y: 0 };
    for (let k = 0; k <= 8; k++) { fragmentOffset(k, v.broke, o); off[k * 2] = o.x; off[k * 2 + 1] = o.y; }
  }
  // The cracks: where they start, how far they run.
  const crackA: number[] = [], crackL: number[] = [];
  if (crack > 0) {
    for (let i = 0; i < 8; i++) {
      crackA.push(0.5 + i * 0.785 + (hash2(i, 3) - 0.5) * 0.5);
      crackL.push(crack * D * (0.5 + 0.55 * hash2(i, 9)));
    }
  }

  const emit = (x: number, y: number, r: number, g: number, b: number, a: number): void => {
    if (a >= 0.995) put(x, y, r, g, b);
    else if (blend) blend(x, y, r * a, g * a, b * a, a);
    else if (a > 0.45) put(x, y, r, g, b);
  };

  const half = step * 0.5;
  const x0 = Math.floor((v.x - rad) / step) * step, x1 = v.x + rad;
  const y0 = Math.floor((v.y - rad) / step) * step, y1 = v.y + rad;
  const gemPulse = 0.8 + 0.2 * Math.sin(frame * 0.1);
  for (let gy = y0; gy <= y1; gy += step) {
    for (let gx = x0; gx <= x1; gx += step) {
      const px = gx + half - v.x, py = gy + half - v.y;
      const dist = Math.hypot(px, py);
      const r = dist / sc;
      if (r > D + 0.55) continue;
      const aw = Math.atan2(py, px);
      const a = aw - spin;
      let ap = a + Math.PI;
      ap -= Math.floor(ap / TAU) * TAU;
      const sector = Math.floor(ap / QUARTER) & 7;
      const into = ap - sector * QUARTER;
      const spokeD = r * Math.sin(Math.min(into, QUARTER - into));
      const piece = r < 3.4 * k12 ? 8 : sector;
      let wx = gx + half, wy = gy + half;
      if (broken) { wx += off[piece * 2]; wy += off[piece * 2 + 1]; if (wy > v.floorY) continue; }
      if (wx < view.x0 || wx > view.x1 || wy < view.y0 || wy > view.y1) continue;
      // The lamp is upper-left: surfaces facing it are brighter.
      const lamp = 0.86 + 0.16 * (-0.6 * Math.cos(aw) - 0.8 * Math.sin(aw));

      // The outline just outside the frame.
      if (r > D) { emit(wx, wy, INK[0], INK[1], INK[2], 0.9 * fade); continue; }

      // Cracks run over everything.
      if (crack > 0) {
        let cracked = false;
        for (let i = 0; i < 8; i++) {
          if (r > crackL[i]) continue;
          const da = Math.atan2(Math.sin(a - crackA[i] - 0.14 * Math.sin(r * 0.9 + i * 2)), Math.cos(a - crackA[i] - 0.14 * Math.sin(r * 0.9 + i * 2)));
          if (Math.abs(da) * Math.max(r, 1) < 0.5) { cracked = true; break; }
        }
        if (cracked) { emit(wx, wy, 0.04, 0.04, 0.06, 0.92 * fade); continue; }
      }

      // The frame.
      const rim = 1.5 * k12;
      if (r > D - rim) {
        const bevel = r > D - 0.5 ? 1.12 : r < D - rim + 0.5 ? 0.82 : 1;
        const sh = lamp * bevel;
        emit(wx, wy, GOLD[0] * sh * (0.5 + 0.5 * lr), GOLD[1] * sh * (0.5 + 0.5 * lg), GOLD[2] * sh * (0.5 + 0.5 * lb), fade);
        add(wx, wy, GOLD[0] * 0.06 * glow * fade, GOLD[1] * 0.06 * glow * fade, GOLD[2] * 0.06 * glow * fade);
        continue;
      }

      // The hub and its gem.
      const hubR = 3.4 * k12;
      if (r < hubR) {
        if (r < 1.5 * k12) {
          const gk = gemPulse * glow;
          emit(wx, wy, 1.0, 0.94 * (0.9 + 0.1 * gk), 0.82, fade);
          add(wx, wy, 0.9 * gk * fade, 0.7 * gk * fade, 0.4 * gk * fade);
        } else {
          const sh = lamp * (r < 2.6 * k12 ? 1.05 : 0.85);
          emit(wx, wy, GOLD_L[0] * sh * (0.5 + 0.5 * lr), GOLD_L[1] * sh * (0.5 + 0.5 * lg), GOLD_L[2] * sh * (0.5 + 0.5 * lb), fade);
        }
        continue;
      }

      // The scalloped ring and the spokes: gold tracery.
      const rm = (7.0 + 1.1 * Math.cos(8 * a)) * k12;
      const ringD = Math.abs(r - rm);
      if (ringD < 0.55 || spokeD < 0.5) {
        const sh = lamp * (ringD < 0.55 && spokeD >= 0.5 && ringD > 0.28 ? 0.82 : 1.0);
        emit(wx, wy, GOLD[0] * sh * (0.5 + 0.5 * lr), GOLD[1] * sh * (0.5 + 0.5 * lg), GOLD[2] * sh * (0.5 + 0.5 * lb), fade);
        add(wx, wy, GOLD[0] * 0.08 * glow * fade, GOLD[1] * 0.08 * glow * fade, GOLD[2] * 0.08 * glow * fade);
        continue;
      }

      // A pane: its colour, darker toward the lead, a little hand-blown unevenness, lit from behind.
      const ring = r < rm ? 0 : 1;
      const pane = PANES[(sector * 3 + ring * 5) & 7];
      const edge = Math.min(spokeD - 0.5, ringD - 0.55, D - rim - r, r - hubR);
      const lead = edge < 0.9 ? 0.74 + 0.26 * (edge / 0.9) : 1;
      const grain = 0.94 + 0.12 * hash2(Math.floor(wx * 2), Math.floor(wy * 2));
      const br = lead * grain * lamp;
      const alpha = 0.8 * fade;
      const body = 0.42 + 0.58 * glow; // the glass loses its colour as the light in it fails
      emit(wx, wy, pane[0] * (0.52 + 0.48 * lr) * br * body, pane[1] * (0.52 + 0.48 * lg) * br * body, pane[2] * (0.52 + 0.48 * lb) * br * body, alpha);
      const g2 = 0.34 * glow * br * fade;
      add(wx, wy, pane[0] * g2, pane[1] * g2, pane[2] * g2);
    }
  }
}

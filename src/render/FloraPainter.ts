import type { BiomeId } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { finePixelStep } from '@/render/sprites/FineArt';
import {
  type FloraBlades, FLORA_BLADE, FLORA_BULB, FLORA_CURL, FLORA_HEAD, FLORA_LEAF, FLORA_PETAL, FLORA_STEM, floraHalfWidth,
} from '@/world/flora';

type RGB = readonly [number, number, number];

/** A four-tone ramp (deep shadow → lit face), a light-catching rim, and accents. */
export interface FloraPalette {
  readonly ramp: readonly [RGB, RGB, RGB, RGB];
  readonly rim: RGB;
  readonly head: RGB;
  readonly glow: RGB;
  readonly petals: readonly RGB[];
}

type Climate = 'verdant' | 'damp' | 'fungal' | 'crystal' | 'frost' | 'arid';
const CLIMATE: Record<BiomeId, Climate> = {
  earthen: 'verdant', timber: 'verdant', gilded: 'verdant', flooded: 'damp',
  fungal: 'fungal', crystal: 'crystal', frozen: 'frost', scorched: 'arid', volcanic: 'arid',
};

/** Foreground plants are near-silhouettes: dark, cool, and lit mostly at the rim. */
const FRONT: Record<Climate, FloraPalette> = {
  verdant: { ramp: [[.022, .05, .04], [.04, .095, .07], [.07, .15, .095], [.115, .215, .12]], rim: [.36, .52, .25],
    head: [.13, .075, .04], glow: [.85, 1, .42], petals: [[.75, .7, .45]] },
  damp: { ramp: [[.018, .05, .052], [.032, .09, .085], [.055, .145, .125], [.095, .21, .165]], rim: [.3, .56, .46],
    head: [.12, .07, .04], glow: [.35, 1, .86], petals: [[.6, .78, .8]] },
  fungal: { ramp: [[.035, .028, .055], [.06, .05, .095], [.09, .085, .14], [.135, .135, .19]], rim: [.46, .36, .62],
    head: [.16, .07, .12], glow: [.9, .42, 1], petals: [[.85, .55, .9]] },
  crystal: { ramp: [[.028, .035, .062], [.048, .065, .105], [.075, .1, .16], [.11, .155, .225]], rim: [.48, .52, .78],
    head: [.1, .08, .16], glow: [.62, .58, 1], petals: [[.7, .7, 1]] },
  frost: { ramp: [[.035, .05, .062], [.065, .088, .105], [.105, .14, .16], [.165, .205, .225]], rim: [.66, .78, .86],
    head: [.16, .13, .1], glow: [.6, .86, 1], petals: [[.85, .9, 1]] },
  arid: { ramp: [[.05, .032, .022], [.088, .055, .03], [.135, .088, .045], [.2, .135, .065]], rim: [.72, .44, .18],
    head: [.17, .08, .035], glow: [1, .55, .16], petals: [[.95, .6, .25]] },
};

/** Ground cover sits in the scene's own light, warmer and lighter than the cover plants. */
const GROUND: Record<Climate, FloraPalette> = {
  verdant: { ramp: [[.07, .12, .05], [.13, .21, .08], [.22, .33, .11], [.34, .45, .15]], rim: [.58, .68, .27],
    head: [.3, .19, .08], glow: [.8, 1, .4], petals: [[.95, .9, .62], [.82, .86, 1], [1, .72, .66]] },
  damp: { ramp: [[.05, .11, .09], [.09, .19, .14], [.15, .29, .2], [.23, .4, .26]], rim: [.46, .66, .46],
    head: [.26, .17, .08], glow: [.4, 1, .85], petals: [[.85, .95, 1], [.95, .92, .7]] },
  fungal: { ramp: [[.08, .07, .11], [.14, .12, .19], [.22, .2, .29], [.32, .3, .4]], rim: [.62, .52, .78],
    head: [.3, .16, .24], glow: [.9, .45, 1], petals: [[.95, .65, .95], [.6, .9, 1]] },
  crystal: { ramp: [[.07, .08, .13], [.12, .15, .22], [.19, .23, .32], [.28, .33, .44]], rim: [.62, .66, .9],
    head: [.22, .18, .3], glow: [.62, .58, 1], petals: [[.8, .8, 1]] },
  frost: { ramp: [[.09, .12, .13], [.16, .21, .22], [.26, .32, .33], [.38, .45, .46]], rim: [.78, .88, .92],
    head: [.3, .25, .2], glow: [.6, .86, 1], petals: [[.9, .95, 1]] },
  arid: { ramp: [[.12, .08, .045], [.21, .14, .07], [.31, .22, .1], [.44, .33, .14]], rim: [.75, .58, .28],
    head: [.32, .17, .07], glow: [1, .55, .16], petals: [[1, .75, .35]] },
};

export function floraPalette(biome: BiomeId | undefined, foreground: boolean): FloraPalette {
  const climate = CLIMATE[biome ?? 'earthen'] ?? 'verdant';
  return (foreground ? FRONT : GROUND)[climate];
}

const CHAR: readonly [RGB, RGB, RGB, RGB] = [[.02, .018, .016], [.04, .034, .03], [.065, .055, .048], [.1, .085, .07]];

export interface FloraPaint {
  blades: FloraBlades;
  palette: FloraPalette;
  light: LightField;
  /** Ticks, for bulb pulse and drifting motes. */
  time: number;
  burn: number;
  burning: boolean;
  /** Camera top-left, so the bitmap lands exactly on the presentation grid. */
  camX: number;
  camY: number;
  /** Silhouette-dark plants in front of actors get a lower ambient floor and stronger rims. */
  foreground: boolean;
  /** Half-width (cells) of the moss mat that roots the plant into the floor; 0 = none. */
  skirt: number;
  /** Opacity at a world point: 0 clips (terrain, protected glyphs), between = see-through. */
  opacity(x: number, y: number): number;
  isSolid(x: number, y: number): boolean;
}

const MAXW = 260, MAXH = 220, MAX = MAXW * MAXH;
const ids = new Int16Array(MAX);
const shade = new Float32Array(MAX);
const rgb = new Float32Array(MAX * 3);
const alpha = new Float32Array(MAX);
const glow = new Float32Array(MAX * 3);
const orderBlade = new Int16Array(1024);
const lightR = new Float32Array(3), lightG = new Float32Array(3), lightB = new Float32Array(3);
let bw = 0, bh = 0, ox = 0, oy = 0, step = 1, inv = 1, glowing = false;

/** Stable 0..1 hash of a world presentation pixel (dither that never swims). */
const grain = (i: number, j: number): number => (((Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0) % 1000) / 1000;

function plot(x: number, y: number, order: number, value: number): void {
  const i = Math.floor((x - ox) * inv), j = Math.floor((y - oy) * inv);
  if (i < 0 || j < 0 || i >= bw || j >= bh) return;
  const k = j * bw + i;
  ids[k] = order; shade[k] = value;
}

function halo(x: number, y: number, radius: number, c: RGB, k: number): void {
  const i0 = Math.max(0, Math.floor((x - radius - ox) * inv)), i1 = Math.min(bw - 1, Math.ceil((x + radius - ox) * inv));
  const j0 = Math.max(0, Math.floor((y - radius - oy) * inv)), j1 = Math.min(bh - 1, Math.ceil((y + radius - oy) * inv));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(ox + (i + .5) * step - x, oy + (j + .5) * step - y) / radius;
    if (d >= 1) continue;
    const f = (1 - d) * (1 - d) * k, g = (j * bw + i) * 3;
    glow[g] += c[0] * f; glow[g + 1] += c[1] * f; glow[g + 2] += c[2] * f;
  }
}

function rasterCurve(b: FloraBlades, k: number, order: number, rootY: number, height: number): void {
  const kind = b.kind[k], w0 = b.width[k];
  const ax = b.ax[k], ay = b.ay[k], cx = b.cx[k], cy = b.cy[k], bx = b.bx[k], by = b.by[k];
  const length = Math.hypot(cx - ax, cy - ay) + Math.hypot(bx - cx, by - cy);
  const n = Math.max(2, Math.ceil(length * inv * 1.4));
  const across = step * .7, base = kind === FLORA_STEM ? .3 : kind === FLORA_HEAD ? .5 : .5;
  const veined = kind === FLORA_LEAF && w0 * inv >= 3;
  for (let s = 0; s <= n; s++) {
    const t = s / n, u = 1 - t;
    const x = u * u * ax + 2 * u * t * cx + t * t * bx, y = u * u * ay + 2 * u * t * cy + t * t * by;
    let dx = 2 * u * (cx - ax) + 2 * t * (bx - cx), dy = 2 * u * (cy - ay) + 2 * t * (by - cy);
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    // Normal oriented to the sky: its positive half is the leaf's lit face.
    let nx = -dy, ny = dx;
    if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
    const hf = Math.max(0, Math.min(1, (rootY - y) / height));
    const ao = .52 + .48 * Math.min(1, hf / .42);
    const along = kind === FLORA_BLADE ? t * .1 : 0;
    const w = floraHalfWidth(kind, t, w0);
    if (w <= step * .6) { plot(x, y, order, (base + along) * ao); continue; }
    for (let o = -w; o <= w + 1e-6; o += across) {
      const v = o / w;
      let value = base + along + (v > 0 ? .1 : -.08) + (1 - Math.abs(v)) * .05;
      if (veined && t > .04 && t < .9) {
        if (Math.abs(o) < step * .6) value += .2;
        else if (Math.abs(((t * 6.5 - Math.abs(v) * .9) % 1 + 1) % 1) < .11) value += .1;
      }
      plot(x + nx * o, y + ny * o, order, value * ao);
    }
  }
}

function rasterRound(b: FloraBlades, k: number, order: number, time: number): void {
  const kind = b.kind[k], r = b.width[k], x = b.bx[k], y = b.by[k];
  if (kind === FLORA_CURL) {
    // A fiddlehead: a tightening spiral of the frond still to unroll.
    const dir = Math.sign(b.cx[k] - b.ax[k]) || 1;
    for (let a = 0; a <= Math.PI * 2.6; a += step * .35 / r) {
      const rr = r * (1 - a / (Math.PI * 3.2));
      const sx = x + Math.cos(a) * rr * dir, sy = y - Math.sin(a) * rr;
      plot(sx, sy, order, .55 - a * .03);
      plot(sx + step * .5, sy, order, .5 - a * .03);
    }
    return;
  }
  for (let dy = -r; dy <= r + 1e-6; dy += step * .5) for (let dx = -r; dx <= r + 1e-6; dx += step * .5) {
    const d = Math.hypot(dx, dy) / r;
    if (d > 1) continue;
    // Bulbs hang: the lower half is fuller, so shading runs top-dark, belly-bright.
    plot(x + dx, y + dy, order, kind === FLORA_BULB ? .45 + .55 * (1 - d) + dy / r * .15 : .7 - dy / r * .2);
  }
  if (kind === FLORA_BULB) glowing = true;
  void time;
}

/**
 * A plant's finished bitmap, kept between frames. Callers key it on every
 * input that can change a pixel (sway bucket, lean, light, terrain, camera
 * phase, see-through) and re-paint only when the key moves; otherwise the
 * stored pixels are blitted as they are.
 */
export interface FloraCache {
  key: number;
  ox: number; oy: number; w: number; h: number;
  rgb: Float32Array; a: Float32Array; glow: Float32Array | null;
  usedAt: number;
}

const EMPTY = new Float32Array(0);
const live: FloraCache[] = [];
let clock = 0;
/** Cache hits and re-paints since load (perf probes read them). */
export const floraCacheStats = { hits: 0, paints: 0 };

export function createFloraCache(): FloraCache {
  return { key: NaN, ox: 0, oy: 0, w: 0, h: 0, rgb: EMPTY, a: EMPTY, glow: null, usedAt: 0 };
}

/** Write a cached plant; returns false when the key has moved and it must be re-painted. */
export function blitFloraCache(out: PixelSurface, c: FloraCache, key: number, frame: number): boolean {
  if (c.key !== key) return false;
  floraCacheStats.hits++;
  c.usedAt = frame;
  if (c.w > 0) flush(out, c.ox, c.oy, c.w, c.h, c.rgb, c.a, c.glow);
  return true;
}

/** Frees the bitmaps of plants not drawn for a while (the whole level's roots keep their poses). */
export function pruneFloraCaches(frame: number, idle = 240): void {
  if (frame - clock < 60 && frame >= clock) return;
  clock = frame;
  for (let i = live.length - 1; i >= 0; i--) {
    const c = live[i];
    if (Math.abs(frame - c.usedAt) <= idle) continue;
    c.rgb = EMPTY; c.a = EMPTY; c.glow = null; c.w = 0; c.key = NaN;
    live[i] = live[live.length - 1]; live.pop();
  }
}

function store(c: FloraCache, key: number, frame: number, withGlow: boolean): void {
  floraCacheStats.paints++;
  const size = bw * bh;
  if (c.a.length < size) {
    if (c.a === EMPTY) live.push(c);
    c.a = new Float32Array(Math.ceil(size * 1.25)); c.rgb = new Float32Array(c.a.length * 3);
  }
  c.a.set(alpha.subarray(0, size)); c.rgb.set(rgb.subarray(0, size * 3));
  if (withGlow) {
    if (!c.glow || c.glow.length < size * 3) c.glow = new Float32Array(c.rgb.length);
    c.glow.set(glow.subarray(0, size * 3));
  } else c.glow = null;
  c.key = key; c.ox = ox; c.oy = oy; c.w = bw; c.h = bh; c.usedAt = frame;
}

function flush(out: PixelSurface, x0: number, y0: number, w: number, h: number,
  rgbIn: Float32Array, aIn: Float32Array, glowIn: Float32Array | null): void {
  const s = finePixelStep(out);
  if (out.blitFine && s < 1) { out.blitFine(x0, y0, w, h, rgbIn, aIn, glowIn); return; }
  const set = (out.setFinePx ?? out.setPx).bind(out), add = (out.addFinePx ?? out.addPx).bind(out);
  const blend = out.blendFinePx?.bind(out);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, a = aIn[k], x = x0 + i * s, y = y0 + j * s;
    if (a >= .999) set(x, y, rgbIn[k * 3], rgbIn[k * 3 + 1], rgbIn[k * 3 + 2]);
    else if (a > 0) {
      if (blend) blend(x, y, rgbIn[k * 3], rgbIn[k * 3 + 1], rgbIn[k * 3 + 2], a);
      else set(x, y, rgbIn[k * 3] / a, rgbIn[k * 3 + 1] / a, rgbIn[k * 3 + 2] / a);
    }
    if (glowIn && (glowIn[k * 3] > 0 || glowIn[k * 3 + 1] > 0 || glowIn[k * 3 + 2] > 0)) add(x, y, glowIn[k * 3], glowIn[k * 3 + 1], glowIn[k * 3 + 2]);
  }
}

/** Rasterise a plant into a scratch bitmap at presentation resolution, shade, then write it once
 * (and, given a cache, keep the result under `key`). */
export function paintFlora(out: PixelSurface, o: FloraPaint, cache?: FloraCache, key = 0, frame = 0): void {
  const b = o.blades;
  if (b.count === 0) { if (cache) { cache.key = key; cache.w = 0; cache.usedAt = frame; } return; }
  step = finePixelStep(out); inv = 1 / step; glowing = false;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < b.count; k++) {
    const pad = b.width[k] * (b.kind[k] === FLORA_BULB ? 4.2 : 1) + 1;
    x0 = Math.min(x0, b.ax[k] - pad, b.cx[k] - pad, b.bx[k] - pad); x1 = Math.max(x1, b.ax[k] + pad, b.cx[k] + pad, b.bx[k] + pad);
    y0 = Math.min(y0, b.ay[k] - pad, b.cy[k] - pad, b.by[k] - pad); y1 = Math.max(y1, b.ay[k] + pad, b.cy[k] + pad, b.by[k] + pad);
  }
  x0 = Math.min(x0, b.rootX - o.skirt - 1); x1 = Math.max(x1, b.rootX + o.skirt + 1); y1 = Math.max(y1, b.rootY + 3);
  ox = o.camX + Math.floor((x0 - o.camX) * inv) * step;
  oy = o.camY + Math.floor((y0 - o.camY) * inv) * step;
  bw = Math.min(MAXW, Math.ceil((x1 - ox) * inv) + 1);
  bh = Math.min(MAXH, Math.ceil((y1 - oy) * inv) + 1);
  const size = bw * bh;
  ids.fill(0, 0, size); glow.fill(0, 0, size * 3);

  // Light at the base, the middle and the crown; the crown's sides tell which way the rim faces.
  const H = b.height, rootY = b.rootY, floor = o.foreground ? .5 : .62;
  // Designed darkness hides a plant only when no real light (a lantern, a lamp) reaches it.
  let seen = 0;
  // Small plants sit in one light; tall ones read it at the base, middle and crown.
  const bands = H > 14 ? 3 : 1;
  for (let n = 0; n < 3; n++) {
    if (n >= bands) { lightR[n] = lightR[0]; lightG[n] = lightG[0]; lightB[n] = lightB[0]; continue; }
    const s = o.light.sample(b.rootX, rootY - 1 - H * n * .45), so = s.open ?? 1;
    lightR[n] = Math.min(1.25, Math.max(floor * so, s.r)); lightG[n] = Math.min(1.25, Math.max(floor * so, s.g));
    lightB[n] = Math.min(1.25, Math.max(floor * so, s.b));
    seen = Math.max(seen, so, (s.r + s.g + s.b) / 3);
  }
  if (seen < .05) { if (cache) { cache.key = key; cache.w = 0; cache.usedAt = frame; } return; }
  let lightSide = 0;
  if (bands === 3) {
    const left = o.light.sample(b.rootX - H * .5, rootY - H * .6), right = o.light.sample(b.rootX + H * .5, rootY - H * .6);
    const lsum = left.r + left.g + left.b, rsum = right.r + right.g + right.b;
    lightSide = Math.abs(lsum - rsum) < .12 ? 0 : lsum > rsum ? -1 : 1;
  }
  const top = (lightR[2] + lightG[2] + lightB[2]) / 3;
  const rimK = Math.min(1, Math.max(0, (top - (o.foreground ? .32 : .5)) * 1.6)) * (o.foreground ? .55 : .5);

  // The moss mat: draws first, creeps a little over the floor lip and sends up hairs.
  let order = 1;
  if (o.skirt > 0) {
    orderBlade[order] = -1;
    for (let x = b.rootX - o.skirt; x <= b.rootX + o.skirt; x += step) {
      const f = 1 - Math.abs(x - b.rootX) / o.skirt, gi = Math.floor(x * inv), g = grain(gi, 7);
      if (!o.isSolid(x, rootY + .2)) continue;
      const depth = f * (.6 + g * 1.1), hair = g > .72 ? step * (1 + Math.floor((g - .72) * 12)) * f : 0;
      for (let y = rootY - hair - step; y < rootY + depth; y += step) {
        plot(x, y, order, (y < rootY ? .62 : .5 - (y - rootY) / (depth + .01) * .25) * (.8 + g * .3));
      }
    }
    order++;
  }
  for (let layer = 0; layer < 3; layer++) for (let k = 0; k < b.count; k++) {
    if (b.layer[k] !== layer || order >= orderBlade.length) continue;
    orderBlade[order] = k;
    const kind = b.kind[k];
    if (kind === FLORA_BULB || kind === FLORA_PETAL || kind === FLORA_CURL) rasterRound(b, k, order, o.time);
    else rasterCurve(b, k, order, rootY, H);
    order++;
  }

  const pal = o.palette, ramp = pal.ramp, burn = Math.min(1, o.burn * 1.15);
  const pulseBase = .78 + Math.sin(o.time * .045 + b.rootX * .3) * .22;
  for (let j = 0; j < bh; j++) {
    const wy = oy + j * step;
    const hf = Math.max(0, Math.min(1, (rootY - wy) / H)) * 2;
    const band = Math.min(1, Math.floor(hf)), mix = Math.min(1, hf - band);
    const LR = lightR[band] + (lightR[band + 1] - lightR[band]) * mix;
    const LG = lightG[band] + (lightG[band + 1] - lightG[band]) * mix;
    const LB = lightB[band] + (lightB[band + 1] - lightB[band]) * mix;
    for (let i = 0; i < bw; i++) {
      const k = j * bw + i, id = ids[k];
      if (!id) { alpha[k] = 0; continue; }
      const wx = ox + i * step;
      const a = o.opacity(wx + step * .5, wy + step * .5);
      if (a <= 0) { alpha[k] = 0; continue; }
      const blade = orderBlade[id], kind = blade < 0 ? FLORA_BLADE : b.kind[blade];
      const up = j > 0 ? ids[k - bw] : 0, dn = j < bh - 1 ? ids[k + bw] : 0;
      const lf = i > 0 ? ids[k - 1] : 0, rt = i < bw - 1 ? ids[k + 1] : 0;
      let r: number, g: number, bl: number;
      if (kind === FLORA_BULB) {
        const s = shade[k], c = pal.glow, core = s * pulseBase;
        r = c[0] * (.35 + core * .9); g = c[1] * (.35 + core * .9); bl = c[2] * (.35 + core * .9);
        if (!up) { r = r * .7 + .3; g = g * .7 + .3; bl = bl * .7 + .3; }
      } else {
        let s = shade[k] + (blade >= 0 ? b.tone[blade] - (b.layer[blade] - 1) * .07 : 0);
        // A leaf in front casts a contact shadow on whatever it overlaps.
        if (up > id || lf > id || rt > id) s -= .14;
        else if (dn > id) s -= .05;
        const q = s < .3 ? 0 : s < .45 ? 1 : s < .6 ? 2 : 3;
        let c: RGB = kind === FLORA_HEAD ? pal.head : kind === FLORA_PETAL ? pal.petals[blade % pal.petals.length] : ramp[q];
        if (kind === FLORA_HEAD) { const m = .55 + s * .7; r = c[0] * m; g = c[1] * m; bl = c[2] * m; }
        else if (kind === FLORA_PETAL) { r = c[0]; g = c[1]; bl = c[2]; }
        else { r = c[0]; g = c[1]; bl = c[2]; }
        if (burn > 0 && kind !== FLORA_PETAL) {
          c = CHAR[q]; const f = Math.min(1, burn * (1.1 - Math.min(1, hf) * .2));
          r += (c[0] - r) * f; g += (c[1] - g) * f; bl += (c[2] - bl) * f;
        }
        // The edge facing the light (above, and toward the brighter side) catches it.
        const rim = kind !== FLORA_STEM && (!up || (lightSide < 0 && !lf) || (lightSide > 0 && !rt));
        if (rim && rimK > 0) {
          const f = rimK * (1 - burn);
          r += (pal.rim[0] - r) * f; g += (pal.rim[1] - g) * f; bl += (pal.rim[2] - bl) * f;
        } else if (!dn && kind !== FLORA_STEM) { r *= .78; g *= .78; bl *= .78; }
        r *= LR; g *= LG; bl *= LB;
      }
      const g3 = k * 3;
      rgb[g3] = r * a; rgb[g3 + 1] = g * a; rgb[g3 + 2] = bl * a; alpha[k] = a;
    }
  }

  // Spore bulbs light their own surroundings, pulse, and shed slow motes.
  if (glowing) {
    const gc = pal.glow;
    for (let k = 0; k < b.count; k++) {
      if (b.kind[k] !== FLORA_BULB) continue;
      const pulse = .75 + Math.sin(o.time * .045 + b.tone[k] * 7) * .25;
      halo(b.bx[k], b.by[k], b.width[k] * 4.2, gc, .2 * pulse);
      const phase = b.tone[k] * 11;
      const mx = b.bx[k] + Math.sin(o.time * .011 + phase) * 5, my = b.by[k] - 3 - ((o.time * .02 + phase) % 9);
      halo(mx, my, step * 1.6, gc, .55 * Math.max(0, Math.sin(((o.time * .02 + phase) % 9) / 9 * Math.PI)));
    }
  }
  if (o.burning) {
    const flicker = .7 + Math.sin(o.time * .3 + b.rootX) * .15;
    halo(b.rootX, rootY - Math.max(1, H * (1 - o.burn) * .3), 4.5, [1.1, .5, .12], .55 * flicker);
  }

  const withGlow = glowing || o.burning;
  if (cache) { store(cache, key, frame, withGlow); flush(out, ox, oy, bw, bh, cache.rgb, cache.a, cache.glow); return; }
  flush(out, ox, oy, bw, bh, rgb, alpha, withGlow ? glow : null);
}

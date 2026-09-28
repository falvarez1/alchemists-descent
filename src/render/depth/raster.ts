/**
 * Tiny pixel-art raster kit for the depth planes (render/depth).
 *
 * Planes are painted as a MATERIAL MASK first (one byte per texel: 0 empty,
 * 1..n palette entries) plus a signed TONE plane (per-texel value offsets:
 * cylinder shading, flange bands, rivets), then shaded in one pass so every
 * plane gets the same pixel-art treatment: flat fills, a one-texel rim on
 * the side facing the plane's light, a darker opposite edge, ordered-dither
 * grain, and a vertical light gradient. Atmospheric perspective (haze mix and
 * contrast compression toward the plane's haze colour) is applied last, so a
 * far plane reads lighter, cooler and flatter than a near one.
 *
 * Every write wraps in both axes: a plane tiles seamlessly under the
 * compositors' repeat-wrapped sampling (a cave has no horizon).
 *
 * Pure TypeScript — no DOM — so the art is unit-testable and deterministic.
 */

export type Rgb = readonly [number, number, number];

/** A wrapped RGBA8 bitmap (the ParallaxBitmapLayer / foreground payload). */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

/** Deterministic mulberry32 stream; kits fork one per plane. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer lattice hash in [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable smooth value noise: lattice `cell` texels, wrapping every `px`×`py` texels. */
export function tileNoise(x: number, y: number, cell: number, px: number, py: number, seed: number): number {
  const gx = Math.max(1, Math.round(px / cell));
  const gy = Math.max(1, Math.round(py / cell));
  const fx = (x / px) * gx, fy = (y / py) * gy;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const w = (v: number, n: number): number => ((v % n) + n) % n;
  const a = hash2(w(x0, gx), w(y0, gy), seed), b = hash2(w(x0 + 1, gx), w(y0, gy), seed);
  const c = hash2(w(x0, gx), w(y0 + 1, gy), seed), d = hash2(w(x0 + 1, gx), w(y0 + 1, gy), seed);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

/** Two-octave tileable noise in [0, 1). */
export function tileFbm(x: number, y: number, cell: number, px: number, py: number, seed: number): number {
  return tileNoise(x, y, cell, px, py, seed) * 0.65 + tileNoise(x, y, Math.max(2, cell / 2.5), px, py, seed + 17) * 0.35;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function mixRgb(a: Rgb, b: Rgb, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function luma(c: Rgb): number {
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}

/** One palette entry of a plane's silhouettes (0–255 sRGB-ish, like the art PNGs). */
export interface Material {
  readonly base: Rgb;
  /** The light-facing one-texel rim. */
  readonly rim: Rgb;
  /** The shadow-side edge and the tone floor. */
  readonly shade: Rgb;
  /** Emissive: skips rim/shade/grain and most of the haze (windows, kiln mouths, spores). */
  readonly glow?: boolean;
}

/** A plane being painted: material ids + signed tone offsets, wrapped writes. */
export class MaskPlane {
  readonly mat: Uint8Array;
  readonly tone: Int8Array;
  /** Optional per-texel coverage for soft (light-shaft, fog) materials: 0–255. */
  readonly cover: Uint8Array;

  /** wrap = false: writes outside the plane are dropped (the non-tiling foreground). */
  constructor(readonly width: number, readonly height: number, readonly wrap = true) {
    this.mat = new Uint8Array(width * height);
    this.tone = new Int8Array(width * height);
    this.cover = new Uint8Array(width * height);
  }

  /** Texel index, or -1 off a non-wrapping plane. */
  index(x: number, y: number): number {
    const w = this.width, h = this.height;
    if (!this.wrap) {
      const xi = Math.floor(x), yi = Math.floor(y);
      return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : yi * w + xi;
    }
    const xi = ((Math.floor(x) % w) + w) % w;
    const yi = ((Math.floor(y) % h) + h) % h;
    return yi * w + xi;
  }

  set(x: number, y: number, m: number, tone = 0): void {
    const i = this.index(x, y);
    if (i < 0) return;
    this.mat[i] = m;
    this.tone[i] = Math.max(-127, Math.min(127, Math.round(tone)));
    this.cover[i] = 255;
  }

  get(x: number, y: number): number {
    const i = this.index(x, y);
    return i < 0 ? 0 : this.mat[i];
  }

  clear(x: number, y: number): void {
    const i = this.index(x, y);
    if (i < 0) return;
    this.mat[i] = 0;
    this.tone[i] = 0;
    this.cover[i] = 0;
  }

  /** Accumulate soft coverage (keeps the max) for a soft material. */
  soft(x: number, y: number, m: number, cover: number): void {
    const i = this.index(x, y);
    if (i < 0) return;
    const c = Math.max(0, Math.min(255, Math.round(cover * 255)));
    if (this.mat[i] !== 0 && this.mat[i] !== m) return;
    this.mat[i] = m;
    if (c > this.cover[i]) this.cover[i] = c;
  }

  rect(x: number, y: number, w: number, h: number, m: number, tone = 0): void {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.set(x + xx, y + yy, m, tone);
  }

  /** Horizontal run with a cylinder tone profile across its height (a pipe seen side-on). */
  hBar(x: number, y: number, w: number, thick: number, m: number, roundness = 40): void {
    for (let t = 0; t < thick; t++) {
      const u = thick <= 1 ? 0 : (t / (thick - 1)) * 2 - 1;
      const tone = (0.35 - u) * roundness * 0.9;
      for (let xx = 0; xx < w; xx++) this.set(x + xx, y + t, m, tone);
    }
  }

  /** Vertical run with a cylinder tone profile across its width. */
  vBar(x: number, y: number, h: number, thick: number, m: number, roundness = 40): void {
    for (let t = 0; t < thick; t++) {
      const u = thick <= 1 ? 0 : (t / (thick - 1)) * 2 - 1;
      const tone = (0.35 - u) * roundness * 0.9;
      for (let yy = 0; yy < h; yy++) this.set(x + t, y + yy, m, tone);
    }
  }

  disc(cx: number, cy: number, r: number, m: number, tone = 0): void {
    const r2 = r * r;
    for (let y = Math.floor(-r); y <= Math.ceil(r); y++) for (let x = Math.floor(-r); x <= Math.ceil(r); x++) {
      if (x * x + y * y <= r2) this.set(cx + x, cy + y, m, tone - (x + y) * (18 / Math.max(1, r)));
    }
  }

  ring(cx: number, cy: number, r0: number, r1: number, m: number, tone = 0): void {
    const a = r0 * r0, b = r1 * r1;
    for (let y = Math.floor(-r1); y <= Math.ceil(r1); y++) for (let x = Math.floor(-r1); x <= Math.ceil(r1); x++) {
      const d = x * x + y * y;
      if (d >= a && d <= b) this.set(cx + x, cy + y, m, tone);
    }
  }

  /** Thick line (square brush), for spokes, truss members, roots. */
  line(x0: number, y0: number, x1: number, y1: number, thick: number, m: number, tone = 0): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    const h = Math.max(0, thick - 1) / 2;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      for (let yy = Math.floor(-h); yy <= Math.ceil(h); yy++) for (let xx = Math.floor(-h); xx <= Math.ceil(h); xx++) {
        this.set(Math.round(x + xx), Math.round(y + yy), m, tone);
      }
    }
  }

  /** Filled convex/concave polygon (even-odd scanline). */
  poly(points: readonly (readonly [number, number])[], m: number, tone = 0): void {
    let minY = Infinity, maxY = -Infinity;
    for (const p of points) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    const xs: number[] = [];
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      xs.length = 0;
      const sy = y + 0.5;
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
          xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.set(x, y, m, tone);
      }
    }
  }
}

export interface ShadeOptions {
  /** Palette: index = material id (0 unused). */
  readonly materials: readonly (Material | null)[];
  /** Direction TOWARD the light, in texels (e.g. [-1, -1] = lit from the upper left). */
  readonly light: readonly [number, number];
  /** Value multiplier from the top of the plane (t = 0) to the bottom (t = 1). */
  readonly gradient?: (t: number) => number;
  /** Ordered-dither grain amplitude (0–255 units). */
  readonly grain?: number;
  readonly seed?: number;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Shade a mask into an RGBA bitmap (alpha = coverage). */
export function shade(plane: MaskPlane, opts: ShadeOptions): Bitmap {
  const { width: w, height: h, mat, tone, cover } = plane;
  const out = new Uint8ClampedArray(w * h * 4);
  const [lx, ly] = opts.light;
  const grain = opts.grain ?? 6;
  const seed = opts.seed ?? 1;
  for (let y = 0; y < h; y++) {
    const g = opts.gradient ? opts.gradient(y / h) : 1;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const m = mat[i];
      if (m === 0) continue;
      const matl = opts.materials[m];
      if (!matl) continue;
      let r: number, gg: number, b: number;
      if (matl.glow) {
        r = matl.base[0]; gg = matl.base[1]; b = matl.base[2];
      } else {
        const ti = plane.index(x + lx, y + ly), ai = plane.index(x - lx, y - ly);
        const toward = ti < 0 ? 0 : mat[ti];
        const away = ai < 0 ? 0 : mat[ai];
        let c: Rgb = matl.base;
        if (toward !== m && (toward === 0 || opts.materials[toward]?.glow !== true)) c = matl.rim;
        else if (away !== m) c = matl.shade;
        const t = tone[i] / 127;
        const k = (1 + t * 0.45) * g;
        const d = ((BAYER4[(y & 3) * 4 + (x & 3)] / 15) - 0.5) * grain + (hash2(x, y, seed) - 0.5) * grain * 0.6;
        r = c[0] * k + d; gg = c[1] * k + d; b = c[2] * k + d;
        // Tone never drops below the shade colour's floor (keeps the pixel-art ramp).
        r = Math.max(matl.shade[0] * 0.8, r); gg = Math.max(matl.shade[1] * 0.8, gg); b = Math.max(matl.shade[2] * 0.8, b);
      }
      const o = i * 4;
      out[o] = r; out[o + 1] = gg; out[o + 2] = b; out[o + 3] = cover[i];
    }
  }
  return { width: w, height: h, pixels: out };
}

export interface HazeOptions {
  /** Haze colour (0–255). */
  readonly color: Rgb;
  /** 0 = untouched, 1 = pure haze. */
  readonly mix: number;
  /** Contrast kept around the haze value (1 = untouched, 0 = flat). */
  readonly contrast: number;
  /** Saturation kept (1 = untouched). */
  readonly saturation?: number;
  /** Extra haze toward the bottom (floor mist, >0) or top (<0) of the plane. */
  readonly mist?: number;
  /** Emissive texels keep this share of their own colour through the haze. */
  readonly glowKeep?: number;
}

/**
 * Atmospheric perspective, in place: compress contrast toward the haze
 * value, desaturate, then mix toward the haze colour. Far planes take a
 * strong mix and low contrast; near planes almost none.
 */
export function applyHaze(bmp: Bitmap, opts: HazeOptions): Bitmap {
  const { width: w, height: h, pixels } = bmp;
  const pivot = luma(opts.color);
  const sat = opts.saturation ?? 1;
  const mist = opts.mist ?? 0;
  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h - 1);
    const extra = mist > 0 ? mist * t * t : mist < 0 ? -mist * (1 - t) * (1 - t) : 0;
    const m = Math.max(0, Math.min(1, opts.mix + extra));
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (pixels[o + 3] === 0) continue;
      let r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
      r = pivot + (r - pivot) * opts.contrast;
      g = pivot + (g - pivot) * opts.contrast;
      b = pivot + (b - pivot) * opts.contrast;
      const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
      r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
      pixels[o] = r + (opts.color[0] - r) * m;
      pixels[o + 1] = g + (opts.color[1] - g) * m;
      pixels[o + 2] = b + (opts.color[2] - b) * m;
    }
  }
  return bmp;
}

/** Alpha-over `top` onto `base` (same size), in place on `base`. */
export function over(base: Bitmap, top: Bitmap): Bitmap {
  const a = base.pixels, b = top.pixels;
  for (let o = 0; o < a.length; o += 4) {
    const ta = b[o + 3] / 255;
    if (ta <= 0) continue;
    const ba = a[o + 3] / 255;
    const oa = ta + ba * (1 - ta);
    for (let c = 0; c < 3; c++) a[o + c] = (b[o + c] * ta + a[o + c] * ba * (1 - ta)) / Math.max(1e-6, oa);
    a[o + 3] = oa * 255;
  }
  return base;
}

/** An opaque fill: vertical gradient between stops plus tileable fog banks. */
export function fogFill(w: number, h: number, stops: readonly (readonly [number, Rgb])[], fog: {
  readonly color: Rgb; readonly amount: number; readonly cell: number; readonly seed: number;
} | null): Bitmap {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h - 1);
    let c: Rgb = stops[0][1];
    for (let k = 0; k + 1 < stops.length; k++) {
      const [t0, c0] = stops[k], [t1, c1] = stops[k + 1];
      if (t >= t0 && t <= t1) { c = mixRgb(c0, c1, (t - t0) / Math.max(1e-6, t1 - t0)); break; }
      if (t > t1) c = c1;
    }
    for (let x = 0; x < w; x++) {
      let r = c[0], g = c[1], b = c[2];
      if (fog) {
        const n = tileFbm(x, y * 1.8, fog.cell, w, h * 1.8, fog.seed);
        const f = smoothstep(0.42, 0.85, n) * fog.amount;
        r += (fog.color[0] - r) * f; g += (fog.color[1] - g) * f; b += (fog.color[2] - b) * f;
      }
      const d = (BAYER4[(y & 3) * 4 + (x & 3)] / 15 - 0.5) * 2;
      const o = (y * w + x) * 4;
      out[o] = r + d; out[o + 1] = g + d; out[o + 2] = b + d; out[o + 3] = 255;
    }
  }
  return { width: w, height: h, pixels: out };
}

/** Mean luminance and luminance standard deviation of the opaque texels (tests, tuning). */
export function valueStats(bmp: Bitmap): { mean: number; std: number; coverage: number } {
  const p = bmp.pixels;
  let n = 0, s = 0, s2 = 0;
  for (let o = 0; o < p.length; o += 4) {
    if (p[o + 3] < 128) continue;
    const l = p[o] * 0.2126 + p[o + 1] * 0.7152 + p[o + 2] * 0.0722;
    n++; s += l; s2 += l * l;
  }
  const mean = n ? s / n : 0;
  return { mean, std: n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) : 0, coverage: n / (p.length / 4) };
}

import type { KitLight, KitPalette, Rgb } from '@/config/depthKits';
import { type Bitmap, type MaskPlane, hash2, luma, mixRgb, smoothstep, tileFbm } from '@/render/depth/raster';

/**
 * LIT SILHOUETTES — the look that gives Ori / Nine Sols scenes their depth:
 * one luminous far layer (the kit's light: a furnace core, a light well, a
 * spore pool) painted through a restrained colour ramp, and silhouettes in
 * front of it that are nearly flat and step DOWN the ramp toward the viewer.
 * The light behind a silhouette veils it (far planes pick up more of it, so
 * they read lighter and softer) and wraps its edges as a thin rim; interior
 * texture is kept to a whisper so the shapes read first.
 *
 * Every plane evaluates the kit's light in its own coordinates (plane
 * fractions), so a plane's rims brighten where that plane's light pools.
 */

export const M_BODY = 1, M_ACCENT = 2, M_GLOW = 3, M_SOFT = 4;

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Colour at `t` (0 cold/dark … 1 hottest/brightest) along a ramp of stops. */
export function rampColor(stops: readonly (readonly [number, Rgb])[], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let k = 0; k + 1 < stops.length; k++) {
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1];
    if (x <= t1) return mixRgb(c0, c1, (x - t0) / Math.max(1e-6, t1 - t0));
  }
  const last = stops[stops.length - 1][1];
  return [last[0], last[1], last[2]];
}

/** The generic ramp from a palette: deep → haze → fog → a little past it. */
export function paletteRamp(pal: KitPalette): readonly (readonly [number, Rgb])[] {
  if (pal.ramp) return pal.ramp;
  const past: Rgb = [Math.min(255, pal.fog[0] * 1.25), Math.min(255, pal.fog[1] * 1.25), Math.min(255, pal.fog[2] * 1.25)];
  return [[0, pal.deep], [0.35, mixRgb(pal.deep, pal.haze, 0.6)], [0.65, pal.haze], [0.88, pal.fog], [1, past]];
}

function rowLight(rows: KitLight['rows'], t: number): number {
  for (let k = 0; k + 1 < rows.length; k++) {
    const [t0, v0] = rows[k], [t1, v1] = rows[k + 1];
    if (t <= t1) return v0 + (v1 - v0) * smoothstep(0, 1, (t - t0) / Math.max(1e-6, t1 - t0));
  }
  return rows[rows.length - 1][1];
}

/**
 * The kit's light over a plane (0–1 per texel): a vertical profile, soft
 * elliptical cores with a power falloff (a hot core, not a flat wash) and a
 * slow smoke modulation. Tiles in x; the row profile wraps in y.
 */
export function lightField(w: number, h: number, light: KitLight, seed: number): Float32Array {
  // The light is smooth: evaluate it on a 4-texel lattice and interpolate
  // (sixteen times fewer noise evaluations; the bake stays a few ms a plane).
  const S = 4, gw = Math.ceil(w / S), gh = Math.ceil(h / S) + 1;
  const grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const y = Math.min(h, gy * S);
    const base = rowLight(light.rows, y / h);
    for (let gx = 0; gx < gw; gx++) {
      const x = gx * S;
      let v = base;
      for (const c of light.cores) {
        let dx = Math.abs(x - c.x * w);
        dx = Math.min(dx, w - dx);
        const dy = y - c.y * h;
        const e = Math.hypot(dx / (c.rx * w), dy / (c.ry * h));
        if (e >= 1) continue;
        const k = Math.pow(1 - e, light.falloff) * c.k;
        v = 1 - (1 - v) * (1 - k);
      }
      if (light.smoke > 0) {
        const n = tileFbm(x, y * 1.6, light.smokeCell, w, h * 1.6, seed);
        v *= 1 - light.smoke + light.smoke * (0.45 + 1.1 * n);
      }
      grid[gy * gw + gx] = Math.max(0, Math.min(1, v));
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = y / S, y0 = Math.floor(fy), ty = fy - y0, y1 = Math.min(gh - 1, y0 + 1);
    for (let x = 0; x < w; x++) {
      const fx = x / S, x0 = Math.floor(fx) % gw, tx = fx - Math.floor(fx), x1 = (x0 + 1) % gw;
      const a = grid[y0 * gw + x0], b = grid[y0 * gw + x1], c = grid[y1 * gw + x0], d = grid[y1 * gw + x1];
      out[y * w + x] = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    }
  }
  return out;
}

function dither(x: number, y: number, amp: number): number {
  return (BAYER4[(y & 3) * 4 + (x & 3)] / 15 - 0.5) * amp;
}

/** An opaque far plane: the light itself, painted through the ramp (no silhouettes). */
export function paintLight(w: number, h: number, field: Float32Array, ramp: readonly (readonly [number, Rgb])[], scale = 1): Bitmap {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, c = rampColor(ramp, field[i] * scale), d = dither(x, y, 3);
    px[i * 4] = c[0] + d; px[i * 4 + 1] = c[1] + d; px[i * 4 + 2] = c[2] + d; px[i * 4 + 3] = 255;
  }
  return { width: w, height: h, pixels: px };
}

export interface SilhouetteOptions {
  readonly ramp: readonly (readonly [number, Rgb])[];
  /** The plane's light (same size as the mask). */
  readonly field: Float32Array;
  /** Where the silhouettes sit on the ramp with no light behind them (far ~0.12, near ~0.02). */
  readonly value: number;
  /** How far the light behind lifts a silhouette up the ramp (atmospheric veil). */
  readonly veil: number;
  /** Rim: how far up the ramp an edge facing the light climbs, × the light there. */
  readonly rim: number;
  /** Direction TOWARD the light for the full rim ([0, 1] = from below); null = all edges alike. */
  readonly rimDir: readonly [number, number] | null;
  /** Material-2 tint (copper, caps, brick) and how much of it survives. */
  readonly accent?: { readonly color: Rgb; readonly mix: number };
  /** Emissive accents (mouths, spores, windows) and soft light (hearth glow, plumes). */
  readonly glow: Rgb;
  readonly soft: Rgb;
  /** How much of the motifs' tone texture survives (0 = flat silhouettes). */
  readonly tone?: number;
  /** An opaque base to paint over (the far plane's light), or null for a transparent plane. */
  readonly base?: Bitmap | null;
}

/** Paint a mask as lit silhouettes (over `base` if given). */
export function paintSilhouettes(p: MaskPlane, o: SilhouetteOptions): Bitmap {
  const { width: w, height: h, mat, tone, cover } = p;
  const out = o.base ? new Uint8ClampedArray(o.base.pixels) : new Uint8ClampedArray(w * h * 4);
  const toneK = o.tone ?? 0.12;
  // Solid = body or accent; wrapped neighbour reads (planes tile).
  const solidAt = (x: number, y: number): boolean => {
    const xi = x < 0 ? x + w : x >= w ? x - w : x, yi = y < 0 ? y + h : y >= h ? y - h : y;
    const v = mat[yi * w + xi];
    return v === M_BODY || v === M_ACCENT;
  };
  const rx = o.rimDir ? o.rimDir[0] : 0, ry = o.rimDir ? o.rimDir[1] : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, m = mat[i];
    if (m === 0) continue;
    const o4 = i * 4;
    const L = o.field[i];
    if (m === M_GLOW) {
      out[o4] = o.glow[0]; out[o4 + 1] = o.glow[1]; out[o4 + 2] = o.glow[2]; out[o4 + 3] = 255;
      continue;
    }
    if (m === M_SOFT) {
      const a = cover[i] / 255;
      if (o.base) {
        out[o4] += (o.soft[0] - out[o4]) * a; out[o4 + 1] += (o.soft[1] - out[o4 + 1]) * a; out[o4 + 2] += (o.soft[2] - out[o4 + 2]) * a;
      } else {
        out[o4] = o.soft[0]; out[o4 + 1] = o.soft[1]; out[o4 + 2] = o.soft[2]; out[o4 + 3] = cover[i];
      }
      continue;
    }
    // Edges: full rim toward the light, half on the other open sides.
    let edge = 0;
    const open4 = !solidAt(x + 1, y) || !solidAt(x - 1, y) || !solidAt(x, y - 1) || !solidAt(x, y + 1);
    if (o.rimDir) {
      if (!solidAt(x + rx, y + ry)) edge = 1;
      else if (open4) edge = 0.4;
    } else if (open4) edge = 0.8;
    let t = o.value + o.veil * L;
    if (edge > 0) t += o.rim * L * edge;
    let c = rampColor(o.ramp, t);
    if (m === M_ACCENT && o.accent) {
      // Keep the silhouette's value, borrow the accent's hue.
      const a = o.accent.color, k = luma(c) / Math.max(1, luma(a));
      c = mixRgb(c, [a[0] * k, a[1] * k, a[2] * k], o.accent.mix);
    }
    const k = 1 + (tone[i] / 127) * toneK;
    const d = dither(x, y, 2) + (hash2(x, y, 7) - 0.5) * 2;
    out[o4] = c[0] * k + d; out[o4 + 1] = c[1] * k + d; out[o4 + 2] = c[2] * k + d; out[o4 + 3] = 255;
  }
  return { width: w, height: h, pixels: out };
}

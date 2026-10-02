import type { Chain } from '@/creatures/rig/chain';
import type { CreatureRaster, PrimOpts } from '@/render/creatures/raster';

/**
 * Small drawing helpers the hooded looks share (Sable Fen, Mara Quell, Nox Calder): cloth as a sheet between
 * two verlet rails, ragged tongues for a torn hem, wraps and bands across a limb. Pure functions of the
 * raster and the posed rig, no state, no randomness (every wobble is a function of the tick), so the living
 * figure and the ragdoll share every stitch.
 */

export interface P { x: number; y: number }

export const fract = (v: number): number => v - Math.floor(v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const P2 = (x: number, y: number): P => ({ x, y });
export const mixP = (a: P, b: P, t: number): P => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/**
 * The chain's points pushed `off` cells sideways: positive is to the left of the way the chain runs (a chain
 * hanging straight down is pushed to screen-left), so callers pass a sign that moves it away from the body.
 */
export function railP(pts: readonly P[], off: number): P[] {
  const out: P[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    out.push({ x: pts[i].x - dy * off, y: pts[i].y + dx * off });
  }
  return out;
}

export function rail(ch: Chain, off: number, from = 0, to = ch.pts.length - 1): P[] {
  return railP(ch.pts.slice(from, to + 1), off);
}

/** The unit vector a chain runs along at its tail end. */
export function tailDir(ch: Chain): P {
  const n = ch.pts.length;
  const a = ch.pts[Math.max(0, n - 2)], b = ch.pts[n - 1];
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

const BUF = new Float64Array(96);

/** A filled sheet through the points (flat or pillowed by `dome`). */
export function sheet(r: CreatureRaster, pts: readonly P[], z: number, mat: number, group: number, dome = 1, o: PrimOpts = {}): void {
  const n = Math.min(pts.length, BUF.length / 2);
  for (let i = 0; i < n; i++) { BUF[i * 2] = pts[i].x; BUF[i * 2 + 1] = pts[i].y; }
  r.poly(BUF, n, z, mat, dome, { group, ...o });
}

/** A tapered strand: from (x, y) along (dx, dy) for `len` cells, `w0` wide at the root to `w1` at the tip. */
export function strand(r: CreatureRaster, x: number, y: number, dx: number, dy: number, len: number, w0: number, w1: number, z: number, mat: number, group: number, o: PrimOpts = {}): void {
  r.capsule(x, y, w0, x + dx * len, y + dy * len, w1, z, z, mat, { group, ...o });
}

/**
 * A torn hem: vertices alternating between long tongues and short notches along the line a -> b, hanging
 * `down` (unit vector). `lens` are the tongue lengths, `phase` sways them (the tick). Returns the points,
 * left to right, to splice into a sheet.
 */
export function tornHem(a: P, b: P, down: P, lens: readonly number[], notch: number, phase: number, sway = 0.35): P[] {
  const out: P[] = [];
  const n = lens.length;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const base = mixP(a, b, t);
    const w = Math.sin(phase * 0.11 + k * 1.9) * sway;
    out.push({ x: base.x + down.x * lens[k] - down.y * w, y: base.y + down.y * lens[k] + down.x * w });
    if (k < n - 1) {
      const m = mixP(a, b, (k + 1) / n);
      out.push({ x: m.x + down.x * notch, y: m.y + down.y * notch });
    }
  }
  return out;
}

/** Stripes across a limb (a bandage's turns, a boot's wraps): `n` bands between a and b, each `half` cells across. */
export function bands(r: CreatureRaster, a: P, b: P, t0: number, t1: number, n: number, half: number, thick: number, mat: number, tone: number, group: number): void {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? (t0 + t1) / 2 : lerp(t0, t1, k / (n - 1));
    const p = mixP(a, b, t);
    r.stamp(p.x, p.y, thick, half, ang, mat, tone, false, group);
  }
}

/** A sub-segment of a limb thickened into a wrap (a boot's cuff, a bracer): a capsule from t0 to t1 along a -> b. */
export function cuff(r: CreatureRaster, a: P, b: P, t0: number, t1: number, ra: number, rb: number, z: number, mat: number, group: number, o: PrimOpts = {}): void {
  const p = mixP(a, b, t0), q = mixP(a, b, t1);
  r.capsule(p.x, p.y, ra, q.x, q.y, rb, z, z, mat, { group, ...o });
}

/**
 * A wisp of smoke: `n` puffs riding a rising, swaying path off (x, y), each swelling and thinning over its life
 * (the tick is the only clock). `mat` should be a translucent material; `drift` leans the column (cells it
 * leans over its rise: negative is left), `rise` is how far it climbs, `seed` offsets the whole wisp.
 */
export function wisp(r: CreatureRaster, x: number, y: number, frame: number, mat: number, group: number, z: number, drift: number, rise: number, seed: number, n = 4, size = 1.5, period = 96): void {
  for (let k = 0; k < n; k++) {
    const p = fract(frame / period + k / n + seed);
    // No two puffs alike: each has its own size.
    const mine = 0.65 + 0.7 * fract(k * 0.618 + seed * 3.1);
    const rad = size * mine * Math.pow(Math.sin(Math.PI * p), 0.8) + 0.18;
    if (rad < 0.42) continue;
    // Each puff takes its own line off the column and thins into the dark as it ages (a darker ramp step, not a smaller blob).
    const own = (((k * 37 + Math.floor(seed * 101)) % 5) - 2) * 0.45;
    const sway = Math.sin(frame * 0.045 + k * 2.1 + seed * 9) * 0.9 * p + own * p;
    r.ellipse(x + drift * p + sway, y - rise * Math.pow(p, 0.85), rad * 1.2, rad, 0, z, mat, { group, noOutline: true, depth: 0.6, tone: -2.4 * p * p });
  }
}

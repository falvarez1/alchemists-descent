export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/** Linear interpolation between a and b by t. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Walk the integer points of a line from (x0,y0) to (x1,y1), invoking `plot`
 *  at each step (endpoints inclusive). Step count tracks pixel length so the
 *  line is gap-free. Shared by sprite limbs and other pixel/cell line drawing. */
export function traceLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: (x: number, y: number, t: number) => void,
): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    plot(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), t);
  }
}

/** Cubic smoothstep easing (Hermite) of t in [0,1]: t*t*(3-2t). */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Deterministic 2D integer hash → [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothstep-interpolated value noise over the hash2 lattice. */
export function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const fx = x * scale;
  const fy = y * scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

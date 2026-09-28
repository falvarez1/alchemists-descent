/**
 * Creature palettes: hand-keyed colour ramps interpolated in OKLab.
 *
 * Every creature material is a short ramp (deep shadow → specular) authored
 * from three or four key colours. OKLab interpolation keeps the in-between
 * steps clean — no grey mud between a teal shadow and a warm highlight — and
 * lets each species keep one strong identity colour the way Rain World's
 * lizards are read by their heads.
 *
 * Values are linear-ish display RGB in 0..1, the same space the frame
 * composer and every other sprite write in.
 */

export type RGB = readonly [number, number, number];

/** A shading ramp: `steps` RGB triples packed flat, darkest first. */
export interface Ramp {
  readonly steps: number;
  readonly rgb: Float32Array;
}

export function hex(value: number): RGB {
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

// --- OKLab (Björn Ottosson) on sRGB-encoded inputs --------------------------
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055);

function oklab(c: RGB): [number, number, number] {
  const r = toLinear(c[0]), g = toLinear(c[1]), b = toLinear(c[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  return [clamp01(toSrgb(r)), clamp01(toSrgb(g)), clamp01(toSrgb(bb))];
}

/** Mix two colours in OKLab. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  const p = oklab(a), q = oklab(b);
  return fromOklab(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t);
}

/**
 * Build a ramp through the given key colours (darkest first), resampled to
 * `steps` entries with OKLab interpolation between neighbouring keys.
 */
export function ramp(keys: readonly number[], steps = 6): Ramp {
  const rgb = new Float32Array(steps * 3);
  const labs = keys.map(k => oklab(hex(k)));
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : (i / (steps - 1)) * (labs.length - 1);
    const k = Math.min(labs.length - 2, Math.floor(t)), f = t - k;
    const a = labs[k], b = labs[Math.min(labs.length - 1, k + 1)];
    const c = fromOklab(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
    rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
  }
  return { steps, rgb };
}

/**
 * How a surface answers light. `ramp` carries its colour; the rest are
 * response terms the rasterizer's lighting pass reads per pixel.
 */
export interface CreatureMaterial {
  ramp: Ramp;
  /** 0..1 specular strength (wet skin, lacquered chitin). */
  gloss: number;
  /** Specular tightness: higher = smaller, sharper highlight. */
  shine: number;
  /** 0..1 light-side rim (fresnel) boost. */
  rim: number;
  /** 0..1 self-illumination: ignores the scene light, feeds bloom. */
  emissive: number;
  /** Additive glow poured over emissive pixels (bloom fuel), RGB. */
  glow: RGB;
  /** 0..1 terrain shows through (gel, membranes, jelly bells). */
  translucent: number;
  /** Silhouette outline colour (sel-out: a dark tint of the body, not black). */
  outline: RGB;
  /** Ramp offset (in steps) when this material sits on a far/back layer. */
  farDarken: number;
}

export interface MaterialSpec {
  keys: readonly number[];
  steps?: number;
  gloss?: number;
  shine?: number;
  rim?: number;
  emissive?: number;
  glow?: number;
  glowK?: number;
  translucent?: number;
  outline?: number;
  farDarken?: number;
}

export function material(spec: MaterialSpec): CreatureMaterial {
  const r = ramp(spec.keys, spec.steps ?? 6);
  const outline: RGB = spec.outline !== undefined ? hex(spec.outline)
    : [r.rgb[0] * 0.45, r.rgb[1] * 0.45, r.rgb[2] * 0.5];
  const g = spec.glow !== undefined ? hex(spec.glow) : ([0, 0, 0] as RGB);
  const k = spec.glowK ?? 1;
  return {
    ramp: r,
    gloss: spec.gloss ?? 0,
    shine: spec.shine ?? 12,
    rim: spec.rim ?? 0.35,
    emissive: spec.emissive ?? 0,
    glow: [g[0] * k, g[1] * k, g[2] * k],
    translucent: spec.translucent ?? 0,
    outline,
    farDarken: spec.farDarken ?? 1.1,
  };
}

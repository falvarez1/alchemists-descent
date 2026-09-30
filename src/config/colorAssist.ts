/**
 * Colour assist (a player option): the HUD's HP / MANA / LEV bars are told apart by hue, and the shipped
 * hues (a salmon, a teal, a straw gold) run together for some colour-blind players. This is the palette
 * the assist swaps them for, and the tools that say why it is better: a simulation of how each kind of
 * colour-vision deficiency sees a colour, and the distance between two colours as they are then seen.
 *
 * Only the HUD's accents move. The world's material hues are designed and stay as painted (no full remap);
 * the bars also gain a pattern each (options.css), so colour is never the only cue.
 */

export type CvdType = 'protan' | 'deutan' | 'tritan';

export interface BarPalette { hp: string; mana: string; levit: string }

/** What house.css paints the three bars today. */
export const SHIPPED_BARS: Readonly<BarPalette> = { hp: '#d4826a', mana: '#88bfcd', levit: '#cdb678' };

/**
 * Chosen by searching candidate hues for the best worst-case separation as simulated below. Red-green
 * is judged against red-weak (protan) and green-weak (deutan) sight, blue-yellow against tritan.
 */
export const ASSIST_PALETTES: Readonly<Record<'red-green' | 'blue-yellow', BarPalette>> = {
  'red-green': { hp: '#d94f5c', mana: '#7fb0ff', levit: '#f0e442' },
  'blue-yellow': { hp: '#c2185b', mana: '#56b4e9', levit: '#ffd23f' },
};

/** Machado, Oliveira & Fernandes (2009), full severity, applied to linear sRGB. */
const CVD: Readonly<Record<CvdType, readonly (readonly number[])[]>> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

const toLinear = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toSrgb = (v: number): number => Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));

/** How `hex` looks to someone with the given deficiency (or as it is, with none). */
export function simulateCvd(hex: string, type: CvdType | null): string {
  const rgb = parseHex(hex);
  if (!type) return toHex(rgb);
  const lin = rgb.map(toLinear);
  return toHex(CVD[type].map((row) => toSrgb(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])));
}

function toLab(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map(toLinear);
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Distance between two colours in CIE Lab (CIE76): about 2.3 is a just-noticeable difference, 20+ is plainly different. */
export function deltaE(a: string, b: string): number {
  const la = toLab(a), lb = toLab(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/** The closest any two of the bar colours come to each other, as seen with the given deficiency. */
export function minSeparation(palette: BarPalette, type: CvdType | null): number {
  const seen = [palette.hp, palette.mana, palette.levit].map((c) => simulateCvd(c, type));
  return Math.min(deltaE(seen[0], seen[1]), deltaE(seen[0], seen[2]), deltaE(seen[1], seen[2]));
}

/** A lighter tint of a colour (the one-pixel lit edge along a bar's fill). */
export function lighten(hex: string, amount: number): string {
  const t = Math.max(0, Math.min(1, amount));
  return toHex(parseHex(hex).map((v) => v + (255 - v) * t));
}

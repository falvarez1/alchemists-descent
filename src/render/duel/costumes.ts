import type { FighterId } from '@/content/fighters';

/**
 * ALTERNATE COSTUMES (Duel mirror matches): when both seats pick the same fighter, P2 wears a second colourway so the
 * two read apart at a glance. Nothing is stored: each fighter has one rule naming its signature cloth by colour (a hue
 * window, with saturation and brightness bounds that keep skin, metal and the dark outline out of it) and where that
 * cloth goes. The atlas (and a bust, through recolorImageData) is recoloured on the fly from the same rule.
 */
/** One colour moved: the pixels of a hue window (with saturation and brightness bounds) go to another hue. */
export interface CostumeShift {
  /** The hue window in degrees, [from, to] (may wrap through 0). */
  readonly hue: readonly [number, number];
  /** Minimum saturation (0..1) a pixel needs to count. */
  readonly sat: number;
  /** Brightness window (0..1). */
  readonly val: readonly [number, number];
  /** The hue the window's centre moves to; its own variation (folds, light) rides along at half strength. */
  readonly to: number;
  /** Saturation and brightness multipliers for the moved colour. */
  readonly satScale?: number;
  readonly valScale?: number;
}
export interface CostumeRule {
  /** Tried in order; the first that holds the pixel moves it. */
  readonly shifts: readonly CostumeShift[];
  /** Optional: a near-neutral cloth (a black cloak) tinted toward a hue instead of rotated. */
  readonly tint?: { readonly hue: number; readonly sat: number; readonly val: readonly [number, number]; readonly maxSat: number };
}

export const COSTUMES: Readonly<Record<FighterId, CostumeRule>> = {
  // The teal coat goes crimson.
  'ilyra-voss': { shifts: [{ hue: [140, 215], sat: 0.25, val: [0.12, 1], to: 352, satScale: 1.05 }] },
  // Brass trim becomes blued steel.
  'brann-rook': { shifts: [{ hue: [18, 55], sat: 0.3, val: [0.15, 1], to: 205, satScale: 0.55, valScale: 1.08 }] },
  // The violet robe goes emerald.
  'mara-quell': { shifts: [{ hue: [255, 345], sat: 0.2, val: [0.1, 1], to: 150 }] },
  // The green hood and cloak go slate blue.
  'sable-fen': { shifts: [{ hue: [55, 135], sat: 0.2, val: [0.1, 1], to: 215, satScale: 1.3 }] },
  // The red scarf and wraps go cobalt (skin, being less saturated, stays).
  'kest-rel': { shifts: [{ hue: [335, 18], sat: 0.55, val: [0.18, 1], to: 222 }] },
  // The black cloak takes an indigo cast and the lantern burns violet.
  'nox-calder': { shifts: [{ hue: [15, 60], sat: 0.45, val: [0.35, 1], to: 280 }], tint: { hue: 262, sat: 0.5, val: [0.08, 0.6], maxSat: 0.25 } },
  // Gold armour and halo become silver.
  'edda-morrow': { shifts: [{ hue: [28, 62], sat: 0.3, val: [0.2, 1], to: 205, satScale: 0.35, valScale: 1.05 }] },
  // The night-blue suit goes magenta.
  'selene-wraith': { shifts: [{ hue: [195, 265], sat: 0.2, val: [0.1, 1], to: 318 }] },
  // The forge's red-orange goes to a cold teal forge.
  'rusk-emberjaw': { shifts: [{ hue: [350, 40], sat: 0.45, val: [0.15, 1], to: 192, satScale: 0.95 }] },
  // The green robe and vines go violet.
  'father-thorne': { shifts: [{ hue: [55, 140], sat: 0.2, val: [0.1, 1], to: 282, satScale: 0.95 }] },
};

const inWindow = (h: number, [a, b]: readonly [number, number]): boolean => (a <= b ? h >= a && h <= b : h >= a || h <= b);
/** The window's centre (through a wrap) and a signed offset of `h` from it. */
function offsetFromCentre(h: number, [a, b]: readonly [number, number]): number {
  const span = (b - a + 360) % 360, centre = (a + span / 2) % 360;
  let d = h - centre;
  if (d > 180) d -= 360; if (d < -180) d += 360;
  return d;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

/** One pixel (0..1 channels) in the alternate colourway; untouched when it is not the cloth. */
export function recolorPixel(r: number, g: number, b: number, rule: CostumeRule): [number, number, number] {
  const [h, s, v] = rgbToHsv(r, g, b);
  if (rule.tint && s <= rule.tint.maxSat && v >= rule.tint.val[0] && v <= rule.tint.val[1]) {
    // A near-neutral cloth takes the tint's hue, more where it is lit (the outline and deep shadow stay black).
    const k = (v - rule.tint.val[0]) / Math.max(0.01, rule.tint.val[1] - rule.tint.val[0]);
    return hsvToRgb(rule.tint.hue, Math.min(1, s + rule.tint.sat * (0.5 + 0.5 * k)), v);
  }
  for (const shift of rule.shifts) {
    if (s < shift.sat || v < shift.val[0] || v > shift.val[1] || !inWindow(h, shift.hue)) continue;
    const nh = (shift.to + offsetFromCentre(h, shift.hue) * 0.5 + 360) % 360;
    return hsvToRgb(nh, Math.min(1, s * (shift.satScale ?? 1)), Math.min(1, v * (shift.valScale ?? 1)));
  }
  return [r, g, b];
}

/**
 * Recolour RGBA pixels in place (an atlas, a bust drawn to a canvas): alpha untouched. `floor` leaves pixels darker
 * than it alone: a bust's painted background (#111a24) is slate, close enough to a blue cloth to be caught otherwise.
 */
export function recolorImageData(data: Uint8ClampedArray | Uint8Array, rule: CostumeRule, floor = 0): void {
  const min = Math.round(floor * 255);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0 || Math.max(data[i], data[i + 1], data[i + 2]) < min) continue;
    const [r, g, b] = recolorPixel(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, rule);
    data[i] = Math.round(r * 255); data[i + 1] = Math.round(g * 255); data[i + 2] = Math.round(b * 255);
  }
}

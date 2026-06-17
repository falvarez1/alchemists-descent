import { Cell } from '@/sim/CellType';
import { CELL_NAME, CELL_PALETTE, cellForColor, nearestPaletteCell } from '@/sim/cellPalette';
import { unpackB, unpackG, unpackR } from '@/sim/colors';

/**
 * Pure cell-grid <-> RGBA-buffer mapping for the PNG round-trip (the
 * browser-only encode/decode lives in png.ts; this module is the logic and
 * is node-testable). The contract:
 *
 *   - every material renders as its canonical marker color, fully opaque
 *   - Empty renders as transparency (alpha 0) and only transparency maps
 *     back to Empty — opaque off-palette colors are ERRORS, reported with
 *     a nearest-material suggestion so the UI can offer "snap all"
 *   - alpha is binary at threshold 128; semi-transparent pixels are counted
 *     as a warning (they were drawn with a soft brush by accident)
 */

export interface UnknownColor {
  rgb: number;
  count: number;
  /** Nearest material suggestion + its Manhattan distance. */
  suggestion: number;
  dist: number;
  firstAt: { x: number; y: number };
}

export interface RgbaDecodeResult {
  cells: Uint8Array;
  /** Empty = clean import. Capped — a photo pasted by mistake stays sane. */
  unknown: UnknownColor[];
  /** Count of 0 < alpha < 255 pixels (thresholded at 128, warned about). */
  semiTransparent: number;
}

/** Most distinct stray colors reported before the list caps out. File-internal. */
const UNKNOWN_REPORT_CAP = 64;

export function cellsToRgba(cells: Uint8Array, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const t = cells[i];
    if (t === Cell.Empty) continue; // rgba already 0,0,0,0
    const p = CELL_PALETTE[t] ?? CELL_PALETTE[Cell.Empty];
    const o = i * 4;
    out[o] = unpackR(p);
    out[o + 1] = unpackG(p);
    out[o + 2] = unpackB(p);
    out[o + 3] = 255;
  }
  return out;
}

export function rgbaToCells(rgba: Uint8ClampedArray, w: number, h: number): RgbaDecodeResult {
  const cells = new Uint8Array(w * h);
  const unknown = new Map<number, UnknownColor>();
  let semiTransparent = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const a = rgba[o + 3];
    if (a > 0 && a < 255) semiTransparent++;
    if (a < 128) continue; // transparent -> Empty
    const rgb = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    const cell = cellForColor(rgb);
    if (cell !== null) {
      cells[i] = cell;
      continue;
    }
    const seen = unknown.get(rgb);
    if (seen) {
      seen.count++;
    } else if (unknown.size < UNKNOWN_REPORT_CAP) {
      const near = nearestPaletteCell(rgb);
      unknown.set(rgb, {
        rgb,
        count: 1,
        suggestion: near.cell,
        dist: near.dist,
        firstAt: { x: i % w, y: Math.floor(i / w) },
      });
    }
    // unknown pixels decode as Empty until the caller snaps or cancels
  }
  return {
    cells,
    unknown: [...unknown.values()].sort((a, b) => b.count - a.count),
    semiTransparent,
  };
}

/** Resolve EVERY opaque pixel to its nearest material (the "snap all" path). */
export function snapUnknown(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const cells = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue;
    const rgb = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    cells[i] = cellForColor(rgb) ?? nearestPaletteCell(rgb).cell;
  }
  return cells;
}

export function colorHex(rgb: number): string {
  return '#' + rgb.toString(16).padStart(6, '0');
}

export function cellDisplayName(t: number): string {
  return CELL_NAME[t] ?? 'Cell ' + t;
}

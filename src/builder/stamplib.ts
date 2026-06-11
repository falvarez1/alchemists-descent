import { rleDecode, rleEncode } from '@/core/rle';
import type { World } from '@/sim/World';
import { writeCell } from '@/builder/terrain';
import type { PatchRecorder, Region } from '@/builder/terrain';
import { freshId } from '@/builder/document';

/**
 * Stamp library (docs/BUILDER.md "Stamp" tools): reusable authored chunks —
 * door frames, sensor basins, arena pieces, light rigs' terrain. A stamp is
 * a rectangular cell-type block captured from a region; colors regenerate
 * from material factories on paste (same rule as the world layer), so
 * stamps stay small and biome-recolorable. Rotate/mirror are pure
 * transforms; paste writes the full block (including authored emptiness —
 * a carved doorway IS its empty cells) through the undo recorder.
 */

export interface StampDef {
  id: string;
  name: string;
  w: number;
  h: number;
  rle: string;
}

const STAMPS_KEY = 'noita-builder-stamps';
/** Capture cap: stamps are chunks, not whole levels. */
export const STAMP_CELL_CAP = 40000;

export function loadStamps(): StampDef[] {
  try {
    const raw = localStorage.getItem(STAMPS_KEY);
    const list = raw ? (JSON.parse(raw) as StampDef[]) : [];
    return Array.isArray(list) ? list.filter((s) => s && s.w > 0 && s.h > 0) : [];
  } catch {
    return [];
  }
}

export function saveStamps(list: StampDef[]): boolean {
  try {
    localStorage.setItem(STAMPS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function captureStamp(world: World, region: Region, name: string): StampDef | null {
  const w = region.x1 - region.x0 + 1;
  const h = region.y1 - region.y0 + 1;
  if (w <= 0 || h <= 0 || w * h > STAMP_CELL_CAP) return null;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const X = region.x0 + x,
        Y = region.y0 + y;
      cells[x + y * w] = world.inBounds(X, Y) ? world.types[world.idx(X, Y)] : 0;
    }
  }
  return { id: freshId('stamp'), name: name || 'stamp', w, h, rle: rleEncode(cells) };
}

export function decodeStamp(s: StampDef): Uint8Array {
  const out = new Uint8Array(s.w * s.h);
  rleDecode(s.rle, out);
  return out;
}

/** 90 degrees clockwise: src(x, y) -> dst(h-1-y, x). */
export function rotateStamp(s: StampDef): StampDef {
  const src = decodeStamp(s);
  const dst = new Uint8Array(s.w * s.h);
  const dw = s.h;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      dst[s.h - 1 - y + x * dw] = src[x + y * s.w];
    }
  }
  return { ...s, w: s.h, h: s.w, rle: rleEncode(dst) };
}

export function mirrorStamp(s: StampDef): StampDef {
  const src = decodeStamp(s);
  const dst = new Uint8Array(s.w * s.h);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      dst[s.w - 1 - x + y * s.w] = src[x + y * s.w];
    }
  }
  return { ...s, rle: rleEncode(dst) };
}

/** Paste centered on (cx, cy) through the recorder; returns cells written. */
export function pasteStamp(
  world: World,
  rec: PatchRecorder,
  s: StampDef,
  cx: number,
  cy: number,
): number {
  const cells = decodeStamp(s);
  const x0 = cx - Math.floor(s.w / 2);
  const y0 = cy - Math.floor(s.h / 2);
  let n = 0;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (!world.inBounds(x0 + x, y0 + y)) continue;
      writeCell(world, rec, x0 + x, y0 + y, cells[x + y * s.w]);
      n++;
    }
  }
  return n;
}

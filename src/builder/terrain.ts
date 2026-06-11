import type { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR } from '@/sim/colors';
import type { CellPatch } from '@/builder/commands';

/**
 * Builder terrain tools (docs/BUILDER.md Phase 4): deterministic authored
 * shapes — line, rectangle, ellipse, flood fill, replace — all writing
 * through a PatchRecorder so every operation lands as ONE undoable command.
 *
 * Unlike the Sandbox brush (which protects Wall/Metal from loose spray),
 * these are precision tools: they write exactly the cells they say. The
 * recorder snapshots each cell once before its first write; finish() diffs
 * away untouched cells so undo patches stay sparse.
 */

export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Snapshots cells before mutation; one snapshot per cell per operation. */
export class PatchRecorder {
  private readonly seen = new Set<number>();
  private readonly before: CellPatch = { idxs: [], types: [], colors: [], life: [], charge: [] };

  constructor(private readonly w: World) {}

  get size(): number {
    return this.seen.size;
  }

  touch(i: number): void {
    if (this.seen.has(i)) return;
    this.seen.add(i);
    const w = this.w;
    this.before.idxs.push(i);
    this.before.types.push(w.types[i]);
    this.before.colors.push(w.colors[i]);
    this.before.life.push(w.life[i]);
    this.before.charge.push(w.charge[i]);
  }

  /** Diff the live world against the snapshots: changed cells only. */
  finish(): { before: CellPatch; after: CellPatch } | null {
    const w = this.w;
    const s = this.before;
    const before: CellPatch = { idxs: [], types: [], colors: [], life: [], charge: [] };
    const after: CellPatch = { idxs: [], types: [], colors: [], life: [], charge: [] };
    for (let n = 0; n < s.idxs.length; n++) {
      const i = s.idxs[n];
      if (
        w.types[i] === s.types[n] &&
        w.colors[i] === s.colors[n] &&
        w.life[i] === s.life[n] &&
        w.charge[i] === s.charge[n]
      )
        continue;
      before.idxs.push(i);
      before.types.push(s.types[n]);
      before.colors.push(s.colors[n]);
      before.life.push(s.life[n]);
      before.charge.push(s.charge[n]);
      after.idxs.push(i);
      after.types.push(w.types[i]);
      after.colors.push(w.colors[i]);
      after.life.push(w.life[i]);
      after.charge.push(w.charge[i]);
    }
    return before.idxs.length === 0 ? null : { before, after };
  }
}

/** Authored cell write: type + fresh factory color + sane life/charge. */
export function writeCell(w: World, rec: PatchRecorder, x: number, y: number, type: number): void {
  if (!w.inBounds(x, y)) return;
  const i = w.idx(x, y);
  rec.touch(i);
  w.types[i] = type;
  const fn = COLOR_FN[type];
  w.colors[i] = fn ? fn() : EMPTY_COLOR;
  if (type === Cell.Smoke) w.life[i] = 30 + Math.floor(Math.random() * 40);
  else if (type === Cell.Fire) w.life[i] = 15 + Math.floor(Math.random() * 30);
  else w.life[i] = 0;
  w.charge[i] = 0;
}

function disc(w: World, rec: PatchRecorder, cx: number, cy: number, r: number, type: number): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) writeCell(w, rec, cx + dx, cy + dy, type);
    }
  }
}

/** Bresenham line of solid discs (the LINE tool; radius = brush size). */
export function stampLine(
  w: World,
  rec: PatchRecorder,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  type: number,
): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    disc(w, rec, x0, y0, radius, type);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** Axis-aligned rectangle from two corners; 1-cell outline unless filled. */
export function stampRect(
  w: World,
  rec: PatchRecorder,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  type: number,
  filled: boolean,
): void {
  const x0 = Math.min(ax, bx),
    x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by),
    y1 = Math.max(ay, by);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (filled || x === x0 || x === x1 || y === y0 || y === y1) writeCell(w, rec, x, y, type);
    }
  }
}

/** Ellipse inscribed in the corner-to-corner box; 1-cell rim unless filled. */
export function stampEllipse(
  w: World,
  rec: PatchRecorder,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  type: number,
  filled: boolean,
): void {
  const x0 = Math.min(ax, bx),
    x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by),
    y1 = Math.max(ay, by);
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2;
  const rx = Math.max(0.5, (x1 - x0) / 2),
    ry = Math.max(0.5, (y1 - y0) / 2);
  const inside = (x: number, y: number, sx: number, sy: number): boolean => {
    const nx = (x - cx) / sx,
      ny = (y - cy) / sy;
    return nx * nx + ny * ny <= 1;
  };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y, rx, ry)) continue;
      if (filled || !inside(x, y, Math.max(0.5, rx - 1.2), Math.max(0.5, ry - 1.2)))
        writeCell(w, rec, x, y, type);
    }
  }
}

/**
 * Flood fill the connected same-type area under (x, y). Collects first,
 * writes only if the area is under the cap — never a partial fill.
 * Returns cells changed, or -1 if the area exceeded the cap (nothing written).
 */
export function floodFill(
  w: World,
  rec: PatchRecorder,
  x: number,
  y: number,
  type: number,
  cap: number,
): number {
  if (!w.inBounds(x, y)) return 0;
  const from = w.types[w.idx(x, y)];
  if (from === type) return 0;
  const W = w.width,
    H = w.height;
  const found: number[] = [];
  const seen = new Set<number>();
  const stack = [w.idx(x, y)];
  seen.add(stack[0]);
  while (stack.length > 0) {
    const i = stack.pop()!;
    found.push(i);
    if (found.length > cap) return -1;
    const ix = i % W,
      iy = (i / W) | 0;
    for (const [nx, ny] of [
      [ix + 1, iy],
      [ix - 1, iy],
      [ix, iy + 1],
      [ix, iy - 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = nx + ny * W;
      if (seen.has(ni) || w.types[ni] !== from) continue;
      seen.add(ni);
      stack.push(ni);
    }
  }
  for (const i of found) writeCell(w, rec, i % W, (i / W) | 0, type);
  return found.length;
}

/**
 * Replace every cell of the material under (x, y) with `type`, inside the
 * region (or the whole world when region is null). Counted before written;
 * -1 if over the cap (nothing written).
 */
export function replaceMaterial(
  w: World,
  rec: PatchRecorder,
  x: number,
  y: number,
  type: number,
  region: Region | null,
  cap: number,
): number {
  if (!w.inBounds(x, y)) return 0;
  const from = w.types[w.idx(x, y)];
  if (from === type) return 0;
  const x0 = region ? Math.max(0, region.x0) : 0;
  const y0 = region ? Math.max(0, region.y0) : 0;
  const x1 = region ? Math.min(w.width - 1, region.x1) : w.width - 1;
  const y1 = region ? Math.min(w.height - 1, region.y1) : w.height - 1;
  let count = 0;
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * w.width;
    for (let xx = x0; xx <= x1; xx++) {
      if (w.types[row + xx] === from && ++count > cap) return -1;
    }
  }
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (w.types[w.idx(xx, yy)] === from) writeCell(w, rec, xx, yy, type);
    }
  }
  return count;
}

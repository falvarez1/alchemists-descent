import type { Region } from '@/builder/terrain';

/**
 * Symmetry painting (Builder power editing): pure coordinate mirroring.
 * The Builder re-invokes each terrain tool once per mirrored coordinate
 * into the SAME PatchRecorder / stroke, so one gesture stays one undo.
 *
 * The axis sits at the world center and is recentered by the active region
 * (region midpoints may be *.5 — reflections of integer cells stay integer
 * because 2*axis is always an integer).
 */

export type SymmetryMode = 'off' | 'x' | 'y' | 'quad';
export const SYM_MODES: SymmetryMode[] = ['off', 'x', 'y', 'quad'];

interface SymTransform {
  fx: boolean; // reflect across the vertical axis (mirror x)
  fy: boolean; // reflect across the horizontal axis (mirror y)
}

const TRANSFORMS: Record<SymmetryMode, SymTransform[]> = {
  off: [{ fx: false, fy: false }],
  x: [
    { fx: false, fy: false },
    { fx: true, fy: false },
  ],
  y: [
    { fx: false, fy: false },
    { fx: false, fy: true },
  ],
  quad: [
    { fx: false, fy: false },
    { fx: true, fy: false },
    { fx: false, fy: true },
    { fx: true, fy: true },
  ],
};

/** Axis center: world center, recentered by the active region when set. */
export function symAxes(
  region: Region | null,
  width: number,
  height: number,
): { x: number; y: number } {
  return region
    ? { x: (region.x0 + region.x1) / 2, y: (region.y0 + region.y1) / 2 }
    : { x: (width - 1) / 2, y: (height - 1) / 2 };
}

function reflect(t: SymTransform, x: number, y: number, axisX: number, axisY: number): [number, number] {
  return [t.fx ? Math.round(2 * axisX - x) : x, t.fy ? Math.round(2 * axisY - y) : y];
}

/**
 * All mirrored images of a point under the mode, original first, with
 * on-axis duplicates removed (a point ON the axis reflects to itself).
 */
export function mirrorPoints(
  x: number,
  y: number,
  mode: SymmetryMode,
  axisX: number,
  axisY: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const t of TRANSFORMS[mode]) {
    const [nx, ny] = reflect(t, x, y, axisX, axisY);
    if (!out.some(([px, py]) => px === nx && py === ny)) out.push([nx, ny]);
  }
  return out;
}

/**
 * Mirrored images of a SEGMENT / drag box (both endpoints transformed
 * together), deduped so an on-axis symmetric shape yields itself exactly
 * once. `box` shapes (rect/ellipse — corner order is irrelevant) dedupe by
 * normalized bbox; segments dedupe by endpoint set only, because the
 * mirror of a diagonal line is the OTHER diagonal — different geometry.
 */
export function mirrorPairs(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mode: SymmetryMode,
  axisX: number,
  axisY: number,
  box = false,
): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  const seen = new Set<string>();
  for (const t of TRANSFORMS[mode]) {
    const [ax, ay] = reflect(t, x0, y0, axisX, axisY);
    const [bx, by] = reflect(t, x1, y1, axisX, axisY);
    const key = box
      ? `${Math.min(ax, bx)},${Math.min(ay, by)}:${Math.max(ax, bx)},${Math.max(ay, by)}`
      : ax < bx || (ax === bx && ay <= by)
        ? `${ax},${ay}:${bx},${by}`
        : `${bx},${by}:${ax},${ay}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([ax, ay, bx, by]);
  }
  return out;
}

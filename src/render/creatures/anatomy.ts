import type { Chain } from '@/creatures/rig/chain';
import type { CreatureRaster, PrimOpts } from './raster';

/** Shared drawing helpers for the creature roster. */

const XS = new Float64Array(96), YS = new Float64Array(96), RS = new Float64Array(96);

/**
 * A chain drawn as one tapered tube. `r0`/`r1` are root/tip radii (the
 * chain's own radii are used when omitted); `from` skips links at the root.
 */
export function chainTube(r: CreatureRaster, c: Chain, z: number, mat: number, o: PrimOpts, r0 = -1, r1 = -1, from = 0, zEnd = z): void {
  const n = c.pts.length;
  let k = 0;
  for (let i = from; i < n && k < XS.length; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    XS[k] = c.pts[i].x; YS[k] = c.pts[i].y;
    RS[k] = r0 >= 0 ? r0 + (r1 - r0) * t : c.radius[i];
    k++;
  }
  r.tube(XS, YS, RS, k, z, mat, o, zEnd);
}

export interface EyeMats { eye: number; glint: number; iris?: number; lid?: number }

/**
 * Eyes recorded during a species draw, at the rig's real head anchors — the
 * light wave's eyeshine pass (render/creatures/eyeshine) reads them after the
 * body resolves. Species call markEye where they paint an open eye (the
 * shared eye() helper does it for them); closed eyes are never marked.
 */
export const EYE_MARKS = { n: 0, x: new Float32Array(16), y: new Float32Array(16), r: new Float32Array(16) };
export function resetEyeMarks(): void {
  EYE_MARKS.n = 0;
}
export function markEye(x: number, y: number, size: number): void {
  const m = EYE_MARKS;
  if (m.n >= m.x.length) return;
  m.x[m.n] = x; m.y[m.n] = y; m.r[m.n] = size;
  m.n++;
}

/**
 * A small creature eye: a dark wet orb (or an iris when given) with a glint
 * that looks toward the gaze and closes with `lid` (0 open .. 1 shut).
 */
export function eye(r: CreatureRaster, x: number, y: number, rx: number, ry: number, angle: number, m: EyeMats,
  gazeX = 0, gazeY = 0, lid = 0): void {
  const open = Math.max(0, 1 - lid);
  if (open < 0.2) {
    r.stroke(x - Math.cos(angle) * rx, y - Math.sin(angle) * rx, x + Math.cos(angle) * rx, y + Math.sin(angle) * rx, m.lid ?? m.eye, 0, true);
    return;
  }
  r.stamp(x, y, rx, ry * open, angle, m.eye, 0, false);
  markEye(x, y, Math.max(rx, ry) * open);
  if (m.iris !== undefined) {
    r.stamp(x + gazeX * rx * 0.3, y + gazeY * ry * 0.3, rx * 0.62, ry * open * 0.7, angle, m.iris, 2, true);
    r.stamp(x + gazeX * rx * 0.38, y + gazeY * ry * 0.38, rx * 0.26, ry * open * 0.5, angle, m.eye, 0, true);
  }
  if (open > 0.45) r.dot(x - rx * 0.35 + gazeX * rx * 0.15, y - ry * 0.4 * open, m.glint, 1, 1e5);
}

/** Flat float pairs from a callback (keeps call sites free of array churn). */
export const POLY = new Float64Array(256);

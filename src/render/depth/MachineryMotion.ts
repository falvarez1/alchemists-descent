import { chain, gear } from '@/render/depth/motifs';
import { applyHaze, MaskPlane, type Bitmap, type HazeOptions, type MotionMotif } from '@/render/depth/raster';

interface Piece {
  motif: MotionMotif;
  x: number; y: number; width: number; height: number;
  paint: (mask: MaskPlane) => Bitmap;
  mask: MaskPlane;
  destinations: Int32Array;
  rows: { to: number; bytes: Uint8ClampedArray }[];
}
interface MotionPlane {
  pristine: Uint8ClampedArray;
  pieces: Piece[];
  wrap: boolean;
  frame: number;
  haze?: HazeOptions;
}
const planes = new WeakMap<Bitmap, MotionPlane>();

/** The regular plane painter supplies the same palette and lighting to each
 * small moving piece. Stationary architecture is retained once, never rebaked. */
export function registerPlaneMotion(bitmap: Bitmap, mask: MaskPlane,
  paint: (mask: MaskPlane, x: number, y: number) => Bitmap): Bitmap {
  if (!mask.motions.length) return bitmap;
  const pristine = new Uint8ClampedArray(bitmap.pixels);
  const pieces = mask.motions.map(motif => {
    const pad = motif.kind === 'gear' ? Math.ceil(motif.radius * 1.19) + 3 : Math.ceil(Math.min(4, motif.length * .04)) + motif.size * 3 + 3;
    const x = Math.floor(motif.x - pad), y = Math.floor(motif.y - (motif.kind === 'gear' ? pad : motif.size * 2));
    const width = pad * 2 + 1, height = motif.kind === 'gear' ? width : Math.ceil(motif.length + motif.size * 8 + 4);
    const destinations = new Int32Array(width * height).fill(-1), rows: Piece['rows'] = [];
    for (let yy = 0; yy < height; yy++) {
      const wy = y + yy;
      if (!mask.wrap && (wy < 0 || wy >= bitmap.height)) continue;
      const py = ((wy % bitmap.height) + bitmap.height) % bitmap.height;
      for (let xx = 0; xx < width;) {
        const wx = x + xx;
        if (!mask.wrap && (wx < 0 || wx >= bitmap.width)) { xx++; continue; }
        const px = ((wx % bitmap.width) + bitmap.width) % bitmap.width;
        const length = Math.min(width - xx, bitmap.width - px), to = (py * bitmap.width + px) * 4;
        rows.push({ to, bytes: pristine.subarray(to, to + length * 4) });
        for (let k = 0; k < length; k++) destinations[yy * width + xx + k] = to + k * 4;
        xx += length;
      }
    }
    return { motif, x, y, width, height, mask: new MaskPlane(width, height, false), destinations, rows,
      paint: (p: MaskPlane) => paint(p, x, y) };
  });
  planes.set(bitmap, { pristine, pieces, wrap: mask.wrap, frame: -1 });
  updatePlaneMotion(bitmap, 0);
  return bitmap;
}

/** Capture the final haze-treated stationary plane before its first frame. */
export function finalizePlaneMotion(bitmap: Bitmap, haze?: HazeOptions): void {
  const plane = planes.get(bitmap);
  if (!plane) return;
  if (haze) applyHaze({ ...bitmap, pixels: plane.pristine }, haze);
  bitmap.pixels.set(plane.pristine); plane.haze = haze; plane.frame = -1;
  updatePlaneMotion(bitmap, 0);
}

/** Twenty frames per second suit slowly moving pixel machinery. All compose
 * backends receive the same bitmap/version and therefore the same motion. */
export function updatePlaneMotion(bitmap: Bitmap, tick: number): boolean {
  const plane = planes.get(bitmap), frame = Math.floor(tick / 3);
  if (!plane || plane.frame === frame) return false;
  plane.frame = frame;
  // Restore every affected rectangle first, then composite in authored order:
  // overlapping gears/chains cannot erase one another or leave motion trails.
  for (const piece of plane.pieces) for (const row of piece.rows) bitmap.pixels.set(row.bytes, row.to);
  for (const piece of plane.pieces) {
    const m = piece.motif, p = piece.mask;
    p.mat.fill(0); p.tone.fill(0); p.cover.fill(0);
    const x = m.x - piece.x, y = m.y - piece.y;
    const phase = (m.x * .031 + m.y * .017) % (Math.PI * 2);
    if (m.kind === 'gear') {
      const direction = Math.floor(m.x / 40) % 2 ? -1 : 1;
      const angle = direction * (frame * 3 * .0017) % (Math.PI * 2);
      gear(p, x, y, m.radius, m.teeth, m.spokes, m.material, angle);
    } else chain(p, x, y, m.length, m.material, m.size, Math.sin(frame * 3 * .012 + phase) * Math.min(4, m.length * .04));
    const sprite = piece.paint(p);
    if (plane.haze) applyHaze(sprite, plane.haze);
    for (let yy = 0; yy < sprite.height; yy++) for (let xx = 0; xx < sprite.width; xx++) {
      const from = (yy * sprite.width + xx) * 4, alpha = sprite.pixels[from + 3] / 255;
      if (alpha === 0) continue;
      const to = piece.destinations[yy * sprite.width + xx];
      if (to < 0) continue;
      const ba = bitmap.pixels[to + 3] / 255, coverage = alpha + ba * (1 - alpha);
      for (let c = 0; c < 3; c++) bitmap.pixels[to + c] = (sprite.pixels[from + c] * alpha + bitmap.pixels[to + c] * ba * (1 - alpha)) / coverage;
      bitmap.pixels[to + 3] = coverage * 255;
    }
  }
  return true;
}

export function planeMotionCount(bitmap: Bitmap): number { return planes.get(bitmap)?.pieces.length ?? 0; }

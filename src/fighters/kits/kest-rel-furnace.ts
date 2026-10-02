import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';

/**
 * Kest Rel's furnace, the Updraft's body: a compact sooty iron box on short legs with a chimney collar and
 * a flame in its mouth, and the faint warm streaks that run up the column it drives. Drawn pixel by pixel
 * from the kit's state (nothing here is a cell: the Fire and Steam the furnace writes are the real column,
 * this is the iron around them). The box is lit by the level's light like any prop; the flame and the door
 * glow are additive and read in the dark.
 */

export interface FurnaceView {
  /** Centre column of the furnace and of the draft. */
  x: number;
  /** The row the feet stand on (the floor's surface is the row below). */
  floorY: number;
  /** The first open row above the collar, where the flame starts. */
  mouthY: number;
  /** The top row of the column. */
  topY: number;
  /** Half the width of the draft, cells. */
  halfW: number;
  /** The frame the furnace was lit (animation phase). */
  born: number;
  /** 0..1, 1 = roaring, 0 = out. */
  flame: number;
  /** 0..1 heat left in the iron after the flame is out. */
  heat: number;
}

/** Furnace footprint, cells: the box is BOX_HALF_W * 2 + 1 wide and BOX_H tall, feet included. */
export const BOX_HALF_W = 5;
export const BOX_H = 8;

function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Put = (this: PixelSurface, wx: number, wy: number, r: number, g: number, b: number) => void;

/** Fill one world cell with a colour at the surface's own pixel step. */
function fillCell(out: PixelSurface, put: Put, step: number, cx: number, cy: number, r: number, g: number, b: number): void {
  for (let fy = 0; fy < 1; fy += step) {
    for (let fx = 0; fx < 1; fx += step) put.call(out, cx + fx + step * 0.5, cy + fy + step * 0.5, r, g, b);
  }
}

export function drawFurnace(out: PixelSurface, field: LightField, ctx: Ctx, v: FurnaceView): void {
  const step = out.pixelStep ?? 1;
  const put: Put = (out.setFinePx ?? out.setPx) as Put;
  const add: Put = (out.addFinePx ?? out.addPx) as Put;
  const frame = ctx.state.frameCount;
  const calm = ctx.state.reduceFlashes === true;
  const age = frame - v.born;
  const flicker = (k: number): number => (calm ? 0.85 : 0.7 + 0.3 * Math.sin(frame * 0.55 + k) * Math.sin(frame * 0.23 + k * 1.7));
  const glow = Math.max(v.flame, v.heat * 0.6);

  // ---- the iron box (lit like any prop) ----
  for (let ry = 0; ry <= BOX_H - 1; ry++) {
    const cy = v.floorY - ry;
    const half = ry === 0 ? 4 : ry === 7 ? 3 : BOX_HALF_W;
    for (let dx = -half; dx <= half; dx++) {
      if (ry === 0 && Math.abs(dx) < 3) continue; // two short legs, a gap between them
      const cx = v.x + dx;
      // base soot-iron, a light top-left edge, a dark bottom-right edge, a little grain
      let r = 0.2, g = 0.19, b = 0.2;
      const grain = (hash(cx, cy) - 0.5) * 0.05;
      if (ry >= 5 || dx === -half) { r += 0.07; g += 0.065; b += 0.06; }
      if (ry <= 1 || dx === half) { r -= 0.05; g -= 0.05; b -= 0.045; }
      if (ry === 6) { r += 0.05; g += 0.045; b += 0.04; } // the rim
      if (ry === 7) { r = 0.27; g = 0.25; b = 0.24; } // the chimney collar
      // rivets at the four corners of the body
      if ((Math.abs(dx) === 4 && (ry === 2 || ry === 5)) && ry < 6) { r = 0.43; g = 0.39; b = 0.34; }
      // the firebox door: a dark frame round a hot slot
      const inDoor = Math.abs(dx) <= 2 && ry >= 1 && ry <= 3;
      let hotR = 0, hotG = 0, hotB = 0;
      if (inDoor) {
        const edge = Math.abs(dx) === 2 || ry === 3;
        if (edge) { r = 0.1; g = 0.09; b = 0.09; } else {
          // the slot burns from inside: orange at the middle, deeper at the edges
          const f = glow * flicker(dx * 1.9 + ry);
          hotR = 1.0 * f; hotG = 0.5 * f; hotB = 0.12 * f;
          r = 0.05; g = 0.04; b = 0.04;
        }
      }
      r += grain; g += grain; b += grain;
      const lt = field.sample(cx, cy);
      fillCell(out, put, step, cx, cy, r * lt.r * 0.9 + hotR, g * lt.g * 0.9 + hotG, b * lt.b * 0.9 + hotB);
    }
  }

  // soot: a dark smear on the ground and up the collar, the mark of a furnace that has been run hard
  for (let dx = -3; dx <= 3; dx++) {
    if (hash(v.x + dx, 9) < 0.45) continue;
    const cy = v.floorY - BOX_H;
    const lt = field.sample(v.x + dx, cy);
    fillCell(out, put, step, v.x + dx, cy, 0.05 * lt.r, 0.045 * lt.g, 0.045 * lt.b);
  }

  // ---- the flame in the mouth (additive, so it is bright in the dark and in the bloom) ----
  if (v.flame > 0.02) {
    const rise = Math.max(8, v.mouthY - v.topY);
    for (let dx = -3; dx <= 3; dx++) {
      const body = 1 - Math.abs(dx) / 4.2;
      const tongue = 0.75 + 0.25 * Math.sin(frame * 0.45 + dx * 2.1) + (calm ? 0 : 0.2 * Math.sin(frame * 0.91 + dx * 5.3));
      const hgt = Math.min(rise * 0.3, (9 + 11 * body) * v.flame * tongue);
      for (let ry = 0; ry <= hgt; ry += step) {
        const t = ry / Math.max(1, hgt);
        // white-hot at the root, orange in the body, a deep red at the tip
        const heat = Math.pow(1 - t, 0.8) * (0.55 + 0.45 * body);
        const wr = 1.0 * heat;
        const wg = (0.35 + 0.6 * (1 - t) * (1 - t)) * heat;
        const wb = (0.08 + 0.55 * Math.pow(1 - t, 4)) * heat;
        add.call(out, v.x + dx + 0.5, v.mouthY - ry, wr * 0.75, wg * 0.75, wb * 0.75);
      }
    }
  }

  // ---- the draft: warm streaks rising up the column, thinning toward its top ----
  if (v.flame > 0.05) {
    const height = Math.max(8, v.mouthY - v.topY);
    const n = 18;
    for (let i = 0; i < n; i++) {
      const speed = 1.7 + hash(i, 3) * 1.6;
      const phase = (age * speed + hash(i, 5) * height) % height;
      const fy = phase / height;
      const x = v.x + (hash(i, 7) * 2 - 1) * (v.halfW - 1) + Math.sin(age * 0.07 + i) * 1.4 * fy;
      const y = v.mouthY - 2 - phase;
      const a = (1 - fy) * (1 - fy) * 0.34 * v.flame * (0.55 + 0.45 * hash(i, 11));
      for (let k = 0; k < 4; k++) add.call(out, x, y - k * 0.8, a * 1.0, a * 0.62, a * 0.28);
    }
  }
}

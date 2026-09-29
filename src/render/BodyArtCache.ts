import type { PixelSurface } from '@/render/pixels';

/**
 * RESTING-BODY ART CACHE. A settled heap of crates, planks and boulders is
 * hundreds of Pen drawings (polygons, battens, rivets) re-rasterised every
 * frame although a sleeping Rapier body's pose is bit-identical from frame
 * to frame. The composer records a sleeping body's art once — through this
 * surface, unclipped, with the pen's light at 1 — as absolute fine-pixel
 * writes, and replays them each frame with the body's current light
 * multiplied in. Pen.px writes c*k*light = (c*k)*light, and the recording
 * holds c*k*1 = c*k exactly (in f64: a Float32 recording would round c*k
 * before the light multiply), so the replay is bit-identical to drawing.
 *
 * Only lit writes may be cached: a burning body (self-lit embers, glowing
 * fuse, flicker) always draws directly, and so does anything moving.
 */

/** Floats per recorded write: abs fine x, abs fine y (from the top), r, g, b, coverage. */
export const ART_RECORD = 6;

export interface BodyArtEntry {
  x: number;
  y: number;
  angle: number;
  fill0: number;
  fill1: number;
  fill2: number;
  count: number;
  data: Float64Array;
}

export class ArtRecorder implements PixelSurface {
  readonly pixelStep: number;
  private buf = new Float64Array(4096 * ART_RECORD);
  private n = 0;

  constructor(private readonly scale: number) {
    this.pixelStep = 1 / scale;
  }

  begin(): this {
    this.n = 0;
    return this;
  }

  private push(fx: number, fy: number, r: number, g: number, b: number, coverage: number): void {
    if ((this.n + 1) * ART_RECORD > this.buf.length) {
      const grown = new Float64Array(this.buf.length * 2);
      grown.set(this.buf);
      this.buf = grown;
    }
    const o = this.n * ART_RECORD, d = this.buf;
    d[o] = fx; d[o + 1] = fy; d[o + 2] = r; d[o + 3] = g; d[o + 4] = b; d[o + 5] = coverage;
    this.n++;
  }

  // The composer's setFinePx rounds (x - renderCam) * scale; the camera is
  // integral and scale a power of two, so round(x * scale) - cam * scale is
  // the same pixel: the recording is camera-free.
  setFinePx(x: number, y: number, r: number, g: number, b: number): void {
    if (this.scale === 1) { this.setPx(x, y, r, g, b); return; }
    this.push(Math.round(x * this.scale), Math.round(y * this.scale), r, g, b, 1);
  }

  addFinePx(x: number, y: number, r: number, g: number, b: number): void {
    if (this.scale === 1) { this.addPx(x, y, r, g, b); return; }
    this.push(Math.round(x * this.scale), Math.round(y * this.scale), r, g, b, 0);
  }

  blendFinePx(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (a >= 0.999) { this.setFinePx(x, y, r, g, b); return; }
    if (a <= 0.001) { this.addFinePx(x, y, r, g, b); return; }
    this.push(Math.round(x * this.scale), Math.round(y * this.scale), r, g, b, a);
  }

  /** Cell-level write: the S x S fine block, in the composer's own order. */
  setPx(x: number, y: number, r: number, g: number, b: number): void {
    this.block(x, y, r, g, b, 1);
  }

  addPx(x: number, y: number, r: number, g: number, b: number): void {
    this.block(x, y, r, g, b, 0);
  }

  private block(x: number, y: number, r: number, g: number, b: number, coverage: number): void {
    const s = this.scale, cx = Math.round(x) * s, cy = Math.round(y) * s;
    // setPx walks GL rows bottom-up: fine rows cy + s - 1 down to cy.
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) this.push(cx + dx, cy + s - 1 - dy, r, g, b, coverage);
  }

  /** Store the recording into `entry` (reusing its buffer when it fits). */
  finish(pose: { x: number; y: number; angle: number }, fill: readonly [number, number, number], entry?: BodyArtEntry): BodyArtEntry {
    const len = this.n * ART_RECORD;
    const data = entry && entry.data.length >= len ? entry.data : new Float64Array(len);
    data.set(this.buf.subarray(0, len));
    const out = entry ?? { x: 0, y: 0, angle: 0, fill0: 0, fill1: 0, fill2: 0, count: 0, data };
    out.x = pose.x; out.y = pose.y; out.angle = pose.angle;
    out.fill0 = fill[0]; out.fill1 = fill[1]; out.fill2 = fill[2];
    out.count = this.n; out.data = data;
    return out;
  }
}

/** True when `entry` still describes this pose and colour exactly. */
export function artEntryValid(entry: BodyArtEntry | undefined, pose: { x: number; y: number; angle: number }, fill: readonly [number, number, number]): entry is BodyArtEntry {
  return entry !== undefined && entry.x === pose.x && entry.y === pose.y && entry.angle === pose.angle &&
    entry.fill0 === fill[0] && entry.fill1 === fill[1] && entry.fill2 === fill[2];
}

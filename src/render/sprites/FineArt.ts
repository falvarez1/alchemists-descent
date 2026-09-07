import type { PixelSurface } from '@/render/pixels';
import { VIEW_H, VIEW_W } from '@/config/constants';

/**
 * Shared presentation-resolution drawing kit.
 *
 * The world is simulated in cells but presented at `pixelStep` (half a cell
 * on the default fine surface). Terrain, foliage and creatures already draw
 * at that step; this module gives every remaining sprite family — the
 * player, mechanisms, machine linkages, rigid bodies, bitmap decor — the
 * same grain, so nothing on screen reads as "bigger pixels" than its
 * neighbours. Everything degrades to the legacy cell art on a surface
 * without `setFinePx` (classic presentation, the Builder gallery, tests).
 *
 * Nothing here touches the grid: these are overlay pixels only.
 */

export type RGB = readonly [number, number, number];
export interface ViewRect { x0: number; y0: number; x1: number; y1: number }

export const INK: RGB = [0.05, 0.07, 0.09];
export const BRASS: RGB = [0.83, 0.65, 0.31];
export const BRASS_D: RGB = [0.5, 0.36, 0.15];
export const BRASS_L: RGB = [0.98, 0.9, 0.62];
export const STEEL: RGB = [0.64, 0.73, 0.74];
export const STEEL_D: RGB = [0.3, 0.36, 0.38];
export const STEEL_L: RGB = [0.88, 0.94, 0.95];
export const IRON: RGB = [0.34, 0.33, 0.35];
export const IRON_D: RGB = [0.16, 0.16, 0.18];
export const COPPER: RGB = [0.72, 0.42, 0.2];
export const HEMP: RGB = [0.72, 0.58, 0.3];
export const HEMP_D: RGB = [0.42, 0.32, 0.14];
export const WHEEL_FACE: RGB = [0.34, 0.24, 0.1];

/** The composed view in world cells, padded so edge sprites are not clipped early. */
export function cameraView(camera: { renderX: number; renderY: number }, margin = 12): ViewRect {
  return { x0: camera.renderX - margin, y0: camera.renderY - margin, x1: camera.renderX + VIEW_W + margin, y1: camera.renderY + VIEW_H + margin };
}

/** True when a world-space box touches the composed view (plus margin). */
export function viewIntersects(camera: { renderX: number; renderY: number }, x0: number, y0: number, x1: number, y1: number, margin = 8): boolean {
  return x1 >= camera.renderX - margin && x0 <= camera.renderX + VIEW_W + margin && y1 >= camera.renderY - margin && y0 <= camera.renderY + VIEW_H + margin;
}

export function finePixelStep(out: PixelSurface): number {
  return out.setFinePx ? out.pixelStep ?? 1 : 1;
}

const same = (a: RGB, b: RGB): boolean =>
  Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3 && Math.abs(a[2] - b[2]) < 1e-3;

/**
 * Scale2x / EPX corner rule. Given the centre and its four neighbours
 * (undefined = nothing drawn there), each 2x2 quadrant takes the colour of
 * two agreeing adjacent neighbours — which carves outer corners, fills
 * staircase diagonals and leaves one-cell lines intact. Returns the
 * quadrant colour, or undefined when the quadrant is carved away.
 */
export function epxQuadrant(centre: RGB, a: RGB | undefined, b: RGB | undefined, opposite1: RGB | undefined, opposite2: RGB | undefined): RGB | undefined {
  const eq = (p: RGB | undefined, q: RGB | undefined): boolean => (p === undefined || q === undefined) ? p === q : same(p, q);
  if (eq(a, b) && !eq(a, opposite1) && !eq(b, opposite2)) return a;
  return centre;
}

/**
 * Cell-resolution sprite capture that re-emits at presentation resolution.
 *
 * Pose code keeps drawing whole cells through the ordinary `setPx`; the
 * flush upsamples the captured silhouette with the EPX rule, stamps a rim
 * one presentation pixel wide (instead of one cell) and replays additive
 * glows. On a legacy surface the flush is the byte-for-byte cell drawing.
 */
export class CellCapture implements PixelSurface {
  private readonly slots = new Map<number, number>();
  private colors = new Float32Array(3 * 512);
  private count = 0;
  private readonly adds: number[] = [];
  /** Presentation-pixel keys of the last fine flush (for a follow-up layer's shadow test). */
  readonly fineMask = new Set<number>();
  /** Cell keys of everything captured (the legacy silhouette record). */
  readonly cellMask = new Set<number>();

  static key(x: number, y: number): number { return (x & 0xfff) | ((y & 0xfff) << 12); }

  reset(): void { this.slots.clear(); this.count = 0; this.adds.length = 0; this.fineMask.clear(); this.cellMask.clear(); }

  setPx(x: number, y: number, r: number, g: number, b: number): void {
    const cx = Math.round(x), cy = Math.round(y), key = CellCapture.key(cx, cy);
    let slot = this.slots.get(key);
    if (slot === undefined) {
      if (this.count * 3 + 3 > this.colors.length) {
        const grown = new Float32Array(this.colors.length * 2); grown.set(this.colors); this.colors = grown;
      }
      slot = this.count++; this.slots.set(key, slot); this.cellMask.add(key);
    }
    this.colors[slot * 3] = r; this.colors[slot * 3 + 1] = g; this.colors[slot * 3 + 2] = b;
  }

  addPx(x: number, y: number, r: number, g: number, b: number): void { this.adds.push(x, y, r, g, b); }

  has(x: number, y: number): boolean { return this.slots.has(CellCapture.key(x, y)); }

  private colorAt(key: number): RGB | undefined {
    const slot = this.slots.get(key);
    return slot === undefined ? undefined : [this.colors[slot * 3], this.colors[slot * 3 + 1], this.colors[slot * 3 + 2]];
  }

  /**
   * Emit the captured layer. `rim` stamps an outline (skipped below
   * `feetY`); `shadowUnder` stamps a one-sided drop shadow beneath each
   * pixel that is not covered by this layer or the `shadowFrom` layer; `subX/subY`
   * shift the emitted art by whole presentation pixels for sub-cell motion.
   */
  flush(out: PixelSurface, opts: {
    rim?: RGB; feetY?: number; shadowUnder?: RGB; shadowFrom?: CellCapture; subX?: number; subY?: number;
  } = {}): void {
    const step = finePixelStep(out);
    const feetY = opts.feetY ?? Infinity;
    if (step >= 1) {
      for (const [key, slot] of this.slots) {
        out.setPx(key & 0xfff, (key >> 12) & 0xfff, this.colors[slot * 3], this.colors[slot * 3 + 1], this.colors[slot * 3 + 2]);
      }
      if (opts.rim) for (const key of this.slots.keys()) {
        const mx = key & 0xfff, my = (key >> 12) & 0xfff;
        for (let n = 0; n < 4; n++) {
          const nx = mx + (n === 0 ? 1 : n === 1 ? -1 : 0), ny = my + (n === 2 ? 1 : n === 3 ? -1 : 0);
          if (ny > feetY || this.slots.has(CellCapture.key(nx, ny))) continue;
          out.setPx(nx, ny, opts.rim[0], opts.rim[1], opts.rim[2]);
        }
      }
      if (opts.shadowUnder) for (const key of this.slots.keys()) {
        const sx = key & 0xfff, sy = ((key >> 12) & 0xfff) + 1, skey = CellCapture.key(sx, sy);
        if (!this.slots.has(skey) && !opts.shadowFrom?.cellMask.has(skey)) out.setPx(sx, sy, opts.shadowUnder[0], opts.shadowUnder[1], opts.shadowUnder[2]);
      }
      for (let i = 0; i < this.adds.length; i += 5) out.addPx(this.adds[i], this.adds[i + 1], this.adds[i + 2], this.adds[i + 3], this.adds[i + 4]);
      return;
    }
    // Presentation resolution: upsample with the EPX corner rule, then
    // outline the finer silhouette one presentation pixel wide.
    const n = Math.round(1 / step);
    const fine = new Map<number, RGB>();
    const fineKey = (fx: number, fy: number): number => (fx & 0x3fff) | ((fy & 0x3fff) << 14);
    for (const key of this.slots.keys()) {
      const cx = key & 0xfff, cy = (key >> 12) & 0xfff;
      const centre = this.colorAt(key)!;
      const up = this.colorAt(CellCapture.key(cx, cy - 1)), down = this.colorAt(CellCapture.key(cx, cy + 1));
      const left = this.colorAt(CellCapture.key(cx - 1, cy)), right = this.colorAt(CellCapture.key(cx + 1, cy));
      const quadrant = [
        epxQuadrant(centre, left, up, down, right), // top-left
        epxQuadrant(centre, up, right, left, down), // top-right
        epxQuadrant(centre, down, left, up, right), // bottom-left
        epxQuadrant(centre, right, down, up, left), // bottom-right
      ];
      for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) {
        const q = quadrant[(sy * 2 >= n ? 2 : 0) + (sx * 2 >= n ? 1 : 0)];
        if (q) fine.set(fineKey(cx * n + sx, cy * n + sy), q);
      }
    }
    const shiftX = Math.round((opts.subX ?? 0) * n) / n, shiftY = Math.round((opts.subY ?? 0) * n) / n;
    const feetFine = feetY === Infinity ? Infinity : feetY * n + n - 1;
    const put = (fx: number, fy: number, c: RGB): void => out.setFinePx!(fx / n + shiftX, fy / n + shiftY, c[0], c[1], c[2]);
    if (opts.rim) for (const key of fine.keys()) {
      const fx = key & 0x3fff, fy = (key >> 14) & 0x3fff;
      for (let k = 0; k < 4; k++) {
        const nx = fx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = fy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (ny > feetFine || fine.has(fineKey(nx, ny))) continue;
        put(nx, ny, opts.rim);
      }
    }
    if (opts.shadowUnder) for (const key of fine.keys()) {
      const fx = key & 0x3fff, fy = ((key >> 14) & 0x3fff) + 1, skey = fineKey(fx, fy);
      if (!fine.has(skey) && !opts.shadowFrom?.fineMask.has(skey)) put(fx, fy, opts.shadowUnder);
    }
    this.fineMask.clear();
    for (const [key, c] of fine) { this.fineMask.add(key); put(key & 0x3fff, (key >> 14) & 0x3fff, c); }
    for (let i = 0; i < this.adds.length; i += 5) out.addPx(this.adds[i] + shiftX, this.adds[i + 1] + shiftY, this.adds[i + 2], this.adds[i + 3], this.adds[i + 4]);
  }
}

/**
 * Blit cell-resolution bitmap art (decor frames, prop crops) through the
 * same EPX upsample so hand-drawn sprites share the presentation grain.
 * `sample` returns a packed 0xRRGGBB colour or -1 for a transparent texel.
 */
export function blitCellArt(out: PixelSurface, width: number, height: number, sample: (px: number, py: number) => number,
  x0: number, y0: number, lr = 1, lg = 1, lb = 1): void {
  const step = finePixelStep(out);
  const color = (px: number, py: number): RGB | undefined => {
    if (px < 0 || py < 0 || px >= width || py >= height) return undefined;
    const packed = sample(px, py);
    return packed < 0 ? undefined : [((packed >> 16) & 0xff) / 255, ((packed >> 8) & 0xff) / 255, (packed & 0xff) / 255];
  };
  if (step >= 1) {
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
      const c = color(px, py);
      if (c) out.setPx(x0 + px, y0 + py, c[0] * lr, c[1] * lg, c[2] * lb);
    }
    return;
  }
  const n = Math.round(1 / step);
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const centre = color(px, py);
    if (!centre) continue;
    const up = color(px, py - 1), down = color(px, py + 1), left = color(px - 1, py), right = color(px + 1, py);
    const quadrant = [
      epxQuadrant(centre, left, up, down, right), epxQuadrant(centre, up, right, left, down),
      epxQuadrant(centre, down, left, up, right), epxQuadrant(centre, right, down, up, left),
    ];
    for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) {
      const q = quadrant[(sy * 2 >= n ? 2 : 0) + (sx * 2 >= n ? 1 : 0)];
      if (q) out.setFinePx!(x0 + px + sx / n, y0 + py + sy / n, q[0] * lr, q[1] * lg, q[2] * lb);
    }
  }
}

/**
 * Vector primitives rasterised at the presentation step: rods, wheels,
 * cables, plates and rivets for machinery, plus the general shapes the
 * fine sprite families share. Light is a per-pen multiplier so a fixture
 * takes the scene's lamps without every call sampling the field.
 */
export class Pen {
  readonly step: number;
  private readonly lr: number;
  private readonly lg: number;
  private readonly lb: number;

  constructor(readonly out: PixelSurface, readonly view: ViewRect | null = null, light: RGB = [1, 1, 1]) {
    this.step = finePixelStep(out);
    this.lr = light[0]; this.lg = light[1]; this.lb = light[2];
  }

  /** Coarse cull against the composed view; nothing off-screen is rasterised. */
  inView(x0: number, y0: number, x1: number, y1: number): boolean {
    const v = this.view;
    if (!v) return true;
    return Math.max(x0, x1) >= v.x0 && Math.min(x0, x1) <= v.x1 && Math.max(y0, y1) >= v.y0 && Math.min(y0, y1) <= v.y1;
  }

  private clipped(x: number, y: number): boolean {
    const v = this.view;
    return v !== null && (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1);
  }

  px(x: number, y: number, c: RGB, k = 1): void {
    if (this.clipped(x, y)) return;
    (this.out.setFinePx ?? this.out.setPx).call(this.out, x, y, c[0] * k * this.lr, c[1] * k * this.lg, c[2] * k * this.lb);
  }

  /** Self-lit pixel (glowing knobs, sparks): ignores the pen's light. */
  raw(x: number, y: number, c: RGB, k = 1): void {
    if (this.clipped(x, y)) return;
    (this.out.setFinePx ?? this.out.setPx).call(this.out, x, y, c[0] * k, c[1] * k, c[2] * k);
  }

  glow(x: number, y: number, c: RGB, k = 1): void {
    if (this.clipped(x, y)) return;
    (this.out.addFinePx ?? this.out.addPx).call(this.out, x, y, c[0] * k, c[1] * k, c[2] * k);
  }

  /** A straight stroke `width` cells thick (0 = one presentation pixel). */
  line(ax: number, ay: number, bx: number, by: number, c: RGB, width = 0, k = 1): void {
    if (!this.inView(ax, ay, bx, by)) return;
    const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy) || 1;
    const n = Math.max(1, Math.ceil(length / this.step));
    const nx = -dy / length, ny = dx / length;
    const half = Math.max(0, width - this.step) / 2;
    for (let i = 0; i <= n; i++) {
      const x = ax + dx * i / n, y = ay + dy * i / n;
      if (half <= 0) { this.px(x, y, c, k); continue; }
      for (let w = -half; w <= half + 1e-6; w += this.step) this.px(x + nx * w, y + ny * w, c, k);
    }
  }

  /** A machined rod: dark edges, a lit core and a single highlight thread. */
  rod(ax: number, ay: number, bx: number, by: number, c: RGB, width = 1): void {
    if (!this.inView(ax - width, ay - width, bx + width, by + width)) return;
    const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length;
    this.line(ax, ay, bx, by, INK, width + this.step * 2);
    this.line(ax, ay, bx, by, c, width);
    const lift = -Math.max(0, (width - this.step) / 2) + this.step * 0.5;
    const side = nx - ny < 0 ? 1 : -1; // the thread faces the upper-left lamp
    this.line(ax + nx * lift * side, ay + ny * lift * side, bx + nx * lift * side, by + ny * lift * side, c, 0, 1.35);
  }

  /** A shaded disc; `rim` draws the outer edge in a second colour. */
  disc(x: number, y: number, r: number, c: RGB, rim?: RGB, rimWidth = this.step, flat = false): void {
    if (!this.inView(x - r, y - r, x + r, y + r)) return;
    const s = this.step;
    for (let dy = -r; dy <= r; dy += s) for (let dx = -r; dx <= r; dx += s) {
      const d = Math.hypot(dx, dy) / r;
      if (d > 1) continue;
      if (rim && d > 1 - rimWidth / r) { this.px(x + dx, y + dy, rim); continue; }
      const k = flat ? 1 : 0.7 + Math.sqrt(1 - d * d) * 0.3 - (dx + dy) / r * 0.14;
      this.px(x + dx, y + dy, c, k);
    }
  }

  ring(x: number, y: number, r: number, width: number, c: RGB, k = 1): void {
    if (!this.inView(x - r, y - r, x + r, y + r)) return;
    const s = this.step, inner = Math.max(0, r - width);
    for (let dy = -r; dy <= r; dy += s) for (let dx = -r; dx <= r; dx += s) {
      const d = Math.hypot(dx, dy);
      if (d > r || d < inner) continue;
      this.px(x + dx, y + dy, c, k);
    }
  }

  arc(x: number, y: number, r: number, a0: number, a1: number, c: RGB, width = 0, k = 1): void {
    if (!this.inView(x - r, y - r, x + r, y + r)) return;
    const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / this.step));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (width <= this.step) this.px(px, py, c, k);
      else this.line(px, py, x + Math.cos(a) * (r - width), y + Math.sin(a) * (r - width), c, 0, k);
    }
  }

  polygon(points: ReadonlyArray<readonly [number, number]>, c: RGB, k = 1, shade = 0): void {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    if (!this.inView(minX, minY, maxX, maxY)) return;
    const s = this.step, cuts: number[] = [];
    for (let y = Math.floor(minY / s) * s; y <= maxY; y += s) {
      cuts.length = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) cuts.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      cuts.sort((p, q) => p - q);
      for (let i = 0; i + 1 < cuts.length; i += 2) for (let x = Math.ceil(cuts[i] / s) * s; x <= cuts[i + 1]; x += s) {
        this.px(x, y, c, k * (1 - shade * (y - minY) / Math.max(1e-3, maxY - minY)));
      }
    }
  }

  /** A rotated plate with a dark edge and a lit top bevel. */
  box(x: number, y: number, halfW: number, halfH: number, angle: number, c: RGB, edge: RGB = INK, k = 1): void {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const corner = (lx: number, ly: number): readonly [number, number] => [x + lx * cos - ly * sin, y + lx * sin + ly * cos];
    const reach = Math.hypot(halfW, halfH);
    if (!this.inView(x - reach, y - reach, x + reach, y + reach)) return;
    this.polygon([corner(-halfW, -halfH), corner(halfW, -halfH), corner(halfW, halfH), corner(-halfW, halfH)], edge, k);
    const e = this.step;
    if (halfW > e && halfH > e) {
      this.polygon([corner(-halfW + e, -halfH + e), corner(halfW - e, -halfH + e), corner(halfW - e, halfH - e), corner(-halfW + e, halfH - e)], c, k, 0.22);
      const a = corner(-halfW + e * 2, -halfH + e), b = corner(halfW - e * 2, -halfH + e);
      this.line(a[0], a[1], b[0], b[1], c, 0, k * 1.3);
    }
  }

  rivet(x: number, y: number, c: RGB = BRASS_L): void {
    this.px(x, y, c, 1.1);
    this.px(x + this.step, y + this.step, INK);
  }

  /**
   * A pulley, handwheel or crank wheel. Spokes rotate with `angle`; the
   * specular highlight stays put (it belongs to the lamp, not the wheel),
   * which is what makes rotation legible.
   */
  wheel(x: number, y: number, r: number, angle: number, opts: {
    spokes?: number; face?: RGB; rim?: RGB; hub?: RGB; groove?: boolean; handle?: boolean; rimWidth?: number;
  } = {}): void {
    if (!this.inView(x - r - 2, y - r - 2, x + r + 2, y + r + 2)) return;
    const rim = opts.rim ?? BRASS, face = opts.face ?? WHEEL_FACE, hub = opts.hub ?? BRASS;
    const rimWidth = opts.rimWidth ?? Math.max(this.step * 2, r * 0.22);
    const spokes = opts.spokes ?? (r >= 7 ? 6 : 4);
    this.ring(x, y, r + this.step, this.step, INK);
    if (r > rimWidth + this.step) this.disc(x, y, r - rimWidth, face, undefined, 0, false);
    this.ring(x, y, r, rimWidth, rim);
    if (opts.groove && r > 3) this.ring(x, y, r - rimWidth * 0.5, this.step, rim, 0.55);
    // Fixed lamp highlight on the upper-left of the rim.
    this.arc(x, y, r - this.step * 0.5, Math.PI * 1.05, Math.PI * 1.45, BRASS_L, 0, 1);
    const spokeR = Math.max(0, r - rimWidth);
    for (let i = 0; i < spokes; i++) {
      const a = angle + i * Math.PI * 2 / spokes;
      const ex = x + Math.cos(a) * spokeR, ey = y + Math.sin(a) * spokeR;
      this.line(x, y, ex, ey, INK, r >= 6 ? this.step * 3 : this.step * 2);
      this.line(x, y, ex, ey, rim, r >= 6 ? this.step : 0);
    }
    const hubR = Math.max(this.step, Math.min(r * 0.32, 2.2));
    this.disc(x, y, hubR, hub, INK);
    this.px(x - this.step * 0.5, y - this.step * 0.5, BRASS_L);
    if (opts.handle) {
      const a = angle + Math.PI / spokes;
      const hx = x + Math.cos(a) * (r - rimWidth * 0.5), hy = y + Math.sin(a) * (r - rimWidth * 0.5);
      this.disc(hx, hy, Math.max(1, r * 0.2), IRON, INK);
      this.px(hx - this.step, hy - this.step, STEEL_L);
    }
  }

  /**
   * A cable, rope or chain along a polyline. Runs sag by their span (never
   * the vertical drops), the two-tone twist advances with `phase` so a
   * moving strand visibly travels over its pulleys, and a dark underside
   * thread lifts it off the background.
   */
  cable(points: ReadonlyArray<readonly [number, number]>, phase: number, opts: {
    color?: RGB; dark?: RGB; material?: 'rope' | 'chain' | 'cable'; sag?: number; width?: number;
  } = {}): void {
    const material = opts.material ?? 'cable';
    const color = opts.color ?? (material === 'rope' ? HEMP : STEEL);
    const dark = opts.dark ?? (material === 'rope' ? HEMP_D : STEEL_D);
    const width = opts.width ?? (material === 'chain' ? 1 : this.step);
    const period = material === 'chain' ? 3 : material === 'rope' ? 2 : 2.5;
    let travelled = phase;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1], [bx, by] = points[i];
      const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
      if (length < 1e-3) continue;
      const horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
      const sag = horizontal ? Math.min(opts.sag ?? 2.5, length / 36) : 0;
      if (this.inView(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by) + sag)) {
        const n = Math.max(1, Math.ceil(length / this.step));
        for (let k = 0; k <= n; k++) {
          const t = k / n, x = ax + dx * t, y = ay + dy * t + Math.sin(t * Math.PI) * sag;
          const along = travelled + t * length, twist = ((along % period) + period) % period;
          if (material === 'chain') {
            // Alternating links: a lit link, then a dark edge-on link.
            const lit = twist < period * 0.55;
            this.px(x, y, lit ? color : dark, lit ? 1 : 0.9);
            if (lit) this.px(x - this.step, y, dark, 0.9);
            this.px(x, y + this.step, INK);
          } else {
            const lit = twist < period * 0.5;
            for (let w = 0; w < width; w += this.step) this.px(x + w * 0.5, y + w, lit ? color : dark, lit ? 1.05 : 0.9);
            this.px(x, y + Math.max(width, this.step), INK);
          }
        }
      }
      travelled += length;
    }
  }
}

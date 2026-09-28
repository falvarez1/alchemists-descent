import { smoothstep } from '@/render/depth/raster';

/**
 * THE READABILITY RULE for the foreground occluders: the play layer always
 * wins. A coarse screen-space field (one texel per REVEAL_CELL view cells,
 * linearly filtered by the quad that draws the foreground) says how much of
 * an occluder may show at each point:
 *
 *   - nothing over the screen's centre (the HUD-critical middle, where the
 *     follow camera keeps the player): a clear ellipse easing out to the edges;
 *   - nothing over the player, a creature, a pickup, a projectile, a lever
 *     or a hazard: each punches a soft hole sized to the thing;
 *   - softer everywhere under high-readability lighting.
 *
 * The field EASES toward its target on every update (REVEAL_EASE), so an occluder
 * thins and returns smoothly as things move behind it instead of popping.
 * Channel G carries how lit the spot is (0 dark … 1), so an occluder's rim
 * catch dims in designed darkness; channel B the designed-darkness render
 * factor alone (1 open … 0 deep dark), which the far depth particles dim by;
 * channel A is CALM (1, or 0 inside an optics zone: the Glass Galleries'
 * puzzle rooms and the Lens Room), where no depth particle may glint.
 */

export const REVEAL_CELL = 8;
/** Ease per update (the scene updates the field every other tick: ~0.14 per tick). */
export const REVEAL_EASE = 0.26;
/** The light channel refreshes every few frames (it only tints the rims). */
const LIGHT_EVERY = 3;

/** Writes [light level 0–1, designed-darkness open factor 0–1] for a view point. */
export type RevealLightSampler = (vx: number, vy: number, out: Float32Array) => void;

/** A thing the occluders must not hide: view-space centre (cells) and radius (cells). */
export interface RevealPoint {
  x: number;
  y: number;
  r: number;
}

/** A region occluders never cover (an authored set piece), view cells, with a soft edge of `pad` cells. */
export interface RevealRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pad: number;
  /** Also silence the depth particles here (optics: no false glints near a beam puzzle). */
  calm?: boolean;
}

/** A rect's hole: 0 inside, easing to 1 over `pad` cells outside. */
export function rectMask(vx: number, vy: number, r: RevealRect): number {
  const dx = Math.max(r.x0 - vx, 0, vx - r.x1), dy = Math.max(r.y0 - vy, 0, vy - r.y1);
  return smoothstep(0, r.pad, Math.hypot(dx, dy));
}

export interface RevealOptions {
  /** High-readability lighting: fewer/softer occluders. */
  readonly readable: boolean;
  /** Snap straight to the target (level entry, camera cut). */
  readonly snap?: boolean;
}

/** The clear-centre mask at a view point (0 = fully clear, 1 = occluders at full strength). */
export function centreMask(vx: number, vy: number, viewW: number, viewH: number, readable: boolean): number {
  const ex = (vx - viewW / 2) / (viewW / 2);
  const ey = (vy - viewH / 2) / (viewH / 2);
  const d = Math.sqrt(ex * ex + ey * ey);
  return readable ? smoothstep(0.62, 1.05, d) : smoothstep(0.42, 0.86, d);
}

/** One point's hole: 0 at the thing, easing to 1 outside ~1.35 radii. */
export function pointMask(vx: number, vy: number, p: RevealPoint): number {
  const d = Math.hypot(vx - p.x, vy - p.y);
  return smoothstep(p.r * 0.6, p.r * 1.35, d);
}

export class RevealField {
  readonly w: number;
  readonly h: number;
  /** Eased occluder allowance per texel (0–1). */
  readonly value: Float32Array;
  /** Light catch per texel (0–1). */
  readonly light: Float32Array;
  /** Designed-darkness open factor per texel (0–1). */
  readonly open: Float32Array;
  /** Particle calm per texel (1 = particles allowed, 0 = an optics zone). */
  readonly calm: Float32Array;
  /** RGBA8 upload buffer (R = allowance, G = light, B = open, A = calm). */
  readonly bytes: Uint8Array;
  version = 0;
  private primed = false;
  private readonly target: Float32Array;
  /** Centre masks per mode (static: the view never changes size). */
  private readonly centre: Float32Array;
  private readonly centreReadable: Float32Array;
  private readonly lightSample = new Float32Array(2);
  private readonly calmTarget: Float32Array;

  constructor(readonly viewW: number, readonly viewH: number) {
    this.w = Math.ceil(viewW / REVEAL_CELL) + 1;
    this.h = Math.ceil(viewH / REVEAL_CELL) + 1;
    const n = this.w * this.h;
    this.value = new Float32Array(n);
    this.light = new Float32Array(n).fill(1);
    this.open = new Float32Array(n).fill(1);
    this.calm = new Float32Array(n).fill(1);
    this.calmTarget = new Float32Array(n);
    this.bytes = new Uint8Array(n * 4);
    this.target = new Float32Array(n);
    this.centre = new Float32Array(n);
    this.centreReadable = new Float32Array(n);
    for (let ty = 0; ty < this.h; ty++) for (let tx = 0; tx < this.w; tx++) {
      const i = ty * this.w + tx;
      this.centre[i] = centreMask(tx * REVEAL_CELL, ty * REVEAL_CELL, viewW, viewH, false);
      this.centreReadable[i] = centreMask(tx * REVEAL_CELL, ty * REVEAL_CELL, viewW, viewH, true) * 0.55;
    }
  }

  /**
   * Ease toward the target built from `points`; `lightAt` samples how lit
   * a view point is and its designed-darkness factor. Returns the new version.
   */
  update(points: readonly RevealPoint[], opts: RevealOptions, lightAt: RevealLightSampler | null,
    rects: readonly RevealRect[] = []): number {
    const { w, h, value, light, open, calm, calmTarget, bytes, target, lightSample } = this;
    const ease = opts.snap || !this.primed ? 1 : REVEAL_EASE;
    target.set(opts.readable ? this.centreReadable : this.centre);
    calmTarget.fill(1);
    for (const r of rects) {
      if (!r.calm) continue;
      const tx0 = Math.max(0, Math.floor((r.x0 - r.pad) / REVEAL_CELL)), tx1 = Math.min(w - 1, Math.ceil((r.x1 + r.pad) / REVEAL_CELL));
      const ty0 = Math.max(0, Math.floor((r.y0 - r.pad) / REVEAL_CELL)), ty1 = Math.min(h - 1, Math.ceil((r.y1 + r.pad) / REVEAL_CELL));
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * w + tx;
        calmTarget[i] = Math.min(calmTarget[i], rectMask(tx * REVEAL_CELL, ty * REVEAL_CELL, r));
      }
    }
    for (const r of rects) {
      const tx0 = Math.max(0, Math.floor((r.x0 - r.pad) / REVEAL_CELL)), tx1 = Math.min(w - 1, Math.ceil((r.x1 + r.pad) / REVEAL_CELL));
      const ty0 = Math.max(0, Math.floor((r.y0 - r.pad) / REVEAL_CELL)), ty1 = Math.min(h - 1, Math.ceil((r.y1 + r.pad) / REVEAL_CELL));
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * w + tx;
        if (target[i] > 0) target[i] *= rectMask(tx * REVEAL_CELL, ty * REVEAL_CELL, r);
      }
    }
    // Each point touches only the texels inside its hole's reach.
    for (let k = 0; k < points.length; k++) {
      const p = points[k];
      const reach = p.r * 1.35;
      const tx0 = Math.max(0, Math.floor((p.x - reach) / REVEAL_CELL)), tx1 = Math.min(w - 1, Math.ceil((p.x + reach) / REVEAL_CELL));
      const ty0 = Math.max(0, Math.floor((p.y - reach) / REVEAL_CELL)), ty1 = Math.min(h - 1, Math.ceil((p.y + reach) / REVEAL_CELL));
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * w + tx;
        if (target[i] > 0) target[i] *= pointMask(tx * REVEAL_CELL, ty * REVEAL_CELL, p);
      }
    }
    const lightNow = lightAt !== null && (ease === 1 || this.version % LIGHT_EVERY === 0);
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const i = ty * w + tx;
        value[i] += (target[i] - value[i]) * ease;
        calm[i] += (calmTarget[i] - calm[i]) * ease;
        if (lightNow) {
          lightAt(tx * REVEAL_CELL, ty * REVEAL_CELL, lightSample);
          const k = Math.min(1, ease * 3);
          light[i] += (lightSample[0] - light[i]) * k;
          open[i] += (lightSample[1] - open[i]) * k;
        }
        const o = i * 4;
        bytes[o] = Math.round(value[i] * 255);
        bytes[o + 1] = Math.round(Math.max(0, Math.min(1, light[i])) * 255);
        bytes[o + 2] = Math.round(Math.max(0, Math.min(1, open[i])) * 255);
        bytes[o + 3] = Math.round(Math.max(0, Math.min(1, calm[i])) * 255);
      }
    }
    this.primed = true;
    return ++this.version;
  }

  /** Bilinear read of the eased allowance at a view point (tests, particles). */
  sample(vx: number, vy: number): number {
    return this.bilinear(this.value, vx, vy);
  }

  /** Bilinear read of the particle calm at a view point (the CPU particle path). */
  sampleCalm(vx: number, vy: number): number {
    return this.bilinear(this.calm, vx, vy);
  }

  private bilinear(v: Float32Array, vx: number, vy: number): number {
    const fx = Math.max(0, Math.min(this.w - 1.001, vx / REVEAL_CELL));
    const fy = Math.max(0, Math.min(this.h - 1.001, vy / REVEAL_CELL));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const w = this.w;
    const a = v[y0 * w + x0], b = v[y0 * w + x0 + 1], c = v[(y0 + 1) * w + x0], d = v[(y0 + 1) * w + x0 + 1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  }
}

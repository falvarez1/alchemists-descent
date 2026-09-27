import type { LightField, PixelSurface } from '@/render/pixels';
import type { CreatureMaterial, RGB } from './palette';

/**
 * The creature rasterizer: smooth 2.5D volumes at presentation resolution.
 *
 * Creatures are built each frame from their simulated rig as a handful of
 * volumes — ellipsoids, tapered capsules (limbs, tails, necks), domed or flat
 * polygons (membranes, fins, soft bodies). Each primitive writes a height and
 * an ANALYTIC surface normal into a small z-buffered canvas, so overlapping
 * parts occlude correctly and every pixel knows which way it faces.
 *
 * One lighting pass then shades the whole animal: a key light whose direction
 * is read from the real light field around the body (a creature standing
 * beside the wizard's wand is lit from the wand side), soft-banded ramps with
 * hue-shifted shadows, a light-side rim, specular glints on wet or lacquered
 * materials, self-lit accents that feed bloom, a dark sel-out silhouette line
 * and contact lines where a near limb crosses the body.
 *
 * The pass writes overlay pixels only; nothing here touches the grid.
 */

export interface SceneLight {
  /** Unit direction TOWARD the key light (+x right, +y down, +z toward the viewer). */
  lx: number;
  ly: number;
  lz: number;
  /** Per-channel light level at the body (the field's 0.48..1.8 lit factors). */
  r: number;
  g: number;
  b: number;
  /** 0..1 hit flash. */
  flash: number;
  /** 0..1 life in the self-lit parts (a corpse's lights gutter out). */
  glow: number;
  /**
   * 0..1 how much of the body the light has found (light wave). Below 1, in
   * designed darkness, unrevealed pixels keep only their own glow: the body
   * resolves out of the black through an ordered dither as the beam lands.
   */
  reveal?: number;
  /**
   * A wash over the whole body toward a colour, [r, g, b, amount 0..1]:
   * charred remains darken, frozen ones go ice-pale, a body in the wand's
   * grip takes a faint brass glow (creatures/corpses → render/creatures).
   */
  tint?: readonly [number, number, number, number];
}

// Pixel flags.
const F_FAR = 1;
const F_NO_OUTLINE = 2;
const F_FLAT = 4; // unlit decal (pupils, painted marks): ramp index fixed by tone

export interface PrimOpts {
  /** Parts sharing a group blend smoothly where they meet; different groups get a contact line. */
  group?: number;
  /** Back layer: darker, like Rain World's far-side limbs. */
  far?: boolean;
  /** Volume depth scale (1 = round cross-section). */
  depth?: number;
  /** Ramp offset in steps (+ lighter, - darker) for painted markings baked into the volume. */
  tone?: number;
  noOutline?: boolean;
}

const EMPTY_OPTS: PrimOpts = {};

/** 4×4 Bayer thresholds in 0..1 for soft band edges. */
const BAYER = new Float32Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16));

/** Drawing window half-size around the creature's anchor (world cells). */
const RASTER_MAX_HALF_SPAN = 192;
/** Hard ceiling on scratch pixels (≈ 34 MB across the planes at the cap). */
const RASTER_MAX_PIXELS = 1 << 20;

export class CreatureRaster {
  /** World units per canvas pixel (0.5 on the fine surface, 1 on legacy surfaces). */
  step = 1;
  private inv = 1;
  ox = 0;
  oy = 0;
  w = 0;
  h = 0;
  private cap = 0;
  private z = new Float32Array(0);
  private nx = new Float32Array(0);
  private ny = new Float32Array(0);
  private tone = new Float32Array(0);
  private mat = new Uint8Array(0);
  private grp = new Uint8Array(0);
  private flags = new Uint8Array(0);
  private outR = new Float32Array(0);
  private outG = new Float32Array(0);
  private outB = new Float32Array(0);
  private blkRgb = new Float32Array(0);
  private blkA = new Float32Array(0);
  private blkGlow = new Float32Array(0);
  private mats: CreatureMaterial[] = [];
  /** Dirty rectangle of covered pixels (resolve only walks this). */
  private dx0 = 0;
  private dy0 = 0;
  private dx1 = -1;
  private dy1 = -1;
  /** Anchor for the dither lattice so the pattern rides the body, not the screen. */
  private ax = 0;
  private ay = 0;
  /** Smooth-blend window (world cells of height) for same-group joins. */
  blend = 1.6;
  /** Outline mode: 0 none, 1 full silhouette, 2 shadow side only. */
  outline = 1;
  /** Band crispness: 0 = continuous shading, 1 = hard pixel-art bands. */
  bands = 0.72;
  /** Resolve band seams with an ordered dither instead of a blend. */
  dither = false;

  /** Start a creature: world-space bounds it may draw into and its material table. */
  begin(step: number, x0: number, y0: number, x1: number, y1: number, mats: CreatureMaterial[], anchorX = x0, anchorY = y0): void {
    // Runaway guard (QA "Array buffer allocation failed"): the bounds come
    // from simulated rig points. Non-finite bounds draw nothing this frame;
    // a limb flung across the map is clipped to a window around the anchor
    // (the largest real creature — the leviathan — spans < 200 cells).
    if (!(step > 0) || !Number.isFinite(step) || !Number.isFinite(x0 + y0 + x1 + y1)) { this.beginEmpty(step, mats); return; }
    const cx = Number.isFinite(anchorX) ? anchorX : x0, cy = Number.isFinite(anchorY) ? anchorY : y0;
    x0 = Math.max(x0, cx - RASTER_MAX_HALF_SPAN); x1 = Math.min(x1, cx + RASTER_MAX_HALF_SPAN);
    y0 = Math.max(y0, cy - RASTER_MAX_HALF_SPAN); y1 = Math.min(y1, cy + RASTER_MAX_HALF_SPAN);
    this.step = step;
    this.inv = 1 / step;
    this.ox = Math.floor(x0 / step) * step - step;
    this.oy = Math.floor(y0 / step) * step - step;
    this.w = Math.max(1, Math.ceil((x1 - this.ox) / step) + 2);
    this.h = Math.max(1, Math.ceil((y1 - this.oy) / step) + 2);
    const n = this.w * this.h;
    if (!(n <= RASTER_MAX_PIXELS)) { this.beginEmpty(step, mats); return; }
    if (n > this.cap) {
      // Allocate first, commit after: a failed allocation must not leave
      // `cap` claiming buffers that were never made.
      const cap = Math.max(n, Math.min(this.cap * 2, RASTER_MAX_PIXELS), 4096);
      try {
        const z = new Float32Array(cap), nx = new Float32Array(cap), ny = new Float32Array(cap);
        const tone = new Float32Array(cap), mat = new Uint8Array(cap), grp = new Uint8Array(cap);
        const flags = new Uint8Array(cap), outR = new Float32Array(cap), outG = new Float32Array(cap), outB = new Float32Array(cap);
        this.z = z; this.nx = nx; this.ny = ny; this.tone = tone; this.mat = mat; this.grp = grp;
        this.flags = flags; this.outR = outR; this.outG = outG; this.outB = outB;
        this.cap = cap;
      } catch {
        this.beginEmpty(step, mats);
        return;
      }
    }
    this.mat.fill(0, 0, n);
    this.dx0 = this.w; this.dy0 = this.h; this.dx1 = -1; this.dy1 = -1;
    this.z.fill(-1e9, 0, n);
    this.mats = mats;
    this.ax = Math.round(anchorX * this.inv);
    this.ay = Math.round(anchorY * this.inv);
  }

  /** A zero-size canvas: every primitive clips to nothing and resolve() is a no-op. */
  private beginEmpty(step: number, mats: CreatureMaterial[]): void {
    this.step = step > 0 && Number.isFinite(step) ? step : 1;
    this.inv = 1 / this.step;
    this.ox = 0; this.oy = 0; this.w = 0; this.h = 0;
    this.dx0 = 0; this.dy0 = 0; this.dx1 = -1; this.dy1 = -1;
    this.mats = mats;
    this.ax = 0; this.ay = 0;
  }

  private write(i: number, height: number, nx: number, ny: number, mat: number, o: PrimOpts): void {
    const g = o.group ?? 0;
    const cur = this.z[i];
    const occupied = this.mat[i] !== 0;
    if (occupied && this.grp[i] === g && Math.abs(height - cur) < this.blend) {
      // Same-body join: smooth-max the height and blend the normals so necks
      // flow into heads and limbs root into shoulders without a seam.
      const k = this.blend, d = Math.abs(height - cur);
      const s = (k - d) / k;
      const wNew = height >= cur ? 0.5 + 0.5 * (1 - s) : 0.5 - 0.5 * (1 - s);
      this.nx[i] = this.nx[i] * (1 - wNew) + nx * wNew;
      this.ny[i] = this.ny[i] * (1 - wNew) + ny * wNew;
      this.z[i] = Math.max(height, cur) + s * s * k * 0.25;
      if (height >= cur) {
        this.mat[i] = mat;
        this.tone[i] = o.tone ?? 0;
        this.flags[i] = (o.far ? F_FAR : 0) | (o.noOutline ? F_NO_OUTLINE : 0);
      }
      return;
    }
    if (occupied && height <= cur) return;
    if (!occupied) {
      const x = i % this.w, y = (i - x) / this.w;
      if (x < this.dx0) this.dx0 = x; if (x > this.dx1) this.dx1 = x;
      if (y < this.dy0) this.dy0 = y; if (y > this.dy1) this.dy1 = y;
    }
    this.z[i] = height;
    this.nx[i] = nx;
    this.ny[i] = ny;
    this.mat[i] = mat;
    this.grp[i] = g;
    this.tone[i] = o.tone ?? 0;
    this.flags[i] = (o.far ? F_FAR : 0) | (o.noOutline ? F_NO_OUTLINE : 0);
  }

  /** Rotated ellipsoid. `mat` is 1-based into the material table. */
  ellipse(cx: number, cy: number, rx: number, ry: number, angle: number, z: number, mat: number, o: PrimOpts = EMPTY_OPTS): void {
    rx = Math.max(rx, this.step * 0.5); ry = Math.max(ry, this.step * 0.5);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const ex = Math.sqrt(rx * rx * cos * cos + ry * ry * sin * sin), ey = Math.sqrt(rx * rx * sin * sin + ry * ry * cos * cos);
    const depth = Math.min(rx, ry) * (o.depth ?? 1);
    const s = this.step, inv = this.inv;
    const i0 = Math.max(0, Math.floor((cx - ex - this.ox) * inv)), i1 = Math.min(this.w - 1, Math.ceil((cx + ex - this.ox) * inv));
    const j0 = Math.max(0, Math.floor((cy - ey - this.oy) * inv)), j1 = Math.min(this.h - 1, Math.ceil((cy + ey - this.oy) * inv));
    const irx = 1 / rx, iry = 1 / ry;
    for (let j = j0; j <= j1; j++) {
      const dy = this.oy + j * s - cy;
      for (let i = i0; i <= i1; i++) {
        const dx = this.ox + i * s - cx;
        const u = (dx * cos + dy * sin) * irx, v = (-dx * sin + dy * cos) * iry;
        const d2 = u * u + v * v;
        if (d2 > 1) continue;
        const hgt = Math.sqrt(1 - d2);
        // Ellipsoid normal ∝ (u/rx, v/ry, h/depth) in local space.
        let lx = u * irx, ly = v * iry;
        const lz = hgt / depth;
        const len = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
        lx /= len; ly /= len;
        this.write(j * this.w + i, z + depth * hgt, lx * cos - ly * sin, lx * sin + ly * cos, mat, o);
      }
    }
  }

  /** Tapered capsule from a (radius ra, height za) to b (radius rb, height zb). */
  capsule(ax: number, ay: number, ra: number, bx: number, by: number, rb: number, za: number, zb: number, mat: number, o: PrimOpts = EMPTY_OPTS): void {
    ra = Math.max(ra, this.step * 0.5); rb = Math.max(rb, this.step * 0.5);
    const rmax = Math.max(ra, rb), s = this.step, inv = this.inv;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - rmax - this.ox) * inv)), i1 = Math.min(this.w - 1, Math.ceil((Math.max(ax, bx) + rmax - this.ox) * inv));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - rmax - this.oy) * inv)), j1 = Math.min(this.h - 1, Math.ceil((Math.max(ay, by) + rmax - this.oy) * inv));
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, il2 = l2 > 1e-9 ? 1 / l2 : 0;
    const depthK = o.depth ?? 1;
    for (let j = j0; j <= j1; j++) {
      const py = this.oy + j * s;
      for (let i = i0; i <= i1; i++) {
        const px = this.ox + i * s;
        let t = ((px - ax) * dx + (py - ay) * dy) * il2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = ax + dx * t, cy = ay + dy * t, r = ra + (rb - ra) * t;
        const ox = px - cx, oy = py - cy, d2 = ox * ox + oy * oy;
        if (d2 > r * r) continue;
        const ir = 1 / r, qx = ox * ir, qy = oy * ir;
        const hgt = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy));
        this.write(j * this.w + i, za + (zb - za) * t + r * depthK * hgt, qx, qy, mat, o);
      }
    }
  }

  /** A tube through points with per-point radii (tails, necks, tentacles, limbs). */
  tube(xs: ArrayLike<number>, ys: ArrayLike<number>, rs: ArrayLike<number>, n: number, z: number, mat: number, o: PrimOpts = EMPTY_OPTS, zEnd = z): void {
    for (let k = 1; k < n; k++) {
      const za = z + (zEnd - z) * ((k - 1) / Math.max(1, n - 1)), zb = z + (zEnd - z) * (k / Math.max(1, n - 1));
      this.capsule(xs[k - 1], ys[k - 1], rs[k - 1], xs[k], ys[k], rs[k], za, zb, mat, o);
    }
  }

  /**
   * Filled polygon. `dome` > 0 pillows it by distance to the nearest edge (soft
   * bodies, leaves, puffed membranes); 0 = a flat plate facing the viewer,
   * optionally tilted by (tiltX, tiltY) so membranes catch light as they flap.
   */
  poly(pts: ArrayLike<number>, count: number, z: number, mat: number, dome = 0, o: PrimOpts = EMPTY_OPTS, tiltX = 0, tiltY = 0): void {
    if (count < 3) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < count; k++) {
      const x = pts[k * 2], y = pts[k * 2 + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const s = this.step, inv = this.inv;
    const j0 = Math.max(0, Math.floor((minY - this.oy) * inv)), j1 = Math.min(this.h - 1, Math.ceil((maxY - this.oy) * inv));
    const flatN = Math.hypot(tiltX, tiltY) > 0.95 ? 0.95 / Math.hypot(tiltX, tiltY) : 1;
    const tx = tiltX * flatN, ty = tiltY * flatN;
    for (let j = j0; j <= j1; j++) {
      const py = this.oy + j * s;
      // Scanline crossings.
      let c0 = Infinity, c1 = -Infinity;
      const cuts = POLY_CUTS; let nc = 0;
      for (let k = 0; k < count; k++) {
        const ax = pts[k * 2], ay = pts[k * 2 + 1];
        const kb = (k + 1) % count, bx = pts[kb * 2], by = pts[kb * 2 + 1];
        if ((ay <= py && by > py) || (by <= py && ay > py)) {
          const x = ax + (py - ay) * (bx - ax) / (by - ay);
          if (nc < cuts.length) cuts[nc++] = x;
          if (x < c0) c0 = x; if (x > c1) c1 = x;
        }
      }
      if (nc < 2) continue;
      sortSmall(cuts, nc);
      for (let c = 0; c + 1 < nc; c += 2) {
        const i0 = Math.max(0, Math.ceil((cuts[c] - this.ox) * inv)), i1 = Math.min(this.w - 1, Math.floor((cuts[c + 1] - this.ox) * inv));
        for (let i = i0; i <= i1; i++) {
          const px = this.ox + i * s;
          if (dome <= 0) { this.write(j * this.w + i, z, tx, ty, mat, o); continue; }
          // Distance to the nearest edge and its outward direction.
          let best = Infinity, bx0 = 0, by0 = 0;
          for (let k = 0; k < count; k++) {
            const ax = pts[k * 2], ay = pts[k * 2 + 1];
            const kb = (k + 1) % count, ex = pts[kb * 2] - ax, ey = pts[kb * 2 + 1] - ay;
            const l2 = ex * ex + ey * ey;
            let t = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = px - (ax + ex * t), qy = py - (ay + ey * t), d2 = qx * qx + qy * qy;
            if (d2 < best) { best = d2; bx0 = qx; by0 = qy; }
          }
          const d = Math.sqrt(best);
          const e = Math.min(1, d / dome), q = 1 - e;
          const hgt = Math.sqrt(1 - q * q);
          const il = d > 1e-6 ? 1 / d : 0;
          // (bx0,by0) points inward from the edge; the surface leans outward.
          this.write(j * this.w + i, z + dome * hgt, -bx0 * il * q, -by0 * il * q, mat, o);
        }
      }
    }
  }

  /**
   * Re-paint the material inside an ellipse without changing the volume:
   * markings, stripes, lips, pupils. `flat` paints an unlit decal whose ramp
   * index is fixed (`tone` picks it: 0 darkest ... steps-1 lightest).
   */
  stamp(cx: number, cy: number, rx: number, ry: number, angle: number, mat: number, tone = 0, flat = false, onlyGroup = -1): void {
    rx = Math.max(rx, this.step * 0.5); ry = Math.max(ry, this.step * 0.5);
    const cos = Math.cos(angle), sin = Math.sin(angle), e = Math.max(rx, ry), s = this.step, inv = this.inv;
    const i0 = Math.max(0, Math.floor((cx - e - this.ox) * inv)), i1 = Math.min(this.w - 1, Math.ceil((cx + e - this.ox) * inv));
    const j0 = Math.max(0, Math.floor((cy - e - this.oy) * inv)), j1 = Math.min(this.h - 1, Math.ceil((cy + e - this.oy) * inv));
    for (let j = j0; j <= j1; j++) {
      const dy = this.oy + j * s - cy;
      for (let i = i0; i <= i1; i++) {
        const idx = j * this.w + i;
        if (this.mat[idx] === 0 || (onlyGroup >= 0 && this.grp[idx] !== onlyGroup)) continue;
        const dx = this.ox + i * s - cx;
        const u = (dx * cos + dy * sin) / rx, v = (-dx * sin + dy * cos) / ry;
        if (u * u + v * v > 1) continue;
        this.mat[idx] = mat;
        this.tone[idx] = tone;
        if (flat) this.flags[idx] |= F_FLAT; else this.flags[idx] &= ~F_FLAT;
      }
    }
  }

  /**
   * Soft tonal paint: add `dTone` ramp steps inside an ellipse with a smooth
   * falloff, keeping the material and the volume. Nuclei seen through gel,
   * ambient-occlusion pools, soft markings.
   */
  shade(cx: number, cy: number, rx: number, ry: number, angle: number, dTone: number, onlyGroup = -1, hard = 0): void {
    rx = Math.max(rx, this.step * 0.5); ry = Math.max(ry, this.step * 0.5);
    const cos = Math.cos(angle), sin = Math.sin(angle), e = Math.max(rx, ry), s = this.step, inv = this.inv;
    const i0 = Math.max(0, Math.floor((cx - e - this.ox) * inv)), i1 = Math.min(this.w - 1, Math.ceil((cx + e - this.ox) * inv));
    const j0 = Math.max(0, Math.floor((cy - e - this.oy) * inv)), j1 = Math.min(this.h - 1, Math.ceil((cy + e - this.oy) * inv));
    for (let j = j0; j <= j1; j++) {
      const dy = this.oy + j * s - cy;
      for (let i = i0; i <= i1; i++) {
        const idx = j * this.w + i;
        if (this.mat[idx] === 0 || (onlyGroup >= 0 && this.grp[idx] !== onlyGroup)) continue;
        const dx = this.ox + i * s - cx;
        const u = (dx * cos + dy * sin) / rx, v = (-dx * sin + dy * cos) / ry, d2 = u * u + v * v;
        if (d2 > 1) continue;
        const k = hard > 0 ? Math.min(1, (1 - d2) / Math.max(1e-3, 1 - hard)) : (1 - d2) * (1 - d2);
        this.tone[idx] += dTone * k;
      }
    }
  }

  /**
   * Gradient material stamp: repaint with `mat`, tone falling from `t0` at the
   * centre to `t1` at the rim — glowing cores, hot bladders, bioluminescent spots.
   */
  glowStamp(cx: number, cy: number, rx: number, ry: number, angle: number, mat: number, t0: number, t1: number, onlyGroup = -1): void {
    rx = Math.max(rx, this.step * 0.5); ry = Math.max(ry, this.step * 0.5);
    const cos = Math.cos(angle), sin = Math.sin(angle), e = Math.max(rx, ry), s = this.step, inv = this.inv;
    const i0 = Math.max(0, Math.floor((cx - e - this.ox) * inv)), i1 = Math.min(this.w - 1, Math.ceil((cx + e - this.ox) * inv));
    const j0 = Math.max(0, Math.floor((cy - e - this.oy) * inv)), j1 = Math.min(this.h - 1, Math.ceil((cy + e - this.oy) * inv));
    for (let j = j0; j <= j1; j++) {
      const dy = this.oy + j * s - cy;
      for (let i = i0; i <= i1; i++) {
        const idx = j * this.w + i;
        if (this.mat[idx] === 0 || (onlyGroup >= 0 && this.grp[idx] !== onlyGroup)) continue;
        const dx = this.ox + i * s - cx;
        const u = (dx * cos + dy * sin) / rx, v = (-dx * sin + dy * cos) / ry, d2 = u * u + v * v;
        if (d2 > 1) continue;
        const d = Math.sqrt(d2);
        this.mat[idx] = mat;
        this.tone[idx] = t0 + (t1 - t0) * d;
        this.flags[idx] |= F_FLAT;
      }
    }
  }

  /** A painted line of unlit/lit decal pixels over existing coverage (seams, stripes, mouths). */
  stroke(ax: number, ay: number, bx: number, by: number, mat: number, tone = 0, flat = true, width = 0): void {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * this.inv));
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (width > 0) this.stamp(x, y, width, width, 0, mat, tone, flat);
      else this.dotOver(x, y, mat, tone, flat);
    }
  }

  private dotOver(x: number, y: number, mat: number, tone: number, flat: boolean): void {
    const i = Math.round((x - this.ox) * this.inv), j = Math.round((y - this.oy) * this.inv);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return;
    const idx = j * this.w + i;
    if (this.mat[idx] === 0) return;
    this.mat[idx] = mat;
    this.tone[idx] = tone;
    if (flat) this.flags[idx] |= F_FLAT; else this.flags[idx] &= ~F_FLAT;
  }

  /** A free-standing pixel on top of everything (glints, fang tips, sparks). */
  dot(x: number, y: number, mat: number, tone = 0, z = 1e6): void {
    const i = Math.round((x - this.ox) * this.inv), j = Math.round((y - this.oy) * this.inv);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return;
    const idx = j * this.w + i;
    if (this.mat[idx] !== 0 && this.z[idx] > z) return;
    if (i < this.dx0) this.dx0 = i; if (i > this.dx1) this.dx1 = i;
    if (j < this.dy0) this.dy0 = j; if (j > this.dy1) this.dy1 = j;
    this.z[idx] = z; this.nx[idx] = 0; this.ny[idx] = 0;
    this.mat[idx] = mat; this.tone[idx] = tone; this.grp[idx] = 255; this.flags[idx] = F_FLAT | F_NO_OUTLINE;
  }

  /** Is there creature coverage at a world point? (for decals that must sit on the body). */
  covered(x: number, y: number): boolean {
    const i = Math.round((x - this.ox) * this.inv), j = Math.round((y - this.oy) * this.inv);
    return i >= 0 && j >= 0 && i < this.w && j < this.h && this.mat[j * this.w + i] !== 0;
  }

  /**
   * Shade and emit. Translucent materials blend with the terrain through the
   * surface's `blendFinePx` when it has one (the GPU overlay) and fall back to
   * an opaque, lightened body elsewhere.
   */
  resolve(out: PixelSurface, light: SceneLight): void {
    const w = this.w, h = this.h, s = this.step;
    const mats = this.mats, z = this.z, nxA = this.nx, nyA = this.ny, mat = this.mat, flags = this.flags;
    const lx = light.lx, ly = light.ly, lz = light.lz;
    // Blinn half vector with the viewer at +z.
    let hx = lx, hy = ly, hz = lz + 1;
    const hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
    const lxy = Math.hypot(lx, ly) || 1;
    const lr = light.r, lg = light.g, lb = light.b;
    const flash = light.flash, life = light.glow, reveal = light.reveal ?? 1, tint = light.tint;
    const bands = this.bands;
    const fine = out.setFinePx !== undefined && s < 1;
    const set = fine ? out.setFinePx! : out.setPx;
    const add = fine ? (out.addFinePx ?? out.addPx) : out.addPx;
    const blendPx = fine ? out.blendFinePx : undefined;
    const canBlend = blendPx !== undefined || (fine && out.blitFine !== undefined);
    const ax = this.ax, ay = this.ay;
    if (this.dx1 < this.dx0) return;
    const ri0 = Math.max(0, this.dx0 - 1), ri1 = Math.min(w - 1, this.dx1 + 1);
    const rj0 = Math.max(0, this.dy0 - 1), rj1 = Math.min(h - 1, this.dy1 + 1);
    // Pass 1: shade every covered pixel into the colour scratch.
    for (let j = rj0; j <= rj1; j++) {
      for (let i = ri0; i <= ri1; i++) {
        const idx = j * w + i, m = mat[idx];
        if (m === 0) continue;
        const M = mats[m - 1];
        if (!M) continue;
        const steps = M.ramp.steps, rgb = M.ramp.rgb, f = flags[idx];
        let v: number;
        if (f & F_FLAT) {
          v = this.tone[idx] / Math.max(1, steps - 1);
        } else {
          const nx = nxA[idx], ny = nyA[idx];
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          const ndl = nx * lx + ny * ly + nz * lz;
          // Half-Lambert wrap keeps the terminator soft and the shadow side readable.
          const wrap = ndl * 0.5 + 0.5;
          v = 0.08 + wrap * wrap * 0.92;
          // Fresnel rim on the lit side only: edges turned toward the lamp catch it.
          const edge = 1 - nz;
          const side = (nx * lx + ny * ly) / lxy;
          if (side > 0) v += edge * edge * M.rim * side * 1.2;
          // Contact line: a nearer part of another group crossing just above.
          if (i > 0 && i < w - 1 && j > 0 && j < h - 1) {
            const zc = z[idx], g = this.grp[idx];
            if ((mat[idx - 1] !== 0 && this.grp[idx - 1] !== g && z[idx - 1] > zc + 1.5) ||
                (mat[idx + 1] !== 0 && this.grp[idx + 1] !== g && z[idx + 1] > zc + 1.5) ||
                (mat[idx - w] !== 0 && this.grp[idx - w] !== g && z[idx - w] > zc + 1.5) ||
                (mat[idx + w] !== 0 && this.grp[idx + w] !== g && z[idx + w] > zc + 1.5)) v -= 0.3;
          }
          v += this.tone[idx] / Math.max(1, steps - 1);
          if (f & F_FAR) v -= M.farDarken / Math.max(1, steps - 1);
          // Specular glint.
          if (M.gloss > 0) {
            const ndh = nx * hx + ny * hy + nz * hz;
            if (ndh > 0) {
              const sp = Math.pow(ndh, M.shine) * M.gloss;
              v += sp * 0.9;
            }
          }
        }
        // Soft-banded ramp lookup with an ordered-dither seam.
        const t = Math.max(0, Math.min(1, v)) * (steps - 1);
        let k = Math.floor(t), fr = t - k;
        if (k >= steps - 1) { k = steps - 2; fr = 1; }
        // Plateaus with a soft seam (`bands`), or a dithered seam when crisp.
        const width = 1 - bands;
        let q = width > 1e-3 ? (fr - 0.5) / width + 0.5 : fr;
        q = q < 0 ? 0 : q > 1 ? 1 : q;
        if (this.dither && q > 0 && q < 1) q = q > BAYER[((j + ay) & 3) * 4 + ((i + ax) & 3)] ? 1 : 0;
        const o0 = k * 3, o1 = o0 + 3;
        let r = rgb[o0] + (rgb[o1] - rgb[o0]) * q;
        let g = rgb[o0 + 1] + (rgb[o1 + 1] - rgb[o0 + 1]) * q;
        let b = rgb[o0 + 2] + (rgb[o1 + 2] - rgb[o0 + 2]) * q;
        // Scene light: emissive parts keep their own colour (while alive).
        // Unrevealed pixels (designed darkness, see SceneLight.reveal) are
        // only their own glow until the light finds them.
        const hidden = reveal < 1 && BAYER[((j + ay) & 3) * 4 + ((i + ax) & 3)] >= reveal;
        const em = M.emissive * life, lit = hidden ? 0 : 1 - em;
        r *= lit * lr + em; g *= lit * lg + em; b *= lit * lb + em;
        if (flash > 0) { r += (1 - r) * flash; g += (0.93 - g) * flash; b += (0.82 - b) * flash; }
        if (tint) { const k = tint[3]; r += (tint[0] - r) * k; g += (tint[1] - g) * k; b += (tint[2] - b) * k; }
        this.outR[idx] = r; this.outG[idx] = g; this.outB[idx] = b;
      }
    }
    // Pass 2: decide every output pixel (body, glass, silhouette line, glow)
    // into a packed block; then hand it over in one blit where the surface
    // supports it, or pixel by pixel where it doesn't.
    const ox = this.ox, oy = this.oy, mode = this.outline;
    const bw = ri1 - ri0 + 1, bh = rj1 - rj0 + 1, bn = bw * bh;
    if (bn * 3 > this.blkRgb.length) { this.blkRgb = new Float32Array(bn * 3 * 2); this.blkA = new Float32Array(bn * 2); this.blkGlow = new Float32Array(bn * 3 * 2); }
    const RGB = this.blkRgb, A = this.blkA, G = this.blkGlow;
    A.fill(0, 0, bn); G.fill(0, 0, bn * 3);
    let anyGlow = false;
    for (let j = rj0; j <= rj1; j++) {
      for (let i = ri0; i <= ri1; i++) {
        const idx = j * w + i, m = mat[idx], o = (j - rj0) * bw + (i - ri0);
        if (m === 0) {
          if (mode === 0) continue;
          // Sel-out: the neighbour whose surface faces this edge most squarely.
          let best = 0, bestN = -2;
          for (let q = 0; q < 4; q++) {
            let k: number, dirX: number, dirY: number;
            if (q === 0) { if (i === 0) continue; k = idx - 1; dirX = 1; dirY = 0; }
            else if (q === 1) { if (i === w - 1) continue; k = idx + 1; dirX = -1; dirY = 0; }
            else if (q === 2) { if (j === 0) continue; k = idx - w; dirX = 0; dirY = 1; }
            else { if (j === h - 1) continue; k = idx + w; dirX = 0; dirY = -1; }
            const mk = mat[k];
            if (mk === 0 || (flags[k] & F_NO_OUTLINE)) continue;
            // Shadow-side mode skips edges turned toward the light.
            if (mode === 2 && (dirX * lx + dirY * ly) / lxy < -0.25) continue;
            const facing = -(nxA[k] * dirX + nyA[k] * dirY);
            if (facing > bestN) { bestN = facing; best = mk; }
          }
          if (best === 0) continue;
          const M = mats[best - 1];
          const oc = M.outline, e = M.emissive * life;
          const k = 1 - e * 0.5;
          RGB[o * 3] = oc[0] * (k * lr * 0.7 + e * 0.5); RGB[o * 3 + 1] = oc[1] * (k * lg * 0.7 + e * 0.5); RGB[o * 3 + 2] = oc[2] * (k * lb * 0.7 + e * 0.5);
          A[o] = 1;
          continue;
        }
        const M = mats[m - 1];
        if (!M) continue;
        const r = this.outR[idx], g = this.outG[idx], b = this.outB[idx];
        if (M.translucent > 0 && canBlend) {
          // Glass lets the cave through; its own light (emissive) is added, not faded.
          const alpha = 1 - M.translucent;
          const k = alpha + M.emissive * life * (1 - alpha);
          RGB[o * 3] = r * k; RGB[o * 3 + 1] = g * k; RGB[o * 3 + 2] = b * k; A[o] = alpha;
        } else {
          RGB[o * 3] = r; RGB[o * 3 + 1] = g; RGB[o * 3 + 2] = b; A[o] = 1;
        }
        if (M.emissive > 0 && life > 0.02 && (M.glow[0] + M.glow[1] + M.glow[2]) > 0) {
          G[o * 3] = M.glow[0] * life; G[o * 3 + 1] = M.glow[1] * life; G[o * 3 + 2] = M.glow[2] * life;
          anyGlow = true;
        }
      }
    }
    const bx = ox + ri0 * s, by = oy + rj0 * s;
    if (fine && out.blitFine) { out.blitFine(bx, by, bw, bh, RGB, A, anyGlow ? G : null); return; }
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      const o = j * bw + i, al = A[o], wx = bx + i * s, wy = by + j * s;
      if (al >= 0.999) set.call(out, wx, wy, RGB[o * 3], RGB[o * 3 + 1], RGB[o * 3 + 2]);
      else if (al > 0 && blendPx) blendPx.call(out, wx, wy, RGB[o * 3], RGB[o * 3 + 1], RGB[o * 3 + 2], al);
      if (anyGlow && (G[o * 3] > 0 || G[o * 3 + 1] > 0 || G[o * 3 + 2] > 0)) add.call(out, wx, wy, G[o * 3], G[o * 3 + 1], G[o * 3 + 2]);
    }
  }
}

const POLY_CUTS = new Float64Array(64);
function sortSmall(a: Float64Array, n: number): void {
  for (let i = 1; i < n; i++) {
    const v = a[i]; let j = i - 1;
    while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; }
    a[j + 1] = v;
  }
}

/** One shared raster: creatures draw one at a time inside the overlay pass. */
export const sharedRaster = new CreatureRaster();

/**
 * Read the key light around a body from the real light field: the gradient
 * across the silhouette gives its direction (toward the brighter side, biased
 * from above like ambient sky), the centre sample its colour and level.
 */
export function sampleSceneLight(field: LightField, x: number, y: number, radius: number, flash: number, into: SceneLight, glow = 1): SceneLight {
  // Builder/test surfaces may provide no sampler: a neutral overhead light.
  if (typeof field?.sample !== 'function') {
    Object.assign(into, blankLight());
    into.flash = flash; into.glow = glow;
    return into;
  }
  const c = field.sample(x, y);
  const cr = c.r, cg = c.g, cb = c.b;
  const lum = (s: { r: number; g: number; b: number }): number => s.r * 0.3 + s.g * 0.5 + s.b * 0.2;
  const L = lum(field.sample(x - radius, y));
  const R = lum(field.sample(x + radius, y));
  const U = lum(field.sample(x, y - radius));
  const D = lum(field.sample(x, y + radius));
  let gx = (R - L), gy = (D - U);
  const g = Math.hypot(gx, gy);
  const mid = Math.max(0.25, cr * 0.3 + cg * 0.5 + cb * 0.2);
  // Strong local gradient = a nearby lamp; flat field = soft overhead light.
  const strength = Math.min(1, g / (mid * 0.35));
  if (g > 1e-4) { gx /= g; gy /= g; } else { gx = 0; gy = -1; }
  let lx = gx * (0.35 + 0.55 * strength) - 0.25 * (1 - strength);
  let ly = gy * (0.35 + 0.55 * strength) - 0.62 * (1 - strength);
  let lz = 0.62;
  const l = Math.hypot(lx, ly, lz);
  lx /= l; ly /= l; lz /= l;
  into.lx = lx; into.ly = ly; into.lz = lz;
  // Keep bodies readable in the dark, never blown out in a lamp — except in
  // DESIGNED darkness (config/darkness), where the floor falls with the place
  // and a body is only what real light shows of it.
  const open = c.open ?? 1;
  into.r = Math.max(0.42 * open, Math.min(1.35, cr));
  into.g = Math.max(0.42 * open, Math.min(1.35, cg));
  into.b = Math.max(0.46 * open, Math.min(1.35, cb));
  into.flash = flash;
  into.glow = glow;
  return into;
}

export function blankLight(): SceneLight {
  return { lx: -0.38, ly: -0.62, lz: 0.68, r: 1, g: 1, b: 1, flash: 0, glow: 1 };
}

export type { RGB };

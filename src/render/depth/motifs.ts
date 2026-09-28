import type { MaskPlane } from '@/render/depth/raster';

/**
 * Silhouette motifs for the depth planes, drawn into a MaskPlane in the
 * game's pixel grain (one texel per world cell on the background planes).
 * Every motif writes a material id plus tone offsets; shading, rim light and
 * atmospheric perspective happen later in raster.shade/applyHaze.
 *
 * Coordinates wrap (planes tile), so a column drawn at x = width - 3 simply
 * continues on the left edge.
 */

export type Rand = () => number;

const between = (r: Rand, a: number, b: number): number => a + (b - a) * r();

/** A full-height vertical pipe with flanges and rivets (tiles vertically). */
export function pipeColumn(p: MaskPlane, x: number, w: number, m: number, r: Rand, detail = m): void {
  p.vBar(x, 0, p.height, w, m, 46);
  const every = Math.round(between(r, 60, 120));
  const phase = Math.floor(r() * every);
  for (let y = phase; y < p.height; y += every) {
    // Flanges only where they tile cleanly (the last one may wrap: fine).
    p.hBar(x - 2, y, w + 4, 3, detail, 30);
    for (let k = 0; k < w + 4; k += 3) p.set(x - 2 + k, y + 1, detail, 60);
  }
}

/** A refinery pressure column: a wide stack with boiler bulges, a ladder and dim windows. */
export function pressureStack(p: MaskPlane, x: number, w: number, m: number, glow: number, r: Rand): void {
  p.vBar(x, 0, p.height, w, m, 34);
  const bulgeEvery = Math.round(between(r, 150, 260));
  const phase = Math.floor(r() * bulgeEvery);
  for (let y = phase; y < p.height + bulgeEvery; y += bulgeEvery) {
    const bw = w * between(r, 1.25, 1.6), bh = Math.round(between(r, 26, 48));
    for (let yy = 0; yy < bh; yy++) {
      const t = (yy / (bh - 1)) * 2 - 1;
      const half = (bw / 2) * Math.sqrt(Math.max(0, 1 - t * t * 0.85));
      for (let xx = -Math.floor(half); xx <= Math.floor(half); xx++) {
        const u = xx / Math.max(1, half);
        p.set(x + w / 2 + xx, y + yy, m, (0.3 - u) * 40);
      }
    }
    p.hBar(x - 3, y + Math.floor(bh / 2) - 1, w + 6, 3, m, 20);
    if (r() < 0.6) p.set(x + Math.floor(w / 2), y + Math.floor(bh / 2) + 5, glow);
  }
  // Ladder on one side.
  const lx = x + (r() < 0.5 ? -4 : w + 2);
  p.vBar(lx, 0, p.height, 1, m, 0);
  p.vBar(lx + 2, 0, p.height, 1, m, 0);
  for (let y = 0; y < p.height; y += 4) p.set(lx + 1, y, m, 10);
  // Bands every so often.
  for (let y = Math.floor(r() * 40); y < p.height; y += Math.round(between(r, 36, 70))) p.hBar(x, y, w, 2, m, -10);
}

/** A horizontal pipe run with flanges. */
export function hPipe(p: MaskPlane, x0: number, x1: number, y: number, thick: number, m: number): void {
  p.hBar(x0, y, x1 - x0, thick, m, 46);
  for (let x = x0 + 20; x < x1 - 4; x += 44) p.vBar(x, y - 2, thick + 4, 3, m, 24);
}

/** A hanging chain of alternating face/edge links from (x, y0) downward. */
export function chain(p: MaskPlane, x: number, y0: number, len: number, m: number, size = 1): void {
  if (size > 1) {
    // A heavy chain: oval face links (a ring with a hole) alternating with edge-on bars.
    const lh = 5 * size, lw = 2 * size;
    for (let k = 0; k < len; k += lh) {
      if (((k / lh) & 1) === 0) {
        for (let yy = 0; yy < lh + 1; yy++) {
          const t = (yy / lh) * 2 - 1;
          const half = lw * Math.sqrt(Math.max(0, 1 - t * t * 0.7));
          for (let xx = -Math.round(half); xx <= Math.round(half); xx++) {
            const hole = Math.abs(xx) < half - size && yy > size - 1 && yy < lh - size + 1;
            if (!hole) p.set(x + xx, y0 + k + yy, m, -xx * 8);
          }
        }
      } else {
        for (let yy = -size; yy < lh + size; yy++) for (let xx = 0; xx < size; xx++) p.set(x + xx - (size >> 1), y0 + k + yy, m, 14);
      }
    }
    return;
  }
  for (let k = 0; k < len; k += 6) {
    const face = ((k / 6) & 1) === 0;
    if (face) {
      for (let yy = 0; yy < 6; yy++) {
        p.set(x - 1, y0 + k + yy, m, 20);
        p.set(x + 1, y0 + k + yy, m, -10);
      }
      p.set(x, y0 + k, m, 30);
      p.set(x, y0 + k + 5, m, 0);
    } else {
      for (let yy = -1; yy < 7; yy++) p.set(x, y0 + k + yy, m, 10);
    }
  }
}

/** A big gear: toothed rim, spokes and a hub. */
export function gear(p: MaskPlane, cx: number, cy: number, radius: number, teeth: number, spokes: number, m: number): void {
  const rim = Math.max(2, Math.round(radius * 0.16));
  p.ring(cx, cy, radius - rim, radius, m, 10);
  // A thin inner lip reads as a machined face.
  if (radius > 14) p.ring(cx, cy, radius - rim - 2, radius - rim - 1, m, -30);
  if (teeth > 0) {
    const pitch = (Math.PI * 2) / teeth;
    const toothH = Math.max(2, radius * 0.17);
    for (let k = 0; k < teeth; k++) {
      const a = k * pitch;
      const ca = Math.cos(a), sa = Math.sin(a);
      const hw0 = radius * pitch * 0.3, hw1 = radius * pitch * 0.2;
      const r0 = radius - 1, r1 = radius + toothH;
      p.poly([
        [cx + ca * r0 - sa * hw0, cy + sa * r0 + ca * hw0],
        [cx + ca * r0 + sa * hw0, cy + sa * r0 - ca * hw0],
        [cx + ca * r1 + sa * hw1, cy + sa * r1 - ca * hw1],
        [cx + ca * r1 - sa * hw1, cy + sa * r1 + ca * hw1],
      ], m, 18);
    }
  }
  const sw = Math.max(1, Math.round(radius * 0.1));
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2 + 0.3;
    p.line(cx, cy, cx + Math.cos(a) * (radius - rim), cy + Math.sin(a) * (radius - rim), sw, m, -6);
  }
  p.disc(cx, cy, Math.max(2, radius * 0.22), m, 16);
  if (radius > 10) p.ring(cx, cy, Math.max(1, radius * 0.08), Math.max(1.5, radius * 0.08) + 1, m, -50);
}

/** A masonry arch: a semicircular ring on two piers (pier bottoms at baseY + pierH). */
export function arch(p: MaskPlane, cx: number, springY: number, span: number, thick: number, pierH: number, m: number): void {
  const r0 = span / 2, r1 = r0 + thick;
  for (let y = -Math.ceil(r1); y <= 0; y++) for (let x = -Math.ceil(r1); x <= Math.ceil(r1); x++) {
    const d = Math.sqrt(x * x + y * y);
    if (d >= r0 && d <= r1) {
      // Voussoir joints: radial seams every ~10 degrees.
      const ang = Math.atan2(-y, x);
      const seam = Math.abs(((ang / (Math.PI / 14)) % 1) - 0.5) > 0.44;
      p.set(cx + x, springY + y, m, seam ? -40 : (d - r0) / thick * 14);
    }
  }
  // Keystone.
  p.rect(cx - 2, springY - Math.ceil(r1) - 1, 5, thick + 2, m, 20);
  // Piers.
  for (const px of [cx - r1, cx + r0]) {
    for (let y = 0; y < pierH; y++) for (let x = 0; x < thick; x++) {
      const joint = y % 9 === 0 || (x === Math.floor(thick / 2) && Math.floor(y / 9) % 2 === 0);
      p.set(px + x, springY + y, m, joint ? -34 : 6);
    }
  }
}

/** A row of arches spanning the full plane width (tileable if width % period === 0). */
export function arcade(p: MaskPlane, springY: number, period: number, span: number, thick: number, pierH: number, m: number, phase = 0): void {
  for (let x = phase; x < p.width + phase; x += period) arch(p, x + period / 2, springY, span, thick, pierH, m);
  // Entablature above the arches.
  p.hBar(0, springY - Math.ceil(span / 2 + thick) - 4, p.width, 4, m, 12);
}

/** A riveted girder catwalk: chords, truss and a railing above. */
export function girder(p: MaskPlane, x0: number, x1: number, y: number, depth: number, m: number): void {
  p.hBar(x0, y, x1 - x0, 2, m, 20);
  p.hBar(x0, y + depth, x1 - x0, 2, m, 0);
  let up = true;
  for (let x = x0; x < x1 - 8; x += 10) {
    p.vBar(x, y, depth + 2, 1, m, 0);
    p.line(x, up ? y + 1 : y + depth, x + 10, up ? y + depth : y + 1, 1, m, -8);
    up = !up;
  }
  // Railing.
  p.hBar(x0, y - 8, x1 - x0, 1, m, 24);
  for (let x = x0; x < x1; x += 6) p.vBar(x, y - 8, 8, 1, m, 0);
}

/** A hanging stalactite cluster from a ceiling line at y. */
export function stalactites(p: MaskPlane, r: Rand, x0: number, x1: number, y: number, maxLen: number, m: number): void {
  for (let x = x0; x < x1;) {
    const w = Math.round(between(r, 3, 11));
    const len = Math.round(between(r, maxLen * 0.25, maxLen));
    for (let yy = 0; yy < len; yy++) {
      const half = (w / 2) * (1 - yy / len);
      for (let xx = -Math.floor(half); xx <= Math.floor(half); xx++) p.set(x + xx, y + yy, m, -xx * 6);
    }
    x += w + Math.round(between(r, 0, 9));
  }
  p.hBar(x0, y - 3, x1 - x0, 4, m, 8);
}

/** A hanging root: a wandering, tapering, sometimes-branching strand. */
export function root(p: MaskPlane, r: Rand, x: number, y: number, len: number, thick: number, m: number, depth = 0): void {
  let cx = x, dx = between(r, -0.35, 0.35);
  for (let k = 0; k < len; k++) {
    dx += between(r, -0.12, 0.12);
    dx = Math.max(-0.6, Math.min(0.6, dx));
    cx += dx;
    const t = thick * (1 - k / len);
    const half = Math.max(0, t - 1) / 2;
    for (let xx = -Math.floor(half); xx <= Math.ceil(half); xx++) p.set(Math.round(cx + xx), y + k, m, (xx === 0 ? 8 : -8));
    if (depth < 2 && k > 6 && r() < 0.035) root(p, r, Math.round(cx), y + k, Math.round((len - k) * between(r, 0.4, 0.8)), Math.max(1, t * 0.7), m, depth + 1);
  }
}

/** A towering mushroom: curved stem with an annulus, a domed cap, gills and glowing spots. */
export function mushroom(p: MaskPlane, r: Rand, x: number, baseY: number, h: number, capW: number,
  stemM: number, capM: number, glowM: number): void {
  const stemW = Math.max(3, Math.round(capW * between(r, 0.1, 0.16)));
  const bend = between(r, -0.18, 0.18);
  const topX = x + bend * h;
  for (let k = 0; k < h; k++) {
    const t = k / h;
    const cx = x + (topX - x) * t * t;
    const w = stemW * (1.25 - t * 0.35) + (t > 0.93 ? 0 : 0);
    for (let xx = 0; xx < w; xx++) {
      const u = (xx / Math.max(1, w - 1)) * 2 - 1;
      // Fibrous stem: vertical streaks.
      const streak = (Math.floor(cx + xx) * 7) % 5 === 0 ? -18 : 0;
      p.set(Math.round(cx - w / 2 + xx), baseY - k, stemM, (0.3 - u) * 36 + streak);
    }
  }
  // Annulus (skirt ring) about two-thirds up.
  const ringY = baseY - Math.round(h * between(r, 0.62, 0.74));
  const ringX = x + (topX - x) * 0.5;
  for (let yy = 0; yy < 5; yy++) {
    const half = stemW * (0.9 + yy * 0.18);
    for (let xx = -Math.floor(half); xx <= Math.floor(half); xx++) p.set(Math.round(ringX + xx), ringY + yy, stemM, 10 - yy * 4);
  }
  // Cap: a flattened dome with a curled rim.
  const capH = Math.round(capW * between(r, 0.28, 0.42));
  const capY = baseY - h;
  for (let yy = 0; yy < capH; yy++) {
    const t = 1 - yy / capH;
    const half = (capW / 2) * Math.sqrt(Math.max(0, 1 - t * t * t));
    for (let xx = -Math.floor(half); xx <= Math.floor(half); xx++) {
      const u = xx / Math.max(1, half);
      p.set(Math.round(topX + xx), capY - capH + yy, capM, (0.2 - u) * 30 - t * 20);
    }
  }
  // Gills: dark streaks under the cap.
  for (let xx = -Math.floor(capW / 2) + 2; xx < capW / 2 - 2; xx += 2) {
    const len = Math.round(3 + (1 - Math.abs(xx) / (capW / 2)) * 4);
    for (let yy = 0; yy < len; yy++) p.set(Math.round(topX + xx), capY + yy, capM, -60);
  }
  // Glowing spots on the cap.
  const spots = Math.round(capW / 18);
  for (let k = 0; k < spots; k++) {
    const sx = Math.round(topX + between(r, -0.38, 0.38) * capW);
    const sy = Math.round(capY - capH * between(r, 0.25, 0.8));
    if (p.get(sx, sy) === capM) { p.set(sx, sy, glowM); if (r() < 0.5) p.set(sx + 1, sy, glowM); }
  }
}

/** A kelp strand rising from baseY: a swaying stem with alternating blades. */
export function kelp(p: MaskPlane, r: Rand, x: number, baseY: number, h: number, m: number): void {
  const phase = r() * Math.PI * 2, amp = between(r, 2, 6), freq = between(r, 0.03, 0.06);
  let prev = x;
  for (let k = 0; k < h; k++) {
    const cx = Math.round(x + Math.sin(phase + k * freq) * amp * (k / h + 0.2));
    p.set(cx, baseY - k, m, 10);
    if (Math.abs(cx - prev) > 0) p.set(prev, baseY - k, m, 0);
    prev = cx;
    if (k % 7 === 3 && k < h - 4) {
      const side = (Math.floor(k / 7) & 1) === 0 ? 1 : -1;
      const len = Math.round(between(r, 4, 9));
      for (let s = 1; s <= len; s++) p.set(cx + side * s, baseY - k - Math.round(s * 0.6), m, -6);
    }
  }
}

/** A basalt column: a flat-topped prism with a facet split and joint cracks. */
export function basalt(p: MaskPlane, r: Rand, x: number, w: number, topY: number, bottomY: number, m: number): void {
  const facet = Math.round(w * between(r, 0.35, 0.6));
  for (let y = topY; y < bottomY; y++) {
    for (let xx = 0; xx < w; xx++) p.set(x + xx, y, m, xx < facet ? 18 : -18);
  }
  // Slanted top.
  const slope = between(r, -0.4, 0.4);
  for (let xx = 0; xx < w; xx++) {
    const cut = Math.round((xx - w / 2) * slope) + 2;
    for (let y = topY; y < topY + cut; y++) p.clear(x + xx, y);
  }
  // Cross joints.
  for (let y = topY + Math.round(between(r, 20, 60)); y < bottomY; y += Math.round(between(r, 30, 80))) {
    for (let xx = 0; xx < w; xx++) p.set(x + xx, y + Math.round((xx - w / 2) * 0.2), m, -70);
  }
}

/** A tapered brick chimney with a lip and a glowing mouth. */
export function chimney(p: MaskPlane, r: Rand, x: number, baseY: number, w: number, h: number, m: number, glowM: number): void {
  for (let k = 0; k < h; k++) {
    const t = k / h;
    const ww = Math.round(w * (1 - t * 0.3));
    const x0 = Math.round(x - ww / 2);
    const course = Math.floor(k / 4);
    for (let xx = 0; xx < ww; xx++) {
      const joint = k % 4 === 0 || (xx + (course & 1) * 4) % 8 === 0;
      const u = (xx / Math.max(1, ww - 1)) * 2 - 1;
      p.set(x0 + xx, baseY - k, m, (0.3 - u) * 30 + (joint ? -30 : 0));
    }
  }
  const topW = Math.round(w * 0.7) + 6;
  p.hBar(Math.round(x - topW / 2), baseY - h - 3, topW, 4, m, 20);
  // Glowing throat.
  for (let xx = -Math.floor(w * 0.22); xx <= Math.floor(w * 0.22); xx++) {
    p.set(Math.round(x + xx), baseY - h - 4, glowM);
    if (r() < 0.5) p.set(Math.round(x + xx), baseY - h - 5, glowM);
  }
}

/** A drowned hooded statue on a pedestal; broken statues lose the head and a shoulder. */
export function statue(p: MaskPlane, r: Rand, x: number, baseY: number, h: number, m: number, broken: boolean): void {
  const pedH = Math.round(h * 0.16), pedW = Math.round(h * 0.42);
  p.rect(Math.round(x - pedW / 2), baseY - pedH, pedW, pedH, m, -12);
  p.hBar(Math.round(x - pedW / 2) - 2, baseY - pedH, pedW + 4, 2, m, 18);
  const bodyH = h - pedH;
  const y0 = baseY - pedH;
  // Robe: a trapezoid widening to the hem, with fold lines.
  for (let k = 0; k < bodyH * 0.72; k++) {
    const t = k / (bodyH * 0.72);
    const half = h * (0.17 - t * 0.07);
    for (let xx = -Math.floor(half); xx <= Math.floor(half); xx++) {
      const fold = (xx + 40) % 5 === 0 ? -22 : 0;
      p.set(Math.round(x + xx), y0 - k, m, -xx * 3 + fold);
    }
  }
  const shoulderY = Math.round(y0 - bodyH * 0.72);
  if (!broken || r() < 0.5) {
    // Hood and head.
    p.disc(x, shoulderY - Math.round(h * 0.07), Math.max(2, h * 0.075), m, 12);
    p.poly([[x - h * 0.1, shoulderY + 2], [x, shoulderY - h * 0.19], [x + h * 0.1, shoulderY + 2]], m, 6);
  }
  // Clasped hands / a bowl held forward.
  p.rect(Math.round(x - h * 0.05), Math.round(shoulderY + bodyH * 0.2), Math.round(h * 0.1), 3, m, 22);
  if (broken) {
    // A clean diagonal break through one shoulder.
    for (let k = 0; k < h * 0.25; k++) for (let xx = 0; xx < h * 0.2; xx++) {
      if (xx > k * 0.9) p.clear(Math.round(x + h * 0.02 + xx), shoulderY - Math.round(h * 0.12) + k);
    }
  }
}

/** The Bellows' lungs: an accordion bellows with boards and a nozzle. */
export function bellows(p: MaskPlane, cx: number, cy: number, w: number, h: number, m: number): void {
  const pleats = Math.max(3, Math.round(h / 9));
  const ph = h / pleats;
  for (let k = 0; k < pleats; k++) {
    for (let yy = 0; yy < ph; yy++) {
      const t = yy / ph;
      const inset = (t < 0.5 ? t : 1 - t) * 2 * (w * 0.08);
      const x0 = cx - w / 2 + inset, x1 = cx + w / 2 - inset;
      for (let x = Math.round(x0); x < Math.round(x1); x++) p.set(x, Math.round(cy - h / 2 + k * ph + yy), m, t < 0.5 ? 16 : -22);
    }
  }
  p.hBar(Math.round(cx - w / 2 - 4), Math.round(cy - h / 2 - 4), Math.round(w + 8), 4, m, 20);
  p.hBar(Math.round(cx - w / 2 - 4), Math.round(cy + h / 2), Math.round(w + 8), 4, m, 0);
  // Nozzle.
  p.poly([[cx - 5, cy + h / 2 + 4], [cx + 5, cy + h / 2 + 4], [cx + 2, cy + h / 2 + 18], [cx - 2, cy + h / 2 + 18]], m, 10);
}

/** Soft light shaft (a god ray): a slanted band that fades along its length (dir -1 rises: heat plumes). */
export function shaft(p: MaskPlane, m: number, x: number, y: number, len: number, width: number, slant: number,
  strength: number, seed: number, dir: 1 | -1 = 1): void {
  for (let k = 0; k < len; k++) {
    const t = k / len;
    const along = Math.sin(Math.min(1, t * 4) * Math.PI / 2) * (1 - t) ** 1.3;
    const cx = x + slant * k;
    const half = width * (0.5 + t * 0.6);
    for (let xx = -Math.ceil(half); xx <= Math.ceil(half); xx++) {
      const u = Math.abs(xx) / half;
      const edge = u >= 1 ? 0 : (1 - u * u);
      // Streaks inside the shaft (dust columns), stable along the band.
      const streak = 0.7 + 0.3 * Math.sin((xx + seed) * 1.7) * Math.sin((xx - seed) * 0.6);
      const c = strength * along * edge * streak;
      if (c > 0.01) p.soft(Math.round(cx + xx), y + k * dir, m, c);
    }
  }
}

// The Foundry UI kit's image operations (docs/arena/platform-fighter/UI-KIT.md): key a generated sheet's magenta, cut
// a piece at the kit's art-pixel size, regularise a frame or plate into a clean 9-slice, make a seamless tile.
// Images are { data: Buffer (RGBA), w, h }. A piece is drawn 1 art pixel = 1 image pixel; the UI shows it at an integer
// CSS scale with image-rendering: pixelated.
import sharp from 'sharp';

/** Load a sheet and its magenta key (0 = not magenta, 1 = the pure key colour; an anti-aliased fringe sits between). */
export async function loadSheet(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, key = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const m = (Math.min(r, b) - g) / 255, balance = 1 - Math.abs(r - b) / 255;
    key[i] = Math.max(0, Math.min(1, (m - 0.25) / 0.45)) * Math.max(0, Math.min(1, (balance - 0.55) / 0.3));
  }
  return { data, W, H, key };
}

/** The tight bounds of the non-magenta pixels inside a rectangle [x0, y0, x1, y1] (inclusive). */
export function tightRect(sheet, [x0, y0, x1, y1]) {
  let bx0 = Infinity, by0 = Infinity, bx1 = -1, by1 = -1;
  for (let y = Math.max(0, y0); y <= Math.min(sheet.H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(sheet.W - 1, x1); x++) {
    if (sheet.key[x + y * sheet.W] >= 0.5) continue;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  if (bx1 < 0) throw new Error(`nothing visible in ${[x0, y0, x1, y1]}`);
  return [bx0, by0, bx1, by1];
}

const colourDist = (s, c) => (s[0] - c[0]) ** 2 * 3 + (s[1] - c[1]) ** 2 * 4 + (s[2] - c[2]) ** 2 * 2;

/** Snap an RGBA float image's solid pixels to its own k-means palette; coverage >= 0.5 becomes opaque, the rest clear. */
function snapPalette(rgba, w, h, K) {
  const solid = [];
  for (let i = 0; i < w * h; i++) if (rgba[i * 4 + 3] >= 0.5) solid.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
  const out = Buffer.alloc(w * h * 4);
  if (!solid.length) return out;
  const lum = c => c[0] * 3 + c[1] * 6 + c[2];
  const sorted = [...solid].sort((p, q) => lum(p) - lum(q)), k = Math.min(K, sorted.length);
  let centers = Array.from({ length: k }, (_, j) => sorted[Math.floor((j + 0.5) / k * sorted.length)].slice());
  for (let it = 0; it < 10; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (const s of solid) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < centers.length; j++) { const d = colourDist(s, centers[j]); if (d < bd) { bd = d; best = j; } }
      const a = acc[best]; a[0] += s[0]; a[1] += s[1]; a[2] += s[2]; a[3]++;
    }
    centers = centers.map((c, j) => acc[j][3] ? [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]] : c);
  }
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] < 0.5) continue;
    const s = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
    let best = centers[0], bd = Infinity;
    for (const c of centers) { const d = colourDist(s, c); if (d < bd) { bd = d; best = c; } }
    out[i * 4] = Math.round(best[0]); out[i * 4 + 1] = Math.round(best[1]); out[i * 4 + 2] = Math.round(best[2]); out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Cut a piece: the sheet's pixels inside `rect`, area-downsampled to `size` [w, h] (or by `factor` source pixels per
 * art pixel), magenta fringes decontaminated and weighted out, colours snapped to the piece's own palette. Transparent
 * wherever the sheet was magenta, holes included.
 */
export function cutPiece(sheet, rect, { factor = 4, size = null, colors = 40, opaque = false } = {}) {
  const { data, W, H, key } = sheet;
  const [rx0, ry0, rx1, ry1] = rect, rw = rx1 - rx0 + 1, rh = ry1 - ry0 + 1;
  const [ow, oh] = size ?? [Math.max(1, Math.round(rw / factor)), Math.max(1, Math.round(rh / factor))];
  const fx = rw / ow, fy = rh / oh;
  const decontam = i => {
    const a = opaque ? 1 : 1 - key[i]; let r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (a < 0.98 && a > 0.05) { r = (r - (1 - a) * 255) / a; g = g / a; b = (b - (1 - a) * 255) / a; }
    return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b)), a];
  };
  const rgba = new Float32Array(ow * oh * 4);
  for (let oy = 0; oy < oh; oy++) {
    const y0 = ry0 + oy * fy, y1 = y0 + fy;
    for (let ox = 0; ox < ow; ox++) {
      const x0 = rx0 + ox * fx, x1 = x0 + fx;
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy); if (wy <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx); if (wx <= 0) continue;
          const wgt = wx * wy; n += wgt;
          if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
          const [cr, cg, cb, ca] = decontam(sx + sy * W);
          r += cr * ca * wgt; g += cg * ca * wgt; b += cb * ca * wgt; a += ca * wgt;
        }
      }
      const o = (ox + oy * ow) * 4;
      if (a > 0) { rgba[o] = r / a; rgba[o + 1] = g / a; rgba[o + 2] = b / a; }
      rgba[o + 3] = n ? a / n : 0;
    }
  }
  return { data: snapPalette(rgba, ow, oh, colors), w: ow, h: oh };
}

const pixel = (img, x, y) => { const i = (x + y * img.w) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]; };
const pixDiff = (p, q) => (p[3] < 128) !== (q[3] < 128) ? 400 : p[3] < 128 ? 0 : Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
const colDiff = (img, x1, x2, y0, y1) => { let s = 0; for (let y = y0; y < y1; y++) s += pixDiff(pixel(img, x1, y), pixel(img, x2, y)); return s / Math.max(1, y1 - y0); };
const rowDiff = (img, y1, y2, x0, x1) => { let s = 0; for (let x = x0; x < x1; x++) s += pixDiff(pixel(img, x, y1), pixel(img, x, y2)); return s / Math.max(1, x1 - x0); };

/**
 * The repeating stretch of an edge: among periods in [pMin, pMax] and starts between the corners `lo` and `hi`, the
 * stretch [a, a + p) whose own wrap (a+p -> a), joint after the first corner (lo -> a) and joint before the second
 * (a+p-1 -> hi-1) look most like neighbours. `bands` are the strips that share the period (each gets its own start);
 * `same(band, i, j)` says how different line i and line j of that band are.
 */
function bestStretch(lo, hi, bands, same, [pMin, pMax]) {
  let best = null;
  for (let p = pMin; p <= Math.min(pMax, hi - lo - 2); p++) {
    let total = 0; const starts = [];
    for (const band of bands) {
      // How periodic the whole edge is at this lag: the rivet rhythm decides the period, not one lucky seam.
      let lag = 0, nl = 0;
      for (let x = lo; x + p < hi; x++) { lag += same(band, x, x + p); nl++; }
      total += 2 * lag / nl;
      let bb = null;
      for (let a = lo; a + p <= hi; a++) {
        // The stretch must repeat what really comes next in the source (each column against the one a period on, or
        // back): judging only the seam lets a stretch near a corner swallow two unevenly spaced rivets.
        let wrap = 0;
        for (let x = a; x < a + p; x++) wrap += x + p < hi ? same(band, x, x + p) : x - p >= lo ? same(band, x, x - p) : same(band, a + p - 1, a);
        wrap /= p;
        // ...and the seam itself must look like the source: what follows the stretch's last line, and what precedes its first.
        const seam = ((a + p < hi ? same(band, a + p, a) : 0) + (a > lo ? same(band, a - 1, a + p - 1) : 0)) / ((a + p < hi) + (a > lo) || 1);
        const c = 2 * wrap + 2 * seam + same(band, lo, a) + same(band, a + p - 1, hi - 1);
        if (!bb || c < bb.c) bb = { a, c };
      }
      total += bb.c; starts.push(bb.a);
    }
    // Prefer longer periods a little: a 3-column stretch of plain iron "fits" but erases the rivet rhythm.
    total *= 1 + 2 / p;
    if (!best || total < best.c) best = { p, c: total, starts };
  }
  if (!best) throw new Error('edge too short for the period range');
  return best;
}

/**
 * Regularise a cut frame or plate into a clean 9-slice: corners exactly as drawn, each edge one repeating stretch of
 * itself (so CSS border-image round/repeat tiles it without a seam), the middle slice exactly one period.
 *   slice [t, r, b, l]; periodX / periodY [min, max] search ranges; fill: the centre is part of the piece (a plate,
 *   a button) and repeats with the edges, else it stays transparent (a hollow frame, a fill tile goes behind it);
 *   keepY: no vertical repetition (the piece keeps its drawn height; for buttons and bands).
 */
export function regularise(img, [t, r, b, l], { periodX = [6, 48], periodY = [6, 48], fill = false, keepY = false } = {}) {
  const { w, h } = img;
  const hBands = fill ? [[0, h]] : [[0, t], [h - b, h]];
  const H = bestStretch(l, w - r, hBands, ([y0, y1], i, j) => colDiff(img, i, j, y0, y1), periodX);
  let V = null;
  if (!keepY) {
    const vBands = fill ? [[0, w]] : [[0, l], [w - r, w]];
    V = bestStretch(t, h - b, vBands, ([x0, x1], i, j) => rowDiff(img, i, j, x0, x1), periodY);
  }
  const NW = l + H.p + r, NH = keepY ? h : t + V.p + b;
  const out = Buffer.alloc(NW * NH * 4);
  const put = (x, y, p) => { const o = (x + y * NW) * 4; out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2]; out[o + 3] = p[3]; };
  // Source column for output column x, source row for output row y.
  const srcX = (x, band) => x < l ? x : x >= l + H.p ? w - (NW - x) : H.starts[band] + (x - l);
  const srcY = (y, band) => keepY ? y : y < t ? y : y >= t + V.p ? h - (NH - y) : V.starts[band] + (y - t);
  for (let y = 0; y < NH; y++) for (let x = 0; x < NW; x++) {
    const inMidX = x >= l && x < l + H.p, inMidY = !keepY && y >= t && y < t + V.p;
    if (!fill && inMidX && (keepY ? (y >= t && y < h - b) : inMidY)) continue; // hollow centre
    const hb = fill ? 0 : (y < t ? 0 : 1), vb = fill ? 0 : (x < l ? 0 : 1);
    const sx = inMidX ? srcX(x, hb) : srcX(x, 0);
    const sy = inMidY ? srcY(y, vb) : srcY(y, 0);
    put(x, y, pixel(img, sx, sy));
  }
  const result = { data: out, w: NW, h: NH, slice: [t, r, b, l], periodX: H.p, periodY: keepY ? null : V.p };
  // Visible border thickness at mid-edge, outside in, to the first transparent pixel (where a fill tile must reach).
  // (Skips any transparent margin outside the band first: a bracket can stand proud of the bar.)
  const depth = step => {
    const opaqueAt = d => { const [x, y] = step(d); return x >= 0 && y >= 0 && x < NW && y < NH && out[(x + y * NW) * 4 + 3] >= 128; };
    let d = 0; while (d < 400 && !opaqueAt(d)) d++;
    while (d < 400 && opaqueAt(d)) d++;
    return d;
  };
  const cx = l + (H.p >> 1), cy = keepY ? h >> 1 : t + (V.p >> 1);
  result.band = fill ? null : [depth(d => [cx, d]), depth(d => [NW - 1 - d, cy]), depth(d => [cx, NH - 1 - d]), depth(d => [d, cy])];
  return result;
}

/** Stretch a regularised 9-slice to an arbitrary size the way CSS border-image round would (for previews and checks). */
export function nineSlice(img, [t, r, b, l], W, Hh, { fill = true } = {}) {
  const out = Buffer.alloc(W * Hh * 4);
  const mw = img.w - l - r, mh = img.h - t - b, tw = W - l - r, th = Hh - t - b;
  const nx = Math.max(1, Math.round(tw / mw)), ny = Math.max(1, Math.round(th / mh));
  const mapX = x => x < l ? x : x >= W - r ? img.w - (W - x) : l + Math.min(mw - 1, Math.floor(((x - l) * nx / tw) * mw) % mw);
  const mapY = y => y < t ? y : y >= Hh - b ? img.h - (Hh - y) : t + Math.min(mh - 1, Math.floor(((y - t) * ny / th) * mh) % mh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    if (!fill && x >= l && x < W - r && y >= t && y < Hh - b) continue;
    const i = (mapX(x) + mapY(y) * img.w) * 4, o = (x + y * W) * 4;
    out[o] = img.data[i]; out[o + 1] = img.data[i + 1]; out[o + 2] = img.data[i + 2]; out[o + 3] = img.data[i + 3];
  }
  return { data: out, w: W, h: Hh };
}

/**
 * A seamless tile from an opaque texture crop: the crop (size + blend) is cross-faded across its wrap so the tile's
 * right edge runs into its left (and bottom into top when `y`), then palette-snapped. `y: false` keeps the vertical
 * gradient intact (a text texture: it repeats across, never down).
 */
export function seamlessTile(img, size, blend, { x = true, y = true, colors = 48 } = {}) {
  const [tw, th] = size, src = img;
  const f = new Float32Array(tw * th * 4);
  const at = (sx, sy) => { const i = (sx + sy * src.w) * 4; return [src.data[i], src.data[i + 1], src.data[i + 2]]; };
  for (let yy = 0; yy < th; yy++) for (let xx = 0; xx < tw; xx++) {
    // Horizontal: columns [0, blend) fade from the crop's continuation (xx + tw) into the column itself.
    const wx = x && xx < blend ? xx / blend : 1, wy = y && yy < blend ? yy / blend : 1;
    const bx = x && xx < blend, by = y && yy < blend;
    const c00 = at(xx, yy), c10 = bx ? at(xx + tw, yy) : c00, c01 = by ? at(xx, yy + th) : c00, c11 = bx && by ? at(xx + tw, yy + th) : bx ? c10 : c01;
    const o = (xx + yy * tw) * 4;
    for (let k = 0; k < 3; k++) {
      const top = c10[k] * (1 - wx) + c00[k] * wx, bot = c11[k] * (1 - wx) + c01[k] * wx;
      f[o + k] = bot * (1 - wy) + top * wy;
    }
    f[o + 3] = 1;
  }
  return { data: snapPalette(f, tw, th, colors), w: tw, h: th };
}

/** Grow a one-pixel dark rim around a piece's silhouette (the crisp outline an area downsample softens). */
export function outerRim(img) {
  const { w, h, data } = img, out = Buffer.from(data);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (x + y * w) * 4; if (data[i + 3] >= 128) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const j = (X + Y * w) * 4; if (data[j + 3] < 128) continue;
      out[i] = Math.round(data[j] * 0.22 + 8); out[i + 1] = Math.round(data[j + 1] * 0.2 + 8); out[i + 2] = Math.round(data[j + 2] * 0.22 + 12); out[i + 3] = 255;
      break;
    }
  }
  return { ...img, data: out };
}

/** Crop columns/rows out of an image. */
export function crop(img, x, y, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let yy = 0; yy < h; yy++) img.data.copy(out, yy * w * 4, ((x) + (y + yy) * img.w) * 4, ((x + w) + (y + yy) * img.w) * 4);
  return { data: out, w, h };
}

/** Pad an image with transparent pixels to a size, centred (or at an offset). */
export function pad(img, w, h, ox = Math.floor((w - img.w) / 2), oy = Math.floor((h - img.h) / 2)) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < img.h; y++) img.data.copy(out, ((ox) + (oy + y) * w) * 4, y * img.w * 4, (y + 1) * img.w * 4);
  return { data: out, w, h };
}

export const savePng = (img, path) => sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path);
export const pngBuffer = img => sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } }).png().toBuffer();

/**
 * One repeat of a strip that repeats along one axis (a chain: repeat-y): the stretch [a, a+p) of rows (axis 'y') or
 * columns (axis 'x') that best joins its own end, within the period range, searched over the whole image.
 */
export function periodicStrip(img, axis, [pMin, pMax]) {
  const len = axis === 'y' ? img.h : img.w;
  const same = axis === 'y' ? (i, j) => rowDiff(img, i, j, 0, img.w) : (i, j) => colDiff(img, i, j, 0, img.h);
  let best = null;
  for (let p = pMin; p <= Math.min(pMax, len - 1); p++) for (let a = 0; a + p < len; a++) {
    const c = same(a + p, a) * (1 + 2 / p);
    if (!best || c < best.c) best = { a, p, c };
  }
  return axis === 'y' ? { ...crop(img, 0, best.a, img.w, best.p), period: best.p } : { ...crop(img, best.a, 0, best.p, img.h), period: best.p };
}

/** Per-column count of opaque pixels (to find a divider's caps and diamond). */
export function columnHeights(img) {
  return Array.from({ length: img.w }, (_, x) => { let n = 0; for (let y = 0; y < img.h; y++) if (img.data[(x + y * img.w) * 4 + 3] >= 128) n++; return n; });
}

/** Keep only the pixels where `lit` differs from `unlit` (the glow of a lantern's glass), others transparent. */
export function difference(lit, unlit, threshold = 60) {
  const out = Buffer.alloc(lit.w * lit.h * 4);
  for (let i = 0; i < lit.w * lit.h; i++) {
    const a = lit.data.subarray(i * 4, i * 4 + 4), b = unlit.data.subarray(i * 4, i * 4 + 4);
    if (a[3] < 128) continue;
    const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const warm = a[0] > 120 && a[0] >= a[2];
    if (d >= threshold && warm) { out[i * 4] = a[0]; out[i * 4 + 1] = a[1]; out[i * 4 + 2] = a[2]; out[i * 4 + 3] = 255; }
  }
  return { data: out, w: lit.w, h: lit.h };
}

// Brighten a texture for lettering: per channel out = 255 * gain * (v / 255) ^ gamma (gamma < 1 lifts the darks).
export function lift(img, gamma, gain) {
  const out = Buffer.from(img.data);
  for (let i = 0; i < img.w * img.h; i++) for (let c = 0; c < 3; c++) {
    out[i * 4 + c] = Math.min(255, Math.round(255 * gain * (img.data[i * 4 + c] / 255) ** gamma));
  }
  return { data: out, w: img.w, h: img.h };
}

// Even out a seamless tile's broad light (a painted gradient becomes a stripe once tiled): each pixel is scaled by the
// tile's mean brightness over its local mean (a wrapping box blur of radius r), keeping the fine texture.
export function flatten(img, r) {
  const { w, h } = img, lum = new Float32Array(w * h), tmp = new Float32Array(w * h), blur = new Float32Array(w * h);
  let mean = 0;
  for (let i = 0; i < w * h; i++) { lum[i] = img.data[i * 4] * 0.3 + img.data[i * 4 + 1] * 0.59 + img.data[i * 4 + 2] * 0.11; mean += lum[i]; }
  mean /= w * h;
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let d = -r; d <= r; d++) s += lum[((x + d) % w + w) % w + y * w]; tmp[x + y * w] = s / n; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let d = -r; d <= r; d++) s += tmp[x + (((y + d) % h + h) % h) * w]; blur[x + y * w] = s / n; }
  const out = Buffer.from(img.data);
  for (let i = 0; i < w * h; i++) {
    const k = mean / Math.max(1, blur[i]);
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.min(255, Math.round(img.data[i * 4 + c] * k));
  }
  return { data: out, w, h };
}

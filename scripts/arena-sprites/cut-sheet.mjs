// Cut a generated fighter pose sheet (flat magenta background, rows x cols grid of poses) into game-resolution sprites.
//
// The sheet is chroma-keyed, segmented into one figure per grid cell, scaled so the sheet's ANCHOR pose (cell 0, an idle
// stance) stands `--height` presentation pixels tall, area-downsampled, snapped to the sheet's own palette, given a crisp
// one-pixel rim, and written as individual PNGs plus a manifest. Generated art is a source, not the runtime: the runtime
// reads the packed atlas made by pack-atlas.mjs.
//
// Usage: node scripts/arena-sprites/cut-sheet.mjs <sheet.png> --grid 6x3 --names a,b,c,... --out <dir> [--height 38]
//        [--anchor 0] [--preview preview.png]
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const sheetPath = args[0];
const [cols, rows] = opt('grid', '6x3').split('x').map(Number);
const names = opt('names', '').split(',').filter(Boolean);
const outDir = opt('out', 'verify-out/sprites');
const targetH = Number(opt('height', '38'));
const anchorCell = Number(opt('anchor', '0'));
const previewPath = opt('preview', null);
const scaleOverride = opt('scale', null);
mkdirSync(outDir, { recursive: true });

const { data, info } = await sharp(sheetPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;

// ---- 1. key: how magenta is a pixel (0 = not at all, 1 = pure key) ----
const key = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  // Magenta is high red AND high blue with low green; anti-aliased fringes sit partway.
  const m = (Math.min(r, b) - g) / 255;
  const balance = 1 - Math.abs(r - b) / 255;
  key[i] = Math.max(0, Math.min(1, (m - 0.25) / 0.45)) * Math.max(0, Math.min(1, (balance - 0.55) / 0.3));
}
const fg = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) fg[i] = key[i] < 0.5 ? 1 : 0;
// --erase x0,y0,x1,y1[;x0,y0,x1,y1...]: source rectangles that are props, not the figure (a generated ledge brick).
for (const rect of (opt('erase', '') ?? '').split(';').filter(Boolean)) {
  const [x0, y0, x1, y1] = rect.split(',').map(Number);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < W && y < H) { fg[x + y * W] = 0; key[x + y * W] = 1; }
}

// ---- 2. components, assigned to grid cells by centroid ----
const label = new Int32Array(W * H).fill(-1);
const comps = [];
const stack = [];
for (let s = 0; s < W * H; s++) {
  if (!fg[s] || label[s] >= 0) continue;
  const id = comps.length; let n = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
  label[s] = id; stack.push(s);
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0;
    n++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (const j of [i - 1, i + 1, i - W, i + W]) {
      if (j < 0 || j >= W * H || !fg[j] || label[j] >= 0) continue;
      if ((j === i - 1 && x === 0) || (j === i + 1 && x === W - 1)) continue;
      label[j] = id; stack.push(j);
    }
  }
  comps.push({ id, n, cx: sx / n, cy: sy / n, x0, y0, x1, y1 });
}
const cellW = W / cols, cellH = H / rows;
const minArea = (cellW * cellH) * 0.0006;
const cells = Array.from({ length: cols * rows }, () => ({ comps: [], x0: W, y0: H, x1: 0, y1: 0, n: 0 }));
for (const c of comps) {
  if (c.n < minArea) continue;
  const col = Math.min(cols - 1, Math.floor(c.cx / cellW)), row = Math.min(rows - 1, Math.floor(c.cy / cellH));
  const cell = cells[col + row * cols];
  cell.comps.push(c.id); cell.n += c.n;
  cell.x0 = Math.min(cell.x0, c.x0); cell.y0 = Math.min(cell.y0, c.y0); cell.x1 = Math.max(cell.x1, c.x1); cell.y1 = Math.max(cell.y1, c.y1);
}

// ---- 3. scale from the anchor pose ----
const anchor = cells[anchorCell];
const scale = scaleOverride ? Number(scaleOverride) : targetH / (anchor.y1 - anchor.y0 + 1);

// ---- 4. palette: the sheet's own colours (k-means over the figures, decontaminated) ----
function decontam(i) {
  // Remove the magenta that an anti-aliased fringe mixed in: c = a*fg + (1-a)*magenta  =>  fg = (c - (1-a)*M) / a
  const a = 1 - key[i];
  let r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  if (a < 0.98 && a > 0.05) { r = (r - (1 - a) * 255) / a; g = g / a; b = (b - (1 - a) * 255) / a; }
  return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b)), a];
}
const samples = [];
for (let i = 0; i < W * H; i += 7) if (fg[i] && key[i] < 0.05) samples.push(decontam(i).slice(0, 3));
const K = Number(opt('colors', '28'));
let centers = [];
for (let k = 0; k < K; k++) centers.push(samples[Math.floor((k + 0.5) / K * samples.length)].slice());
// Seed spread by sorting on luminance first, so dark outlines and bright highlights both get a centre.
samples.sort((p, q) => (p[0] * 3 + p[1] * 6 + p[2]) - (q[0] * 3 + q[1] * 6 + q[2]));
centers = Array.from({ length: K }, (_, k) => samples[Math.floor((k + 0.5) / K * samples.length)].slice());
for (let iter = 0; iter < 12; iter++) {
  const acc = centers.map(() => [0, 0, 0, 0]);
  for (const s of samples) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < K; k++) { const c = centers[k], d = (s[0] - c[0]) ** 2 * 3 + (s[1] - c[1]) ** 2 * 4 + (s[2] - c[2]) ** 2 * 2; if (d < bd) { bd = d; best = k; } }
    const a = acc[best]; a[0] += s[0]; a[1] += s[1]; a[2] += s[2]; a[3]++;
  }
  centers = centers.map((c, k) => acc[k][3] ? [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]] : c);
}
const snap = (r, g, b) => {
  let best = centers[0], bd = Infinity;
  for (const c of centers) { const d = (r - c[0]) ** 2 * 3 + (g - c[1]) ** 2 * 4 + (b - c[2]) ** 2 * 2; if (d < bd) { bd = d; best = c; } }
  return best;
};

// ---- 5. each figure: area-downsample into presentation pixels, snap, rim ----
const manifest = { sheet: sheetPath, scale, targetH, frames: {} };
const previews = [];
for (let c = 0; c < cells.length; c++) {
  const cell = cells[c];
  const name = names[c] ?? `cell${c}`;
  if (!cell.n || name === '-') continue;
  const owned = new Set(cell.comps);
  // Bottom-centre of the figure is the foot anchor; the frame keeps a 1px margin for the rim.
  const ow = Math.max(1, Math.ceil((cell.x1 - cell.x0 + 1) * scale)) + 2;
  const oh = Math.max(1, Math.ceil((cell.y1 - cell.y0 + 1) * scale)) + 2;
  const rgba = new Float32Array(ow * oh * 4);
  const inv = 1 / scale;
  for (let oy = 0; oy < oh - 2; oy++) for (let ox = 0; ox < ow - 2; ox++) {
    // Source footprint of this output pixel.
    const sx0 = cell.x0 + ox * inv, sy0 = cell.y0 + oy * inv;
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy0 + inv); sy++) for (let sx = Math.floor(sx0); sx < Math.ceil(sx0 + inv); sx++) {
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) { n++; continue; }
      const i = sx + sy * W; n++;
      if (!fg[i] || !owned.has(label[i])) continue;
      const [cr, cg, cb, ca] = decontam(i);
      r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
    }
    const o = ((ox + 1) + (oy + 1) * ow) * 4;
    if (a > 0) { rgba[o] = r / a; rgba[o + 1] = g / a; rgba[o + 2] = b / a; }
    rgba[o + 3] = n ? a / n : 0;
  }
  // Coverage threshold, palette snap.
  const out = Buffer.alloc(ow * oh * 4);
  const solid = new Uint8Array(ow * oh);
  for (let i = 0; i < ow * oh; i++) solid[i] = rgba[i * 4 + 3] >= 0.42 ? 1 : 0;
  for (let i = 0; i < ow * oh; i++) {
    if (!solid[i]) continue;
    const [r, g, b] = snap(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
  }
  // Rim: the concept's crisp dark outline. 'inner' darkens edge pixels, 'outer' grows a one-pixel ink ring, 'none' keeps the downsample.
  const rimMode = opt('rim', 'outer');
  const isEdge = (x, y) => { const i = x + y * ow; return solid[i] && (x === 0 || y === 0 || x === ow - 1 || y === oh - 1 || !solid[i - 1] || !solid[i + 1] || !solid[i - ow] || !solid[i + ow]); };
  const ink = (r, g, b) => [Math.round(r * 0.22 + 8), Math.round(g * 0.2 + 8), Math.round(b * 0.22 + 12)];
  if (rimMode === 'inner') {
    const edges = []; for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) if (isEdge(x, y)) edges.push(x + y * ow);
    for (const i of edges) { const [r, g, b] = ink(out[i * 4], out[i * 4 + 1], out[i * 4 + 2]); out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; }
  } else if (rimMode === 'outer') {
    const grow = [];
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
      const i = x + y * ow; if (solid[i]) continue;
      let n = -1; for (const j of [x > 0 ? i - 1 : -1, x < ow - 1 ? i + 1 : -1, y > 0 ? i - ow : -1, y < oh - 1 ? i + ow : -1]) if (j >= 0 && solid[j]) { n = j; break; }
      if (n >= 0) grow.push([i, n]);
    }
    for (const [i, n] of grow) { const [r, g, b] = ink(out[n * 4], out[n * 4 + 1], out[n * 4 + 2]); out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255; solid[i] = 1; }
  }
  // Foot anchor: centre of the lowest solid row (in output pixels, from the frame's top-left).
  let footY = oh - 1; while (footY > 0 && !solid.slice(footY * ow, footY * ow + ow).some(Boolean)) footY--;
  let fx0 = ow, fx1 = 0; for (let x = 0; x < ow; x++) if (solid[x + footY * ow]) { fx0 = Math.min(fx0, x); fx1 = Math.max(fx1, x); }
  // The figure's horizontal anchor: the centre of its torso column (median of solid pixel x over the middle third of its height).
  const xs = []; for (let y = Math.floor(oh / 3); y < Math.floor(oh * 2 / 3); y++) for (let x = 0; x < ow; x++) if (solid[x + y * ow]) xs.push(x);
  xs.sort((p, q) => p - q);
  const ax = xs.length ? xs[xs.length >> 1] : (ow >> 1);
  const file = join(outDir, `${name}.png`);
  await sharp(out, { raw: { width: ow, height: oh, channels: 4 } }).png().toFile(file);
  manifest.frames[name] = { file: `${name}.png`, w: ow, h: oh, ax, ay: footY, footX: (fx0 + fx1) / 2, src: [cell.x0, cell.y0, cell.x1, cell.y1] };
  previews.push({ name, out, ow, oh });
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));

if (previewPath) {
  // Zoomed contact sheet over a slate tile, for eyeballing.
  const Z = 4, pad = 6, tile = 60;
  const pw = (tile * Z + pad) * cols, ph = (tile * Z + pad + 14) * rows;
  const comp = [];
  previews.forEach((p, k) => {
    const idx = names.indexOf(p.name) >= 0 ? names.indexOf(p.name) : k;
    const col = idx % cols, row = Math.floor(idx / cols);
    comp.push({ input: { create: { width: tile * Z, height: tile * Z, channels: 4, background: '#1b2a3a' } }, left: col * (tile * Z + pad), top: row * (tile * Z + pad + 14) });
  });
  const base = sharp({ create: { width: pw, height: ph, channels: 4, background: '#0c121a' } }).composite(comp);
  const baseBuf = await base.png().toBuffer();
  const layers = [];
  for (const [k, p] of previews.entries()) {
    const idx = names.indexOf(p.name) >= 0 ? names.indexOf(p.name) : k;
    const col = idx % cols, row = Math.floor(idx / cols);
    const big = await sharp(p.out, { raw: { width: p.ow, height: p.oh, channels: 4 } }).resize(p.ow * Z, p.oh * Z, { kernel: 'nearest' }).png().toBuffer();
    const m = manifest.frames[p.name];
    const left = col * (tile * Z + pad) + Math.round((tile / 2 - m.ax) * Z);
    const top = row * (tile * Z + pad + 14) + Math.round((tile - 6 - m.ay) * Z);
    layers.push({ input: big, left: Math.max(0, left), top: Math.max(0, top) });
  }
  await sharp(baseBuf).composite(layers).png().toFile(previewPath);
}
console.log(JSON.stringify({ W, H, scale, frames: Object.keys(manifest.frames).length, anchorH: anchor.y1 - anchor.y0 + 1 }));

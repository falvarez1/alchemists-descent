// Bake one stage platform from its art (a generated, magenta-keyed render) into game data:
//   public/assets/arena/<stage>/<slab>.png        cell-resolution colours of the solid hull (alpha = solid)
//   public/assets/arena/<stage>/<slab>-decor.png  half-cell (presentation) resolution hangings: chains, lantern frames
//   public/assets/arena/<stage>/<slab>.json       the hull mask as row runs, the decor rectangle, lantern glass cells
// gen-stage-slabs.mjs turns the JSON files into src/content/arena/stageSlabs.generated.ts (collision is synchronous and
// deterministic; colours arrive with the PNG). The art IS the cells: what the art shows as solid is real Metal; thin
// hangings never collide.
//
// Usage: node scripts/arena-stages/bake-slab.mjs <art.png> --stage foundry --slab main --width 480 [--preview out.png]
//        [--glass "#65cac5"] [--colors 40]
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const artPath = args[0], stage = opt('stage', 'foundry'), slab = opt('slab', 'main');
const widthCells = Number(opt('width', '480')), previewPath = opt('preview', null);
const K = Number(opt('colors', '40'));
const outDir = join('public/assets/arena', stage);
mkdirSync(outDir, { recursive: true });

const { data, info } = await sharp(artPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;

// ---- key ----
const keyA = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  const m = (Math.min(r, b) - g) / 255, bal = 1 - Math.abs(r - b) / 255;
  const key = Math.max(0, Math.min(1, (m - 0.25) / 0.45)) * Math.max(0, Math.min(1, (bal - 0.55) / 0.3));
  keyA[i] = 1 - key;
}
const col = (i) => {
  const a = keyA[i]; let r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  if (a < 0.98 && a > 0.05) { r = (r - (1 - a) * 255) / a; g = g / a; b = (b - (1 - a) * 255) / a; }
  return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
};

// ---- bounds and the deck line ----
let bx0 = W, bx1 = 0, by0 = H, by1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (keyA[x + y * W] > 0.5) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
const rowFill = (y) => { let n = 0; for (let x = bx0; x <= bx1; x++) if (keyA[x + y * W] > 0.5) n++; return n / (bx1 - bx0 + 1); };
let deckTop = by0; while (deckTop < by1 && rowFill(deckTop) < 0.6) deckTop++;
const p = (bx1 - bx0 + 1) / widthCells; // source pixels per cell
const depthCells = Math.ceil((by1 - deckTop + 1) / p);

// ---- palette ----
const samples = [];
for (let i = 0; i < W * H; i += 5) if (keyA[i] > 0.97) samples.push(col(i));
samples.sort((a, b) => (a[0] * 3 + a[1] * 6 + a[2]) - (b[0] * 3 + b[1] * 6 + b[2]));
let centers = Array.from({ length: K }, (_, k) => samples[Math.floor((k + 0.5) / K * samples.length)].slice());
const dist = (s, c) => (s[0] - c[0]) ** 2 * 3 + (s[1] - c[1]) ** 2 * 4 + (s[2] - c[2]) ** 2 * 2;
for (let it = 0; it < 10; it++) {
  const acc = centers.map(() => [0, 0, 0, 0]);
  for (let s = 0; s < samples.length; s += 2) { const v = samples[s]; let best = 0, bd = Infinity; for (let k = 0; k < K; k++) { const d = dist(v, centers[k]); if (d < bd) { bd = d; best = k; } } const a = acc[best]; a[0] += v[0]; a[1] += v[1]; a[2] += v[2]; a[3]++; }
  centers = centers.map((c, k) => acc[k][3] ? [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]] : c);
}
const snapIdx = (v) => { let best = 0, bd = Infinity; for (let k = 0; k < K; k++) { const d = dist(v, centers[k]); if (d < bd) { bd = d; best = k; } } return best; };

// ---- a block of source pixels -> coverage and dominant palette colour ----
function block(sx0, sy0, size) {
  const votes = new Map(); let cov = 0, n = 0;
  const x0 = Math.floor(sx0), y0 = Math.floor(sy0), x1 = Math.ceil(sx0 + size), y1 = Math.ceil(sy0 + size);
  const cx = sx0 + size / 2, cy = sy0 + size / 2;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    n++;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = x + y * W, a = keyA[i];
    cov += a;
    if (a < 0.9) continue; // fringes carry the key colour: they count as coverage, never as colour
    // Centre pixels vote harder: an art pixel straddling the block edge belongs to its neighbour.
    const w = 1 + 1.5 * (1 - Math.min(1, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / (size * 0.7)));
    const k = snapIdx(col(i));
    votes.set(k, (votes.get(k) ?? 0) + w);
  }
  let best = -1, bw = 0; for (const [k, w] of votes) if (w > bw) { bw = w; best = k; }
  return { cov: n ? cov / n : 0, color: best >= 0 ? centers[best] : null };
}

// ---- lantern glass (bright teal) in source pixels: lanterns hang, they never collide ----
// --glass <hex> picks the lantern glass hue (--glass none: no lanterns); --glass-tol widens or narrows the match.
const glassOpt = opt('glass', '#65cac5'), glassTol = Number(opt('glass-tol', '170')), glassMinLum = Number(opt('glass-lum', '140'));
const glassHex = glassOpt === 'none' ? '000000' : glassOpt.replace('#', '');
const gR = parseInt(glassHex.slice(0, 2), 16), gG = parseInt(glassHex.slice(2, 4), 16), gB = parseInt(glassHex.slice(4, 6), 16);
const isGlass = (i) => {
  if (glassOpt === 'none' || keyA[i] < 0.9) return false;
  const [r, g, b] = col(i);
  return r * 0.3 + g * 0.59 + b * 0.11 > glassMinLum && Math.abs(r - gR) + Math.abs(g - gG) + Math.abs(b - gB) < glassTol;
};
const glassSeen = new Uint8Array(W * H), lanterns = [];
for (let s0 = 0; s0 < W * H; s0++) {
  if (glassSeen[s0] || !isGlass(s0)) continue;
  const st = [s0]; glassSeen[s0] = 1; let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
  while (st.length) { const i = st.pop(), x = i % W, y = (i / W) | 0; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = X + Y * W; if (!glassSeen[j] && isGlass(j)) { glassSeen[j] = 1; st.push(j); } } }
  if (n > (W / 400) ** 2 * 6) lanterns.push({ x0, y0, x1, y1 });
}
// A lantern's housing: the glass box widened by 60% each side, from 90% of its height above to the bottom of the art below.
const lanternBoxes = lanterns.map(l => { const gw = l.x1 - l.x0 + 1, gh = l.y1 - l.y0 + 1; return { x0: l.x0 - gw * 0.6, x1: l.x1 + gw * 0.6, y0: l.y0 - gh * 0.9, y1: by1 + 1 }; });
const inLantern = (sx, sy) => lanternBoxes.some(b => sx >= b.x0 && sx <= b.x1 && sy >= b.y0 && sy <= b.y1);

// ---- cells ----
const Wc = widthCells, Hc = depthCells;
const cov = new Float32Array(Wc * Hc), colors = new Array(Wc * Hc).fill(null);
for (let cy = 0; cy < Hc; cy++) for (let cx = 0; cx < Wc; cx++) {
  const b = block(bx0 + cx * p, deckTop + cy * p, p);
  cov[cx + cy * Wc] = b.cov; colors[cx + cy * Wc] = b.color;
}
let solid = new Uint8Array(Wc * Hc);
for (let i = 0; i < Wc * Hc; i++) {
  const cx = i % Wc, cy = (i / Wc) | 0;
  solid[i] = cov[i] > 0.5 && !(cy > 2 && inLantern(bx0 + (cx + 0.5) * p, deckTop + (cy + 0.5) * p)) ? 1 : 0;
}
// The walking surface is one flat, unbroken row (and the one under it), end cap to end cap.
let deckL = Wc, deckR = -1;
for (let cx = 0; cx < Wc; cx++) if (solid[cx + Wc] || solid[cx + 2 * Wc]) { deckL = Math.min(deckL, cx); deckR = Math.max(deckR, cx); }
for (const cy of [0, 1]) for (let cx = 0; cx < Wc; cx++) solid[cx + cy * Wc] = cx >= deckL && cx <= deckR ? 1 : 0;
for (let cx = deckL; cx <= deckR; cx++) if (!colors[cx]) colors[cx] = colors[cx + Wc] ?? centers[K - 1];

// ---- hull = what survives an opening (thin chains do not), grown back into the art by 2 cells ----
const erode = (m, r) => { const o = new Uint8Array(m.length); for (let y = 0; y < Hc; y++) for (let x = 0; x < Wc; x++) { let ok = 1; for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= Wc || Y >= Hc || !m[X + Y * Wc]) { ok = 0; break; } } o[x + y * Wc] = ok; } return o; };
const dilate = (m, r) => { const o = new Uint8Array(m.length); for (let y = 0; y < Hc; y++) for (let x = 0; x < Wc; x++) { if (!m[x + y * Wc]) continue; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < Wc && Y < Hc) o[X + Y * Wc] = 1; } } return o; };
const opened = dilate(erode(solid, 2), 2);
// Largest component of the opened mask (4-connected).
const lab = new Int32Array(Wc * Hc).fill(-1); let bestId = -1, bestN = 0;
for (let s = 0, id = 0; s < Wc * Hc; s++) {
  if (!opened[s] || lab[s] >= 0) continue;
  const st = [s]; lab[s] = id; let n = 0;
  while (st.length) { const i = st.pop(); n++; const x = i % Wc; for (const j of [x > 0 ? i - 1 : -1, x < Wc - 1 ? i + 1 : -1, i - Wc, i + Wc]) if (j >= 0 && j < Wc * Hc && opened[j] && lab[j] < 0) { lab[j] = id; st.push(j); } }
  if (n > bestN) { bestN = n; bestId = id; }
  id++;
}
const core = new Uint8Array(Wc * Hc); for (let i = 0; i < Wc * Hc; i++) core[i] = lab[i] === bestId ? 1 : 0;
const near = dilate(core, 2);
const hull = new Uint8Array(Wc * Hc);
for (let i = 0; i < Wc * Hc; i++) hull[i] = solid[i] && (near[i] || i < 2 * Wc) ? 1 : 0;
// Enclosed holes become dark recesses (solid): flood the air from the border; whatever air it cannot reach is inside.
{
  const air = new Uint8Array(Wc * Hc), st = [];
  for (let x = 0; x < Wc; x++) for (const y of [0, Hc - 1]) if (!hull[x + y * Wc]) { air[x + y * Wc] = 1; st.push(x + y * Wc); }
  for (let y = 0; y < Hc; y++) for (const x of [0, Wc - 1]) if (!hull[x + y * Wc] && !air[x + y * Wc]) { air[x + y * Wc] = 1; st.push(x + y * Wc); }
  while (st.length) { const i = st.pop(), x = i % Wc; for (const j of [x > 0 ? i - 1 : -1, x < Wc - 1 ? i + 1 : -1, i - Wc, i + Wc]) if (j >= 0 && j < Wc * Hc && !hull[j] && !air[j]) { air[j] = 1; st.push(j); } }
  const recess = centers.reduce((a, c) => (c[0] + c[1] + c[2] < a[0] + a[1] + a[2] ? c : a), centers[0]);
  for (let i = 0; i < Wc * Hc; i++) if (!hull[i] && !air[i]) { hull[i] = 1; colors[i] = recess; }
}
// Trim trailing empty rows.
let lastRow = Hc - 1; while (lastRow > 0 && !hull.slice(lastRow * Wc, lastRow * Wc + Wc).some(Boolean)) lastRow--;
const depth = lastRow + 1;

// ---- tone: the walking edge is the concept's lit copper (#efac58), and no hull colour may bloom ----
{
  const edge = [239, 172, 88], maxLum = 0.72 * 255;
  const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  for (let cx = 0; cx < Wc; cx++) if (hull[cx]) colors[cx] = edge;
  for (let i = Wc; i < Wc * Hc; i++) {
    const c = colors[i]; if (!c || !hull[i]) continue;
    const L = lum(c); if (L > maxLum) colors[i] = c.map(v => v * maxLum / L);
  }
}

// ---- outputs: hull colours (cell res) ----
const hullPng = Buffer.alloc(Wc * depth * 4);
const runs = [];
for (let cy = 0; cy < depth; cy++) {
  const row = []; let start = -1;
  for (let cx = 0; cx <= Wc; cx++) {
    const on = cx < Wc && hull[cx + cy * Wc];
    if (on && start < 0) start = cx;
    if (!on && start >= 0) { row.push(start, cx - 1); start = -1; }
    if (on) { const c = colors[cx + cy * Wc] ?? centers[0]; const o = (cx + cy * Wc) * 4; hullPng[o] = c[0]; hullPng[o + 1] = c[1]; hullPng[o + 2] = c[2]; hullPng[o + 3] = 255; }
  }
  runs.push(row);
}
await sharp(hullPng, { raw: { width: Wc, height: depth, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(outDir, `${slab}.png`));

// ---- decor: everything the hull does not own, at presentation (half-cell) resolution ----
const fp = p / 2, Wf = Wc * 2, Hf = Math.ceil((by1 - deckTop + 1) / fp) + 2;
const decor = Buffer.alloc(Wf * Hf * 4); let dx0 = Wf, dy0 = Hf, dx1 = -1, dy1 = -1;
const glass = [];
for (let fy = 0; fy < Hf; fy++) for (let fx = 0; fx < Wf; fx++) {
  const cx = fx >> 1, cy = fy >> 1;
  if (cy < depth && hull[cx + cy * Wc]) continue;
  const b = block(bx0 + fx * fp, deckTop + fy * fp, fp);
  if (b.cov < 0.45 || !b.color) continue;
  const o = (fx + fy * Wf) * 4; decor[o] = b.color[0]; decor[o + 1] = b.color[1]; decor[o + 2] = b.color[2]; decor[o + 3] = 255;
  dx0 = Math.min(dx0, fx); dy0 = Math.min(dy0, fy); dx1 = Math.max(dx1, fx); dy1 = Math.max(dy1, fy);
  // Lantern glass: it becomes real, light-giving, non-blocking cells.
  const si = Math.min(W - 1, Math.round(bx0 + (fx + 0.5) * fp)) + Math.min(H - 1, Math.round(deckTop + (fy + 0.5) * fp)) * W;
  if (isGlass(si)) glass.push([cx, cy]);
}
let decorRect = null;
if (dx1 >= 0) {
  const w = dx1 - dx0 + 1, h = dy1 - dy0 + 1, crop = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) decor.copy(crop, y * w * 4, ((dy0 + y) * Wf + dx0) * 4, ((dy0 + y) * Wf + dx0 + w) * 4);
  await sharp(crop, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(outDir, `${slab}-decor.png`));
  decorRect = { file: `${slab}-decor.png`, x: dx0, y: dy0, w, h };
}
const glassCells = [...new Set(glass.map(([x, y]) => `${x},${y}`))].map(s => s.split(',').map(Number));

// ---- the hull face at presentation (half-cell) resolution: what close camera framings draw over the cells ----
{
  const fw = Wc * 2, fh = depth * 2, face = Buffer.alloc(fw * fh * 4);
  const edge = [239, 172, 88], maxLum = 0.72 * 255, lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  for (let fy = 0; fy < fh; fy++) for (let fx = 0; fx < fw; fx++) {
    const cx = fx >> 1, cy = fy >> 1;
    if (!hull[cx + cy * Wc]) continue;
    let c = fy < 2 ? edge : block(bx0 + fx * fp, deckTop + fy * fp, fp).color ?? colors[cx + cy * Wc] ?? centers[0];
    const L = lum(c); if (fy >= 2 && L > maxLum) c = c.map(v => v * maxLum / L);
    const o = (fx + fy * fw) * 4; face[o] = c[0]; face[o + 1] = c[1]; face[o + 2] = c[2]; face[o + 3] = 255;
  }
  await sharp(face, { raw: { width: fw, height: fh, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(outDir, `${slab}-fine.png`));
}
writeFileSync(join(outDir, `${slab}.json`), JSON.stringify({ stage, slab, width: Wc, depth, runs, decor: decorRect, glass: glassCells, fine: `${slab}-fine.png` }));

if (previewPath) {
  // Hull (cells, x4) over slate with the decor (fine, x2) laid on top: what the game will show.
  const Z = 2;
  const hullBig = await sharp(hullPng, { raw: { width: Wc, height: depth, channels: 4 } }).resize(Wc * 2 * Z, depth * 2 * Z, { kernel: 'nearest' }).png().toBuffer();
  const layers = [{ input: hullBig, left: 0, top: 0 }];
  if (decorRect) layers.push({ input: await sharp(join(outDir, decorRect.file)).resize(decorRect.w * Z, decorRect.h * Z, { kernel: 'nearest' }).png().toBuffer(), left: decorRect.x * Z, top: decorRect.y * Z });
  await sharp({ create: { width: Wf * Z, height: Math.max(depth * 2, Hf) * Z, channels: 4, background: '#1b2a3a' } }).composite(layers).png().toFile(previewPath);
}
console.log(JSON.stringify({ stage, slab, pxPerCell: p, width: Wc, depth, decor: decorRect, glass: glassCells.length }));

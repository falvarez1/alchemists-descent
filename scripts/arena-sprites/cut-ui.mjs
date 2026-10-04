// Find and try out interface pieces on a generated UI kit sheet (flat magenta background), to choose the rectangles
// and factors that build-ui-kit.mjs then cuts for good.
//
//   list <sheet> [--merge 28] [--min 400] [--preview out.png] [--json out.json]
//       finds every piece (connected non-magenta areas, merged when closer than --merge source pixels) and writes a
//       numbered preview, so pieces can be named by their bounding boxes.
//   cut <sheet> --rect x0,y0,x1,y1 (--factor F | --size WxH) --out piece.png [--colors 40] [--no-trim]
//       one piece exactly as the kit cuts it (ui-kit-lib cutPiece): the rectangle tightened to the drawn pixels (unless
//       --no-trim), area-downsampled by --factor source pixels per art pixel (any number) or to an exact --size, magenta
//       fringes decontaminated, colours snapped to the piece's own palette.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { loadSheet, tightRect, cutPiece, savePng } from './ui-kit-lib.mjs';

const [mode, sheetPath, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : fallback; };
const sheet = await loadSheet(sheetPath);
const { W, H, key } = sheet;

if (mode === 'list') {
  const merge = Number(opt('merge', '28')), minArea = Number(opt('min', '400'));
  // Dilate the foreground by `merge` (a box test on a coarse grid) and label the coarse cells: cheap and enough to
  // group a piece's parts (a lantern and its chain) while keeping separate pieces apart.
  const S = 4, gw = Math.ceil(W / S), gh = Math.ceil(H / S), grid = new Uint8Array(gw * gh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (key[x + y * W] < 0.5) grid[((x / S) | 0) + ((y / S) | 0) * gw] = 1;
  const R = Math.ceil(merge / S / 2), dil = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (!grid[x + y * gw]) continue;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < gw && Y < gh) dil[X + Y * gw] = 1;
    }
  }
  const label = new Int32Array(gw * gh).fill(-1), pieces = [];
  for (let s = 0; s < gw * gh; s++) {
    if (!dil[s] || label[s] >= 0) continue;
    const id = pieces.length, stack = [s]; label[s] = id; let x0 = gw, y0 = gh, x1 = 0, y1 = 0, n = 0;
    while (stack.length) {
      const i = stack.pop(), x = i % gw, y = (i / gw) | 0;
      if (grid[i]) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      for (const j of [i - 1, i + 1, i - gw, i + gw]) {
        if (j < 0 || j >= gw * gh || !dil[j] || label[j] >= 0) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === gw - 1)) continue;
        label[j] = id; stack.push(j);
      }
    }
    if (n * S * S >= minArea) pieces.push({ id, rect: [x0 * S, y0 * S, Math.min(W - 1, x1 * S + S - 1), Math.min(H - 1, y1 * S + S - 1)], area: n * S * S });
  }
  pieces.sort((a, b) => (a.rect[1] - b.rect[1]) || (a.rect[0] - b.rect[0]));
  const out = pieces.map((p, n) => ({ n, rect: p.rect, w: p.rect[2] - p.rect[0] + 1, h: p.rect[3] - p.rect[1] + 1 }));
  console.log(JSON.stringify(out));
  if (opt('json', null)) writeFileSync(opt('json'), JSON.stringify(out, null, 1));
  if (opt('preview', null)) {
    const svg = `<svg width="${W}" height="${H}">${out.map(p => `<rect x="${p.rect[0]}" y="${p.rect[1]}" width="${p.w}" height="${p.h}" fill="none" stroke="#00ff66" stroke-width="3"/><text x="${p.rect[0] + 4}" y="${p.rect[1] + 30}" font-size="30" fill="#00ff66" font-family="monospace">${p.n}</text>`).join('')}</svg>`;
    // Composite at full size first: sharp resizes before it composites, and the overlay would no longer fit.
    const full = await sharp(sheetPath).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
    await sharp(full).resize({ width: 1600 }).png().toFile(opt('preview'));
  }
} else if (mode === 'cut') {
  const loose = opt('rect', `0,0,${W - 1},${H - 1}`).split(',').map(Number);
  const rect = rest.includes('--no-trim') ? loose : tightRect(sheet, loose);
  const size = opt('size', null) ? opt('size').split('x').map(Number) : null;
  const piece = cutPiece(sheet, rect, { factor: Number(opt('factor', '4')), size, colors: Number(opt('colors', '40')) });
  const outPath = opt('out', 'piece.png');
  await savePng(piece, outPath);
  console.log(JSON.stringify({ out: outPath, rect, w: piece.w, h: piece.h, factor: +((rect[2] - rect[0] + 1) / piece.w).toFixed(3) }));
} else {
  throw new Error('usage: cut-ui.mjs list|cut <sheet> ...');
}

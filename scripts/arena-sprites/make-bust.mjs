// Frame a generated bust portrait (docs/arena/platform-fighter/sprite-sources/<id>-bust.webp) into the UI asset
// public/assets/arena/fighters/<id>/bust.webp: every fighter's eyes on the same line, heads at about the same size, on a
// dark slate ground that reaches exactly #111a24 at the edges so a panel (or a CSS mask) can fade it in.
// Framing numbers per fighter live in bust-framing.json (measured on each master).
//
// Usage: node scripts/arena-sprites/make-bust.mjs [id ...] [--size 768] [--src <master.png>] [--sheet <contact.png>]
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const framing = JSON.parse(readFileSync(new URL('./bust-framing.json', import.meta.url), 'utf8'));
const optValues = new Set(['--size', '--src', '--sheet'].map(f => opt(f.slice(2), null)).filter(Boolean));
const ids = args.filter(a => !a.startsWith('--') && !optValues.has(a));
const list = ids.length ? ids : Object.keys(framing).filter(k => !k.startsWith('_'));
const N = Number(opt('size', '768'));
const EYE_Y = 0.38, EDGE = [17, 26, 36]; // #111a24
const FEATHER = 0.07; // fraction of the side over which the picture fades into EDGE

const made = [];
for (const id of list) {
  const f = framing[id];
  if (!f) throw new Error(`no framing for ${id}`);
  const src = opt('src', null) && list.length === 1 ? opt('src') : `docs/arena/platform-fighter/sprite-sources/${id}-bust.webp`;
  const meta = await sharp(src).metadata();
  // Ground colour the generator painted: the mean of the master's top rows.
  const top = await sharp(src).extract({ left: 0, top: 0, width: meta.width, height: Math.round(meta.height * 0.02) }).removeAlpha().raw().toBuffer();
  const ground = [0, 1, 2].map(c => { let s = 0; for (let i = c; i < top.length; i += 3) s += top[i]; return s / (top.length / 3); });
  // Scale, then place so the eye line lands at (tx, EYE_Y).
  const W = Math.round(N * f.s);
  const scaled = await sharp(src).resize(W, W, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
  const left = Math.round(f.tx * N - f.ex * W), topOff = Math.round(EYE_Y * N - f.ey * W);
  const out = Buffer.alloc(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const sx = x - left, sy = y - topOff, o = (x + y * N) * 3;
    let r = ground[0], g = ground[1], b = ground[2];
    if (sx >= 0 && sy >= 0 && sx < W && sy < W) { const i = (sx + sy * W) * 3; r = scaled[i]; g = scaled[i + 1]; b = scaled[i + 2]; }
    // Lift the painted ground (and only the deepest shadows) onto #111a24, so the bust sits on the panel colour.
    const lum = 0.3 * r + 0.59 * g + 0.11 * b, lift = Math.max(0, 1 - lum / 70);
    r += (EDGE[0] - ground[0]) * lift; g += (EDGE[1] - ground[1]) * lift; b += (EDGE[2] - ground[2]) * lift;
    // Feather every side into exactly #111a24 (smoothstep over FEATHER of the side).
    const d = Math.min(x, y, N - 1 - x, N - 1 - y) / (N * FEATHER);
    const t = d >= 1 ? 1 : d * d * (3 - 2 * d);
    out[o] = Math.round(EDGE[0] + (r - EDGE[0]) * t); out[o + 1] = Math.round(EDGE[1] + (g - EDGE[1]) * t); out[o + 2] = Math.round(EDGE[2] + (b - EDGE[2]) * t);
  }
  const dir = join('public/assets/arena/fighters', id);
  mkdirSync(dir, { recursive: true });
  await sharp(out, { raw: { width: N, height: N, channels: 3 } }).webp({ quality: 90 }).toFile(join(dir, 'bust.webp'));
  made.push({ id, buf: await sharp(out, { raw: { width: N, height: N, channels: 3 } }).png().toBuffer() });
  console.log(`${id}: bust ${N}x${N} (scale ${f.s}, eyes at ${f.tx},${EYE_Y})`);
}

// Contact sheet: five across, each bust over a guide at the shared eye line.
const sheet = opt('sheet', null);
if (sheet) {
  const T = 300, pad = 8, cols = Math.min(5, made.length), rows = Math.ceil(made.length / cols);
  const guide = Buffer.from(`<svg width="${T}" height="${T}"><line x1="0" y1="${EYE_Y * T}" x2="${T}" y2="${EYE_Y * T}" stroke="rgba(255,200,80,0.35)" stroke-dasharray="4 4"/></svg>`);
  const comp = await Promise.all(made.map(async (m, k) => ({
    input: await sharp(m.buf).resize(T, T).composite([{ input: guide }]).png().toBuffer(),
    left: pad + (k % cols) * (T + pad), top: pad + Math.floor(k / cols) * (T + pad),
  })));
  await sharp({ create: { width: pad + cols * (T + pad), height: pad + rows * (T + pad), channels: 3, background: '#0b1118' } })
    .composite(comp).png().toFile(sheet);
  console.log(`contact sheet: ${sheet}`);
}

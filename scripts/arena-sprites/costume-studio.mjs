// Every fighter in its own colours and its mirror-match colourway (src/render/duel/costumes.ts), side by side, for
// tuning the rules by eye: idle, a strike and the victory pose, plus the bust.
// Usage: node scripts/arena-sprites/costume-studio.mjs [--out verify-out/costumes]
import { mkdirSync, readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import sharp from 'sharp';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'verify-out/costumes';
mkdirSync(out, { recursive: true });
const code = buildSync({ entryPoints: ['src/render/duel/costumes.ts'], bundle: true, format: 'esm', write: false, platform: 'neutral',
  alias: { '@': './src' }, logLevel: 'silent' }).outputFiles[0].text;
const { COSTUMES, recolorImageData } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const ROSTER = Object.keys(COSTUMES);
const POSES = ['idle0', 'opener_strike', 'ultimate', 'victory'];
const Z = 4, cw = 58, ch = 64, bustSize = 160;
const rows = [];
for (const id of ROSTER) {
  const json = JSON.parse(readFileSync(`public/assets/arena/fighters/${id}/sprites.json`, 'utf8'));
  const { data, info } = await sharp(`public/assets/arena/fighters/${id}/sprites.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alt = Buffer.from(data); recolorImageData(alt, COSTUMES[id]);
  const comp = [];
  for (const [side, buf] of [[0, data], [1, alt]]) {
    for (const [c, pose] of POSES.entries()) {
      const f = json.frames[pose]; if (!f) continue;
      const [x, y, w, h, ax, ay] = f;
      const piece = await sharp(buf, { raw: { width: info.width, height: info.height, channels: 4 } }).extract({ left: x, top: y, width: w, height: h })
        .resize(w * Z, h * Z, { kernel: 'nearest' }).png().toBuffer();
      const col = side * (POSES.length + 1) + c;
      comp.push({ input: piece, left: Math.max(0, Math.round((col * cw + cw / 2 - ax) * Z)), top: Math.max(0, Math.round((ch - 4 - ay) * Z)) });
    }
  }
  // The bust, both ways.
  const bust = await sharp(`public/assets/arena/fighters/${id}/bust.webp`).resize(bustSize, bustSize).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bustAlt = Buffer.from(bust.data); recolorImageData(bustAlt, COSTUMES[id], 0.17);
  const W = (POSES.length * 2 + 1) * cw * Z;
  for (const [k, buf] of [[0, bust.data], [1, bustAlt]]) {
    comp.push({ input: await sharp(buf, { raw: { width: bustSize, height: bustSize, channels: 4 } }).png().toBuffer(), left: W + k * (bustSize + 8), top: Math.round((ch * Z - bustSize) / 2) });
  }
  rows.push(await sharp({ create: { width: W + 2 * bustSize + 16, height: ch * Z, channels: 4, background: '#142334' } }).composite(comp).png().toBuffer());
}
const meta = await sharp(rows[0]).metadata();
await sharp({ create: { width: meta.width, height: meta.height * rows.length, channels: 4, background: '#142334' } })
  .composite(rows.map((input, i) => ({ input, left: 0, top: i * meta.height }))).png().toFile(`${out}/costumes.png`);
console.log(`${out}/costumes.png: ${ROSTER.length} fighters, own colours left, mirror colourway right, busts at the end`);

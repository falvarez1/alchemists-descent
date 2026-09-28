// A region of a level's cell grid, straight from the colors plane (no camera,
// no lighting), scaled up, with the cell types' outlines optional — the way to
// inspect a set piece's construction cell by cell. Usage:
//   node scripts/shot-region.mjs <levelId> <x0> <y0> <x1> <y1> [--seed=N] [--scale=4]
//     [--url=...] [--out=file.png] [--ticks=N] (simulate N ticks first)
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const pos = args.filter((a) => !a.startsWith('--'));
const [id, x0, y0, x1, y1] = [pos[0], ...pos.slice(1, 5).map(Number)];
const url = opt('url', 'http://localhost:5173/');
const seed = Number(opt('seed', '7'));
const scale = Number(opt('scale', '4'));
const out = opt('out', `verify-out/region-${id}-${x0}-${y0}.png`);
const ticks = Number(opt('ticks', '0'));

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await startConsoleTestRun(page, { seed, level: id, settleMs: 300 });
const data = await page.evaluate(({ x0, y0, x1, y1, S, ticks }) => {
  const game = window.__game, ctx = game.ctx;
  for (let k = 0; k < ticks; k++) game.tick?.();
  const w = ctx.world;
  const W = (x1 - x0 + 1) * S, H = (y1 - y0 + 1) * S;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!w.inBounds(x, y)) continue;
    const c = w.colors[w.idx(x, y)];
    g.fillStyle = `rgb(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255})`;
    g.fillRect((x - x0) * S, (y - y0) * S, S, S);
  }
  const counts = {};
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.inBounds(x, y)) { const t = w.types[w.idx(x, y)]; counts[t] = (counts[t] ?? 0) + 1; }
  return { url: canvas.toDataURL('image/png'), counts };
}, { x0, y0, x1, y1, S: scale, ticks });
writeFileSync(out, Buffer.from(data.url.split(',')[1], 'base64'));
console.log(JSON.stringify({ out, counts: data.counts }));
await browser.close();

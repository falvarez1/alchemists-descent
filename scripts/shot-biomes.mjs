// Whole-world overview PNGs (1:4 downsample of the live colors plane) per
// depth, into verify-out/ — the worldgen eyeball pass. Usage:
//   node scripts/shot-biomes.mjs [seed] [url]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const seed = Number(process.argv[2] ?? 7);
const url = process.argv[3] ?? 'http://localhost:5173/';
const DEPTHS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'];
mkdirSync('verify-out', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

await page.evaluate((SEED) => {
  localStorage.removeItem('noita-expedition');
  window.__game.ctx.state.worldSeed = SEED;
  document.getElementById('mode-play-btn').click();
}, seed);
await page.waitForTimeout(1800);

for (const id of DEPTHS) {
  const dataUrl = await page.evaluate(async (ID) => {
    const ctx = window.__game.ctx;
    if (ID !== 'd1') {
      ctx.levels.leaveLevel();
      ctx.levels.enterLevel(ctx, ID);
      await new Promise((r) => setTimeout(r, 400));
    }
    const w = ctx.world;
    const DS = 4;
    const ow = Math.floor(w.width / DS), oh = Math.floor(w.height / DS);
    const canvas = document.createElement('canvas');
    canvas.width = ow; canvas.height = oh;
    const g = canvas.getContext('2d');
    const img = g.createImageData(ow, oh);
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const wi = x * DS + 2 + (y * DS + 2) * w.width;
        const c = w.colors[wi];
        const o = (x + y * ow) * 4;
        img.data[o] = (c >> 16) & 0xff;
        img.data[o + 1] = (c >> 8) & 0xff;
        img.data[o + 2] = c & 0xff;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // mark spawn
    const rt = ctx.levels.current;
    g.fillStyle = '#ff00ff';
    g.fillRect(rt.spawn.x / DS - 2, rt.spawn.y / DS - 2, 5, 5);
    return canvas.toDataURL('image/png');
  }, id);
  const b64 = dataUrl.split(',')[1];
  writeFileSync(`verify-out/world-${id}-seed${seed}.png`, Buffer.from(b64, 'base64'));
  console.log(`world overview ${id}`);
}
await browser.close();

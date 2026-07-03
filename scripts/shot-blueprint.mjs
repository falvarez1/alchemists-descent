// FULL-LEVEL blueprint PNGs: the whole cell grid rendered straight from the
// colors plane (no camera, no HUD, no lighting), with spawn/player dots and
// every inspection marker drawn as a labeled box. THE tool for judging
// whether a level is actually well-constructed — station crops through the
// game camera can never show the big picture. Usage:
//   node scripts/shot-blueprint.mjs [levelId ...] [--scale=N] [--url=...]
// Defaults to the three proving grounds. Output: verify-out/level-<id>.png
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = (args.find((a) => a.startsWith('--url=')) ?? '--url=http://localhost:5173/').slice(6);
const scale = Number((args.find((a) => a.startsWith('--scale=')) ?? '--scale=1').slice(8));
const ids = args.filter((a) => !a.startsWith('--'));
const LEVELS = ids.length > 0 ? ids : ['alchemy-test', 'gas-test', 'frost-test'];
mkdirSync('verify-out', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await startConsoleTestRun(page, { settleMs: 400 });

for (const id of LEVELS) {
  const dataUrl = await page.evaluate(
    async ({ ID, DS }) => {
      const ctx = window.__game.ctx;
      if (ctx.levels.current?.def?.id !== ID) {
        ctx.levels.leaveLevel();
        ctx.levels.enterLevel(ctx, ID);
        await new Promise((r) => setTimeout(r, 600));
      }
      const w = ctx.world;
      const ow = Math.floor(w.width / DS);
      const oh = Math.floor(w.height / DS);
      const canvas = document.createElement('canvas');
      canvas.width = ow;
      canvas.height = oh;
      const g = canvas.getContext('2d');
      const img = g.createImageData(ow, oh);
      for (let y = 0; y < oh; y++) {
        for (let x = 0; x < ow; x++) {
          const wi = Math.min(w.width - 1, x * DS) + Math.min(w.height - 1, y * DS) * w.width;
          const c = w.colors[wi];
          const o = (x + y * ow) * 4;
          img.data[o] = (c >> 16) & 0xff;
          img.data[o + 1] = (c >> 8) & 0xff;
          img.data[o + 2] = c & 0xff;
          img.data[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      const rt = ctx.levels.current;
      // inspection markers: labeled boxes = the level's own blueprint
      g.font = '10px monospace';
      for (const m of rt?.inspectionMarkers ?? []) {
        g.strokeStyle = 'rgba(255,220,120,0.9)';
        g.strokeRect(m.x0 / DS, m.y0 / DS, (m.x1 - m.x0) / DS, (m.y1 - m.y0) / DS);
        g.fillStyle = 'rgba(255,220,120,1)';
        g.fillText(m.label ?? '?', m.x0 / DS, m.y0 / DS - 2);
      }
      // spawn (magenta) + player (white)
      g.fillStyle = '#ff00ff';
      if (rt?.spawn) g.fillRect(rt.spawn.x / DS - 2, rt.spawn.y / DS - 2, 5, 5);
      g.fillStyle = '#ffffff';
      g.fillRect(ctx.player.x / DS - 2, ctx.player.y / DS - 2, 5, 5);
      // enemies (red)
      g.fillStyle = '#ff4040';
      for (const e of ctx.enemies) g.fillRect(e.x / DS - 1, e.y / DS - 1, 3, 3);
      return canvas.toDataURL('image/png');
    },
    { ID: id, DS: scale },
  );
  const b64 = dataUrl.split(',')[1];
  writeFileSync(`verify-out/level-${id}.png`, Buffer.from(b64, 'base64'));
  console.log(`blueprint verify-out/level-${id}.png`);
}
await browser.close();

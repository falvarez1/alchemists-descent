// Eyeball shots: a pooled marsh-gas pocket, then the same pocket mid-whoosh.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { getGameViewSize, startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
const viewSize = await getGameViewSize(page);
await startConsoleTestRun(page, { settleMs: 400 });

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 380; y <= 560; y++)
    for (let x = 500; x <= 900; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  const solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = 12; w.colors[i] = 0x555055;
      }
  };
  solid(520, 760, 410, 424); // rocky ceiling
  solid(520, 760, 536, 548); // floor
  ctx.enemies.length = 0;
  ctx.pickups.length = 0;
  const p = ctx.player;
  p.hp = p.maxHp = 1e6;
  p.x = 550; p.y = 532;
  ctx.params.global.ambient = 0.5;
  ctx.camera.snapTo(640, 470);
  // a hand-pooled pocket like worldgen makes
  for (let x = 580; x <= 700; x++) {
    const depth = Math.max(2, Math.round(6 * (1 - Math.abs(x - 640) / 65)));
    for (let dy = 0; dy < depth; dy++) {
      const i = w.idx(x, 425 + dy);
      if (w.types[i] === 0) {
        const g = 138 + ((Math.random() * 26) | 0);
        w.types[i] = 38;
        w.colors[i] = ((128 + ((Math.random() * 26) | 0)) << 16) | (g << 8) | (66 + ((Math.random() * 20) | 0));
      }
    }
  }
});
await page.waitForTimeout(1200);
const shot = async (name) => {
  const clip = await page.evaluate(({ view }) => {
    const c = document.querySelector('#canvas-holder > canvas');
    const r = c.getBoundingClientRect();
    const cam = window.__game.ctx.camera;
    const ux = ((640 - cam.renderX) / view.w - 0.5) * cam.zoom + 0.5;
    const uy = ((460 - cam.renderY) / view.h - 0.5) * cam.zoom + 0.5;
    return {
      x: Math.max(0, r.left + ux * r.width - 300),
      y: Math.max(0, r.top + uy * r.height - 180),
      width: 600,
      height: 360,
    };
  }, { view: viewSize });
  await page.screenshot({ path: `verify-out/gas-${name}.png`, clip });
  console.log('shot', name);
};
await shot('pooled');
await page.evaluate(() => {
  const w = window.__game.ctx.world;
  const i = w.idx(585, 426);
  w.types[i] = 5; w.colors[i] = 0xff4600; w.life[i] = 40;
});
await page.waitForTimeout(320);
await shot('whoosh');
await browser.close();

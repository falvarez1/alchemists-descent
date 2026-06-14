// One-off zoomed pose shots for eyeballing crawl + wall-grab sprites.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
await startConsoleTestRun(page, { settleMs: 400 });

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 400; y <= 540; y++)
    for (let x = 500; x <= 760; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  const solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = 13; w.colors[i] = 0x7a8a99;
      }
  };
  solid(500, 760, 536, 540);
  ctx.enemies.length = 0;
  const p = ctx.player;
  p.x = 620; p.y = 535; p.vx = 0; p.vy = 0; p.hp = p.maxHp; p.invuln = 30000;
  ctx.params.global.ambient = 0.5;
  ctx.camera.zoomLock = 2.6;
  ctx.input.mouse.x = p.x + 40;
  ctx.input.mouse.y = p.y - 4;
});
const key = (code, down) =>
  page.evaluate(({ code, down }) => {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
  }, { code, down });
const shot = async (name) => {
  await page.evaluate(() => {
    window.__game.ctx.particles.clear();
    window.__game.ctx.state.paused = true;
  });
  const clip = await page.evaluate(() => {
    const c = document.querySelector('#canvas-holder > canvas');
    const r = c.getBoundingClientRect();
    const ctx = window.__game.ctx;
    const z = ctx.camera.zoom;
    const ux = (((ctx.player.x - ctx.camera.renderX) / 525 - 0.5) * z + 0.5);
    const uy = (((ctx.player.y - 9 - ctx.camera.renderY) / 357 - 0.5) * z + 0.5);
    return {
      x: Math.max(0, r.left + ux * r.width - 130),
      y: Math.max(0, r.top + uy * r.height - 130),
      width: 260,
      height: 260,
    };
  });
  await page.screenshot({ path: `verify-out/crawlpose-${name}.png`, clip });
  await page.evaluate(() => { window.__game.ctx.state.paused = false; });
};

// mid-crawl, moving right
await key('KeyS', true);
await key('KeyD', true);
await page.waitForTimeout(700);
await shot('crawl-right');
await key('KeyD', false);
await page.waitForTimeout(300);
await shot('crawl-still');
await key('KeyS', false);
await page.waitForTimeout(500);

// wall grab
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = 13; w.colors[i] = 0x7a8a99;
      }
  };
  solid(700, 760, 420, 540);
  solid(698, 699, 470, 470);
  const p = ctx.player;
  p.x = 695; p.y = 469; p.vx = 0; p.vy = 0;
  ctx.camera.snapTo(680, 460);
});
await page.waitForTimeout(800);
await shot('wallgrab');

await browser.close();
console.log('shots written');

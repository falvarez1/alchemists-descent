// One-off: magnified close-up of the wizard with the wand level, for
// judging the wand drop-shadow. deviceScaleFactor 3 = 3x detail.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2000);
await startConsoleTestRun(page, { settleMs: 400 });

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 400; y <= 540; y++)
    for (let x = 500; x <= 760; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  for (let y = 536; y <= 540; y++)
    for (let x = 500; x <= 760; x++) {
      const i = w.idx(x, y);
      w.types[i] = 13; w.colors[i] = 0x7a8a99;
    }
  const p = ctx.player;
  p.x = 630; p.y = 534; p.vx = 0; p.vy = 0; p.hp = p.maxHp;
  ctx.projectiles.length = 0;
  ctx.particles.clear();
  ctx.params.global.ambient = 0.45;
  // aim up-right into dark air so the staff isn't swallowed by floor bloom
  ctx.input.mouse.x = 690;
  ctx.input.mouse.y = p.y - 70;
});
await page.waitForTimeout(100);
await page.evaluate(() => { window.__game.ctx.state.paused = true; });
// camera.update runs through the pause — let it converge on the frozen player
await page.waitForTimeout(800);

const clip = await page.evaluate(() => {
  const c = document.querySelector('#canvas-holder > canvas');
  const r = c.getBoundingClientRect();
  const ctx = window.__game.ctx;
  const z = ctx.camera.zoom;
  const ux = ((ctx.player.x - ctx.camera.renderX) / 525 - 0.5) * z + 0.5;
  const uy = ((ctx.player.y - 9 - ctx.camera.renderY) / 357 - 0.5) * z + 0.5;
  return {
    x: Math.max(0, r.left + ux * r.width - 80),
    y: Math.max(0, r.top + uy * r.height - 110),
    width: 220,
    height: 190,
  };
});
await page.screenshot({ path: 'verify-out/wand-closeup.png', clip });
await browser.close();
console.log('saved verify-out/wand-closeup.png');

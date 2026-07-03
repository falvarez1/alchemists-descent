// One-off: full-canvas view of the alchemy shrine wing, no clip guesswork.
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
  ctx.levels.leaveLevel();
  ctx.levels.enterLevel(ctx, 'alchemy-test');
});
await page.waitForTimeout(900);
const info = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.player.x = 1225;
  ctx.player.y = 636;
  ctx.player.vx = 0; ctx.player.vy = 0;
  ctx.camera.snapTo(1140, 575);
  return { secret: ctx.state.secretReaction };
});
console.log('secret pair:', JSON.stringify(info.secret));
await page.waitForTimeout(700);
const box = await page.evaluate(() => {
  const r = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
});
await page.screenshot({ path: 'verify-out/shrine-full.png', clip: box });
console.log('shot verify-out/shrine-full.png');
await browser.close();

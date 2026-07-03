// EYEBALL the proving grounds: enter each arena and screenshot every station
// so the layout is judged by looking, not by cell counts.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { getGameViewSize, startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
const viewSize = await getGameViewSize(page);
await startConsoleTestRun(page, { settleMs: 400 });

const shotAt = async (name, wx, wy) => {
  await page.evaluate(({ wx, wy }) => {
    const ctx = window.__game.ctx;
    ctx.player.x = wx;
    ctx.player.y = wy;
    ctx.player.vx = 0; ctx.player.vy = 0;
    ctx.camera.snapTo(wx, wy - 40);
  }, { wx, wy });
  await page.waitForTimeout(700);
  const clip = await page.evaluate(({ wx, wy, view }) => {
    const c = document.querySelector('#canvas-holder > canvas');
    const r = c.getBoundingClientRect();
    const cam = window.__game.ctx.camera;
    const ux = ((wx - cam.renderX) / view.w - 0.5) * cam.zoom + 0.5;
    const uy = ((wy - 50 - cam.renderY) / view.h - 0.5) * cam.zoom + 0.5;
    const cx = Math.max(0, Math.min(1500 - 760, r.left + ux * r.width - 380));
    const cy = Math.max(0, Math.min(900 - 440, r.top + uy * r.height - 220));
    return { x: cx, y: cy, width: 760, height: 440 };
  }, { wx, wy, view: viewSize });
  await page.screenshot({ path: `verify-out/grounds-${name}.png`, clip });
  console.log('shot', name);
};

const enter = (id) =>
  page.evaluate((id) => {
    const ctx = window.__game.ctx;
    ctx.levels.leaveLevel();
    ctx.levels.enterLevel(ctx, id);
  }, id);

await enter('gas-test');
await page.waitForTimeout(900);
await shotAt('gas-torch', 300, 636);
await shotAt('gas-seam', 780, 550);
await shotAt('gas-clean', 1250, 500);

await enter('alchemy-test');
await page.waitForTimeout(900);
await shotAt('alch-tubs', 400, 636);
await shotAt('alch-secret', 1170, 636);

await enter('frost-test');
await page.waitForTimeout(900);
await shotAt('frost-lake', 620, 600);

await browser.close();

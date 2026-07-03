// Watch the fuse run burn: per-second powder/fire counts + rightmost powder
// column, and a final screenshot of the station.
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
await startConsoleTestRun(page, { settleMs: 400 });
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.levels.leaveLevel();
  ctx.levels.enterLevel(ctx, 'gas-test');
});
await page.waitForTimeout(1200);

const state = () =>
  page.evaluate(() => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    let powder = 0;
    let fire = 0;
    let wood = 0;
    let rightmost = -1;
    for (let y = 620; y <= 655; y++)
      for (let x = 360; x <= 600; x++) {
        const t = w.types[w.idx(x, y)];
        if (t === 8) { powder++; if (x > rightmost) rightmost = x; }
        else if (t === 5) fire++;
        else if (t === 4) wood++;
      }
    return { powder, fire, wood, rightmost };
  });

console.log('t0', JSON.stringify(await state()));
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  ctx.player.x = 220;
  ctx.player.y = 638;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
  ctx.camera.snapTo(460, 570);
  const i = w.idx(371, 639);
  w.types[i] = 11;
  w.colors[i] = 0xfa4600;
});
for (let t = 1; t <= 12; t++) {
  await page.waitForTimeout(1000);
  console.log(`t${t}`, JSON.stringify(await state()));
}
const box = await page.evaluate(() => {
  const r = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
});
await page.screenshot({ path: 'verify-out/fuse-aftermath.png', clip: box });
console.log('shot verify-out/fuse-aftermath.png');
await browser.close();

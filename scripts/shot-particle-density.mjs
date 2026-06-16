// Visualize particle density: screenshot the real game at several live particle
// counts so 4,200 (the current MAX_PARTICLES cap) becomes intuitable.
// Usage: node scripts/shot-particle-density.mjs
import { chromium } from 'playwright-core';
import { newBenchmarkPage, captureCanvasPng } from './perf-harness.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await newBenchmarkPage(browser, { diagnosticsLabel: 'particle-density' });
page.on('pageerror', (e) => console.error('PAGE ERROR:', String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await startConsoleTestRun(page, { seed: 777, settleMs: 1200 });

async function scatterShot(count, label) {
  await page.evaluate((n) => {
    const ctx = window.__game.ctx;
    ctx.particles.clear();
    // TS `private` is compile-time only — raise the live cap to visualize >4200
    // without editing the shipped MAX_PARTICLES const.
    ctx.particles.pool.max = Math.max(n + 1000, 4200);
    const w = ctx.world;
    const cx = Math.floor(ctx.camera.x), cy = Math.floor(ctx.camera.y);
    const VW = 525, VH = 357;
    let placed = 0;
    // spawn only into EMPTY cells (debris lives in air; avoids terrain culling)
    for (let attempt = 0; attempt < n * 8 && placed < n; attempt++) {
      const x = cx + (Math.random() * VW | 0);
      const y = cy + (Math.random() * VH | 0);
      if (!w.inBounds(x, y) || w.types[w.idx(x, y)] !== 0) continue;
      const spark = Math.random() < 0.6;
      const r = spark ? 255 : 130 + (Math.random() * 90 | 0);
      const g = spark ? 150 + (Math.random() * 80 | 0) : 35 + (Math.random() * 30 | 0);
      const b = spark ? 35 : 32 + (Math.random() * 20 | 0);
      const color = (r << 16) | (g << 8) | b;
      ctx.particles.spawn(x + 0.5, y + 0.5, 0, 0, null, color, 99999, { grav: 0, glow: spark ? 1.4 : 0.8 });
      placed++;
    }
  }, count);
  await page.waitForTimeout(60);
  const live = await page.evaluate(() => window.__game.ctx.particles.list.length);
  const path = `verify-out/particles-${label}.png`;
  await captureCanvasPng(page, path);
  console.log(`${label}: requested ${count}, live ${live} -> ${path}`);
}

// realistic chaos: explosions around the player, screenshot at peak debris
async function chaosShot() {
  const live = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    ctx.particles.clear();
    const px = Math.floor(ctx.player.x), py = Math.floor(ctx.player.y);
    ctx.player.hp = 999999; ctx.player.invuln = 999999;
    for (let k = 0; k < 14; k++) {
      const ang = (k / 14) * Math.PI * 2;
      ctx.explosions.trigger(px + Math.cos(ang) * 38, py + Math.sin(ang) * 30 - 6, 11);
    }
    // let debris spawn and spread a few frames
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return ctx.particles.list.length;
  });
  await page.waitForTimeout(60);
  const live2 = await page.evaluate(() => window.__game.ctx.particles.list.length);
  await captureCanvasPng(page, 'verify-out/particles-chaos.png');
  console.log(`chaos: live ${live}->${live2} (explosion debris) -> verify-out/particles-chaos.png`);
}

await scatterShot(4200, '4k2-cap');
await scatterShot(12000, '12k');
await scatterShot(25000, '25k');
await chaosShot();

await page.context().close();
await browser.close();

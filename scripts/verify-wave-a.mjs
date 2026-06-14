// Wave A runtime probes: flask siphon/pour/throw, perf HUD, movement feel.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const canvasBox = await page.locator('#canvas-holder > canvas').boundingBox();
const cx = canvasBox.x + canvasBox.width / 2;
const cy = canvasBox.y + canvasBox.height / 2;

await startConsoleTestRun(page, { settleMs: 1200 });

// Seed a generous runtime water pool near the screen area used by the siphon probe.
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const px = Math.floor(ctx.player.x);
  const py = Math.floor(ctx.player.y);
  const x0 = px - 95;
  const x1 = px + 80;
  const y0 = py - 48;
  const y1 = py - 16;
  for (let y = y0 - 6; y <= y1 + 4; y++) {
    for (let x = x0 - 4; x <= x1 + 4; x++) {
      if (!w.inBounds(x, y)) continue;
      const i = w.idx(x, y);
      w.types[i] = 0;
      w.colors[i] = 0;
      w.life[i] = 0;
      w.charge[i] = 0;
    }
  }
  for (let x = x0; x <= x1; x++) {
    const floor = w.idx(x, y1 + 1);
    w.types[floor] = 13;
    w.colors[floor] = 0x7a8a99;
    for (let y = y0; y <= y1; y++) {
      const i = w.idx(x, y);
      w.types[i] = 2;
      w.colors[i] = 0x1e8ce6;
    }
  }
  for (let y = y0; y <= y1 + 1; y++) {
    for (const x of [x0 - 1, x1 + 1]) {
      const i = w.idx(x, y);
      w.types[i] = 13;
      w.colors[i] = 0x7a8a99;
    }
  }
  ctx.camera.snapTo(ctx.player.x, ctx.player.y);
});
await page.waitForTimeout(800);

// --- Probe 1: siphon water with E held at the cursor over the pool ---
// Wizard spawns near world center; the painted pool was near the camera center,
// so aim the cursor around mid-screen and sweep while holding E.
const flaskBefore = await page.evaluate(() => document.getElementById('flask-fill')?.style.width);
await page.keyboard.down('e');
for (let i = 0; i < 30; i++) {
  await page.mouse.move(cx - 70 + (i % 14) * 10, cy - 60 + (i % 5) * 14);
  await page.waitForTimeout(50);
}
await page.keyboard.up('e');
const flaskAfter = await page.evaluate(() => document.getElementById('flask-fill')?.style.width);
console.log('flask width before/after siphon:', flaskBefore, '->', flaskAfter);
await page.screenshot({ path: 'verify-out/wave-a-1-siphoned.png' });

// --- Probe 2: pour (Q) ---
await page.keyboard.down('q');
await page.waitForTimeout(900);
await page.keyboard.up('q');
const flaskAfterPour = await page.evaluate(() => document.getElementById('flask-fill')?.style.width);
console.log('flask width after pour:', flaskAfterPour);

// --- Probe 3: throw (F) — remaining contents shatter somewhere downrange ---
await page.mouse.move(cx + 150, cy - 80);
await page.keyboard.press('f');
await page.waitForTimeout(1200);
const flaskAfterThrow = await page.evaluate(() => document.getElementById('flask-fill')?.style.width);
console.log('flask width after throw:', flaskAfterThrow);
await page.screenshot({ path: 'verify-out/wave-a-2-after-throw.png' });

// --- Probe 4: throw with empty flask (should be a no-op, no errors) ---
await page.keyboard.press('f');
await page.waitForTimeout(300);

// --- Probe 5: perf HUD toggle ---
await page.keyboard.press('F3');
await page.waitForTimeout(700);
const perfVisible = await page.evaluate(() => {
  const els = [...document.querySelectorAll('div')].filter((d) => /fps/.test(d.textContent || '') && d.style.position === 'fixed');
  return els.length > 0 ? els[0].textContent : null;
});
console.log('perf hud:', perfVisible);
await page.screenshot({ path: 'verify-out/wave-a-3-perfhud.png' });
await page.keyboard.press('F3');

// --- Probe 6: movement still sane (run + jump around for a bit) ---
for (let i = 0; i < 3; i++) {
  await page.keyboard.down('d');
  await page.waitForTimeout(400);
  await page.keyboard.up('d');
  await page.keyboard.press('Space');
  await page.keyboard.down('a');
  await page.waitForTimeout(400);
  await page.keyboard.up('a');
}
const hp = await page.evaluate(() => document.getElementById('hp-fill')?.style.width);
console.log('hp after movement:', hp);

// --- Probe 7: telemetry persisted ---
const telemetry = await page.evaluate(() => localStorage.getItem('noita-telemetry'));
console.log('telemetry:', telemetry);

console.log('page errors:', pageErrors.length ? JSON.stringify(pageErrors) : 'none');
await browser.close();

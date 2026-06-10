// Wave A runtime probes: flask siphon/pour/throw, perf HUD, movement feel.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

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

// Paint a generous pool of water in build mode near the center.
await page.click('button.tool-btn[data-id="2"]');
await page.mouse.move(cx - 60, cy - 40);
await page.mouse.down();
for (let i = 0; i <= 12; i++) await page.mouse.move(cx - 60 + i * 10, cy - 40, { steps: 2 });
await page.mouse.up();
await page.waitForTimeout(1500); // let it pool

// Enter play mode.
await page.click('#mode-play-btn');
await page.waitForTimeout(2000);

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

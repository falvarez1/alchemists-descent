// Runtime verification: drive the game in headless Edge via playwright-core.
// Usage: node scripts/verify-game.mjs [url]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = 'verify-out';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

console.log('navigating to', url);
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3500); // let worldgen + a few hundred frames run

// --- 1) Build mode: world rendered? ---
await page.screenshot({ path: `${outDir}/01-build-mode.png` });

// Sample canvas pixels: a black screen means the sim/render path is broken.
// drawImage inside rAF (after the game's render callback) captures the GL
// canvas without needing preserveDrawingBuffer.
const samplePixels = () =>
  page.evaluate(
    () =>
      new Promise((res) => {
        requestAnimationFrame(() => {
          const glCanvas = document.querySelector('#canvas-holder > canvas');
          if (!glCanvas) return res({ error: 'no canvas' });
          const c2 = document.createElement('canvas');
          c2.width = glCanvas.width;
          c2.height = glCanvas.height;
          const g = c2.getContext('2d');
          g.drawImage(glCanvas, 0, 0);
          const d = g.getImageData(0, 0, c2.width, c2.height).data;
          let nonBlack = 0;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) {
            const v = d[i] + d[i + 1] + d[i + 2];
            sum += v;
            if (v > 30) nonBlack++;
          }
          const total = d.length / 4;
          res({
            w: c2.width,
            h: c2.height,
            nonBlackPct: ((nonBlack / total) * 100).toFixed(1),
            avg: (sum / total / 3).toFixed(1),
          });
        });
      }),
  );
console.log('canvas pixels (build):', JSON.stringify(await samplePixels()));

// --- 2) Paint water with the brush (click-drag on the canvas) ---
await page.click('button.tool-btn[data-id="2"]'); // Water
const canvasBox = await page.locator('#canvas-holder > canvas').boundingBox();
const cx = canvasBox.x + canvasBox.width / 2;
const cy = canvasBox.y + canvasBox.height / 3;
await page.mouse.move(cx - 80, cy);
await page.mouse.down();
for (let i = 0; i <= 10; i++) await page.mouse.move(cx - 80 + i * 16, cy, { steps: 2 });
await page.mouse.up();
await page.waitForTimeout(1200); // let it flow
await page.screenshot({ path: `${outDir}/02-painted-water.png` });
console.log('painted water stroke');

// --- 3) Generate caves for a different biome (UI wiring check) ---
await page.selectOption('#biome-select', 'frozen');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/03-frozen-biome.png` });
console.log('switched biome to frozen');

// --- 4) PLAY mode ---
await page.click('#mode-play-btn');
await page.waitForTimeout(2500);
const hudState = await page.evaluate(() => ({
  hudVisible: document.getElementById('game-hud')?.classList.contains('visible'),
  playActive: document.body.classList.contains('play-active'),
  hotbarSlots: document.querySelectorAll('#spell-hotbar .hot-slot').length,
  waveNum: document.getElementById('wave-num')?.textContent,
  enemiesLeft: document.getElementById('enemies-left')?.textContent,
  hpWidth: document.getElementById('hp-fill')?.style.width,
}));
console.log('play mode state:', JSON.stringify(hudState));
await page.screenshot({ path: `${outDir}/04-play-mode.png` });

// --- 5) Move + jump + fire a spark bolt at the terrain ---
await page.keyboard.down('d');
await page.waitForTimeout(700);
await page.keyboard.up('d');
await page.keyboard.press('Space');
await page.waitForTimeout(400);
await page.mouse.move(cx + 120, cy + 60);
await page.mouse.down();
await page.waitForTimeout(350);
await page.mouse.up();
await page.waitForTimeout(900);
await page.screenshot({ path: `${outDir}/05-play-fired-bolt.png` });
console.log('moved, jumped, fired');

// --- 6) Spell hotkey switch + flamethrower hold ---
await page.keyboard.press('4'); // flamethrower
await page.mouse.move(cx - 140, cy - 40);
await page.mouse.down();
await page.waitForTimeout(900);
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/06-flamethrower.png` });
console.log('flamethrower burst done');

// --- 7) Probe: TAB back to build mid-action, then back to play ---
await page.keyboard.press('Tab');
await page.waitForTimeout(400);
const backInBuild = await page.evaluate(() => !document.body.classList.contains('play-active'));
await page.keyboard.press('Tab');
await page.waitForTimeout(600);
const backInPlay = await page.evaluate(() => document.body.classList.contains('play-active'));
console.log('tab toggle: backInBuild=', backInBuild, 'backInPlay=', backInPlay);
await page.screenshot({ path: `${outDir}/07-after-tab-roundtrip.png` });

// --- 8) FPS sample ---
const fps = await page.evaluate(
  () =>
    new Promise((res) => {
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else res((frames / (performance.now() - t0)) * 1000);
      };
      requestAnimationFrame(tick);
    }),
);
console.log('fps over 2s:', fps.toFixed(1));

console.log('--- console errors:', consoleErrors.length ? JSON.stringify(consoleErrors, null, 1) : 'none');
console.log('--- page errors:', pageErrors.length ? JSON.stringify(pageErrors, null, 1) : 'none');

await browser.close();

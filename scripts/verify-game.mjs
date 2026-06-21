// Runtime verification: drive the game in headless Chromium via playwright-core.
// Usage: node scripts/verify-game.mjs [url]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError, waitForRunReady } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = 'verify-out';
mkdirSync(outDir, { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' && !isBenignDevConsoleError(msg.text())) consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

function assertCanvasSample(label, sample, minNonBlackPct = 1, minAvg = 2) {
  if (sample?.error) throw new Error(`${label} canvas sample failed: ${sample.error}`);
  const nonBlackPct = Number(sample?.nonBlackPct);
  const avg = Number(sample?.avg);
  if (!Number.isFinite(nonBlackPct) || !Number.isFinite(avg)) {
    throw new Error(`${label} canvas sample was malformed: ${JSON.stringify(sample)}`);
  }
  if (nonBlackPct < minNonBlackPct || avg < minAvg) {
    throw new Error(
      `${label} canvas appears blank: nonBlackPct=${nonBlackPct.toFixed(1)} avg=${avg.toFixed(1)}`,
    );
  }
}

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

async function waitForCanvasSample(label, minNonBlackPct = 1, minAvg = 2, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastSample = null;
  let lastError = null;
  while (Date.now() < deadline) {
    lastSample = await samplePixels();
    try {
      assertCanvasSample(label, lastSample, minNonBlackPct, minAvg);
      return lastSample;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(250);
    }
  }
  if (lastError) throw lastError;
  throw new Error(`${label} canvas sample timed out: ${JSON.stringify(lastSample)}`);
}

const buildPixels = await waitForCanvasSample('build mode');
console.log('canvas pixels (build):', JSON.stringify(buildPixels));

// --- 2) Paint water with the brush (click-drag on the canvas) ---
await page.click('button.tool-btn[data-id="2"]'); // Water
const canvasBox = await page.locator('#canvas-holder > canvas').boundingBox();
if (!canvasBox) throw new Error('Game canvas has no visible bounding box.');
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
await page.waitForSelector('#run-launcher.visible', { timeout: 5000 });
await page.click('#run-launcher .run-launcher-start');
await page.waitForFunction(() => document.body.classList.contains('play-active'), null, { timeout: 30000 });
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
if (!hudState.hudVisible || !hudState.playActive || hudState.hotbarSlots <= 0) {
  throw new Error('Play launcher did not enter a usable play mode: ' + JSON.stringify(hudState));
}
await page.screenshot({ path: `${outDir}/04-play-mode.png` });
const playPixels = await waitForCanvasSample('play mode');
console.log('canvas pixels (play):', JSON.stringify(playPixels));

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
await page.waitForSelector('#run-launcher.visible', { timeout: 5000 });
await page.evaluate(() => document.querySelector('#run-launcher [data-action="continue"]')?.click());
await waitForRunReady(page);
const backInPlay = await page.evaluate(() => document.body.classList.contains('play-active'));
console.log('tab toggle: backInBuild=', backInBuild, 'backInPlay=', backInPlay);
if (!backInBuild || !backInPlay) throw new Error('TAB launcher roundtrip failed.');
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
if (fps < 10) throw new Error(`FPS probe too low; render loop may be stalled (${fps.toFixed(1)} fps).`);

console.log('--- console errors:', consoleErrors.length ? JSON.stringify(consoleErrors, null, 1) : 'none');
console.log('--- page errors:', pageErrors.length ? JSON.stringify(pageErrors, null, 1) : 'none');

await browser.close();
if (consoleErrors.length > 0 || pageErrors.length > 0) {
  throw new Error(`Runtime errors during verification: console=${consoleErrors.length} page=${pageErrors.length}`);
}

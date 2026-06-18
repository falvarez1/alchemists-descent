// Verifies the two new Pixel Scene Editor features: (1) GEN TILE generates a chunk
// with the scene placed and previews it, and (2) hovering a pixel shows its material
// readout. Usage: node scripts/verify-scene-editor-tile.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};
const litCount = (page) => page.$eval('#pse-canvas', (c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 11) + Math.abs(d[i + 1] - 11) + Math.abs(d[i + 2] - 15) > 20) n++;
  return { lit: n, w: c.width, h: c.height };
});

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx, { timeout: 20000 });
await page.evaluate(() => sessionStorage.setItem('ad-mode', 'builder'));
await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => document.body.classList.contains('builder-open'), { timeout: 20000 });
await page.waitForSelector('#b-scene-editor', { timeout: 10000, state: 'attached' });
await page.$eval('#b-scene-editor', (b) => b.click());
await page.waitForSelector('#pse-overlay:not([hidden])', { timeout: 8000 });

// Load a built-in scene with painted cells + a light.
const shrine = await page.$('#pse-builtin .pse-scene-row[data-id="scene-shrine"]');
if (shrine) await shrine.click();
else await page.$eval('#pse-builtin .pse-scene-row', (el) => el.click());
await page.waitForTimeout(200);

// ---- material hover readout (edit mode) ------------------------------------
let box = await (await page.$('#pse-canvas')).boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7); // over the shrine floor
await page.waitForTimeout(120);
const hoverShown = await page.$eval('#pse-hover', (el) => !el.hidden).catch(() => false);
const hoverText = await page.$eval('#pse-hover', (el) => el.textContent || '').catch(() => '');
check('hovering a pixel shows the material readout', hoverShown && /rgb|#\d/.test(hoverText), `text="${hoverText.slice(0, 50)}"`);
check('readout names a material (id + rgb)', /#\d+/.test(hoverText) && /rgb \d/.test(hoverText), hoverText.slice(0, 60));

// ---- GEN TILE: scene generated into a chunk --------------------------------
const before = await litCount(page);
await page.$eval('#pse-tile', (b) => b.click());
await page.waitForTimeout(400);
const tileActive = await page.$eval('#pse-tile', (b) => b.classList.contains('active')).catch(() => false);
check('GEN TILE switches to tile-preview mode', tileActive);
const after = await litCount(page);
check('the tile preview is a square chunk render (not the scene canvas)', after.w === after.h && after.w !== before.w, `before=${before.w} after=${after.w}x${after.h}`);
check('the generated tile renders cave + scene (non-blank)', after.lit > 5000, `litAfter=${after.lit}`);

// Changing biome regenerates without error.
await page.selectOption('#pse-tile-biome', 'volcanic').catch(() => {});
await page.waitForTimeout(300);
const volc = await litCount(page);
check('changing the tile biome regenerates', volc.lit > 1000, `lit=${volc.lit}`);

// ---- material hover in tile mode (reads the generated chunk) ---------------
box = await (await page.$('#pse-canvas')).boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(120);
const tileHover = await page.$eval('#pse-hover', (el) => (!el.hidden ? el.textContent || '' : '')).catch(() => '');
check('hover works in tile mode (reads the chunk material)', /#\d+/.test(tileHover), tileHover.slice(0, 50));

// Back to edit.
await page.$eval('#pse-tile', (b) => b.click());
await page.waitForTimeout(150);
const backToEdit = await page.$eval('#pse-tile', (b) => !b.classList.contains('active')).catch(() => false);
check('toggling GEN TILE returns to edit mode', backToEdit);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\nscene-editor-tile probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

// Drives the Pixel Scene Editor: opens the Builder, opens the editor, paints a
// cell on the canvas, toggles lit preview, saves to the user library, and checks
// validation — no errors. Usage: node scripts/verify-scene-editor.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx, { timeout: 20000 });
await page.evaluate(() => { sessionStorage.setItem('ad-mode', 'builder'); try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('ad:pixelscene:')) localStorage.removeItem(k); } } catch {} });
await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => document.body.classList.contains('builder-open'), { timeout: 20000 });
await page.waitForSelector('#b-scene-editor', { timeout: 10000, state: 'attached' });

await page.$eval('#b-scene-editor', (b) => b.click());
const opened = await page.waitForSelector('#pse-overlay:not([hidden])', { timeout: 8000 }).then(() => true).catch(() => false);
check('Pixel Scene Editor opens', opened);

const swatches = await page.$$eval('#pse-palette .pse-swatch', (e) => e.length).catch(() => 0);
check('cell palette renders', swatches >= 10, `swatches=${swatches}`);
const builtin = await page.$$eval('#pse-builtin .pse-scene-row', (e) => e.length).catch(() => 0);
check('built-in library lists scenes', builtin >= 15, `builtin=${builtin}`);

// Start blank, select Wall, paint at the canvas centre, confirm a cell got painted.
await page.$eval('#pse-new', (b) => b.click());
await page.$eval('#pse-palette .pse-swatch[data-cell="3"]', (b) => b.click()); // Wall=3
const box = await (await page.$('#pse-canvas')).boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2);
await page.mouse.up();
await page.waitForTimeout(120);
const litPx = await page.$eval('#pse-canvas', (c) => {
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let painted = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - 11) + Math.abs(d[i + 1] - 11) + Math.abs(d[i + 2] - 15) > 20) painted++;
  }
  return painted;
}).catch(() => 0);
check('painting on the canvas marks cells', litPx > 0, `paintedPx=${litPx}`);

// Lit toggle should not throw and should keep/grow lit pixels.
await page.$eval('#pse-lit', (b) => b.click());
await page.waitForTimeout(80);
const litOn = await page.$eval('#pse-lit', (b) => b.classList.contains('active')).catch(() => false);
check('lit preview toggles', litOn === true);

// Validation panel should report something (the blank-but-painted scene has hints).
const warns = await page.$$eval('#pse-warns .pse-warn', (e) => e.length).catch(() => 0);
check('validation panel populates', warns >= 1, `warns=${warns}`);

// Name + save creates a user-library entry.
await page.$eval('#pse-name', (el) => { el.value = 'Probe Scene'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.$eval('#pse-save', (b) => b.click());
await page.waitForTimeout(150);
const userRows = await page.$$eval('#pse-user .pse-scene-row', (e) => e.length).catch(() => 0);
const stored = await page.evaluate(() => { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('ad:pixelscene:')) n++; } return n; });
check('save writes a user scene to the library', userRows >= 1 && stored >= 1, `rows=${userRows} stored=${stored}`);

await page.keyboard.press('Escape');
const closed = await page.$eval('#pse-overlay', (el) => el.hidden).catch(() => false);
check('Escape closes the editor', closed === true);

check('no page errors while driving the editor', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.evaluate(() => { try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('ad:pixelscene:')) localStorage.removeItem(k); } } catch {} });
console.log(`\nscene-editor probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

// Verifies the visual (per-pixel colour) + background layers in the Pixel Scene
// Editor. Usage: node scripts/verify-scene-layers.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};
const setColor = (page, hex) => page.$eval('#pse-color', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, hex);
const pickTool = (page, t) => page.$eval(`#pse-toolrow button[data-tool="${t}"]`, (b) => b.click());
const centerPx = async (page) => {
  const box = await (await page.$('#pse-canvas')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(60);
  return page.$eval('#pse-canvas', (c) => {
    const cx = Math.floor(c.width / 2), cy = Math.floor(c.height / 2);
    const d = c.getContext('2d').getImageData(cx, cy, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  });
};

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
await page.$eval('#pse-new', (b) => b.click());

// 1) BG tool: paint a red background on an empty cell -> the canvas shows red there.
await setColor(page, '#ff2020');
await pickTool(page, 'bg');
let px = await centerPx(page);
check('BG layer paints behind empty cells', px.r > 150 && px.g < 90 && px.b < 90, JSON.stringify(px));

// 2) Paint a Wall over it -> the material covers the background.
await pickTool(page, 'paint');
await page.$eval('#pse-palette .pse-swatch[data-cell="3"]', (b) => b.click()); // Wall
px = await centerPx(page);
check('material covers the background', px.r < 120 && Math.abs(px.r - px.g) < 30, JSON.stringify(px));

// 3) Color (visual) tool: recolour that wall green -> the cell reads green.
await setColor(page, '#20ff20');
await pickTool(page, 'color');
px = await centerPx(page);
check('Color (visual) tool recolours the pixel', px.g > 150 && px.r < 120 && px.b < 120, JSON.stringify(px));

// 4) Eyedropper picks the colour back into the picker.
await pickTool(page, 'eyedrop');
const box = await (await page.$('#pse-canvas')).boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(60);
const hex = await page.$eval('#pse-color-hex', (el) => el.textContent || '');
const gChan = parseInt(hex.slice(2, 4), 16);
check('eyedropper picks the cell colour into the picker', /^[0-9A-F]{6}$/.test(hex) && gChan > 150, `hex=${hex}`);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\nscene-layers probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

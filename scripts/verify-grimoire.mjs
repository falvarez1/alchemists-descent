// Focused Grimoire/examine probe.
// Usage: node scripts/verify-grimoire.mjs [url]  (dev server running)
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;

const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (dialog) => dialog.dismiss().catch(() => undefined));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.world, { timeout: 20000 });

await page.evaluate(() => {
  localStorage.removeItem('noita-grimoire');
  localStorage.removeItem('noita-grimoire-lore');
  const ctx = window.__game.ctx;
  const world = ctx.world;
  const water = world.idx(40, 40);
  world.types[water] = 2;
  world.colors[water] = 0x367ed0;
  const lava = world.idx(42, 40);
  world.types[lava] = 11;
  world.colors[lava] = 0xff5f18;
  ctx.input.mouse.x = 40;
  ctx.input.mouse.y = 40;
});

await page.keyboard.press('KeyI');
await page.waitForFunction(() => {
  const raw = localStorage.getItem('noita-grimoire');
  return raw && JSON.parse(raw).materials?.['2'] === true;
}, null, { timeout: 5000 });

let state = await page.evaluate(() => JSON.parse(localStorage.getItem('noita-grimoire') ?? '{}'));
check('Explicit examine records Water in the unified Grimoire store', state.version === 2 && state.materials?.['2'] === true, JSON.stringify(state));

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.input.mouse.x = 42;
  ctx.input.mouse.y = 40;
});
await page.waitForTimeout(350);
state = await page.evaluate(() => JSON.parse(localStorage.getItem('noita-grimoire') ?? '{}'));
check('Passive visible inspector hover does not unlock Lava lore', state.materials?.['11'] !== true, JSON.stringify(state));

await page.keyboard.press('KeyI');
await page.waitForFunction(() => {
  const raw = localStorage.getItem('noita-grimoire');
  return raw && JSON.parse(raw).materials?.['11'] === true;
}, null, { timeout: 5000 });
state = await page.evaluate(() => JSON.parse(localStorage.getItem('noita-grimoire') ?? '{}'));
check('Second explicit examine records Lava lore', state.materials?.['11'] === true, JSON.stringify(state));

await startConsoleTestRun(page, { seed: 1, settleMs: 100 });
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const world = ctx.world;
  const x = Math.floor(ctx.player.x + 16);
  const y = Math.floor(ctx.player.y - 8);
  for (let yy = y - 2; yy <= y + 2; yy++) {
    for (let xx = x - 2; xx <= x + 2; xx++) {
      if (!world.inBounds(xx, yy)) continue;
      const i = world.idx(xx, yy);
      world.clearCellAt(i);
    }
  }
  const lava = world.idx(x, y);
  const water = world.idx(x + 1, y);
  world.types[lava] = 11;
  world.colors[lava] = 0xff5f18;
  world.types[water] = 2;
  world.colors[water] = 0x367ed0;
});
await page.waitForFunction(() => {
  const raw = localStorage.getItem('noita-grimoire');
  return raw && JSON.parse(raw).interactions?.['lava-flashes-water'] === true;
}, null, { timeout: 5000 });
state = await page.evaluate(() => JSON.parse(localStorage.getItem('noita-grimoire') ?? '{}'));
check('Near-player lava and water contact records an interaction entry', state.interactions?.['lava-flashes-water'] === true, JSON.stringify(state));

await page.keyboard.press('KeyJ');
await page.waitForSelector('#grimoire-overlay.open', { timeout: 5000 });
const book = await page.evaluate(() => document.getElementById('grimoire-overlay')?.textContent ?? '');
check('Grimoire book renders examined material and witnessed interaction entries', /Water/.test(book) && /Lava/.test(book) && /Lava Flashes Water/.test(book), book.slice(0, 400));
check('No page errors', pageErrors.length === 0, pageErrors.join('\n'));

await browser.close();

console.log(`\nverify-grimoire: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

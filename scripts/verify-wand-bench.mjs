// Focused Wandsmith Bench probe.
// Usage: node scripts/verify-wand-bench.mjs [url]  (dev server running)
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
await page.waitForFunction(() => window.__game?.ctx?.console, { timeout: 20000 });
await startConsoleTestRun(page, {
  loadout: 'review',
  flasks: [
    { material: 2, count: 100 },
    null,
    null,
    null,
  ],
  activeFlaskIndex: 0,
  settleMs: 250,
});

await page.keyboard.press('KeyB');
await page.waitForSelector('#wand-bench.visible', { timeout: 5000 });

const labels = await page.evaluate(() => ({
  hasStatusPotions: [...document.querySelectorAll('#wand-bench .bench-section')]
    .some((el) => el.textContent === 'STATUS POTIONS'),
  hasPotionInventory: [...document.querySelectorAll('#wand-bench .bench-section')]
    .some((el) => el.textContent === 'POTION INVENTORY'),
  flaskSlots: document.querySelectorAll('#wand-bench [data-bench-flask-slot]').length,
  flaskSelects: document.querySelectorAll('#wand-bench [data-bench-flask-material]').length,
}));
check(
  'Bench separates status potions from compact flask inventory',
  labels.hasStatusPotions && labels.hasPotionInventory && labels.flaskSlots === 4 && labels.flaskSelects === 4,
  JSON.stringify(labels),
);

const compactUi = await page.evaluate(() => {
  const slots = [...document.querySelectorAll('#wand-bench [data-bench-flask-slot]')];
  const iconRects = slots.map((slot) => slot.querySelector('.bench-flask-icon canvas')?.getBoundingClientRect())
    .filter(Boolean)
    .map((rect) => ({ width: rect.width, height: rect.height }));
  const slotRects = slots.map((slot) => slot.getBoundingClientRect());
  return {
    maxIcon: Math.max(...iconRects.map((rect) => Math.max(rect.width, rect.height))),
    maxSlotHeight: Math.max(...slotRects.map((rect) => rect.height)),
    materialButtons: document.querySelectorAll('#wand-bench [data-bench-flask-fill]').length,
  };
});
check(
  'Bench flask inventory uses small icons and no material button grid',
  compactUi.maxIcon <= 40 && compactUi.maxSlotHeight <= 96 && compactUi.materialButtons === 0,
  JSON.stringify(compactUi),
);

await page.selectOption('#wand-bench [data-bench-flask-slot="1"] [data-bench-flask-material]', '21');
await page.selectOption('#wand-bench [data-bench-flask-slot="2"] [data-bench-flask-material]', '7');
const flaskState = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return {
    active: ctx.flask.activeIndex,
    slots: ctx.flask.slots.map((slot) => ({ material: slot.material, count: slot.count, capacity: slot.capacity })),
  };
});
check(
  'Bench flask dropdowns target independent inventory slots',
  flaskState.active === 2 &&
    flaskState.slots[0].material === 2 &&
    flaskState.slots[0].count === 100 &&
    flaskState.slots[1].material === 21 &&
    flaskState.slots[1].count === 600 &&
    flaskState.slots[2].material === 7 &&
    flaskState.slots[2].count === 600,
  JSON.stringify(flaskState),
);

const beforePlace = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return {
    card: ctx.wands.collection[0],
    previousSlot: ctx.wands.wands[0].cards[0],
  };
});
await page.locator('#wand-bench [data-bench-collection-index="0"]').dragTo(
  page.locator('#wand-bench [data-bench-wand="0"][data-bench-slot="0"]'),
);
const afterPlace = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return {
    slot: ctx.wands.wands[0].cards[0],
    collectionHasPrevious: ctx.wands.collection.includes('spark'),
  };
});
check(
  'Bench drags collection cards into wand slots',
  afterPlace.slot === beforePlace.card && afterPlace.collectionHasPrevious,
  JSON.stringify({ beforePlace, afterPlace }),
);

const beforeSwap = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return {
    slot0: ctx.wands.wands[0].cards[0],
    slot1: ctx.wands.wands[0].cards[1],
  };
});
await page.locator('#wand-bench [data-bench-wand="0"][data-bench-slot="0"]').dragTo(
  page.locator('#wand-bench [data-bench-wand="0"][data-bench-slot="1"]'),
);
const afterSwap = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return {
    slot0: ctx.wands.wands[0].cards[0],
    slot1: ctx.wands.wands[0].cards[1],
  };
});
check(
  'Bench drags slotted cards to rearrange wand order',
  afterSwap.slot0 === beforeSwap.slot1 && afterSwap.slot1 === beforeSwap.slot0,
  JSON.stringify({ beforeSwap, afterSwap }),
);

await page.locator('#wand-bench [data-bench-wand="0"][data-bench-slot="1"]').dragTo(
  page.locator('#wand-bench .bench-card-collection'),
);
const afterReturn = await page.evaluate((moved) => {
  const ctx = window.__game.ctx;
  return {
    slot1: ctx.wands.wands[0].cards[1],
    returned: ctx.wands.collection.includes(moved),
  };
}, afterSwap.slot1);
check('Bench drags slotted cards back to collection', afterReturn.slot1 === null && afterReturn.returned, JSON.stringify(afterReturn));

check('No page errors', pageErrors.length === 0, pageErrors.join('\n'));

await browser.close();

console.log(`\nverify-wand-bench: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

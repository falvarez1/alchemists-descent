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
await page.evaluate(() => {
  window.__game.ctx.state.debugGodMode = false;
});

const awayProbe = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  const anchor = rt?.refuge;
  if (!anchor) return { hasRefuge: false, visible: false };
  ctx.player.x = anchor.x + 160;
  ctx.player.y = anchor.y;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
  ctx.camera.snapTo(ctx.player.x, ctx.player.y);
  return { hasRefuge: true, visible: document.getElementById('wand-bench')?.classList.contains('visible') === true };
});
await page.keyboard.press('KeyB');
await page.waitForTimeout(150);
const awayVisible = await page.evaluate(() => document.getElementById('wand-bench')?.classList.contains('visible') === true);
const awayToast = await page.evaluate(() => [...document.querySelectorAll('#toast-stack .toast')].map((el) => el.textContent ?? '').at(-1) ?? '');
check(
  'Bench refuses to open away from the Refuge with a directional cue',
  awayProbe.hasRefuge && !awayProbe.visible && !awayVisible && awayToast.includes('WAND BENCH IN REFUGE'),
  JSON.stringify({ awayProbe, awayVisible, awayToast }),
);

const benchAnchor = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.debugGodMode = true;
  const rt = ctx.levels.current;
  const anchor = rt?.refuge;
  if (!anchor) return null;
  ctx.player.x = anchor.x;
  ctx.player.y = anchor.y;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
  ctx.camera.snapTo(ctx.player.x, ctx.player.y);
  return { x: Math.round(anchor.x), y: Math.round(anchor.y) };
});
check('Bench access anchor exists in the current level', benchAnchor !== null, JSON.stringify(benchAnchor));

await page.keyboard.press('KeyB');
await page.waitForSelector('#wand-bench.visible', { timeout: 5000 });

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.wands.loadLoadout({
    active: 0,
    collection: ['speed', 'heavy', 'spread', 'flame', 'lightning', 'conjure', 'vitriol'],
    wands: [
      { frameId: 'brass', cards: ['trigger', 'spark', 'bomb', 'double', 'spark'], mana: 0 },
      { frameId: 'void', cards: ['dig', 'conjure', 'vitriol', 'blackhole', 'warp'], mana: 220 },
    ],
  });
  ctx.player.mana = 0;
});
await page.waitForTimeout(180);

const sentenceProbe = await page.evaluate(() => {
  const bench = document.getElementById('wand-bench');
  const firstLine = bench?.querySelector('.bench-sentence-line')?.textContent ?? '';
  const warnings = [...(bench?.querySelectorAll('.bench-sentence-warning') ?? [])].map((el) => el.textContent ?? '');
  const inspect = bench?.querySelector('.bench-inspect')?.textContent ?? '';
  const hud = document.querySelector('#spell-hotbar .wand-cast-caption');
  return {
    firstLine,
    warnings,
    inspect,
    hud: hud?.textContent ?? '',
    hudOvermana: hud?.classList.contains('overmana') === true,
  };
});
check(
  'Bench renders compiled trigger sentence with group mana need',
  sentenceProbe.firstLine.includes('Next: Spark Bolt -> Cast Bomb at impact') &&
    sentenceProbe.firstLine.includes('Needs 42 mana') &&
    sentenceProbe.firstLine.includes('slots 1, 2, 3'),
  JSON.stringify(sentenceProbe),
);
check(
  'Bench warns about underfilled multicast decks',
  sentenceProbe.warnings.some((text) => text.includes('Twin Cast in slot 4 wants 2 projectiles, found 1')),
  JSON.stringify(sentenceProbe.warnings),
);
check(
  'Bench inspect panel shows visible card learning text',
  sentenceProbe.inspect.includes('Trigger') && sentenceProbe.inspect.includes('MODIFIER') && sentenceProbe.inspect.includes('8 MANA'),
  JSON.stringify(sentenceProbe.inspect),
);
check(
  'HUD caption mirrors the next compiled cast and group affordability',
  sentenceProbe.hud.includes('Next: Spark Bolt -> Cast Bomb at impact') &&
    sentenceProbe.hud.includes('Needs 42 mana') &&
    sentenceProbe.hudOvermana,
  JSON.stringify(sentenceProbe),
);

await page.locator('#wand-bench [data-bench-wand="0"][data-bench-slot="0"]').hover();
const triggerRelations = await page.evaluate(() => ({
  host: document.querySelector('#wand-bench [data-bench-wand="0"][data-bench-slot="1"]')?.classList.contains('sentence-related') === true,
  payload: document.querySelector('#wand-bench [data-bench-wand="0"][data-bench-slot="2"]')?.classList.contains('sentence-related') === true,
}));
check('Bench highlights trigger host and payload slots', triggerRelations.host && triggerRelations.payload, JSON.stringify(triggerRelations));

await page.locator('#wand-bench [data-bench-collection-index="0"]').hover();
const collectionInspect = await page.evaluate(() => document.querySelector('#wand-bench .bench-inspect')?.textContent ?? '');
check(
  'Collection cards update the visible inspect panel on hover',
  collectionInspect.includes('Swift Charm') && collectionInspect.includes('MODIFIER') && collectionInspect.includes('4 MANA'),
  JSON.stringify(collectionInspect),
);

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
  const previousSlot = ctx.wands.wands[0].cards[0];
  const index = ctx.wands.collection.findIndex((card) => card !== previousSlot);
  return {
    index,
    card: index >= 0 ? ctx.wands.collection[index] : null,
    previousSlot,
  };
});
check('Bench probe found a distinct collection card to move', beforePlace.index >= 0 && beforePlace.card !== beforePlace.previousSlot, JSON.stringify(beforePlace));
await page.locator(`#wand-bench [data-bench-collection-index="${beforePlace.index}"]`).dragTo(
  page.locator('#wand-bench [data-bench-wand="0"][data-bench-slot="0"]'),
);
const afterPlace = await page.evaluate((previousSlot) => {
  const ctx = window.__game.ctx;
  return {
    slot: ctx.wands.wands[0].cards[0],
    collectionHasPrevious: previousSlot === null || ctx.wands.collection.includes(previousSlot),
  };
}, beforePlace.previousSlot);
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

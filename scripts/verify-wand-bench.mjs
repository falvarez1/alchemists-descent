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

const sampleRefugeMarker = () => page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  const canvas = document.getElementById('minimap-corner');
  const g = canvas?.getContext('2d');
  if (!rt?.refuge || !g) return { hasRefuge: false, highlighted: 0, blue: 0 };
  const rx = rt.refuge.x >> 3;
  const ry = rt.refuge.y >> 3;
  const x0 = Math.max(0, rx - 3);
  const y0 = Math.max(0, ry - 3);
  const w = Math.min(7, canvas.width - x0);
  const h = Math.min(7, canvas.height - y0);
  if (w <= 0 || h <= 0) return { hasRefuge: true, highlighted: 0, blue: 0 };
  const img = g.getImageData(x0, y0, w, h).data;
  let highlighted = 0;
  let blue = 0;
  for (let i = 0; i < img.length; i += 4) {
    const r = img[i];
    const gg = img[i + 1];
    const b = img[i + 2];
    if (r > 220 && gg > 220 && b > 220) highlighted++;
    if (b > 180 && gg > 120 && r < 120) blue++;
  }
  return { hasRefuge: true, highlighted, blue };
});

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
  const canvas = document.getElementById('minimap-corner');
  const rx = anchor.x >> 3;
  const ry = anchor.y >> 3;
  if (canvas instanceof HTMLCanvasElement) rt.explored[rx + ry * canvas.width] = 1;
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

await page.waitForTimeout(250);
const refugeMarker = await sampleRefugeMarker();
check(
  'Refuge ping highlights the discovered minimap bench marker',
  refugeMarker.hasRefuge && (refugeMarker.highlighted > 0 || refugeMarker.blue > 0),
  JSON.stringify(refugeMarker),
);

await page.setViewportSize({ width: 900, height: 650 });
await page.evaluate(() => window.__game.ctx.events.emit('refugePing'));
await page.waitForTimeout(250);
const compactRefugeMarker = await sampleRefugeMarker();
check(
  'Refuge marker remains readable in a mobile-ish viewport',
  compactRefugeMarker.hasRefuge && (compactRefugeMarker.highlighted > 0 || compactRefugeMarker.blue > 0),
  JSON.stringify(compactRefugeMarker),
);
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(120);

const unexploredCardGrantCue = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  const refuge = rt?.refuge;
  if (!rt || !refuge) return { hasRefuge: false, banner: '', objective: '' };
  const canvas = document.getElementById('minimap-corner');
  const mapWidth = canvas instanceof HTMLCanvasElement ? canvas.width : 200;
  const mapIndex = (refuge.x >> 3) + (refuge.y >> 3) * mapWidth;
  if (mapIndex >= 0 && mapIndex < rt.explored.length) rt.explored[mapIndex] = 0;
  ctx.player.x = refuge.x - 160;
  ctx.player.y = refuge.y + 48;
  ctx.state.frameCount += 10;
  ctx.events.emit('cardGranted', { id: 'speed', name: 'Swift Charm' });
  return {
    hasRefuge: true,
    banner: document.getElementById('banner-small')?.textContent ?? '',
    objective: document.getElementById('objective')?.textContent ?? '',
  };
});
check(
  'Card grant gives Refuge direction text even before the map marker is explored',
  unexploredCardGrantCue.hasRefuge &&
    unexploredCardGrantCue.banner.includes('BENCH IN REFUGE EAST ABOVE') &&
    unexploredCardGrantCue.objective.includes('BENCH AVAILABLE IN REFUGE'),
  JSON.stringify(unexploredCardGrantCue),
);

await page.click('#dev-console-toggle');
await page.waitForFunction(() => document.getElementById('dev-console')?.classList.contains('open'));
await page.fill('#dev-console-input', 'god');
await page.keyboard.press('Enter');
await page.waitForFunction(
  () => {
    const log = document.querySelector('#dev-console .dev-console-log')?.textContent ?? '';
    return log.includes('God mode enabled') || log.includes('God mode refreshed');
  },
  null,
  { timeout: 5000 },
);
const godConsoleProbe = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const collection = [...ctx.wands.collection];
  const phase4 = ['watertrail', 'oiltrail', 'electriccharge', 'critwet', 'shorthoming'];
  return {
    debugGodMode: ctx.state.debugGodMode,
    collection,
    uniqueCards: new Set(collection).size,
    phase4Present: phase4.filter((id) => collection.includes(id)),
    wandFrames: ctx.wands.wands.map((wand) => wand.frame.id),
  };
});
check(
  'Typing god in the developer console grants the full review card collection',
  godConsoleProbe.debugGodMode &&
    godConsoleProbe.collection.length > 0 &&
    godConsoleProbe.uniqueCards === godConsoleProbe.collection.length &&
    godConsoleProbe.phase4Present.length === 5 &&
    godConsoleProbe.wandFrames.join(',') === 'brass,void',
  JSON.stringify(godConsoleProbe),
);
await page.keyboard.press('Backquote');
await page.waitForFunction(() => !document.getElementById('dev-console')?.classList.contains('open'));

const benchAnchor = await page.evaluate(() => {
  const ctx = window.__game.ctx;
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

const godBenchProbe = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const collection = [...ctx.wands.collection];
  const visible = [...document.querySelectorAll('#wand-bench .bench-card-collection [data-bench-card-id]')]
    .map((el) => el.getAttribute('data-bench-card-id'));
  const phase4 = ['watertrail', 'oiltrail', 'electriccharge', 'critwet', 'shorthoming'];
  return {
    collection,
    visible,
    missing: collection.filter((id) => !visible.includes(id)),
    phase4Visible: phase4.filter((id) => visible.includes(id)),
  };
});
check(
  'God-mode Wand Bench visibly lists every granted card, including new modifiers',
  godBenchProbe.collection.length > 0 &&
    godBenchProbe.missing.length === 0 &&
    godBenchProbe.phase4Visible.length === 5,
  JSON.stringify(godBenchProbe),
);

const reviewLoadoutButtons = await page.evaluate(() =>
  [...document.querySelectorAll('#wand-bench .bench-loadout')].map((button) => ({
    text: button.textContent ?? '',
    title: button.getAttribute('title') ?? '',
  })),
);
check(
  'God-mode bench exposes review primer loadouts',
  ['Wet Crit Primer', 'Fuse Primer', 'Trigger Primer'].every((name) =>
    reviewLoadoutButtons.some((button) => button.text === name),
  ),
  JSON.stringify(reviewLoadoutButtons),
);
await page.locator('#wand-bench .bench-loadout', { hasText: 'Wet Crit Primer' }).click();
const appliedPrimer = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const active = ctx.wands.active;
  return {
    active,
    frame: ctx.wands.wands[active].frame.id,
    cards: ctx.wands.wands[active].cards,
    collection: ctx.wands.collection,
    sentence: document.querySelector('#wand-bench .bench-sentence-line')?.textContent ?? '',
  };
});
check(
  'Review primer loadout applies to the active wand without hiding cards',
  appliedPrimer.frame === 'brass' &&
    appliedPrimer.cards.slice(0, 3).join(',') === 'watertrail,critwet,spark' &&
    appliedPrimer.collection.includes('oiltrail') &&
    appliedPrimer.sentence.includes('Water-Trail Wet-Crit Spark Bolt'),
  JSON.stringify(appliedPrimer),
);
await page.locator('#wand-bench .bench-loadout', { hasText: 'Fuse Primer' }).click();
const appliedFusePrimer = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const active = ctx.wands.active;
  return {
    frame: ctx.wands.wands[active].frame.id,
    cards: ctx.wands.wands[active].cards,
    sentence: document.querySelector('#wand-bench .bench-sentence-line')?.textContent ?? '',
  };
});
check(
  'Fuse primer lays oil with a projectile before the fire card',
  appliedFusePrimer.frame === 'brass' &&
    appliedFusePrimer.cards.slice(0, 3).join(',') === 'oiltrail,spark,flame' &&
    appliedFusePrimer.sentence.includes('Oil-Wick Spark Bolt'),
  JSON.stringify(appliedFusePrimer),
);
await page.locator('#wand-bench .bench-loadout', { hasText: 'Trigger Primer' }).click();
const appliedTriggerPrimer = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const active = ctx.wands.active;
  return {
    frame: ctx.wands.wands[active].frame.id,
    cards: ctx.wands.wands[active].cards,
    sentence: document.querySelector('#wand-bench .bench-sentence-line')?.textContent ?? '',
  };
});
check(
  'Trigger primer previews host and payload',
  appliedTriggerPrimer.frame === 'brass' &&
    appliedTriggerPrimer.cards.slice(0, 3).join(',') === 'trigger,spark,bomb' &&
    appliedTriggerPrimer.sentence.includes('Spark Bolt -> Cast Bomb at impact'),
  JSON.stringify(appliedTriggerPrimer),
);

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const collection = [...ctx.wands.collection];
  ctx.wands.loadLoadout({
    active: 0,
    collection,
    wands: [
      { frameId: 'brass', cards: ['trigger', 'spark', 'bomb', 'double', 'spark'], mana: 0 },
      { frameId: 'void', cards: ['dig', 'conjure', 'vitriol', 'blackhole', 'warp'], mana: 220 },
    ],
  });
  ctx.player.mana = 0;
});
await page.waitForTimeout(180);

const objectiveCue = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.events.emit('cardGranted', { id: 'speed', name: 'Swift Charm' });
  return document.getElementById('objective')?.textContent ?? '';
});
check(
  'Card grants point the objective row back to the Refuge bench',
  objectiveCue.includes('BENCH AVAILABLE IN REFUGE'),
  JSON.stringify(objectiveCue),
);

const keyObjective = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  if (!rt) return '';
  ctx.state.frameCount += 1000;
  rt.keyTaken = true;
  ctx.events.emit('objectiveChanged', { text: 'RETURN TO THE PORTAL' });
  return document.getElementById('objective')?.textContent ?? '';
});
check(
  'Key objective uses return-to-portal wording',
  keyObjective.includes('RETURN TO THE PORTAL'),
  JSON.stringify(keyObjective),
);

await page.locator('#wand-bench [data-bench-wand="0"][data-bench-slot="0"]').hover();
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

await page.locator('#wand-bench .bench-card-collection [data-bench-card-id="speed"]').hover();
const collectionInspect = await page.evaluate(() => document.querySelector('#wand-bench .bench-inspect')?.textContent ?? '');
check(
  'Collection cards update the visible inspect panel on hover',
  collectionInspect.includes('Swift Charm') && collectionInspect.includes('MODIFIER') && collectionInspect.includes('4 MANA'),
  JSON.stringify(collectionInspect),
);

await page.locator('#wand-bench .bench-card-collection [data-bench-card-id="oiltrail"]').hover();
const recipeInspect = await page.evaluate(() => document.querySelector('#wand-bench .bench-inspect')?.textContent ?? '');
check(
  'Bench inspect panel shows recipe hints for combo cards',
  recipeInspect.includes('Oil Wick') && recipeInspect.includes('Pairs with Flame'),
  JSON.stringify(recipeInspect),
);

const filterLabels = await page.evaluate(() =>
  [...document.querySelectorAll('#wand-bench [data-bench-card-filter]')].map((btn) => ({
    filter: btn.getAttribute('data-bench-card-filter'),
    text: btn.textContent ?? '',
    pressed: btn.getAttribute('aria-pressed'),
  })),
);
check(
  'Bench exposes compact collection filters',
  ['all', 'projectile', 'modifier', 'multicast', 'setup', 'terrain'].every((filter) =>
    filterLabels.some((entry) => entry.filter === filter),
  ) && filterLabels.find((entry) => entry.filter === 'all')?.pressed === 'true',
  JSON.stringify(filterLabels),
);

await page.click('#wand-bench [data-bench-card-filter="setup"]');
const setupFilter = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#wand-bench .bench-card-collection .bench-card')];
  return {
    pressed: document.querySelector('#wand-bench [data-bench-card-filter="setup"]')?.getAttribute('aria-pressed') ?? '',
    cards: cards.map((card) => ({
      id: card.getAttribute('data-bench-card-id'),
      tags: card.getAttribute('data-bench-card-tags') ?? '',
    })),
  };
});
check(
  'Bench Setup filter shows only setup-tagged cards',
  setupFilter.pressed === 'true' &&
    setupFilter.cards.length > 0 &&
    setupFilter.cards.every((card) => card.tags.split(' ').includes('Setup')),
  JSON.stringify(setupFilter),
);

await page.click('#wand-bench [data-bench-card-filter="projectile"]');
const projectileFilter = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#wand-bench .bench-card-collection .bench-card')];
  return {
    pressed: document.querySelector('#wand-bench [data-bench-card-filter="projectile"]')?.getAttribute('aria-pressed') ?? '',
    cards: cards.map((card) => ({
      id: card.getAttribute('data-bench-card-id'),
      kind: card.getAttribute('data-bench-card-kind'),
    })),
  };
});
check(
  'Bench Projectiles filter shows only projectile cards',
  projectileFilter.pressed === 'true' &&
    projectileFilter.cards.length > 0 &&
    projectileFilter.cards.every((card) => card.kind === 'projectile'),
  JSON.stringify(projectileFilter),
);
await page.click('#wand-bench [data-bench-card-filter="modifier"]');
const modifierFilter = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#wand-bench .bench-card-collection .bench-card')];
  return {
    pressed: document.querySelector('#wand-bench [data-bench-card-filter="modifier"]')?.getAttribute('aria-pressed') ?? '',
    cards: cards.map((card) => ({
      id: card.getAttribute('data-bench-card-id'),
      kind: card.getAttribute('data-bench-card-kind'),
    })),
  };
});
check(
  'Bench Modifiers filter shows only modifier cards',
  modifierFilter.pressed === 'true' &&
    modifierFilter.cards.length > 0 &&
    modifierFilter.cards.every((card) => card.kind === 'modifier'),
  JSON.stringify(modifierFilter),
);
await page.click('#wand-bench [data-bench-card-filter="multicast"]');
const multicastFilter = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#wand-bench .bench-card-collection .bench-card')];
  return {
    pressed: document.querySelector('#wand-bench [data-bench-card-filter="multicast"]')?.getAttribute('aria-pressed') ?? '',
    cards: cards.map((card) => ({
      id: card.getAttribute('data-bench-card-id'),
      kind: card.getAttribute('data-bench-card-kind'),
    })),
  };
});
check(
  'Bench Multicast filter shows only multicast cards',
  multicastFilter.pressed === 'true' &&
    multicastFilter.cards.length > 0 &&
    multicastFilter.cards.every((card) => card.kind === 'multicast'),
  JSON.stringify(multicastFilter),
);
await page.click('#wand-bench [data-bench-card-filter="terrain"]');
const terrainFilter = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#wand-bench .bench-card-collection .bench-card')];
  return {
    pressed: document.querySelector('#wand-bench [data-bench-card-filter="terrain"]')?.getAttribute('aria-pressed') ?? '',
    cards: cards.map((card) => ({
      id: card.getAttribute('data-bench-card-id'),
      tags: card.getAttribute('data-bench-card-tags') ?? '',
    })),
  };
});
check(
  'Bench Terrain filter shows only terrain-tagged cards',
  terrainFilter.pressed === 'true' &&
    terrainFilter.cards.length > 0 &&
    terrainFilter.cards.every((card) => card.tags.split(' ').includes('Terrain')),
  JSON.stringify(terrainFilter),
);
await page.click('#wand-bench [data-bench-card-filter="all"]');

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
    flaskState.slots[0].material === 21 &&
    flaskState.slots[0].count === 600 &&
    flaskState.slots[1].material === 21 &&
    flaskState.slots[1].count === 600 &&
    flaskState.slots[2].material === 7 &&
    flaskState.slots[2].count === 600 &&
    flaskState.slots[3].material === 2 &&
    flaskState.slots[3].count === 600,
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

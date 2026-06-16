// Focused card-offer probe.
// Usage: node scripts/verify-card-offers.mjs [url]  (dev server running)
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
  loadout: 'fresh',
  gold: 500,
  settleMs: 250,
});

const beforeTome = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  const p = ctx.player;
  const tome = { kind: 'tome', x: p.x, y: p.y - 8, vx: 0, vy: 0, taken: false, data: { card: 'watertrail' } };
  rt.pickups.push(tome);
  return {
    cards: ctx.wands.collection.length,
    pickups: rt.pickups.length,
    paused: ctx.state.paused,
  };
});

await page.waitForSelector('#card-offer-overlay.visible', { timeout: 5000 });
const tomeOffer = await page.evaluate(() => {
  const rt = window.__game.ctx.levels.current;
  const tome = rt.pickups[rt.pickups.length - 1];
  return {
    visible: document.getElementById('card-offer-overlay')?.classList.contains('visible') === true,
    cards: [...document.querySelectorAll('#card-offer-overlay .card-offer-card')].map((el) => ({
      id: el.getAttribute('data-card-offer-id'),
      text: el.textContent,
    })),
    pending: tome.data.offerPending === true,
    taken: tome.taken === true,
    paused: window.__game.ctx.state.paused,
  };
});
check(
  'Tome opens a three-card unskippable offer before marking pickup taken',
  tomeOffer.visible &&
    tomeOffer.cards.length === 3 &&
    new Set(tomeOffer.cards.map((card) => card.id)).size === 3 &&
    tomeOffer.cards.some((card) => card.id === 'watertrail') &&
    tomeOffer.pending &&
    !tomeOffer.taken &&
    tomeOffer.paused,
  JSON.stringify(tomeOffer),
);

await page.click('#card-offer-overlay [data-card-offer-id="watertrail"]');
await page.waitForFunction(() => !document.getElementById('card-offer-overlay')?.classList.contains('visible'), null, { timeout: 5000 });
await page.waitForFunction(
  () => Number(document.getElementById('hud-cards')?.textContent ?? 0) === window.__game.ctx.wands.collection.length,
  null,
  { timeout: 5000 },
);
const afterTome = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  const tome = rt.pickups[rt.pickups.length - 1];
  return {
    cards: ctx.wands.collection.length,
    hasWaterTrail: ctx.wands.collection.includes('watertrail'),
    taken: tome.taken === true,
    pending: tome.data.offerPending === true,
    paused: ctx.state.paused,
    banner: document.getElementById('wave-banner')?.textContent ?? '',
    hudCards: Number(document.getElementById('hud-cards')?.textContent ?? 0),
  };
});
check(
  'Tome selection grants a normal-pool Phase 4 card and marks the pickup taken once',
  afterTome.cards === beforeTome.cards + 1 &&
    afterTome.hasWaterTrail &&
    afterTome.taken &&
    !afterTome.pending &&
    afterTome.paused === beforeTome.paused &&
    afterTome.hudCards >= afterTome.cards,
  JSON.stringify({ beforeTome, afterTome }),
);

const beforeShop = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.score = 500;
  ctx.wands.collection.length = 0;
  ctx.wands.collection.push(
    'speed',
    'heavy',
    'spread',
    'double',
    'flame',
    'dig',
    'conjure',
    'vitriol',
    'frostshard',
    'bomb',
    'lightning',
    'warp',
    'blackhole',
    'icelance',
    'wisp',
    'meteor',
    'emberstorm',
    'bounce',
    'trigger',
    'triple',
    'watertrail',
    'shorthoming',
  );
  ctx.events.emit('scoreChanged', { score: ctx.state.score });
  ctx.sanctum.openShop(ctx);
  return {
    gold: ctx.state.score,
    cards: ctx.wands.collection.length,
  };
});
await page.waitForSelector('#sanctum-overlay.visible', { timeout: 5000 });
await page.locator('#sanc-shop .shop-row', { hasText: 'LOST PAGES' }).locator('button').click();
await page.waitForSelector('#card-offer-overlay.visible', { timeout: 5000 });
const shopBeforeChoice = await page.evaluate(() => ({
  gold: window.__game.ctx.state.score,
  cards: window.__game.ctx.wands.collection.length,
  offers: [...document.querySelectorAll('#card-offer-overlay .card-offer-card')].map((el) =>
    el.getAttribute('data-card-offer-id')),
  sanctumVisible: document.getElementById('sanctum-overlay')?.classList.contains('visible') === true,
}));
check(
  'Lost Pages can offer normal-pool Phase 4 combo cards without spending gold first',
  shopBeforeChoice.gold === beforeShop.gold &&
    shopBeforeChoice.cards === beforeShop.cards &&
    shopBeforeChoice.offers.length === 3 &&
    ['electriccharge', 'critwet', 'oiltrail'].every((card) => shopBeforeChoice.offers.includes(card)) &&
    shopBeforeChoice.sanctumVisible,
  JSON.stringify({ beforeShop, shopBeforeChoice }),
);

await page.locator('#card-offer-overlay .card-offer-card').first().click();
await page.waitForFunction(() => !document.getElementById('card-offer-overlay')?.classList.contains('visible'), null, { timeout: 5000 });
const shopAfterChoice = await page.evaluate(() => ({
  gold: window.__game.ctx.state.score,
  cards: window.__game.ctx.wands.collection.length,
  goldText: document.getElementById('sanc-gold')?.textContent,
  sanctumVisible: document.getElementById('sanctum-overlay')?.classList.contains('visible') === true,
}));
check(
  'Lost Pages spends gold and grants exactly one card after selection',
  shopAfterChoice.gold === beforeShop.gold - 160 &&
    shopAfterChoice.goldText === String(beforeShop.gold - 160) &&
    shopAfterChoice.cards === beforeShop.cards + 1 &&
    shopAfterChoice.sanctumVisible,
  JSON.stringify({ beforeShop, shopAfterChoice }),
);

check('No page errors', pageErrors.length === 0, pageErrors.join('\n'));

await browser.close();

console.log(`\nverify-card-offers: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

// Focused D1 Spell Lab probe.
// Usage: node scripts/verify-spell-lab.mjs [url]  (dev server running)
import { chromium } from 'playwright-core';
import { startConsolePlayRun } from './run-helpers.mjs';

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
await startConsolePlayRun(page, { seed: 1, settleMs: 100 });

const lab = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  const world = ctx.world;
  const marker = rt.spellLab;
  const cellsNear = (type, r = 28) => {
    if (!marker) return 0;
    let count = 0;
    for (let y = Math.floor(marker.y - r); y <= Math.floor(marker.y + r); y++) {
      for (let x = Math.floor(marker.x - r); x <= Math.floor(marker.x + r); x++) {
        if (world.inBounds(x, y) && world.types[world.idx(x, y)] === type) count++;
      }
    }
    return count;
  };
  const reward = marker
    ? rt.pickups.find((p) =>
        !p.taken &&
        p.kind === 'tome' &&
        Math.abs(p.x - marker.rewardX) <= 2 &&
        Math.abs(p.y - marker.rewardY) <= 2)
    : null;
  return {
    level: rt.def.id,
    marker,
    starterFlask: {
      active: ctx.flask.activeIndex,
      material: ctx.flask.state.material,
      count: ctx.flask.state.count,
    },
    reward: reward ? { kind: reward.kind, card: reward.data.card, x: reward.x, y: reward.y } : null,
    sand: cellsNear(1),
    water: cellsNear(2),
    fire: cellsNear(5),
    lava: cellsNear(11),
    wood: cellsNear(4),
    chargeLatch: marker
      ? rt.mechanisms.some((m) =>
          m.kind === 'chargelatch' &&
          Math.abs(m.x - marker.x) < 30 &&
          Math.abs(m.y - marker.y) < 20)
      : false,
  };
});

check('D1 runtime exposes a Spell Lab marker', lab.level === 'd1' && !!lab.marker, JSON.stringify(lab));
check(
  'Fresh expedition starts with a water flask for the first lab experiments',
  lab.starterFlask.active === 0 && lab.starterFlask.material === 2 && lab.starterFlask.count === 300,
  JSON.stringify(lab.starterFlask),
);
check(
  'Spell Lab has all required real-cell teaching stations',
  lab.sand > 0 && lab.wood > 0 && lab.fire > 0 && lab.water > 0 && lab.lava > 0 && lab.chargeLatch,
  JSON.stringify(lab),
);
check('Spell Lab reward is a preferred Heavy tome', lab.reward?.kind === 'tome' && lab.reward.card === 'heavy', JSON.stringify(lab));

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const lab = ctx.levels.current.spellLab;
  ctx.player.x = lab.rewardX;
  ctx.player.y = lab.rewardY + 8;
  ctx.player.dead = false;
  ctx.pickups.update(ctx);
});
await page.waitForSelector('#card-offer-overlay.visible', { timeout: 5000 });
const offer = await page.evaluate(() => ({
  visible: document.getElementById('card-offer-overlay')?.classList.contains('visible') === true,
  cards: [...document.querySelectorAll('#card-offer-overlay .card-offer-card')].map((el) =>
    el.getAttribute('data-card-offer-id')),
}));
check(
  'Spell Lab tome opens a three-card offer containing Heavy',
  offer.visible && offer.cards.length === 3 && offer.cards.includes('heavy'),
  JSON.stringify(offer),
);
await page.click('#card-offer-overlay [data-card-offer-id="heavy"]');
await page.waitForFunction(
  () => !document.getElementById('card-offer-overlay')?.classList.contains('visible'),
  null,
  { timeout: 5000 },
);

check('No page errors', pageErrors.length === 0, pageErrors.join('\n'));

await browser.close();

console.log(`\nverify-spell-lab: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

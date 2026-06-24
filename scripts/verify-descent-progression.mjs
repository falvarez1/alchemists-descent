// Verifies the D1 descent progression gate:
// - the old bottom shaft is sealed and falling to the bottom never transitions,
// - the Refuge bench is near spawn and only present on D1,
// - the D1 portal refuses descent until Heavy is slotted at the bench.
import { launchBrowser } from './browser-launch.mjs';
import { startConsolePlayRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(' ok ', name);
  } else {
    fail++;
    console.error('FAIL', name, detail);
  }
}

await page.goto(url, { waitUntil: 'networkidle' });
await startConsolePlayRun(page, { seed: 1, settleMs: 1200 });

const blocked = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  const w = ctx.world;

  for (const wand of ctx.wands.wands) {
    for (let i = 0; i < wand.cards.length; i++) {
      if (wand.cards[i] === 'heavy') wand.cards[i] = null;
    }
  }
  for (let i = ctx.wands.collection.length - 1; i >= 0; i--) {
    if (ctx.wands.collection[i] === 'heavy') ctx.wands.collection.splice(i, 1);
  }
  ctx.wands.invalidatePrograms?.();

  let bottomEmpty = 0;
  for (let y = w.height - 6; y < w.height; y++) {
    for (let dx = -rt.exit.halfW; dx <= rt.exit.halfW; dx++) {
      const x = rt.exit.x + dx;
      if (w.inBounds(x, y) && w.types[w.idx(x, y)] === 0) bottomEmpty++;
    }
  }

  ctx.player.x = rt.exit.x;
  ctx.player.y = w.height - 8;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
  ctx.state.paused = false;
  await sleep(500);
  const afterFallId = ctx.levels.current?.def.id;
  const afterFallY = ctx.player.y;

  const objectives = [];
  const toasts = [];
  const disposeObjective = ctx.events.on('objectiveChanged', (event) => objectives.push(event.text));
  const disposeToast = ctx.events.on('toast', (event) => toasts.push(event.text));
  rt.keyTaken = true;
  rt.portal.open = false;
  ctx.player.x = rt.portal.x;
  ctx.player.y = rt.portal.y + 6;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
  ctx.state.frameCount = 89;
  await sleep(500);
  disposeObjective?.();
  disposeToast?.();

  return {
    id: rt.def.id,
    hasRefuge: !!rt.refuge,
    refugeDistance: rt.refuge ? Math.hypot(rt.refuge.x - rt.spawn.x, rt.refuge.y - rt.spawn.y) : Infinity,
    bottomEmpty,
    afterFallId,
    afterFallY,
    blockedId: ctx.levels.current?.def.id,
    portalOpen: rt.portal.open,
    sanctumOpen: ctx.sanctum.isOpen,
    objective: document.getElementById('objective')?.textContent ?? '',
    objectives,
    toasts,
  };
});

check('D1 has a Refuge bench', blocked.hasRefuge, JSON.stringify(blocked));
check('D1 Refuge bench is near spawn', blocked.refugeDistance <= 150, JSON.stringify(blocked));
check('old bottom shaft is sealed', blocked.bottomEmpty === 0, JSON.stringify(blocked));
check('falling to the bottom does not transition', blocked.afterFallId === 'd1', JSON.stringify(blocked));
check('D1 portal remains blocked before Heavy is slotted', blocked.blockedId === 'd1' && !blocked.portalOpen && !blocked.sanctumOpen, JSON.stringify(blocked));
check(
  'blocked portal points back to lab or bench',
  /HEAVY|BENCH|LAB/i.test([...blocked.objectives, ...blocked.toasts].join(' ')),
  JSON.stringify(blocked),
);

const opened = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  ctx.wands.grantCard(ctx, 'heavy');
  const heavyIndex = ctx.wands.collection.indexOf('heavy');
  if (heavyIndex >= 0) ctx.wands.slotCollectionCard(heavyIndex, 0, 1);
  rt.keyTaken = true;
  rt.portal.open = false;
  ctx.player.x = rt.portal.x;
  ctx.player.y = rt.portal.y + 6;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
  ctx.state.paused = false;
  await sleep(500);
  return {
    id: ctx.levels.current?.def.id,
    heavySlotted: ctx.wands.wands.some((wand) => wand.cards.includes('heavy')),
    sanctumOpen: ctx.sanctum.isOpen,
    overlayVisible: document.getElementById('sanctum-overlay')?.classList.contains('visible') === true,
  };
});

check('slotting Heavy opens the D1 descent sanctum', opened.heavySlotted && opened.sanctumOpen && opened.overlayVisible, JSON.stringify(opened));

await page.locator('#sanctum-overlay .perk-card').first().click();
await page.locator('#descend-btn').click();
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'd2', null, { timeout: 15000 });

const d2 = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  return {
    id: rt?.def.id,
    hasRefuge: !!rt?.refuge,
    playerAtSpawn: rt ? Math.abs(ctx.player.x - rt.spawn.x) < 40 && Math.abs(ctx.player.y - rt.spawn.y) < 40 : false,
  };
});

check('D1 portal descends after the bench gate is complete', d2.id === 'd2' && d2.playerAtSpawn, JSON.stringify(d2));
check('D2 does not place a recurring Wand Bench', d2.hasRefuge === false, JSON.stringify(d2));

for (const error of pageErrors) check('no page error: ' + error, false);

await browser.close();
console.log(`\nverify-descent-progression: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

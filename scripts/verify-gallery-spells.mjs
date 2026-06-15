// Gallery firing-range probe: the Alchemist's full pose set (crawl, wall
// grab, dive, skid, tells...) and the TACTICAL SPELLS live-fire demos —
// every spell chip must run its rig without errors, and the destructive
// ones must visibly reshape the scratch world's cells.
// Usage: node scripts/verify-gallery-spells.mjs [url]  (dev server running)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('dialog', (d) => d.accept());
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
const drawWarnings = [];
page.on('console', (msg) => {
  if (msg.text().includes('[gallery] preview draw failed')) drawWarnings.push(msg.text());
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2200);
await page.click('#mode-builder-btn');
await page.waitForTimeout(400);
await page.click('[data-menu="view"]');
await page.click('#b-gallery');
await page.waitForTimeout(500);
check('gallery opens', await page.isVisible('#builder-gallery'));

// REAL clicks only (synthetic events bypass hit-testing); scroll first —
// list rows live in an inner scroller and boundingBox lies for hidden rows
const clickByText = async (selector, text, textOf = null) => {
  const box = await page.evaluate(
    ({ selector, text, textOf }) => {
      const el = [...document.querySelectorAll(selector)].find(
        (e) => (textOf ? e.querySelector(textOf)?.textContent : e.textContent) === text,
      );
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { selector, text, textOf },
  );
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(200);
  return true;
};

check('select The Alchemist', await clickByText('#builder-gallery .bg-item', 'The Alchemist', '.bg-name'));
await page.waitForTimeout(300);
check(
  'alchemist is the selection',
  (await page.evaluate(
    () => document.querySelector('#builder-gallery .bg-item.sel .bg-name')?.textContent,
  )) === 'The Alchemist',
);

/* ---------- the pose set ---------- */
const stateChips = await page.$$eval('#builder-gallery .bg-chip[data-s]', (els) =>
  els.map((e) => e.textContent),
);
for (const want of [
  'CROUCH', 'CRAWL (loop)', 'CRAWL · CRAMPED', 'WALL GRAB', 'DIVE', 'SKID (loop)',
  'STATUS TELLS (loop)',
]) {
  check(`state chip: ${want}`, stateChips.includes(want), JSON.stringify(stateChips));
}

const caption = () => page.evaluate(() => document.getElementById('bg-caption')?.textContent ?? '');
const snap = () =>
  page.evaluate(() => {
    const c = document.getElementById('bg-stage');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] + d[i + 1] + d[i + 2];
      sum += v;
      if (v > 90) lit++;
    }
    return { lit, sum };
  });

for (const [chip, file] of [
  ['CRAWL (loop)', 'gallery-crawl.png'],
  ['CRAWL · CRAMPED', 'gallery-crawl-cramped.png'],
  ['WALL GRAB', 'gallery-wallgrab.png'],
  ['DIVE', 'gallery-dive.png'],
]) {
  await clickByText('#builder-gallery .bg-chip[data-s]', chip);
  await page.waitForTimeout(450);
  const s = await snap();
  check(`${chip}: body renders`, s.lit > 60, `lit=${s.lit}`);
  check(`${chip}: captioned`, (await caption()).includes(chip), await caption());
  await page.screenshot({ path: `verify-out/${file}` });
}
// loops actually animate
await clickByText('#builder-gallery .bg-chip[data-s]', 'CRAWL (loop)');
await page.waitForTimeout(300);
const c1 = await snap();
await page.waitForTimeout(350);
const c2 = await snap();
check('crawl loop animates', c1.sum !== c2.sum);

/* ---------- the firing range ---------- */
const spellChips = await page.$$eval('#builder-gallery .bg-chip[data-sp]', (els) =>
  els.map((e) => e.textContent),
);
check('15 tactical spell chips', spellChips.length === 15, JSON.stringify(spellChips));

// stage-region cell census straight off the gallery's scratch world
const cellCensus = () =>
  page.evaluate(() => {
    const g = window.__gallery;
    const w = g.world;
    const b = g.rig?.bounds ?? { x0: 68, y0: 74, x1: 182, y1: 126 };
    let solid = 0, fire = 0, stone = 0;
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const t = w.types[x + y * w.width];
        if (t !== 0) solid++;
        if (t === 5 || t === 20) fire++;
        if (t === 12) stone++;
      }
    }
    return { solid, fire, stone };
  });

// the destructive set must visibly reshape the stage's cells
const expectDelta = {
  'SPARK BOLT': 18, 'SCATTER HEX': 12, 'CAST BOMB': 60, 'METEOR': 120,
  'BLACK HOLE': 150, 'EXCAVATE RAY': 30, 'CONJURE STONE': 25, 'VITRIOL SPRAY': 10,
};

for (const label of spellChips) {
  await clickByText('#builder-gallery .bg-chip[data-sp]', label);
  await page.waitForTimeout(250);
  const before = await cellCensus();
  check(`${label}: stage painted`, before.solid > 900, `solid=${before.solid}`);
  check(`${label}: captioned`, (await caption()).includes(label), await caption());

  const need = expectDelta[label];
  const budgetMs = label === 'CAST BOMB' ? 5200 : label === 'BLACK HOLE' ? 6500 : 3200;
  let moved = false;
  let sawFire = false;
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    const now = await cellCensus();
    if (Math.abs(now.solid - before.solid) > (need ?? 9999)) moved = true;
    if (now.fire > 0) sawFire = true;
    if (need !== undefined ? moved : true) break;
    await page.waitForTimeout(140);
  }
  if (need !== undefined) check(`${label}: cells reshaped (>${need})`, moved);
  if (label === 'FLAMETHROWER') check('FLAMETHROWER: real fire cells land', sawFire);
  if (label === 'METEOR') await page.screenshot({ path: 'verify-out/gallery-meteor.png' });
  if (label === 'BLACK HOLE') await page.screenshot({ path: 'verify-out/gallery-blackhole.png' });
  if (label === 'SPARK BOLT') await page.screenshot({ path: 'verify-out/gallery-bolt.png' });
}

// arrows now walk the spell list while a spell demo is up
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
const afterArrow = await caption();
check('arrow keys cycle spells in spell mode', /—/.test(afterArrow), afterArrow);

// a state chip click leaves spell mode
await clickByText('#builder-gallery .bg-chip[data-s]', 'IDLE');
await page.waitForTimeout(200);
check('state chip exits spell mode', (await caption()).includes('IDLE'), await caption());

check('no preview draw failures', drawWarnings.length === 0, drawWarnings.join(' | '));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\ngallery-spells probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

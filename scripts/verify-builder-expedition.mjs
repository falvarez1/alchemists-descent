// Expedition-protection probe: opening the Builder mid-expedition must NOT
// edit the expedition level's live World (the save-family bleed blocker).
// The Builder detaches onto a scratch world; PLAY re-attaches the real one.
// Usage: node scripts/verify-builder-expedition.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
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

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2000);

/* ---------- enter the descent (a REAL expedition level, d1) ---------- */
console.log('-- descend');
await page.click('#mode-play-btn');
await page.waitForFunction(
  () => {
    const ctx = window.__game.ctx;
    return ctx.state.mode === 'play' && ctx.levels.current && !ctx.levels.transitioning;
  },
  { timeout: 30000 },
);
await page.waitForTimeout(800);
const d1 = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return { id: ctx.levels.current.def.id, attached: ctx.world === ctx.levels.current.world };
});
check('expedition running on its own live world', d1.id !== 'custom' && d1.attached, JSON.stringify(d1));

/* ---------- open the Builder: must detach, not adopt, the level ---------- */
console.log('-- open builder mid-expedition');
await page.click('#mode-builder-btn');
await page.waitForTimeout(400);
const det = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  return {
    mode: ctx.state.mode,
    detached: ctx.world !== ctx.levels.current.world,
    levelId: ctx.levels.current.def.id,
  };
});
check('builder detached onto a scratch world', det.detached, JSON.stringify(det));

/* paint into the scratch world; the expedition level must not change */
const before = await page.evaluate(() => {
  const w = window.__game.ctx.levels.current.world;
  let sum = 0;
  for (let y = 200; y < 240; y++) for (let x = 200; x < 240; x++) sum += w.types[w.idx(x, y)];
  return sum;
});
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world; // the SCRATCH world
  for (let y = 200; y < 240; y++)
    for (let x = 200; x < 240; x++) {
      const i = w.idx(x, y);
      w.types[i] = 13;
      w.colors[i] = 0x7a8a99;
    }
});
const after = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.levels.current.world;
  let sum = 0;
  for (let y = 200; y < 240; y++) for (let x = 200; x < 240; x++) sum += w.types[w.idx(x, y)];
  let scratch = 0;
  const sw = ctx.world;
  for (let y = 200; y < 240; y++) for (let x = 200; x < 240; x++) scratch += sw.types[sw.idx(x, y)];
  return { sum, scratch };
});
check('builder edits land in the scratch world', after.scratch === 13 * 40 * 40, `got ${after.scratch}`);
check('the expedition level is untouched', after.sum === before, `before ${before} after ${after.sum}`);

/* ---------- PLAY re-attaches the expedition's own world ---------- */
console.log('-- back to the descent');
await page.click('#mode-play-btn');
await page.waitForFunction(
  () => {
    const ctx = window.__game.ctx;
    return ctx.state.mode === 'play' && ctx.levels.current && !ctx.levels.transitioning;
  },
  { timeout: 30000 },
);
await page.waitForTimeout(500);
const back = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  let sum = 0;
  const w = ctx.world;
  for (let y = 200; y < 240; y++) for (let x = 200; x < 240; x++) sum += w.types[w.idx(x, y)];
  return {
    attached: ctx.world === ctx.levels.current.world,
    levelId: ctx.levels.current.def.id,
    probeSum: sum,
  };
});
check('play re-attaches the expedition world', back.attached, JSON.stringify(back));
check('no scratch metal bled into the level', back.probeSum === before, `before ${before} after ${back.probeSum}`);

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

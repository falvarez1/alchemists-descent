// One-off probe: the four new knowledge-loop teach-onces.
// grimoire-observed (worldInteractionObserved), wand-sentence (real B-key bench
// open), inspect-cell (Spell Lab proximity, after the lab's own popover),
// map-open (arrival at depth >= 2). Fresh context = clean seen-hints storage.
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.playerCtl, { timeout: 20000 });

// Collect every hintTeach key from the real bus.
await page.evaluate(() => {
  window.__hintKeys = [];
  window.__game.ctx.events.on('hintTeach', ({ key }) => window.__hintKeys.push(key));
});

// --- D1: spell-lab then inspect-cell at the same stations ---
await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const tick = (n) => { for (let f = 0; f < n; f++) window.__game.tick(); };
  await ctx.console.exec('run test --level d1 --world campaign-level');
  tick(20);
  const lab = ctx.levels.current?.spellLab;
  if (lab) {
    // Beside the lab, not on it: landing on the reward tome collects it and
    // its overlay pauses the game (known probe gotcha), freezing all hints.
    ctx.player.x = lab.x - 24;
    ctx.player.y = lab.y;
    tick(24); // hint scan runs every 4th frame; two teach beats need ~2 scans
  }
});
let keys = await page.evaluate(() => window.__hintKeys.slice());
check('spell-lab popover fired at the lab', keys.includes('spell-lab'), JSON.stringify(keys));
check('inspect-cell popover follows the lab popover', keys.indexOf('inspect-cell') > keys.indexOf('spell-lab'), JSON.stringify(keys));

// --- wand-sentence on a REAL B-key bench open ---
await page.keyboard.press('b');
await page.waitForTimeout(200);
keys = await page.evaluate(() => window.__hintKeys.slice());
check('bench open teaches the wand sentence', keys.includes('wand-sentence'), JSON.stringify(keys));
const benchCount = await page.evaluate(() => window.__game.ctx.telemetry.all()['bench.opened']);
check('bench.opened telemetry counted', benchCount >= 1, String(benchCount));
await page.keyboard.press('Escape');

// --- grimoire-observed via the real event bus ---
await page.evaluate(() => {
  window.__game.ctx.events.emit('worldInteractionObserved', { id: 'water-quenches-fire', title: 'Water quenches fire', x: 100, y: 100 });
});
keys = await page.evaluate(() => window.__hintKeys.slice());
check('witnessed reaction teaches the Grimoire', keys.includes('grimoire-observed'), JSON.stringify(keys));

// --- map-open on arrival at depth 2 ---
await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level d2 --world campaign-level');
  for (let f = 0; f < 10; f++) window.__game.tick();
});
keys = await page.evaluate(() => window.__hintKeys.slice());
check('first descent teaches the map', keys.includes('map-open'), JSON.stringify(keys));

// --- teach-once: repeats do not re-fire ---
const before = keys.length;
await page.evaluate(() => {
  window.__game.ctx.events.emit('worldInteractionObserved', { id: 'lava-flashes-water', title: 'Lava flashes water', x: 100, y: 100 });
});
await page.keyboard.press('b');
await page.waitForTimeout(200);
keys = await page.evaluate(() => window.__hintKeys.slice());
check('taught hints never re-fire', keys.length === before, JSON.stringify(keys.slice(before)));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nfirst-run hints probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

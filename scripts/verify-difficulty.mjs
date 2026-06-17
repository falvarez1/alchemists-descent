// Runtime probe for the difficulty system:
//  - the Start Run menu has a 4-option difficulty selector + a live blurb
//  - per-enemy scaling: harder levels spawn higher-damage, higher-HP foes
//  - the headline knob: a real level spawns FEWER foes on easy, MORE on hard
// Usage: node scripts/verify-difficulty.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.levels, { timeout: 20000 });

// ---- 1. the Start Run menu has the difficulty control ----------------------
const menu = await page.evaluate(() => {
  const sel = document.querySelector('[data-field="difficulty"]');
  const note = document.querySelector('[data-field="difficulty-note"]');
  const opts = sel ? Array.from(sel.options).map((o) => o.value) : [];
  let noteChanged = false;
  if (sel && note) {
    sel.value = '4';
    sel.dispatchEvent(new Event('change'));
    const archmage = note.textContent || '';
    sel.value = '1';
    sel.dispatchEvent(new Event('change'));
    noteChanged = (note.textContent || '') !== archmage && /apprentice/i.test(note.textContent || '');
  }
  return { hasSelect: !!sel, opts, hasNote: !!note, noteChanged };
});
check('menu has a difficulty selector with 4 levels', menu.hasSelect && menu.opts.join(',') === '1,2,3,4', JSON.stringify(menu));
check('menu shows a per-level blurb that updates on change', menu.hasNote && menu.noteChanged, JSON.stringify(menu));

// ---- 2. per-enemy scaling: damage + HP rise with difficulty ----------------
await page.evaluate(() => window.__game.ctx.levels.startRun(window.__game.ctx, { mode: 'test', worldSource: 'campaign-level', levelId: 'physics-test', seed: 1, loadout: 'fresh' }));
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'physics-test', { timeout: 20000 });
await page.waitForFunction(() => window.__game.ctx.levels._transitioning === false, { timeout: 10000 });
const perEnemy = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const sample = (d) => {
    ctx.state.difficulty = d;
    ctx.enemies.length = 0;
    ctx.enemyCtl.spawn('slime', 300, 699);
    const e = ctx.enemies[ctx.enemies.length - 1];
    return e ? { dmgK: +e.dmgK.toFixed(3), maxHp: e.maxHp } : null;
  };
  const easy = sample(1);
  const hard = sample(4);
  ctx.enemies.length = 0;
  return { easy, hard };
});
check('harder foes deal more damage (dmgK scales)', perEnemy.hard && perEnemy.easy && perEnemy.hard.dmgK > perEnemy.easy.dmgK, JSON.stringify(perEnemy));
check('harder foes have more HP', perEnemy.hard && perEnemy.easy && perEnemy.hard.maxHp > perEnemy.easy.maxHp, JSON.stringify(perEnemy));

// ---- 3. headline: a real level spawns fewer foes on easy, more on hard ------
const countAt = async (difficulty) => {
  await page.evaluate((d) => window.__game.ctx.levels.startRun(window.__game.ctx, { mode: 'test', worldSource: 'campaign-level', levelId: 'd1', seed: 7, difficulty: d }), difficulty);
  await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'd1', { timeout: 40000 });
  await page.waitForFunction(() => window.__game.ctx.levels._transitioning === false, { timeout: 15000 });
  // population spawns during enterLevel; give it a moment to settle
  await page.waitForTimeout(400);
  return page.evaluate(() => window.__game.ctx.enemies.length);
};
const easyCount = await countAt(1);
const hardCount = await countAt(4);
check('easy spawns far fewer foes than hard on the same level/seed', easyCount > 0 && hardCount > easyCount, JSON.stringify({ easyCount, hardCount }));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\ndifficulty probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

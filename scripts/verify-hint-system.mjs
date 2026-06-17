// Runtime probe for the contextual HintSystem (onboarding tier 1/2/3). Confirms
// the nearest interactable raises the right hint line, the HUD shows it, the
// teach-once popover fires (and only once), priority ordering holds, and the
// goal-loop hints (cauldron / portal / key) read their runtime state. Uses the
// physics-test playground's real lever + liquids, and injects cauldron/portal/key.
// Usage: node scripts/verify-hint-system.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
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
await page.waitForFunction(() => window.__game?.ctx?.hints, { timeout: 20000 });
await page.evaluate(() => window.__game.ctx.levels.startRun(window.__game.ctx, { mode: 'test', worldSource: 'campaign-level', levelId: 'physics-test', seed: 1, loadout: 'fresh' }));
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'physics-test', { timeout: 20000 });
await page.waitForFunction(() => window.__game.ctx.levels._transitioning === false, { timeout: 10000 });

// helper that runs inside the page: teleport, tick, report current hint + DOM
const probe = async (setup) => page.evaluate((setupSrc) => {
  const ctx = window.__game.ctx;
  // eslint-disable-next-line no-new-func
  (new Function('ctx', setupSrc))(ctx);
  ctx.player.dead = false;
  for (let f = 0; f < 8; f++) window.__game.tick();
  const cur = ctx.hints.current;
  const hintEl = document.getElementById('interaction-hint');
  const teachEl = document.getElementById('hint-teach-overlay');
  return {
    key: cur?.key ?? null,
    line: cur?.line ?? '',
    hudText: hintEl?.textContent ?? '',
    hudVisible: !!hintEl?.classList.contains('visible'),
    teachVisible: !!teachEl?.classList.contains('visible'),
    teachTitle: teachEl?.querySelector('.hint-teach-title')?.textContent ?? '',
  };
}, setup);

// count teach events across the run
await page.evaluate(() => {
  window.__teaches = [];
  window.__game.ctx.events.on('hintTeach', (t) => window.__teaches.push(t.key));
});

// ---- A. lever (real playground lever at 650) -> hint + HUD + teach ----------
const lever = await probe(`ctx.player.x = 650; ctx.player.y = 699;`);
check('standing by the lever raises the lever hint', lever.key === 'lever', JSON.stringify(lever));
check('HUD shows the hint line + becomes visible', lever.hudVisible && lever.hudText === lever.line && lever.line.length > 0, JSON.stringify(lever));
check('teach-once popover opens with the right title', lever.teachVisible && /lever/i.test(lever.teachTitle), JSON.stringify(lever));

// ---- B. teach fires only once per category ---------------------------------
const leverAgain = await probe(`ctx.player.x = 200; ctx.player.y = 699; ctx.player.x = 650;`);
const teachCounts = await page.evaluate(() => {
  const c = {};
  for (const k of window.__teaches) c[k] = (c[k] || 0) + 1;
  return c;
});
check('re-approaching the lever does not re-teach', (teachCounts.lever ?? 0) === 1, JSON.stringify({ teachCounts, leverAgain: leverAgain.key }));

// ---- C. flask: near the water pool (a siphonable liquid) -------------------
const flask = await probe(`ctx.player.x = 845; ctx.player.y = 699; ctx.levels.current.cauldron = null;`);
check('near a liquid raises the flask hint', flask.key === 'flask', JSON.stringify(flask));

// ---- D. priority: a cauldron at the same spot beats the flask hint ---------
const priority = await probe(`ctx.levels.current.cauldron = { x: 845, y: 699 }; ctx.player.x = 845; ctx.player.y = 699;`);
check('object hints outrank the flask fallback', priority.key === 'cauldron', JSON.stringify(priority));

// ---- E. portal: sealed without the key, open with it -----------------------
const sealed = await probe(`ctx.levels.current.cauldron = null; ctx.levels.current.portal = { x: 760, y: 695, open: false }; ctx.levels.current.keyTaken = false; ctx.player.x = 760; ctx.player.y = 699;`);
check('sealed portal hint names the Golden Key', sealed.key === 'portal' && /seal|key/i.test(sealed.line), JSON.stringify(sealed));
const opened = await probe(`ctx.levels.current.keyTaken = true; ctx.player.x = 760; ctx.player.y = 699;`);
check('with the key, the portal hint says step in', opened.key === 'portal' && /open|descend|step/i.test(opened.line), JSON.stringify(opened));

// ---- F. golden key pickup hint ---------------------------------------------
const key = await probe(`ctx.levels.current.portal = null; ctx.levels.current.keyTaken = false; ctx.levels.current.pickups.push({ kind: 'key', x: 785, y: 699, vx: 0, vy: 0, taken: false, data: {} }); ctx.player.x = 760; ctx.player.y = 699;`);
check('an uncollected key raises the key hint', key.key === 'key', JSON.stringify(key));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nhint system probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

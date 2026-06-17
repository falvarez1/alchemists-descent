// Runtime probe for airborne horizontal control: a quick A/D tap while
// levitating/jumping should move a small, controlled distance (not skate ~60
// cells), while a fast run carried into the air still GLIDES.
// Usage: node scripts/verify-air-tap.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1300, height: 860 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.physics, { timeout: 20000 });
await page.evaluate(() => window.__game.ctx.levels.startRun(window.__game.ctx, { mode: 'test', worldSource: 'campaign-level', levelId: 'physics-test', seed: 1, loadout: 'fresh' }));
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'physics-test', { timeout: 20000 });
await page.waitForFunction(() => window.__game.ctx.levels._transitioning === false, { timeout: 10000 });

// hover (levitate) in open air, tap right `hold` frames, release; measure coast
const airTap = (hold) => page.evaluate((hold) => {
  const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
  for (let y = 380; y <= 720; y++) for (let x = 280; x <= 920; x++) { const i = w.idx(x, y); w.types[i] = 0; w.colors[i] = 0; }
  p.x = 600; p.y = 560; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
  p.dead = false; p.crawling = false; p.climbing = false; p.inLiquid = false; p.grounded = false;
  p.levit = 100; p.maxLevit = 100;
  for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  ctx.input.keys.jump = true; // levitate -> stay airborne
  for (let f = 0; f < 4; f++) window.__game.tick();
  const x0 = p.x;
  ctx.input.keys.right = true;
  for (let f = 0; f < hold; f++) window.__game.tick();
  ctx.input.keys.right = false;
  let coastFrames = 0;
  for (let f = 0; f < 80; f++) { window.__game.tick(); if (Math.abs(p.vx) < 0.05) break; coastFrames++; }
  ctx.input.keys.jump = false;
  return { dist: +(p.x - x0).toFixed(1), coastFrames, grounded: p.grounded };
}, hold);

const t1 = await airTap(1);
const t3 = await airTap(3);
console.log(`  ..    air tap distance: 1f=${t1.dist}c (${t1.coastFrames}f coast)  3f=${t3.dist}c (${t3.coastFrames}f coast)`);
check('a 1-frame air tap barely moves (<= 6 cells, was ~30+)', t1.dist >= 0 && t1.dist <= 6, JSON.stringify(t1));
check('a 3-frame air tap stays controlled (<= 12 cells)', t3.dist <= 12, JSON.stringify(t3));
check('an air tap stops fast (no long skate, <= 10 coast frames)', t1.coastFrames <= 10 && t3.coastFrames <= 10, JSON.stringify({ t1: t1.coastFrames, t3: t3.coastFrames }));

// carried momentum: a fast run carried into the air still glides far
const glide = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
  for (let y = 380; y <= 720; y++) for (let x = 280; x <= 1100; x++) { const i = w.idx(x, y); w.types[i] = 0; w.colors[i] = 0; }
  p.x = 400; p.y = 560; p.vy = 0; p.fx = 0; p.fy = 0;
  p.dead = false; p.crawling = false; p.climbing = false; p.inLiquid = false; p.grounded = false;
  p.levit = 100; p.maxLevit = 100; p.vx = 2.6; // a full run carried into the air
  for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  ctx.input.keys.jump = true; // levitate, NO horizontal input — pure glide
  const x0 = p.x;
  for (let f = 0; f < 40; f++) window.__game.tick();
  ctx.input.keys.jump = false;
  return { dist: +(p.x - x0).toFixed(1) };
});
console.log(`  ..    carried glide (vx 2.6, no input, 40f): ${glide.dist}c`);
check('a carried run still GLIDES (momentum preserved, > 18 cells)', glide.dist > 18, JSON.stringify(glide));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\nair-tap probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

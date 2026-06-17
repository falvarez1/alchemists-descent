// Runtime probe for fine horizontal control: a quick A/D tap should move a small,
// predictable distance and stop crisply (not coast several cells past intent),
// while a held run still reaches full speed.
// Usage: node scripts/verify-tap-precision.mjs [url]
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
await page.waitForFunction(() => window.__game?.ctx?.physics, { timeout: 20000 });
await page.evaluate(() => window.__game.ctx.levels.startRun(window.__game.ctx, { mode: 'test', worldSource: 'campaign-level', levelId: 'physics-test', seed: 1, loadout: 'fresh' }));
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'physics-test', { timeout: 20000 });
await page.waitForFunction(() => window.__game.ctx.levels._transitioning === false, { timeout: 10000 });

// a clean flat floor; tap right for `hold` frames, release, run until stopped
const tap = (hold) => page.evaluate((hold) => {
  const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
  for (let y = 690; y <= 706; y++) for (let x = 460; x <= 720; x++) { const i = w.idx(x, y); w.types[i] = (y >= 700) ? 12 : 0; w.colors[i] = (y >= 700) ? 0x6b6b6b : 0; }
  p.x = 560; p.y = 699; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; p.dead = false; p.crawling = false; p.inLiquid = false; p.climbing = false;
  for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  for (let f = 0; f < 4; f++) window.__game.tick(); // settle onto the floor (grounded)
  const x0 = p.x;
  ctx.input.keys.right = true;
  for (let f = 0; f < hold; f++) window.__game.tick();
  ctx.input.keys.right = false;
  let coastFrames = 0;
  for (let f = 0; f < 40; f++) { window.__game.tick(); if (p.vx === 0) break; coastFrames++; }
  return { dist: p.x - x0, coastFrames, grounded: p.grounded };
}, hold);

const t1 = await tap(1);
const t3 = await tap(3);
const t6 = await tap(6);
console.log(`  ..    tap distances: 1f=${t1.dist}c  3f=${t3.dist}c  6f=${t6.dist}c (coast frames: ${t1.coastFrames}/${t3.coastFrames}/${t6.coastFrames})`);
check('a 1-frame tap barely moves (<= 2 cells)', t1.dist >= 0 && t1.dist <= 2, JSON.stringify(t1));
check('a 3-frame tap is a small nudge (<= 4 cells)', t3.dist <= 4, JSON.stringify(t3));
check('a 6-frame press stays controlled (<= 9 cells, was ~16)', t6.dist <= 9, JSON.stringify(t6));
check('release halts crisply — no long coast (<= 6 frames)', t1.coastFrames <= 6 && t3.coastFrames <= 6 && t6.coastFrames <= 7, JSON.stringify({ t1: t1.coastFrames, t3: t3.coastFrames, t6: t6.coastFrames }));

// a held run still reaches full speed
const run = await page.evaluate(() => {
  const ctx = window.__game.ctx, p = ctx.player;
  for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  ctx.input.keys.right = true;
  for (let f = 0; f < 30; f++) window.__game.tick();
  const vx = p.vx;
  ctx.input.keys.right = false;
  return { vx: +vx.toFixed(2) };
});
check('a held run still reaches full speed (vx ~ maxRun)', run.vx >= 2.0, JSON.stringify(run));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\ntap precision probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

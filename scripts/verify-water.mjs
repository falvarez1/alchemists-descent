// P5 water buoyancy + splash, in the PHYSICS TEST ARENA's pool:
//  - a wood body floats near the surface; metal & stone sink to the basin floor
//  - wood floats well above where metal settles (material density drives it)
//  - dropping a body in spawns a splash of real water particles
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
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.rigidBodies, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const tick = (n) => { for (let f = 0; f < n; f++) window.__game.tick(); };
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  tick(30);
  const rb = ctx.rigidBodies;
  const WATER = 2; // Cell.Water
  const POOL_X = 1030; // pool centre (basin x ~953..1107, water y 560..597)
  const drop = (material) => rb.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, POOL_X, 545, { material, friction: 0.6, restitution: 0.1 });
  const settleAt = (material) => { rb.clear(); const b = drop(material); tick(260); return +b.y.toFixed(1); };

  const woodY = settleAt('wood');
  const metalY = settleAt('metal');
  const stoneY = settleAt('stone');

  // SPLASH: let particles settle, then drop a body and track the PEAK water-particle
  // count over its plunge (splash droplets redeposit into the pool within a few frames).
  rb.clear();
  tick(50);
  const countWaterP = () => ctx.particles.list.filter((p) => p.type === WATER).length;
  const waterPBefore = countWaterP();
  drop('metal');
  let waterPPeak = 0;
  for (let f = 0; f < 30; f++) { window.__game.tick(); waterPPeak = Math.max(waterPPeak, countWaterP()); }

  return { woodY, metalY, stoneY, waterPBefore, waterPPeak };
});

check('wood FLOATS near the surface', r.woodY < 578, JSON.stringify(r));
check('metal SINKS to the basin floor', r.metalY > 588, JSON.stringify(r));
check('stone SINKS to the basin floor', r.stoneY > 588, JSON.stringify(r));
check('wood floats well above where metal sinks', r.metalY - r.woodY > 12, JSON.stringify(r));
// The exact droplet count is throttled by the (concurrent) particle-pool refactor,
// so assert the splash FIRES (≥1 water droplet appears that wasn't there before).
check('a body plunging in makes a water splash', r.waterPPeak > r.waterPBefore, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nwater probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

// P4 dispenser entity + lever, in the PHYSICS TEST ARENA:
//  - the lever is wired to the dispenser (lever.targetId === dispenser.id)
//  - while the lever is OFF, nothing is emitted
//  - pulling the lever (ON) rains crates from the hopper, COOLDOWN-gated
//    (not one-per-frame), spawned near the mouth
//  - the active CAP holds (oldest despawned) so it never floods
//  - turning the lever OFF stops emission
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
  const mechs = ctx.levels.current.mechanisms;
  const lever = mechs.find((m) => m.kind === 'lever');
  const disp = mechs.find((m) => m.kind === 'dispenser');
  const wired = !!lever && !!disp && lever.targetId === disp.id;

  rb.clear(); // start from zero bodies so counts are unambiguous

  // lever OFF → nothing emitted
  lever.state = 0;
  tick(40);
  const offCount = rb.bodies.length;

  // pull the lever ON → crates start raining (cooldown-gated)
  lever.state = 1;
  tick(60);
  const after60 = rb.bodies.length;
  const nearMouth = rb.bodies.length > 0 && rb.bodies.every((b) => Math.abs(b.x - disp.x) < 70);

  // keep it on long past cap×cooldown → the active cap holds
  tick(300);
  const capped = rb.bodies.length;

  // turn it OFF → emission stops (count doesn't keep growing)
  lever.state = 0;
  const beforeOff = rb.bodies.length;
  tick(80);
  const afterOff = rb.bodies.length;

  return {
    wired, offCount, after60, nearMouth, capped, beforeOff, afterOff,
    dispMax: disp.dispMax, dispX: disp.x,
  };
});

check('lever is wired to the dispenser', r.wired, JSON.stringify(r));
check('OFF → nothing is dispensed', r.offCount === 0, JSON.stringify(r));
check('pulling the lever dispenses crates', r.after60 >= 2, JSON.stringify(r));
check('emission is cooldown-gated (not one per frame)', r.after60 < 30, JSON.stringify(r));
check('crates spawn near the hopper mouth', r.nearMouth, JSON.stringify(r));
check('active cap holds (no flood)', r.capped <= r.dispMax && r.capped >= r.dispMax - 2, JSON.stringify(r));
check('turning it OFF stops emission', r.afterOff <= r.beforeOff, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\ndispenser probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

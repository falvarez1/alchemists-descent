// Explosive barrels (physics-joy wave 2), in the PHYSICS TEST playground:
//  - fire ignites a barrel → after a short fuse it detonates (and flings a witness)
//  - a blast on one barrel chain-detonates a cluster
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
  tick(20);
  const w = ctx.world;
  const rb = ctx.rigidBodies;
  const FIRE = 5;
  const barrel = (x, y) => rb.spawn({ kind: 'box', halfW: 3.5, halfH: 4.5 }, x, y, { material: 'wood', payload: 'explosive', friction: 0.6, restitution: 0.1 });

  // ---- FIRE → fuse → detonate (and fling a witness crate) ----
  rb.clear();
  const b = barrel(200, 693);
  const witness = rb.spawn({ kind: 'box', halfW: 3, halfH: 3 }, 220, 696, { material: 'wood', friction: 0.6, restitution: 0.15 });
  tick(30);
  const wx0 = witness.x;
  for (const fx of [195, 205]) { w.replaceCellAt(w.idx(fx, 695), FIRE, 0xff7722); w.life[w.idx(fx, 695)] = 200; }
  let fuseFrames = -1;
  for (let f = 0; f < 120; f++) { window.__game.tick(); if (fuseFrames < 0 && !rb.bodies.includes(b)) fuseFrames = f; }
  const detonated = fuseFrames >= 0;
  const witnessFlung = !rb.bodies.includes(witness) || Math.abs(witness.x - wx0) > 2;

  // ---- BLAST → chain detonation across a cluster ----
  rb.clear();
  const cluster = [barrel(200, 693), barrel(212, 693), barrel(224, 693)];
  tick(30);
  const n0 = rb.bodies.length;
  ctx.explosions.trigger(200, 693, 16); // set off the first
  tick(24);
  const remaining = rb.bodies.filter((x) => cluster.includes(x)).length;

  return { detonated, fuseFrames, witnessFlung, n0, remaining };
});

check('fire ignites a barrel and it detonates (fuse)', r.detonated, JSON.stringify(r));
check('the fuse is gated (not instant)', r.fuseFrames > 8, JSON.stringify(r));
check('the blast flings a nearby witness crate', r.witnessFlung, JSON.stringify(r));
check('a cluster of 3 barrels was spawned', r.n0 === 3, JSON.stringify(r));
check('one blast chain-detonates the whole cluster', r.remaining === 0, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nbarrels probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

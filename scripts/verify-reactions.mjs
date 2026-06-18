// P2 spell/material reactions on rigid bodies, in the PHYSICS TEST ARENA:
//  - DIG: the dig beam shoves a crate along its path
//  - FROST: frozenT damps a body's motion; a frost shot sets frozenT
//  - LIGHTNING: a bolt conducts into a metal body (charges it) but passes a wood one
//  - FIRE: a wood body lit by fire burns up and leaves real ash cells
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
  const w = ctx.world; // capture AFTER the level loads — run test swaps ctx.world
  const rb = ctx.rigidBodies;
  const box = (x, material, half = 3.5, y = 596) => rb.spawn({ kind: 'box', halfW: half, halfH: half }, x, y, { material, friction: 0.6, restitution: 0.15 });
  const FIRE = 5; // Cell.Fire
  const countSolid = (x0, x1, y0, y1) => {
    let n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.inBounds(x, y) && w.types[w.idx(x, y)] !== 0) n++;
    return n;
  };

  // ---- DIG: beam shoves a crate ----
  rb.clear();
  let c = box(800, 'wood');
  tick(40);
  const digX0 = c.x;
  for (let f = 0; f < 24; f++) { ctx.fx.digBeam = { x0: 788, y0: c.y, x1: 818, y1: c.y, life: 3 }; tick(1); }
  ctx.fx.digBeam = null;
  const digPush = c.x - digX0;

  // ---- FROST: frozenT damps motion (control vs frozen, same impulse) ----
  rb.clear();
  c = box(810, 'wood');
  tick(40);
  let x0 = c.x;
  rb.applyImpulse(c, 3, 0);
  tick(30);
  const ctrlDist = c.x - x0;

  rb.clear();
  c = box(810, 'wood');
  tick(40);
  x0 = c.x;
  rb.applyImpulse(c, 3, 0);
  c.frozenT = 90;
  tick(30);
  const frozenDist = c.x - x0;

  // ---- FROST: an iceshard sets frozenT on the body it hits ----
  rb.clear();
  c = box(845, 'wood');
  tick(40);
  ctx.projectiles.push({ x: c.x - 25, y: c.y, vx: 9, vy: 0, type: 'iceshard', life: 120, age: 0, charging: false, hostile: false, mul: 1 });
  tick(8);
  const frostSet = c.frozenT ?? 0;

  // ---- LIGHTNING: conducts into metal (bolt terminates AT the crate); a wood
  //      body doesn't conduct so the bolt passes through to the floor below.
  //      (Charge doesn't persist on the empty cells a body occupies, so we read
  //      where the arc ended instead.) Cast straight down onto the crate top.
  rb.clear();
  let m = box(820, 'metal', 8, 592);
  tick(40);
  ctx.lightning.arcs.length = 0;
  ctx.lightning.cast(m.x, m.y - 16, Math.PI / 2);
  const ma = ctx.lightning.arcs[0];
  const metalEndY = ma ? ma.pts[ma.pts.length - 1].y : 999;
  const metalCenter = m.y;

  rb.clear();
  let wd = box(820, 'wood', 8, 592);
  tick(40);
  ctx.lightning.arcs.length = 0;
  ctx.lightning.cast(wd.x, wd.y - 16, Math.PI / 2);
  const wa = ctx.lightning.arcs[0];
  const woodEndY = wa ? wa.pts[wa.pts.length - 1].y : 999;

  // ---- FIRE: a wood body burns up to ash (run last — it leaves cells).
  //      Clear the spot first: the lightning explosions scatter stone debris. ----
  rb.clear();
  for (let y = 585; y <= 599; y++) for (let x = 790; x <= 810; x++) w.clearCellAt(w.idx(x, y));
  c = box(800, 'wood');
  tick(40);
  const ashX = Math.round(c.x);
  const ashYc = Math.round(c.y);
  const before = countSolid(ashX - 4, ashX + 4, ashYc - 3, 699); // ash powder settles toward the floor
  // engulf the body's footprint in fire (3 cols × 4 rows, inside the scan margin)
  for (let fy = ashYc - 2; fy <= ashYc + 1; fy++) {
    for (const fx of [ashX - 3, ashX, ashX + 3]) {
      if (!w.inBounds(fx, fy)) continue;
      const fi = w.idx(fx, fy);
      w.replaceCellAt(fi, FIRE, 0xff7722);
      w.life[fi] = 260;
    }
  }
  tick(5);
  const ignited = c.burnT ?? 0;
  const n0 = rb.bodies.length;
  tick(230);
  const burnedAway = rb.bodies.length < n0;
  const ashAfter = countSolid(ashX - 4, ashX + 4, ashYc - 3, 699);

  return {
    digPush: +digPush.toFixed(2),
    ctrlDist: +ctrlDist.toFixed(2), frozenDist: +frozenDist.toFixed(2), frostSet,
    metalEndY: +metalEndY.toFixed(1), woodEndY: +woodEndY.toFixed(1), metalCenter: +metalCenter.toFixed(1),
    ignited, burnedAway, before, ashAfter,
  };
});

check('DIG beam shoves a crate along its path', r.digPush > 2, JSON.stringify(r));
check('FROST damps a body (frozen travels << control)', r.frozenDist < r.ctrlDist * 0.5, JSON.stringify(r));
check('FROST shot sets frozenT on the body it hits', r.frostSet > 0, JSON.stringify(r));
check('LIGHTNING conducts into a metal body (bolt stops at it)', r.metalEndY <= r.metalCenter + 1, JSON.stringify(r));
check('LIGHTNING passes through a wood body (reaches further)', r.woodEndY > r.metalEndY + 4, JSON.stringify(r));
check('FIRE ignites a wood body', r.ignited > 0, JSON.stringify(r));
check('FIRE burns the body away', r.burnedAway, JSON.stringify(r));
check('FIRE leaves real ash cells where it was', r.ashAfter > r.before + 3, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nreactions probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

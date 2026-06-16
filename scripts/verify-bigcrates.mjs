// P3 larger crates + size×material variety, in the PHYSICS TEST ARENA:
//  - a large metal crate resists a KICK far more than a small wood one (mass)
//  - a large metal crate resists a BLAST far more than a small wood one
//  - a large WOOD crate shatters into smaller crates (+ ash rubble) when bombed
//  - sizes coexist
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
  const p = ctx.player;
  const small = (x, material) => rb.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, x, 596, { material, friction: 0.6, restitution: 0.15 });
  const large = (x, material) => rb.spawn({ kind: 'box', halfW: 6, halfH: 6 }, x, 588, { material, friction: 0.7, restitution: 0.1 });
  const placePlayer = (x, y) => { p.dead = false; p.crawling = false; p.climbing = false; p.diveT = 0; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; };
  const kickAt = (angle) => { p.aimAngle = angle; ctx.playerCtl.kick(ctx); };
  const ASH = 32;
  const countAsh = (cx, cy, rad) => { let n = 0; for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) if (w.inBounds(x, y) && w.types[w.idx(x, y)] === ASH) n++; return n; };

  // ---- KICK resist: small wood flies, large metal barely moves ----
  rb.clear();
  let c = small(800, 'wood');
  tick(40);
  placePlayer(c.x - 10, 599);
  let x0 = c.x;
  kickAt(0);
  tick(20);
  const smallWoodKick = c.x - x0;

  rb.clear();
  c = large(820, 'metal');
  tick(40);
  placePlayer(c.x - 13, 599);
  x0 = c.x;
  kickAt(0);
  tick(20);
  const largeMetalKick = c.x - x0;

  const crashes = [];
  // ---- BLAST resist: small wood flung, large metal resists (no shatter) ----
  let smallWoodBlast = -1, largeMetalBlast = -1, metalStillWhole = false;
  try {
    rb.clear();
    c = small(800, 'wood');
    tick(40);
    x0 = c.x;
    ctx.explosions.trigger(c.x - 8, c.y, 16);
    tick(20);
    smallWoodBlast = Math.abs(c.x - x0);
  } catch (e) { crashes.push('blast-small: ' + e.message); }

  try {
    rb.clear();
    c = large(820, 'metal');
    tick(40);
    x0 = c.x;
    const beforeN = rb.bodies.length;
    ctx.explosions.trigger(c.x - 8, c.y, 16);
    tick(20);
    largeMetalBlast = Math.abs(c.x - x0);
    metalStillWhole = rb.bodies.length === beforeN; // metal does NOT shatter
  } catch (e) { crashes.push('blast-large-metal: ' + e.message); }

  // ---- sizes coexist ----
  rb.clear();
  const a = small(800, 'wood');
  const b = large(830, 'metal');
  tick(30);
  const coexist = rb.bodies.length === 2 && Math.abs(a.shape.halfW - b.shape.halfW) > 1;

  // ---- SHATTER: a large wood crate bombed → smaller crates + ash (run last).
  //      x=845 is clean under-platform floor (clear of the x864+ staircase). ----
  let n0 = -1, pieces = -1, allSmallWood = false, ash = -1;
  try {
    rb.clear();
    for (let y = 574; y <= 599; y++) for (let x = 828; x <= 862; x++) w.clearCellAt(w.idx(x, y));
    c = large(845, 'wood');
    tick(40);
    n0 = rb.bodies.length;
    const sx = c.x, sy = c.y;
    ctx.explosions.trigger(sx, sy, 18);
    tick(5);
    pieces = rb.bodies.length;
    allSmallWood = rb.bodies.length > 0 && rb.bodies.every((bd) => bd.shape.kind === 'box' && bd.shape.halfW < 4 && bd.material === 'wood');
    ash = countAsh(Math.round(sx), Math.round(sy), 12);
  } catch (e) { crashes.push('shatter: ' + e.message); }

  return {
    smallWoodKick: +smallWoodKick.toFixed(2), largeMetalKick: +largeMetalKick.toFixed(2),
    smallWoodBlast: +smallWoodBlast.toFixed(2), largeMetalBlast: +largeMetalBlast.toFixed(2), metalStillWhole,
    coexist, n0, pieces, allSmallWood, ash, crashes,
  };
});
if (r.crashes?.length) console.log('CRASHES:', JSON.stringify(r.crashes));

check('large metal resists a KICK far more than small wood', r.smallWoodKick > r.largeMetalKick * 3 + 1 && r.largeMetalKick < 2, JSON.stringify(r));
check('large metal resists a BLAST far more than small wood', r.smallWoodBlast > r.largeMetalBlast * 3 + 1, JSON.stringify(r));
check('metal does NOT shatter (tough)', r.metalStillWhole, JSON.stringify(r));
check('sizes coexist', r.coexist, JSON.stringify(r));
check('large wood SHATTERS into multiple crates', r.pieces >= 2 && r.pieces <= 5 && r.n0 === 1, JSON.stringify(r));
check('shatter pieces are small wood crates', r.allSmallWood, JSON.stringify(r));
check('shatter leaves ash rubble', r.ash > 0, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nbig-crates probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

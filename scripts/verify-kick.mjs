// P1 kick (bound to F) in the PHYSICS TEST ARENA:
//  - launches a light wood crate far, a heavy metal crate barely (mass-aware)
//  - recoils the wizard off a heavy body, and kick-jumps him off the floor
//  - respects its cooldown (a second immediate kick does nothing)
// NB: aimAngle is recomputed from the mouse every tick, so it's set immediately
// before each kick() with no intervening tick.
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
  const rb = ctx.rigidBodies;
  const p = ctx.player;
  const box = (x, material) => rb.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, x, 596, { material, friction: 0.6, restitution: 0.15 });
  const placePlayer = (x, y) => { p.dead = false; p.crawling = false; p.climbing = false; p.diveT = 0; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; };
  // aim + kick atomically (no tick in between, or the mouse overwrites aimAngle)
  const kickAt = (angle) => { p.aimAngle = angle; ctx.playerCtl.kick(ctx); };

  // ---- mass-aware launch: wood flies, metal resists ----
  rb.clear();
  let c = box(812, 'wood');
  tick(40);                 // settle crate + drain any prior cooldown
  placePlayer(800, 599);
  const wcx0 = c.x;
  kickAt(0);                // kick right
  const kickT = p.kickT;
  tick(30);
  const woodKick = c.x - wcx0;

  rb.clear();
  c = box(812, 'metal');
  tick(40);
  placePlayer(800, 599);
  const mcx0 = c.x;
  kickAt(0);
  tick(30);
  const metalKick = c.x - mcx0;

  // ---- recoil off a heavy body (kick right → wizard shoved left) ----
  rb.clear();
  c = box(810, 'metal');
  tick(40);
  placePlayer(800, 599);
  kickAt(0);
  const recoilVx = p.vx; // applied synchronously by kick()

  // ---- kick-jump: kick straight down near the floor → upward boost ----
  rb.clear();
  tick(25);                 // drain cooldown from the recoil kick
  placePlayer(800, 596);    // airborne just above the floor
  kickAt(Math.PI / 2);      // down
  const jumpVy = p.vy;

  // ---- cooldown: a second immediate kick is a no-op ----
  rb.clear();
  c = box(812, 'wood');
  tick(40);
  placePlayer(800, 599);
  const scx0 = c.x;
  kickAt(0);
  tick(30);
  const dispSingle = c.x - scx0;

  rb.clear();
  c = box(812, 'wood');
  tick(40);
  placePlayer(800, 599);
  const dcx0 = c.x;
  kickAt(0);
  kickAt(0); // blocked by cooldown (no tick between)
  tick(30);
  const dispDouble = c.x - dcx0;

  return {
    woodKick: +woodKick.toFixed(2), metalKick: +metalKick.toFixed(2), kickT,
    recoilVx: +recoilVx.toFixed(2), jumpVy: +jumpVy.toFixed(2),
    dispSingle: +dispSingle.toFixed(2), dispDouble: +dispDouble.toFixed(2),
  };
});

check('kick launches a light wood crate', r.woodKick > 3, JSON.stringify(r));
check('kick is mass-aware (wood >> metal)', r.woodKick > r.metalKick * 1.8 + 0.5, JSON.stringify(r));
check('kick sets the kick pose (kickT)', r.kickT > 0, JSON.stringify(r));
check('kicking a heavy body recoils the wizard back', r.recoilVx < -1.5, JSON.stringify(r));
check('kicking down near the floor kick-jumps him up', r.jumpVy < -2, JSON.stringify(r));
check('cooldown blocks an immediate second kick', r.dispDouble < r.dispSingle * 1.4, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\nkick probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

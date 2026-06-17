// #1 Grab & throw, in the PHYSICS TEST ARENA:
//  - grab a light crate → it follows the wizard's hand point (hovers, tracks him)
//  - throw it → it flies along the aim
//  - a too-heavy body (large metal) can't be grabbed
// Aim is mouse-driven and only recomputed on a tick, so: park the cursor far
// right once (persists → ticks make aim ≈ 0), and set aimAngle directly right
// before each grab/release call (no tick between).
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
  const p = ctx.player;
  ctx.input.mouse.x = 1100; ctx.input.mouse.y = 430; // park cursor right -> aim ~ 0
  const clearBed = () => {}; // new test spot (x~350) is clean floor
  const placePlayer = (x) => { p.dead = false; p.crawling = false; p.climbing = false; p.diveT = 0; p.x = x; p.y = 699; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; };

  // ---- GRAB + FOLLOW (light wood) ----
  rb.clear();
  clearBed();
  let c = rb.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, 350, 695, { material: 'wood', friction: 0.6, restitution: 0.15 });
  tick(30);
  placePlayer(336);
  p.aimAngle = 0;
  rb.grab(ctx);
  tick(6);
  placePlayer(351); // walk right; the carried crate should follow the hand
  tick(25);
  const followX = c.x;
  const hovering = c.y < 695; // lifted off the floor (held), not resting at ~596.5

  // ---- THROW ----
  const beforeThrow = c.x;
  p.aimAngle = 0;
  rb.release(ctx);
  tick(15);
  const throwDx = c.x - beforeThrow;

  // ---- TOO HEAVY (large metal) can't be grabbed ----
  rb.clear();
  clearBed();
  c = rb.spawn({ kind: 'box', halfW: 6, halfH: 6 }, 350, 692, { material: 'metal', friction: 0.7, restitution: 0.1 });
  tick(30);
  placePlayer(336);
  p.aimAngle = 0;
  rb.grab(ctx);
  const heavyX0 = c.x;
  placePlayer(374); // move away; if it were grabbed it'd follow
  tick(25);
  const heavyFollowed = Math.abs(c.x - heavyX0) > 8;

  return { followX: +followX.toFixed(2), hovering, throwDx: +throwDx.toFixed(2), heavyFollowed };
});

check('grabbed crate follows the wizard (tracks the hand point)', r.followX > 355, JSON.stringify(r));
check('grabbed crate is held aloft (not resting on the floor)', r.hovering, JSON.stringify(r));
check('throwing launches it along the aim', r.throwDx > 15, JSON.stringify(r));
check('a too-heavy body cannot be grabbed', r.heavyFollowed === false, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\ngrab probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

// B2 interaction couplings in the PHYSICS TEST ARENA:
//  B2a projectile → body: a player shot shoves a rigid body it strikes, and a
//       light wood crate is shoved far more than a heavy metal one (mass-aware).
//  B2b player ↔ body: the player stands on a heavy crate (doesn't fall through,
//       can jump off it) and shoves a light crate aside by walking into it.
// Order matters: the non-erosive player/iceshard tests run first on pristine
// floor; the floor-eroding bolt test runs LAST.
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
  const FLOOR_Y = 695; // crate centre rests ~696.5 on the y=700 arena floor
  const box = (x, material) => rb.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, x, FLOOR_Y, { material, friction: 0.6, restitution: 0.15 });
  const fire = (type, x, y) => ctx.projectiles.push({ x, y, vx: 9, vy: 0, type, life: 120, age: 0, charging: false, hostile: false, mul: 1 });
  const relInput = () => { for (const k of ['left', 'right', 'up', 'jump', 'down']) ctx.input.keys[k] = false; };
  const placePlayer = (x, y) => { p.dead = false; p.crawling = false; p.climbing = false; p.diveT = 0; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; };
  relInput();

  // ---- B2b: player STANDS on a heavy metal crate (no fall-through) ----
  rb.clear();
  const stand = box(350, 'metal');
  tick(40);
  const crateTop = stand.y - 3.5;
  placePlayer(stand.x, 660);
  tick(80);
  const standY = p.y;
  const standGrounded = p.grounded === true;
  const stoodOnCrate = standY < crateTop + 2 && standY > crateTop - 4;
  // jump off it (grounded was set by the resolve last frame)
  const preJumpY = p.y;
  ctx.input.keys.jump = true; tick(2); ctx.input.keys.jump = false; tick(10);
  const jumpedOff = p.y < preJumpY - 6;
  relInput();

  // ---- B2b: player SHOVES a light wood crate by walking into it. Carve a clean
  //      bed clear of the dispenser/lever furniture (x798/818) and stairs (x864). ----
  rb.clear();
  const shove = box(360, 'wood');
  tick(40);
  const sx0 = shove.x;
  placePlayer(shove.x - 10, 699); // player at ~830
  ctx.input.keys.right = true;
  tick(12); // crate ends ~858, still on open floor (short of the staircase at 864)
  ctx.input.keys.right = false;
  const shovePush = shove.x - sx0;
  const playerLeftOfCrate = p.x < shove.x;
  relInput();
  tick(5);

  // ---- B2a: iceshard shove, wood vs metal (pure momentum, no blast) ----
  rb.clear();
  const w1 = box(350, 'wood');
  tick(40);
  const wx0 = w1.x;
  fire('iceshard', w1.x - 25, w1.y);
  tick(45);
  const woodPush = w1.x - wx0;

  rb.clear();
  const m1 = box(350, 'metal');
  tick(40);
  const mx0 = m1.x;
  fire('iceshard', m1.x - 25, m1.y);
  tick(45);
  const metalPush = m1.x - mx0;

  // ---- B2a: a bolt (the common case) clearly moves a wood crate (erodes floor) ----
  rb.clear();
  const w2 = box(350, 'wood');
  tick(40);
  const bx0 = w2.x;
  fire('bolt', w2.x - 25, w2.y);
  tick(30);
  const boltPush = Math.abs(w2.x - bx0);

  return {
    woodPush: +woodPush.toFixed(2), metalPush: +metalPush.toFixed(2), boltPush: +boltPush.toFixed(2),
    standY: +standY.toFixed(2), crateTop: +crateTop.toFixed(2), standGrounded, stoodOnCrate, jumpedOff,
    shovePush: +shovePush.toFixed(2), playerLeftOfCrate,
  };
});

check('B2a shot shoves a wood crate', r.woodPush > 2, JSON.stringify(r));
check('B2a shove is mass-aware (wood >> metal)', r.woodPush > r.metalPush * 1.5 + 0.3, JSON.stringify(r));
check('B2a a bolt clearly moves a wood crate', r.boltPush > 2, JSON.stringify(r));
check('B2b player stands ON a heavy crate (no fall-through)', r.stoodOnCrate && r.standGrounded, JSON.stringify(r));
check('B2b player can jump off the crate', r.jumpedOff, JSON.stringify(r));
check('B2b player shoves a light crate by walking into it', r.shovePush > 3, JSON.stringify(r));
check('B2b player never tunnels through the crate', r.playerLeftOfCrate, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\ncouplings probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

// B2 interaction couplings in the PHYSICS TEST ARENA:
//  B2a projectile → body: a player shot shoves a rigid body it strikes, and a
//       light wood crate is shoved far more than a heavy metal one (mass-aware).
//  B2b player ↔ body: the player stands on a heavy crate (doesn't fall through)
//       and shoves a light crate aside by walking into it.
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
  const FLOOR_Y = 596; // crate centre rests ~596.5 on the y=600 floor (under the platform)
  const box = (x, material) => rb.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, x, FLOOR_Y, { material, friction: 0.6, restitution: 0.15 });
  const fire = (type, x, y) => ctx.projectiles.push({ x, y, vx: 9, vy: 0, type, life: 120, age: 0, charging: false, hostile: false, mul: 1 });
  const relInput = () => { for (const k of ['left', 'right', 'up', 'jump', 'down']) ctx.input.keys[k] = false; };
  relInput();

  // ---- B2a: iceshard shove, wood vs metal (pure momentum, no blast) ----
  rb.clear();
  const w1 = box(800, 'wood');
  tick(40);
  const wx0 = w1.x;
  fire('iceshard', w1.x - 25, w1.y);
  tick(45);
  const woodPush = w1.x - wx0;

  rb.clear();
  const m1 = box(825, 'metal');
  tick(40);
  const mx0 = m1.x;
  fire('iceshard', m1.x - 25, m1.y);
  tick(45);
  const metalPush = m1.x - mx0;

  // ---- B2a: a bolt (the common case) clearly moves a wood crate ----
  rb.clear();
  const w2 = box(800, 'wood');
  tick(40);
  const bx0 = w2.x;
  fire('bolt', w2.x - 25, w2.y);
  tick(30);
  const boltPush = Math.abs(w2.x - bx0);

  // ---- B2b: player STANDS on a heavy metal crate (no fall-through) ----
  rb.clear();
  const stand = box(815, 'metal');
  tick(40);
  const crateTop = stand.y - 3.5;
  const p = ctx.player;
  p.dead = false; p.crawling = false; p.climbing = false; p.diveT = 0;
  p.x = stand.x; p.y = 560; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
  tick(80);
  const standY = p.y;
  const standGrounded = p.grounded === true;
  const stoodOnCrate = standY < crateTop + 2 && standY > crateTop - 4; // feet on the crate top

  // can he jump off it? (grounded was set by the resolve last frame)
  const preJumpY = p.y;
  ctx.input.keys.jump = true; tick(2); ctx.input.keys.jump = false; tick(10);
  const jumpedOff = p.y < preJumpY - 6;

  // ---- B2b: player SHOVES a light wood crate by walking into it (open floor) ----
  rb.clear();
  const shove = box(800, 'wood');
  tick(40);
  const sx0 = shove.x;
  p.dead = false; p.crawling = false; p.climbing = false; p.diveT = 0;
  p.x = shove.x - 10; p.y = 599; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
  ctx.input.keys.right = true;
  const trace = [];
  for (let k = 0; k < 11; k++) { tick(5); trace.push([+p.x.toFixed(1), +p.y.toFixed(1), +shove.x.toFixed(1)]); }
  ctx.input.keys.right = false;
  const shovePush = shove.x - sx0;
  const playerLeftOfCrate = p.x < shove.x; // never tunnelled through
  const px = p.x, py = p.y, shoveYend = shove.y, shoveXend = shove.x;
  relInput();

  return {
    woodPush: +woodPush.toFixed(2), metalPush: +metalPush.toFixed(2), boltPush: +boltPush.toFixed(2),
    standY: +standY.toFixed(2), crateTop: +crateTop.toFixed(2), standGrounded, stoodOnCrate, jumpedOff,
    shovePush: +shovePush.toFixed(2), playerLeftOfCrate,
    px: +px.toFixed(2), py: +py.toFixed(2), shoveXend: +shoveXend.toFixed(2), shoveYend: +shoveYend.toFixed(2),
    trace,
  };
});
console.log('shove trace [px,py,cratex]:', JSON.stringify(r.trace));

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

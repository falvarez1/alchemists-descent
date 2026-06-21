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
  const rb = ctx.rigidBodies;
  const p = ctx.player;
  const FLOOR_Y = 695; // crate centre rests ~696.5 on the y=700 arena floor
  const box = (x, material) => rb.spawn({ kind: 'box', halfW: 3.5, halfH: 3.5 }, x, FLOOR_Y, { material, friction: 0.6, restitution: 0.15 });
  const fire = (type, x, y) => ctx.projectiles.push({ x, y, vx: 9, vy: 0, type, life: 120, age: 0, charging: false, hostile: false, mul: 1 });
  const relInput = () => { for (const k of ['left', 'right', 'up', 'jump', 'down']) ctx.input.keys[k] = false; };
  const placePlayer = (x, y) => { p.dead = false; p.crawling = false; p.climbing = false; p.diveT = 0; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; };

  const resetArena = async () => {
    await ctx.console.exec('run test --level physics-test --world campaign-level');
    tick(20);
    relInput();
    ctx.projectiles.length = 0;
    rb.clear();
    placePlayer(250, 699);
  };

  const measureStand = async () => {
    await resetArena();
    const stand = box(350, 'metal');
    tick(40);
    const crateTop = stand.y - 3.5;
    placePlayer(stand.x, 660);
    tick(80);
    const standY = p.y;
    const standGrounded = p.grounded === true;
    const stoodOnCrate = standY < crateTop + 2 && standY > crateTop - 4;
    const preJumpY = p.y;
    ctx.input.keys.jump = true; tick(2); ctx.input.keys.jump = false; tick(10);
    const jumpedOff = p.y < preJumpY - 6;
    relInput();
    return { standY, crateTop, standGrounded, stoodOnCrate, jumpedOff };
  };

  const measureShove = async () => {
    await resetArena();
    const shove = box(360, 'wood');
    tick(40);
    const sx0 = shove.x;
    placePlayer(shove.x - 10, 699);
    ctx.input.keys.right = true;
    tick(12);
    ctx.input.keys.right = false;
    const shovePush = shove.x - sx0;
    const playerLeftOfCrate = p.x < shove.x;
    relInput();
    return { shovePush, playerLeftOfCrate };
  };

  const measureProjectile = async (type, material, frames) => {
    await resetArena();
    const body = box(350, material);
    tick(40);
    const x0 = body.x;
    placePlayer(250, 699);
    ctx.projectiles.length = 0;
    fire(type, body.x - 25, body.y);
    let peak = 0;
    for (let f = 0; f < frames; f++) {
      tick(1);
      peak = Math.max(peak, Math.abs(body.x - x0));
    }
    return { final: body.x - x0, peak };
  };

  const stand = await measureStand();
  const shove = await measureShove();
  const wood = await measureProjectile('iceshard', 'wood', 45);
  const metal = await measureProjectile('iceshard', 'metal', 45);
  const bolt = await measureProjectile('bolt', 'wood', 30);

  return {
    woodPush: +wood.final.toFixed(2),
    metalPush: +metal.final.toFixed(2),
    boltPush: +bolt.peak.toFixed(2),
    boltFinal: +bolt.final.toFixed(2),
    standY: +stand.standY.toFixed(2),
    crateTop: +stand.crateTop.toFixed(2),
    standGrounded: stand.standGrounded,
    stoodOnCrate: stand.stoodOnCrate,
    jumpedOff: stand.jumpedOff,
    shovePush: +shove.shovePush.toFixed(2),
    playerLeftOfCrate: shove.playerLeftOfCrate,
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

// "Feel alive" batch: (1) wall-slam gib PUNCH (hitstop/bloom/shake), (2) the
// wizard's CLOTH reacts to the kick gust, (3) ceiling SHEDS dust when the cave
// shakes, (4) light-SHY critters (beetle) flee fire. Usage: node scripts/verify-aliveness.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('  ok    ' + n); } else { fail++; console.log('  FAIL  ' + n + ' ' + d); } };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.critters, { timeout: 20000 });
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level');
  for (let f = 0; f < 20; f++) window.__game.tick();
  const w = ctx.world, p = ctx.player, CR = ctx.critters;
  const STONE = 12, LAVA = 11;
  const wall = (x0, y0, x1, y1, t = STONE) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = w.idx(x, y); w.types[i] = t; w.colors[i] = t === LAVA ? 0xff7722 : 0x777777; } };
  const clear = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.clearCellAt(w.idx(x, y)); };
  const reset = () => {
    ctx.state.mode = 'play'; ctx.state.paused = false; ctx.fx.hitstop = 0; ctx.fx.bloomKick = 0; ctx.fx.screenShake = 0;
    ctx.enemies.length = 0; CR.clear();
    p.dead = false; p.crawling = false; p.climbing = false; p.swinging = false;
    for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  };
  const kick = () => { ctx.playerCtl.kickCooldownT = 0; p.aimAngle = 0; ctx.playerCtl.kick(ctx); };

  // ---- (2) CLOTH reacts to the kick gust ------------------------------------
  reset();
  clear(300, 630, 400, 690); wall(300, 686, 400, 690);
  p.x = 340; p.y = 685; p.vx = 0; p.vy = 0; p.grounded = true;
  p.hat.vx = 0; p.hat.vy = 0; p.robe.vx = 0;
  kick();
  const clothHatVx = +p.hat.vx.toFixed(2), clothHatVy = +p.hat.vy.toFixed(2), clothRobeVx = +p.robe.vx.toFixed(2);

  // ---- (1) SLAM PUNCH: kick a bat into a wall -------------------------------
  reset();
  clear(300, 630, 380, 680); wall(360, 628, 366, 682);
  p.x = 320; p.y = 670; p.grounded = true;
  ctx.enemyCtl.spawn('bat', 336, 658);
  const bat = ctx.enemies[ctx.enemies.length - 1];
  bat.x = 336; bat.y = 658; bat.vx = bat.vy = 0; bat.sleeping = false; bat.knockT = 0;
  kick();
  let maxHitstop = 0, maxBloom = 0, maxShake = 0;
  for (let f = 0; f < 24; f++) {
    window.__game.tick();
    maxHitstop = Math.max(maxHitstop, ctx.fx.hitstop);
    maxBloom = Math.max(maxBloom, ctx.fx.bloomKick);
    maxShake = Math.max(maxShake, ctx.fx.screenShake);
  }

  // ---- (3) CEILING SHEDS dust on a shake ------------------------------------
  reset();
  // a stone ceiling over open air, framed by the camera
  const cx = Math.floor(ctx.camera.x) + 80, cy = Math.floor(ctx.camera.y) + 40;
  clear(cx - 30, cy, cx + 30, cy + 50);
  wall(cx - 30, cy - 4, cx + 30, cy); // ceiling slab
  ctx.particles.clear?.();
  const pBefore = ctx.particles.list.length;
  let shedBelow = 0;
  for (let f = 0; f < 6; f++) {
    ctx.fx.screenShake = 0.06;       // sustain a shake (tick-only: renderer isn't decaying it)
    window.__game.tick();
  }
  for (const pt of ctx.particles.list) {
    if (pt.x > cx - 30 && pt.x < cx + 30 && pt.y > cy && pt.y < cy + 20) shedBelow++;
  }
  const pAfter = ctx.particles.list.length;
  // control: no shake → no shed
  reset();
  clear(cx - 30, cy, cx + 30, cy + 50); wall(cx - 30, cy - 4, cx + 30, cy);
  ctx.particles.clear?.();
  for (let f = 0; f < 6; f++) { ctx.fx.screenShake = 0; window.__game.tick(); }
  const pCalm = ctx.particles.list.length;

  // ---- (4) LIGHT-SHY beetle flees lava --------------------------------------
  reset();
  clear(300, 640, 420, 700); wall(300, 670, 420, 674); // floor
  p.x = 250; p.y = 669; p.dead = true; // keep the player out of it (isolate the fire flee)
  CR.list.push({ kind: 'beetle', x: 360, y: 669, vx: 0, vy: 0, phase: 0, gasp: 0, facing: 1 });
  const beetle = CR.list[CR.list.length - 1];
  wall(372, 666, 378, 669, LAVA); // a lava pocket just to the beetle's RIGHT
  const beetleX0 = beetle.x;
  let beetleStartled = false, beetleMinX = beetle.x;
  for (let f = 0; f < 50; f++) {
    window.__game.tick();
    if (!CR.list.includes(beetle)) break;
    if ((beetle.startle ?? 0) > 0) beetleStartled = true;
    beetleMinX = Math.min(beetleMinX, beetle.x);
  }
  const beetleAlive = CR.list.includes(beetle);
  const beetleFledLeft = beetleAlive ? beetleX0 - beetle.x : 99; // moved away from lava (−x)

  return {
    clothHatVx, clothHatVy, clothRobeVx,
    maxHitstop, maxBloom: +maxBloom.toFixed(2), maxShake: +maxShake.toFixed(3), batGibbed: !ctx.enemies.includes(bat),
    pBefore, pAfter, shedBelow, pCalm,
    beetleStartled, beetleAlive, beetleFledLeft: +(+beetleFledLeft).toFixed(1),
  };
});

console.log('  ' + JSON.stringify(r));
check('kick gust whips the hat (hat.vx +x, lifts)', r.clothHatVx > 1 && r.clothHatVy < 0, JSON.stringify(r));
check('kick gust flares the robe (robe.vx +x)', r.clothRobeVx > 0.5, JSON.stringify(r));
check('wall-slam gibs the bat', r.batGibbed, JSON.stringify(r));
check('slam punch: hitstop fires', r.maxHitstop >= 3, JSON.stringify(r));
check('slam punch: bloom + shake fire', r.maxBloom > 0.6 && r.maxShake > 0, JSON.stringify(r));
check('shake sheds ceiling dust (vs calm control)', r.pAfter - r.pBefore > 5 && r.pAfter > r.pCalm + 6, JSON.stringify(r));
check('some dust lands below the test ceiling', r.shedBelow >= 1, JSON.stringify(r));
check('light-shy beetle is startled by the lava', r.beetleStartled, JSON.stringify(r));
check('beetle flees away from the lava (−x)', r.beetleAlive && r.beetleFledLeft > 3, JSON.stringify(r));
check('no page errors', errs.length === 0, errs.join(' | '));

console.log(`\naliveness probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

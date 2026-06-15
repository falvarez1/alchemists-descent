// Player-feel probe: levitation ramp + wand recoil (Phase 0).
// Usage: node scripts/verify-feel.mjs [url]   (dev server running, system Edge)
//
// Frame-accurate: each test sets up its scene and then drives the game by
// calling window.__game.tick() synchronously inside ONE page.evaluate, so the
// rAF loop can't interleave and we get an exact tick count. tick()'s only gate
// is `frozen = hitstop>0 || paused`, which the scene setup clears.
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1200);

// ---- shared in-page helpers, installed once -------------------------------
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const Stone = 12;
  const stoneColor = 0x777777;
  // A big open shaft: floor far below, hundreds of cells of air around the
  // player so a long levitation climb never hits a ceiling or the floor.
  // `onFloor` plants the player's feet just above the floor for grounded tests.
  window.__feel = {
    scene(onFloor) {
      ctx.state.mode = 'play';
      ctx.state.paused = false;
      ctx.state.playerSpawned = true;
      ctx.fx.hitstop = 0;
      w.clear();
      w.simBounds.x0 = 0;
      w.simBounds.y0 = 0;
      w.simBounds.x1 = w.width - 1;
      w.simBounds.y1 = w.height - 1;
      for (let x = 200; x <= 400; x++) {
        for (let y = 900; y <= 912; y++) {
          const i = w.idx(x, y);
          w.types[i] = Stone;
          w.colors[i] = stoneColor;
        }
      }
      const p = ctx.player;
      p.x = 300;
      p.y = onFloor ? 899 : 600;
      p.fx = p.fy = 0;
      p.vx = p.vy = 0;
      p.hp = p.maxHp;
      p.dead = false;
      p.inLiquid = false;
      p.crawling = false;
      p.climbing = false;
      p.climbT = 0;
      p.wallGrabT = 0;
      p.pullT = 0;
      p.recharge = 0;
      p.firing = false;
      p.diveT = 0;
      p.invuln = 0;
      p.staggerT = 0;
      p.levit = 9999;
      p.maxLevit = 9999;
      p.status.levity = 0;
      p.status.stoneskin = 0;
      for (const k of ['left', 'right', 'up', 'jump', 'wallJump', 'down', 'grab']) ctx.input.keys[k] = false;
      return { x: p.x, y: p.y };
    },
    // Advance N ticks with the current key/firing state.
    run(n) {
      for (let i = 0; i < n; i++) window.__game.tick();
    },
    // Slot an exact card program into wand 0 and make it ready to fire.
    loadWand(cards) {
      const W = ctx.wands;
      W.grantReviewLoadout();
      W.active = 0;
      const cap = W.wands[0].frame.capacity;
      for (let s = 0; s < cap; s++) W.slotCard(0, s, null);
      for (let s = 0; s < cards.length && s < cap; s++) W.slotCard(0, s, cards[s]);
      W.invalidatePrograms();
      W.wands[0].mana = 99999;
      W.wands[0].cooldown = 0;
      W.wands[0].castIndex = 0;
    },
    // Aim the wand by placing the mouse relative to the shoulder (y-9 standing).
    aim(dx, dy) {
      const p = ctx.player;
      ctx.input.mouse.x = p.x + dx;
      ctx.input.mouse.y = p.y - 9 + dy;
    },
  };
});

// =========================== LEVITATION ====================================
// Climb from rest: fall ~12 ticks (expire coyote so a held jump levitates
// instead of jumping), reset to rest, then hold levitate and sample vy/frame.
const levCurve = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__feel.scene(false);
  window.__feel.run(12); // fall; framesSinceGrounded passes the 6-frame coyote window
  const p = ctx.player;
  p.vy = 0;
  p.fy = 0;
  p.vx = 0;
  p.fx = 0;
  ctx.input.keys.jump = true;
  const vy = [];
  for (let f = 0; f < 80; f++) {
    window.__game.tick();
    vy.push(p.vy);
  }
  ctx.input.keys.jump = false;
  return vy;
});

const minVy = Math.min(...levCurve);
const settled = Math.abs(levCurve[79] - levCurve[69]);
check('levitation climbs (vy goes negative)', levCurve[40] < -0.5, `vy[40]=${levCurve[40].toFixed(3)}`);
check(
  'starts slow: |vy| at ~frame 10 stays gentle (old model ~0.93)',
  levCurve[9] < 0 && Math.abs(levCurve[9]) < 0.6,
  `vy[9]=${levCurve[9].toFixed(3)}`,
);
check('mid ramp ~frame 30 still building', levCurve[29] < -0.6 && levCurve[29] > -1.6, `vy[29]=${levCurve[29].toFixed(3)}`);
check(
  'settles to a comfy terminal (~3.3), NOT the -4.6 cap',
  Math.abs(levCurve[79]) > 2.9 && Math.abs(levCurve[79]) < 3.7,
  `vy[79]=${levCurve[79].toFixed(3)}`,
);
check('terminal climb is settled by frame 80', settled < 0.2, `|vy79-vy69|=${settled.toFixed(3)}`);
check('never exceeds the -4.6 up-cap', minVy >= -4.61, `min vy=${minVy.toFixed(3)}`);

// Tap-to-hover: a short tap feathers height (small velocity), not a rocket.
const tap = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__feel.scene(false);
  window.__feel.run(12);
  const p = ctx.player;
  p.vy = 0;
  p.fy = 0;
  const y0 = p.y;
  ctx.input.keys.jump = true;
  window.__feel.run(6);
  const vyRelease = p.vy;
  ctx.input.keys.jump = false;
  return { vyRelease, rose: y0 - p.y };
});
check('tap-to-hover stays gentle (old model ~0.40)', tap.vyRelease < 0 && Math.abs(tap.vyRelease) < 0.34, `vy=${tap.vyRelease.toFixed(3)}`);
check('tap rise is small (a feather, not a leap)', tap.rose >= 0 && tap.rose < 1.5, `rose=${tap.rose.toFixed(2)} cells`);

// Fall-arrest: the every-frame drag must still catch a fast fall.
const arrest = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__feel.scene(false);
  window.__feel.run(12);
  const p = ctx.player;
  p.vy = 5.0;
  p.fy = 0;
  const y0 = p.y;
  ctx.input.keys.jump = true;
  let crossed = -1;
  for (let f = 0; f < 40; f++) {
    window.__game.tick();
    if (crossed < 0 && p.vy <= 0) crossed = f;
  }
  ctx.input.keys.jump = false;
  return { crossed, sank: p.y - y0 };
});
check('catches a fast fall (vy crosses 0 within 30 frames)', arrest.crossed >= 0 && arrest.crossed <= 30, `crossed@${arrest.crossed}`);
check('fall-catch sink is bounded', arrest.sank < 70, `sank=${arrest.sank.toFixed(1)} cells`);

// Fuel burn is unchanged (1.15/frame with no Levity potion).
const fuel = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__feel.scene(false);
  window.__feel.run(12);
  const p = ctx.player;
  p.vy = 0;
  p.levit = 5000;
  const before = p.levit;
  ctx.input.keys.jump = true;
  window.__feel.run(60);
  ctx.input.keys.jump = false;
  return { burned: before - p.levit };
});
check('fuel burn unchanged (~1.15/frame × 60)', Math.abs(fuel.burned - 69) < 6, `burned=${fuel.burned.toFixed(1)}`);

// =========================== WAND RECOIL ===================================
// Measure one cast's effect on velocity. fire() applies recoil after the vy
// clamp, so we read vx/vy right after the firing tick.
const fireOnce = (onFloor, cards, aimDx, aimDy, tweak) =>
  page.evaluate(
    (args) => {
      const ctx = window.__game.ctx;
      window.__feel.scene(args.onFloor);
      window.__feel.run(args.onFloor ? 2 : 12);
      const p = ctx.player;
      p.vx = 0;
      p.vy = 0;
      p.fx = 0;
      p.fy = 0;
      p.hat.vx = 0;
      p.hat.vy = 0;
      p.recoilT = 0;
      window.__feel.loadWand(args.cards);
      window.__feel.aim(args.aimDx, args.aimDy);
      const savedPM = ctx.params.player.recoilPerMomentum;
      if (args.tweakPM != null) ctx.params.player.recoilPerMomentum = args.tweakPM;
      p.firing = true;
      window.__game.tick();
      p.firing = false;
      ctx.params.player.recoilPerMomentum = savedPM;
      return { vx: p.vx, vy: p.vy, recoilT: p.recoilT, hatMoved: p.hat.vx !== 0 || p.hat.vy !== 0, grounded: p.grounded };
    },
    { onFloor, cards, aimDx, aimDy, tweakPM: tweak ?? null },
  );

const single = await fireOnce(false, ['spark'], 100, 0);
check('single spark shoves opposite aim — felt (~1.1)', single.vx < 0 && Math.abs(single.vx) > 0.7 && Math.abs(single.vx) < 1.6, `vx=${single.vx.toFixed(3)}`);
check('horizontal shot barely moves vy', Math.abs(single.vy) < 0.5, `vy=${single.vy.toFixed(3)}`);
check('cosmetic recoil intact (recoilT + hat kick)', single.recoilT > 0 && single.hatMoved, `recoilT=${single.recoilT}`);

const dbl = await fireOnce(false, ['double', 'spark', 'spark'], 100, 0);
check('double spark kicks harder than single', Math.abs(dbl.vx) > Math.abs(single.vx) + 0.3, `dbl=${dbl.vx.toFixed(3)} vs single=${single.vx.toFixed(3)}`);
check('double spark recoil in range (~1.9)', Math.abs(dbl.vx) > 1.5 && Math.abs(dbl.vx) < 2.5, `vx=${dbl.vx.toFixed(3)}`);

const capped = await fireOnce(false, ['spark'], 100, 0, 1.0); // perMomentum=1 → way over cap
check('recoil is capped at recoilMaxImpulse (4.0)', Math.abs(capped.vx) > 3.8 && Math.abs(capped.vx) < 4.2, `vx=${capped.vx.toFixed(3)}`);

const grounded = await fireOnce(true, ['spark'], 100, 0);
check('grounded recoil is damped vs airborne but still felt', grounded.grounded && Math.abs(grounded.vx) > 0.4 && Math.abs(grounded.vx) < Math.abs(single.vx) * 0.65, `grounded vx=${grounded.vx.toFixed(3)}`);

const rocket = await fireOnce(false, ['double', 'spark', 'spark'], 0, 100); // aim straight down
check('rocket-jump: firing down airborne boosts you up (net vy < 0 despite gravity)', rocket.vy < -0.5, `vy=${rocket.vy.toFixed(3)}`);

// =================== LEVITATION DECOUPLED FROM GROUND SPEED =================
// Swift buff (what "god" mode turns on) must speed up the ground run but NOT
// make levitation skate sideways — flight uses its own horizontal control.
const swift = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  // Ground run with Swift → max run ~2.6×1.5 = 3.9
  window.__feel.scene(true);
  window.__feel.run(2);
  const p = ctx.player;
  p.status.swift = 600;
  p.vx = 0;
  p.fx = 0;
  ctx.input.keys.right = true;
  window.__feel.run(50);
  const groundVx = p.vx;
  ctx.input.keys.right = false;
  // Levitating with Swift → horizontal stays decoupled (~2.6, NOT 3.9)
  window.__feel.scene(false);
  window.__feel.run(12);
  const q = ctx.player;
  q.status.swift = 600;
  q.vx = 0;
  q.fx = 0;
  q.vy = 0;
  q.fy = 0;
  ctx.input.keys.jump = true;
  ctx.input.keys.right = true;
  window.__feel.run(50);
  const levVx = q.vx;
  ctx.input.keys.jump = false;
  ctx.input.keys.right = false;
  return { groundVx, levVx };
});
check('Swift speeds the ground run (~3.9)', swift.groundVx > 3.5 && swift.groundVx < 4.2, `vx=${swift.groundVx.toFixed(2)}`);
check('levitation horizontal is decoupled from Swift (~2.6, not 3.9)', swift.levVx > 2.3 && swift.levVx < 3.0, `vx=${swift.levVx.toFixed(2)}`);

// =========================== AIR INERTIA / MOMENTUM ========================
// A fast run must carry into a jump/levitate (no instant snap), and a glide
// must coast instead of stopping dead.
const inertia = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const setup = (swiftOn) => {
    ctx.state.mode = 'play';
    ctx.state.paused = false;
    ctx.fx.hitstop = 0;
    w.clear();
    w.simBounds.x0 = 0;
    w.simBounds.y0 = 0;
    w.simBounds.x1 = w.width - 1;
    w.simBounds.y1 = w.height - 1;
    for (let x = 200; x <= 900; x++) for (let y = 700; y <= 710; y++) {
      const i = w.idx(x, y);
      w.types[i] = 12;
      w.colors[i] = 0x777777;
    }
    const p = ctx.player;
    p.x = 260;
    p.y = 699;
    p.fx = p.fy = p.vx = p.vy = 0;
    p.hp = p.maxHp;
    p.dead = false;
    p.inLiquid = false;
    p.crawling = false;
    p.climbing = false;
    p.diveT = 0;
    p.levit = 9999;
    p.maxLevit = 9999;
    p.status.levity = 0;
    p.status.stoneskin = 0;
    p.status.swift = swiftOn ? 600 : 0;
    p.perks.swiftfoot = false;
    for (const k of ['left', 'right', 'up', 'jump', 'wallJump', 'down', 'grab']) ctx.input.keys[k] = false;
    ctx.camera.snapTo(p.x, p.y - 20);
  };
  const p = ctx.player;
  // (1) run → jump → release: momentum coasts through the air.
  setup(false);
  ctx.input.keys.right = true;
  for (let f = 0; f < 30; f++) window.__game.tick();
  const groundVx = p.vx;
  ctx.input.keys.jump = true;
  window.__game.tick();
  ctx.input.keys.right = false;
  ctx.input.keys.jump = false;
  for (let f = 0; f < 6; f++) window.__game.tick();
  const airVxAfterJump = p.vx;
  // (2) swift sprint → levitate while still steering: no instant snap to 2.6.
  setup(true);
  ctx.input.keys.right = true;
  for (let f = 0; f < 40; f++) window.__game.tick();
  const swiftGroundVx = p.vx;
  ctx.input.keys.jump = true;
  for (let f = 0; f < 6; f++) window.__game.tick();
  const levitVx = p.vx;
  ctx.input.keys.jump = false;
  ctx.input.keys.right = false;
  // (3) levitating glide: release steering, momentum bleeds slowly (not 0.72 stop).
  setup(false);
  ctx.input.keys.right = true;
  ctx.input.keys.jump = true;
  for (let f = 0; f < 12; f++) window.__game.tick();
  const preReleaseVx = p.vx;
  ctx.input.keys.right = false;
  for (let f = 0; f < 12; f++) window.__game.tick();
  const coastVx = p.vx;
  ctx.input.keys.jump = false;
  return { groundVx, airVxAfterJump, swiftGroundVx, levitVx, preReleaseVx, coastVx };
});
check('jumping out of a run keeps horizontal momentum', inertia.airVxAfterJump > inertia.groundVx * 0.8, JSON.stringify(inertia));
check('swift sprint reaches ~3.9 on the ground', inertia.swiftGroundVx > 3.5, JSON.stringify(inertia));
check('sprint momentum carries into levitation (no snap to 2.6)', inertia.levitVx > 3.0, JSON.stringify(inertia));
check('levitating glide coasts when steering is released', inertia.coastVx > inertia.preReleaseVx * 0.6, JSON.stringify(inertia));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nfeel probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

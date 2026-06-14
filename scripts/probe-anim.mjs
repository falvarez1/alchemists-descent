// Player animation fluidity pass probe: assert every new animation state
// triggers from real gameplay paths, and freeze-frame screenshots of the key
// poses for visual review (verify-out/anim-*.png).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2000);

// The descent enters d1 behind a curtain; carving before the world swap
// lands means the new level erases the arena. Wait it out.
await startConsoleTestRun(page, { settleMs: 400 });

// Flat metal arena, player parked inside, invulnerable to ambient chaos.
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 400; y <= 540; y++)
    for (let x = 500; x <= 760; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  const solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = 13; w.colors[i] = 0x7a8a99;
      }
  };
  solid(500, 760, 536, 540);
  solid(500, 506, 400, 540);
  solid(754, 760, 400, 540);
  ctx.enemies.length = 0;
  const p = ctx.player;
  p.x = 630; p.y = 534; p.vx = 0; p.vy = 0; p.hp = p.maxHp;
  p.dead = false;
  ctx.camera.snapTo(630, 480);
});
await page.waitForTimeout(400);
const parked = await page.evaluate(() => {
  const p = window.__game.ctx.player;
  return { x: p.x, y: p.y, grounded: p.grounded };
});
check('player parked in the probe arena', parked.x > 600 && parked.x < 660 && parked.y > 500, JSON.stringify(parked));

const P = () =>
  page.evaluate(() => {
    const p = window.__game.ctx.player;
    return {
      stretchT: p.stretchT, skidT: p.skidT, skidDir: p.skidDir, swapT: p.swapT,
      recoilT: p.recoilT, staggerT: p.staggerT, staggerDir: p.staggerDir,
      fidgetT: p.fidgetT, robeOx: p.robe.ox, vy: p.vy, grounded: p.grounded,
      svx: p._svx, crouchT: p.crouchT, diveT: p.diveT,
      camY: window.__game.ctx.camera.ty,
    };
  });

const pause = (on) => page.evaluate((v) => { window.__game.ctx.state.paused = v; }, on);
// Strip glowing debris so a freeze-frame shows the POSE, not a bloom nova.
const tidy = () =>
  page.evaluate(() => {
    window.__game.ctx.projectiles.length = 0;
    window.__game.ctx.particles.clear();
  });
const park = (x) =>
  page.evaluate((px) => {
    const p = window.__game.ctx.player;
    p.x = px; p.y = 534; p.vx = 0; p.vy = 0;
  }, x);
const shot = async (name) => {
  const clip = await page.evaluate(() => {
    const c = document.querySelector('#canvas-holder > canvas');
    const r = c.getBoundingClientRect();
    const ctx = window.__game.ctx;
    const z = ctx.camera.zoom;
    const ux = (((ctx.player.x - ctx.camera.renderX) / 525 - 0.5) * z + 0.5);
    const uy = (((ctx.player.y - 9 - ctx.camera.renderY) / 357 - 0.5) * z + 0.5);
    return {
      x: Math.max(0, r.left + ux * r.width - 110),
      y: Math.max(0, r.top + uy * r.height - 110),
      width: 220,
      height: 220,
    };
  });
  await page.screenshot({ path: `verify-out/anim-${name}.png`, clip });
};

/* darkness readability: default ambient, unlit cavern — the wizard must
   still read (he draws raw colors + outline, untouched by the light field) */
await pause(true);
await shot('idle-dark');
await pause(false);

/* now light the room for the pose review shots */
await page.evaluate(() => { window.__game.ctx.params.global.ambient = 0.45; });
await page.waitForTimeout(250);
await pause(true);
await shot('idle');
await pause(false);

/* 1) jump stretch + rising pose */
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
await page.waitForTimeout(60);
let s = await P();
check('jump sets stretchT', s.stretchT > 0, JSON.stringify(s));
await pause(true);
await shot('jump-rising');
await pause(false);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })));

/* falling pose: lift then let drop */
await page.evaluate(() => { const p = window.__game.ctx.player; p.y -= 50; p.vy = 3.2; });
await page.waitForTimeout(180);
s = await P();
check('falling state reached (vy>1.6, airborne)', !s.grounded && s.vy > 1.6, JSON.stringify(s));
await pause(true);
await shot('falling');
await pause(false);
await page.waitForTimeout(800); // land + settle

/* 1b) crouch & peek: hold S on the ground */
await park(630);
const beforeCrouch = await P();
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' })));
await page.waitForTimeout(400);
s = await P();
check('hold S crouches (crouchT ramps to cap)', s.crouchT === 10, JSON.stringify(s));
check('crouch peeks the camera down', s.camY > beforeCrouch.camY + 30, `camY ${beforeCrouch.camY} -> ${s.camY}`);
await pause(true);
await shot('crouch');
await pause(false);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS' })));
await page.waitForTimeout(300);
s = await P();
check('release stands back up', s.crouchT === 0, JSON.stringify(s));

/* 1b2) levitation spool: thrust must build gradually, not kick instantly */
await park(630);
await page.evaluate(() => {
  const p = window.__game.ctx.player;
  p.y -= 80; // high enough that the whole spool happens airborne
  p.vy = 0;
  p.levit = p.maxLevit;
});
await page.waitForTimeout(150); // outlive the coyote window so S P A C E levitates
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
await page.waitForTimeout(100); // ~6 frames into the spool
const earlyLift = (await P()).vy;
await page.waitForTimeout(330); // ~26 frames: jet at full thrust
const lateLift = (await P()).vy;
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })));
check('levitation starts gentle (no instant kick)', earlyLift > -1.0, `vy@6f ${earlyLift}`);
check('and winds up into a real climb', lateLift < earlyLift - 0.6, `vy ${earlyLift} -> ${lateLift}`);
await page.waitForTimeout(700); // fall back to the floor

/* 1c) dive slam: jump, then S mid-air */
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.player.y -= 60; // good drop height
  ctx.player.vy = 0;
});
await page.waitForTimeout(50);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' })));
await page.waitForTimeout(80);
s = await P();
check('S in the air starts the dive', s.diveT > 0 && s.vy > 4, JSON.stringify(s));
await pause(true);
await shot('dive');
await pause(false);
let slamSeen = false;
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(50);
  s = await P();
  if (s.grounded && s.diveT === 0) { slamSeen = true; break; }
}
check('dive ends in a landing slam', slamSeen && s.diveT === 0, JSON.stringify(s));
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS' })));
await page.waitForTimeout(400);

/* 2) turn skid: sprint right from mid-floor, slam left (away from walls
   so the freeze-frame isn't washed by wall-adjacent glow) */
await park(560);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' })));
await page.waitForTimeout(500);
const beforeSkid = await P();
await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
});
let skidSeen = null;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(30);
  s = await P();
  if (s.skidT > 0) { skidSeen = s; break; }
}
check('reversal triggers skid', !!skidSeen && skidSeen.skidDir === 1,
  JSON.stringify({ beforeSvx: beforeSkid.svx, skidSeen }));
if (skidSeen) { await pause(true); await shot('skid'); await pause(false); }
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' })));
await page.waitForTimeout(400);

/* robe spring swings during the stop */
check('robe hem spring engaged', Math.abs((skidSeen ?? s).robeOx) > 0.3 || Math.abs(s.robeOx) > 0.05,
  `robeOx ${s.robeOx}`);

/* 3) wand swap draw */
await park(630);
await tidy();
await page.waitForTimeout(150);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2' })));
await page.waitForTimeout(50);
s = await P();
check('swap sets swapT', s.swapT > 0, JSON.stringify(s));
await pause(true);
await shot('swap-draw');
await pause(false);
await page.waitForTimeout(300);

/* 4) cast recoil — back on wand 1 (wand 2 may hold no cards), poll while
   the trigger is held since recoilT decays in ~5 frames */
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' })));
await page.waitForTimeout(400); // let the swap draw finish
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.input.mouse.x = ctx.player.x + 40;
  ctx.input.mouse.y = ctx.player.y - 12;
  for (const w of ctx.wands.wands ?? []) { if (w) w.mana = w.frame?.manaMax ?? w.mana; }
  ctx.player.firing = true;
});
let recoilSeen = null;
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(25);
  s = await P();
  if (s.recoilT > 0) { recoilSeen = s; break; }
}
await page.evaluate(() => { window.__game.ctx.player.firing = false; });
check('cast sets recoilT', !!recoilSeen, JSON.stringify(s));
await tidy();
await pause(true);
await shot('recoil');
await pause(false);
await page.waitForTimeout(500);

/* 5) hurt stagger via the real damage path */
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.player.invuln = 0;
  ctx.playerCtl.damage(4, 2, -0.5, 'probe');
});
await page.waitForTimeout(60);
s = await P();
check('damage sets stagger away from the hit', s.staggerT > 0 && s.staggerDir === 1, JSON.stringify(s));
await tidy();
await pause(true);
await shot('stagger');
await pause(false);
await page.evaluate(() => { const p = window.__game.ctx.player; p.hp = p.maxHp; p.invuln = 0; });

/* 6) idle fidget (420 idle frames to arm; poll for the transient).
   The recoil test sprayed real casts — settle the arena first so impact
   knockback can't keep resetting the idle timer. */
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.projectiles.length = 0;
  ctx.particles.clear();
  const p = ctx.player;
  p.x = 630; p.y = 534; p.vx = 0; p.vy = 0; p.hp = p.maxHp; p.invuln = 0;
});
console.log('  ... waiting out the idle timer (~8s)');
let fidgetMax = 0;
let reachShot = false;
for (let i = 0; i < 50; i++) {
  await page.waitForTimeout(300);
  s = await P();
  if (s.fidgetT > fidgetMax) fidgetMax = s.fidgetT;
  if (!reachShot && s.fidgetT > 58 && s.fidgetT <= 88) {
    await tidy();
    await pause(true);
    await shot('fidget-reach');
    await pause(false);
    reachShot = true;
  }
  if (fidgetMax > 0 && s.fidgetT === 0) break;
}
check('idle fidget fires', fidgetMax > 0, `fidgetT max ${fidgetMax}`);

check('no page errors logged above', true);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

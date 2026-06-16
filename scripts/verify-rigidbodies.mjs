// Verifies the rigid-body layer (Phase 2): boxes fall/rest/sleep, impulses wake
// and move bodies, radial impulses + explosions toss them, circles ROLL down a
// slope (gain spin + travel downhill), and bodies shove each other apart.
// Usage: node scripts/verify-rigidbodies.mjs [url]
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
await page.waitForFunction(() => window.__game?.ctx?.rigidBodies, { timeout: 20000 });
await page.waitForTimeout(800);

await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  window.__rb = {
    stone(x, y) {
      const i = w.idx(x, y);
      w.types[i] = 12;
      w.colors[i] = 0x777777;
    },
    reset() {
      ctx.state.mode = 'play';
      ctx.state.paused = false;
      ctx.fx.hitstop = 0;
      w.clear();
      w.simBounds.x0 = 240;
      w.simBounds.y0 = 420;
      w.simBounds.x1 = 400;
      w.simBounds.y1 = 560;
      const p = ctx.player;
      p.x = 250;
      p.y = 460;
      p.dead = true; // keep him out of the way
      for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
      ctx.rigidBodies.clear();
    },
  };
});

// ---- box: fall, rest, sleep --------------------------------------------------
const fall = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__rb.reset();
  for (let x = 280; x <= 380; x++) for (let y = 500; y <= 506; y++) window.__rb.stone(x, y);
  const b = ctx.rigidBodies.spawn({ kind: 'box', halfW: 3, halfH: 3 }, 340, 470, { restitution: 0 });
  const startY = b.y;
  for (let f = 0; f < 120; f++) window.__game.tick();
  const restY = b.y;
  // Stability: let it sit longer and confirm it doesn't jitter/creep/bounce.
  let maxDrift = 0;
  for (let f = 0; f < 40; f++) {
    window.__game.tick();
    maxDrift = Math.max(maxDrift, Math.abs(b.y - restY), Math.abs(b.x - 340));
  }
  return { startY, y: b.y, sleeping: b.sleeping, vy: b.vy, vx: b.vx, va: b.va, maxDrift };
});
check('box falls and rests on the floor', fall.y > fall.startY && fall.y >= 490 && fall.y <= 500, JSON.stringify(fall));
check('resting box has ~zero velocity', Math.abs(fall.vy) < 0.2 && Math.abs(fall.vx) < 0.2, JSON.stringify(fall));
check('settled box is STABLE (no jitter/creep/bounce)', fall.maxDrift < 0.6, JSON.stringify(fall));
check('settled box sleeps', fall.sleeping === true, JSON.stringify(fall));

// ---- impulses, radial impulse, explosion -------------------------------------
const impulse = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const RB = ctx.rigidBodies;
  window.__rb.reset();
  for (let x = 280; x <= 380; x++) for (let y = 500; y <= 506; y++) window.__rb.stone(x, y);
  const b = RB.spawn({ kind: 'box', halfW: 3, halfH: 3 }, 340, 470, { restitution: 0 });
  for (let f = 0; f < 90; f++) window.__game.tick();
  const xBefore = b.x;
  RB.applyImpulse(b, 4, -3);
  const woke = !b.sleeping;
  for (let f = 0; f < 10; f++) window.__game.tick();
  const movedRight = b.x - xBefore;
  for (let f = 0; f < 60; f++) window.__game.tick();
  RB.applyRadialImpulse(b.x - 12, b.y, 40, 6);
  const radialVx = b.vx;
  // explosion wiring
  window.__rb.reset();
  for (let x = 280; x <= 380; x++) for (let y = 500; y <= 506; y++) window.__rb.stone(x, y);
  const b2 = RB.spawn({ kind: 'box', halfW: 3, halfH: 3 }, 340, 470, { restitution: 0 });
  for (let f = 0; f < 90; f++) window.__game.tick();
  const e2x = b2.x;
  ctx.explosions.trigger(Math.round(b2.x - 22), Math.round(b2.y), 22);
  for (let f = 0; f < 6; f++) window.__game.tick();
  return { woke, movedRight, radialVx, explMoved: b2.x - e2x };
});
check('applyImpulse wakes the body', impulse.woke === true, JSON.stringify(impulse));
check('impulse moves the body horizontally', impulse.movedRight > 0.5, JSON.stringify(impulse));
check('radial impulse pushes the body away', impulse.radialVx > 1, JSON.stringify(impulse));
check('explosion tosses the body', Math.abs(impulse.explMoved) > 0.3, JSON.stringify(impulse));

// ---- circle rolls down a slope (gains spin + travels downhill) ---------------
const roll = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__rb.reset();
  // Ramp descending to the right: surface y rises with x → downhill is +x.
  for (let x = 300; x <= 366; x++) {
    const top = Math.floor(470 + (x - 300) * 0.5);
    for (let y = top; y <= 545; y++) window.__rb.stone(x, y);
  }
  const b = ctx.rigidBodies.spawn({ kind: 'circle', radius: 4 }, 306, 458, { restitution: 0.1, friction: 0.9 });
  const startX = b.x;
  let maxSpin = 0;
  for (let f = 0; f < 70; f++) {
    window.__game.tick();
    if (Math.abs(b.va) > maxSpin) maxSpin = Math.abs(b.va);
  }
  return { startX, x: b.x, y: b.y, maxSpin };
});
check('circle rolls downhill (travels +x)', roll.x - roll.startX > 10, JSON.stringify(roll));
check('circle gains spin while rolling', roll.maxSpin > 0.03, JSON.stringify(roll));

// ---- body-vs-body: overlapping boxes shove apart -----------------------------
const pair = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const RB = ctx.rigidBodies;
  window.__rb.reset();
  for (let x = 280; x <= 380; x++) for (let y = 500; y <= 506; y++) window.__rb.stone(x, y);
  const a = RB.spawn({ kind: 'box', halfW: 3, halfH: 3 }, 330, 495, { restitution: 0 });
  const b = RB.spawn({ kind: 'box', halfW: 3, halfH: 3 }, 333, 495, { restitution: 0 });
  const startGap = Math.abs(b.x - a.x);
  for (let f = 0; f < 40; f++) window.__game.tick();
  return { startGap, gap: Math.abs(b.x - a.x), ax: a.x, bx: b.x };
});
check('overlapping bodies start interpenetrating', pair.startGap < 6, JSON.stringify(pair));
check('body-vs-body resolution shoves them apart', pair.gap > pair.startGap + 1.5 && pair.gap >= 5, JSON.stringify(pair));

// ---- dev console commands ----------------------------------------------------
const cmd = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  ctx.state.mode = 'play';
  ctx.rigidBodies.clear();
  const a = await ctx.console.exec('crate 3');
  const afterCrate = ctx.rigidBodies.bodies.length;
  const b = await ctx.console.exec('boulder 2');
  return { ok: a.ok && b.ok, afterCrate, total: ctx.rigidBodies.bodies.length };
});
check('console "crate"/"boulder" commands spawn bodies', cmd.ok && cmd.afterCrate === 3 && cmd.total === 5, JSON.stringify(cmd));

// ---- playground test arena ---------------------------------------------------
const pg = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  ctx.state.mode = 'play';
  const res = await ctx.console.exec('playground');
  const count = ctx.rigidBodies.bodies.length;
  // sample some body positions, then run the sim and confirm motion happened
  const before = ctx.rigidBodies.bodies.map((b) => ({ x: b.x, y: b.y }));
  for (let f = 0; f < 80; f++) window.__game.tick();
  let moved = 0;
  ctx.rigidBodies.bodies.forEach((b, i) => {
    if (before[i] && Math.hypot(b.x - before[i].x, b.y - before[i].y) > 2) moved++;
  });
  return { ok: res.ok, count, moved, px: ctx.player.x, py: ctx.player.y };
});
check('playground builds the arena and spawns 9 bodies', pg.ok && pg.count === 9, JSON.stringify(pg));
check('playground drops the player into the valley', Math.abs(pg.px - 800) < 6 && Math.abs(pg.py - 551) < 30, JSON.stringify(pg));
check('playground bodies roll/tumble/settle (most move)', pg.moved >= 5, JSON.stringify(pg));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nrigid-body probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

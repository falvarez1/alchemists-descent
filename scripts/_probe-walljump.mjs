// Wall-jump + mantle feel probe (real keys): asserts a HELD Space gives
// exactly ONE wall-jump launch (edge-triggered; no machine-gun re-grabs), the
// launch actually escapes the wall while Grab stays held, and a W-held top-out
// mantles into a STAND on the ledge instead of instantly jumping off it.
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};
const pageErrors = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
await startConsoleTestRun(page, { settleMs: 400 });
await page.click('#canvas-holder > canvas', { position: { x: 750, y: 450 } }).catch(() => {});

const buildArena = () =>
  page.evaluate(() => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    for (let y = 380; y <= 560; y++)
      for (let x = 480; x <= 900; x++) {
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
    solid(480, 900, 530, 545); // floor
    solid(700, 730, 420, 530); // the wall/tower: face at x=700, top at y=420
    ctx.enemies.length = 0;
    ctx.pickups.length = 0;
    const p = ctx.player;
    p.hp = p.maxHp = 1e6;
    p.x = 690; p.y = 528; p.vx = 0; p.vy = 0; p.dead = false;
    ctx.camera.snapTo(690, 470);
  });

const sample = () =>
  page.evaluate(() => {
    const p = window.__game.ctx.player;
    return { x: p.x, y: p.y, vy: +p.vy.toFixed(2), climbing: p.climbing === true, grounded: p.grounded === true };
  });

// ---- scenario 1: held-Space wall-jump fires ONCE and escapes the wall
console.log('scenario: single wall-jump under held keys');
await buildArena();
await page.keyboard.down('c'); // grab
await page.keyboard.down('d'); // press into the wall to engage the climb
await page.waitForTimeout(350);
await page.keyboard.up('d');
const climbing = (await sample()).climbing;
check('engaged the climb', climbing, '');
// hold Space for ~300ms (≈18 ticks) with Grab STILL held
const samples = [];
await page.keyboard.down(' ');
for (let k = 0; k < 12; k++) {
  samples.push(await sample());
  await page.waitForTimeout(40);
}
await page.keyboard.up(' ');
await page.keyboard.up('c');
{
  // a single launch decays past -3.5 within ~2 ticks, so at 40ms sampling at
  // most ONE sample can sit at launch velocity; a machine-gunning wall-jump
  // (the old level-triggered bug) re-set vy=-3.85 every tick and pinned
  // EVERY sample there.
  const atLaunchVel = samples.filter((s) => s.vy <= -3.5).length;
  const escaped = Math.min(...samples.map((s) => s.x));
  const regrabbed = samples.slice(2).some((s) => s.climbing);
  check('single launch impulse (no machine-gun)', atLaunchVel <= 1, `atLaunchVel=${atLaunchVel}`);
  check('launch escaped the wall (moved away)', escaped < 686, `minX=${escaped}`);
  check('no instant re-grab while Grab held', !regrabbed, '');
}

// ---- scenario 2: W-held top-out mantles into a stand, not a jump
console.log('scenario: top-out mantle stands the ledge');
await buildArena();
await page.evaluate(() => {
  const p = window.__game.ctx.player;
  p.x = 696; p.y = 440; p.vx = 0; p.vy = 0; // near the top of the face
});
await page.keyboard.down('c');
await page.keyboard.down('d');
await page.waitForTimeout(200);
await page.keyboard.up('d');
await page.keyboard.down('w'); // haul up — and keep W held through the top-out
let mantled = null;
for (let k = 0; k < 50; k++) {
  const s = await sample();
  if (!s.climbing && s.grounded && s.y <= 421) { mantled = s; break; }
  await page.waitForTimeout(60);
}
// after the mantle, W is STILL held — watch whether he stays put
const after = [];
for (let k = 0; k < 8; k++) {
  after.push(await sample());
  await page.waitForTimeout(50);
}
await page.keyboard.up('w');
await page.keyboard.up('c');
{
  check('mantled onto the ledge top', mantled !== null, '');
  const leftLedge = after.some((s) => s.y < 405 || s.vy < -2.5);
  check('did not launch off the top-out (W held)', !leftLedge, JSON.stringify(after.map((s) => s.vy)));
}
check('no page errors', pageErrors.length === 0, pageErrors.join('; '));

console.log(`\n${pass} ok, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

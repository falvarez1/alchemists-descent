// Regression probe for the fatal Rapier crash: a body that picked up a runaway or
// non-finite velocity used to make syncTerrain request a grid-spanning wall of
// terrain colliders, overflowing Rapier's wasm solver ("Maximum call stack size
// exceeded") and then permanently borrow-locking the world ("recursive use of an
// object"). Confirms the velocity/window clamps keep the game alive.
// Usage: node scripts/verify-rb-runaway.mjs [url]
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
    fillStone(x0, y0, x1, y1) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y); w.types[i] = 12; w.colors[i] = 0x777777;
      }
    },
    // Scatter ≥5-cell clumps (loose-rubble rule keeps smaller specks walk-through)
    // across most of the grid: a runaway, grid-spanning collider window then tries
    // to spawn tens of thousands of terrain colliders in one frame — the overflow.
    scatterClumps() {
      for (let cy = 60; cy < w.height - 6; cy += 9) {
        for (let cx = 60; cx < w.width - 6; cx += 9) {
          for (let y = cy; y < cy + 3; y++) for (let x = cx; x < cx + 3; x++) {
            const i = w.idx(x, y); w.types[i] = 12; w.colors[i] = 0x777777;
          }
        }
      }
    },
    reset() {
      ctx.state.mode = 'play'; ctx.state.paused = false; ctx.fx.hitstop = 0;
      w.clear();
      w.simBounds.x0 = 240; w.simBounds.y0 = 420; w.simBounds.x1 = 480; w.simBounds.y1 = 620;
      const p = ctx.player; p.x = 250; p.y = 460; p.dead = true;
      for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
      ctx.rigidBodies.clear();
    },
  };
});

// ---- runaway linear velocity in dense terrain -------------------------------
const runaway = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const RB = ctx.rigidBodies;
  window.__rb.reset();
  // surface cells scattered across the whole grid (see scatterClumps)
  window.__rb.scatterClumps();
  // widen sim bounds so the body is simulated wherever the blast flings it
  ctx.world.simBounds.x0 = 1; ctx.world.simBounds.y0 = 1;
  ctx.world.simBounds.x1 = ctx.world.width - 2; ctx.world.simBounds.y1 = ctx.world.height - 2;
  const b = RB.spawn({ kind: 'box', halfW: 3, halfH: 3 }, 800, 400, { restitution: 0 });
  for (let f = 0; f < 5; f++) window.__game.tick();
  // slam an absurd velocity in (pre-fix: lead≈5000 → grid-spanning collider wall)
  RB.applyImpulse(b, 5000, -5000);
  let crashed = false;
  try { for (let f = 0; f < 90; f++) window.__game.tick(); } catch (e) { crashed = true; }
  const alive = RB.bodies.includes(b);
  return { crashed, alive, vx: b.vx, vy: b.vy, speed: Math.hypot(b.vx, b.vy) };
});
check('runaway velocity does not crash the sim', !runaway.crashed, JSON.stringify(runaway));
check('runaway velocity is clamped to the cap (<=40 c/f)', runaway.speed <= 41, JSON.stringify(runaway));

// ---- non-finite (NaN) velocity ----------------------------------------------
const nan = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const RB = ctx.rigidBodies;
  window.__rb.reset();
  window.__rb.fillStone(280, 500, 460, 560);
  const b = RB.spawn({ kind: 'box', halfW: 3, halfH: 3 }, 340, 470, { restitution: 0 });
  for (let f = 0; f < 20; f++) window.__game.tick();
  RB.applyImpulse(b, NaN, NaN); // poison the velocity
  let crashed = false;
  try { for (let f = 0; f < 60; f++) window.__game.tick(); } catch (e) { crashed = true; }
  return { crashed, removed: !RB.bodies.includes(b), bodyCount: RB.bodies.length };
});
check('NaN velocity does not crash the sim', !nan.crashed, JSON.stringify(nan));
check('NaN-poisoned body is dropped (unrecoverable)', nan.removed, JSON.stringify(nan));

// ---- the sim is still healthy afterwards (world not borrow-locked) -----------
const healthy = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const RB = ctx.rigidBodies;
  window.__rb.reset();
  window.__rb.fillStone(280, 500, 460, 560);
  const b = RB.spawn({ kind: 'box', halfW: 3, halfH: 3 }, 340, 470, { restitution: 0 });
  const startY = b.y;
  let crashed = false;
  try { for (let f = 0; f < 120; f++) window.__game.tick(); } catch (e) { crashed = true; }
  return { crashed, fell: b.y > startY, restY: b.y, sleeping: b.sleeping };
});
check('a fresh body still falls + rests after the runaway (world not locked)',
  !healthy.crashed && healthy.fell && healthy.restY <= 500, JSON.stringify(healthy));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nrunaway probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

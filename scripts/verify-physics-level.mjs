// Verifies the selectable "PHYSICS TEST ARENA" level: it loads via the run
// system, stamps its authored terrain + water pool, spawns rigid bodies, places
// the player, and runs stably (no Rapier crash) with bodies settling.
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
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.rigidBodies, { timeout: 20000 });
await page.waitForTimeout(800);

const enter = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const res = await ctx.console.exec('run test --level physics-test --world campaign-level');
  const w = ctx.world;
  // Cell ids: Stone = 12, Water = 2.
  const at = (x, y) => w.types[w.idx(x, y)];
  return {
    ok: res.ok,
    text: res.text,
    mode: ctx.state.mode,
    bodies: ctx.rigidBodies.bodies.length,
    floor: at(820, 606), // arena floor
    leftWall: at(561, 500), // outer wall
    waterCells: (() => {
      let n = 0;
      for (let x = 970; x <= 1090; x++) for (let y = 560; y <= 596; y++) if (at(x, y) === 2) n++;
      return n;
    })(),
    px: ctx.player.x,
    py: ctx.player.y,
    spawnClear: at(Math.round(ctx.player.x), Math.round(ctx.player.y)) === 0 && at(Math.round(ctx.player.x), Math.round(ctx.player.y) - 14) === 0,
  };
});
check('run command loads the physics-test level', enter.ok && enter.mode === 'play', JSON.stringify(enter));
check('arena terrain is stamped (floor + walls are Stone)', enter.floor === 12 && enter.leftWall === 12, JSON.stringify(enter));
check('water pool is filled', enter.waterCells > 1500, `waterCells=${enter.waterCells}`);
check('rigid bodies are spawned', enter.bodies >= 12, `bodies=${enter.bodies}`);
check('player is placed inside the arena', enter.px > 560 && enter.px < 1140 && Math.abs(enter.py - 599) < 8, JSON.stringify(enter));
check('player spawn is clear (not wedged in terrain)', enter.spawnClear === true, JSON.stringify(enter));

// Run it a while; confirm stability (no crash) and that bodies settle.
const after = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const moved0 = ctx.rigidBodies.bodies.map((b) => ({ x: b.x, y: b.y }));
  for (let f = 0; f < 320; f++) window.__game.tick();
  let moved = 0;
  let asleep = 0;
  ctx.rigidBodies.bodies.forEach((b, i) => {
    if (moved0[i] && Math.hypot(b.x - moved0[i].x, b.y - moved0[i].y) > 2) moved++;
    if (b.sleeping) asleep++;
  });
  return { count: ctx.rigidBodies.bodies.length, moved, asleep };
});
check('bodies settle in the arena (most asleep, none lost)', after.count >= 12 && after.asleep >= 6, JSON.stringify(after));
check('bodies moved under gravity/ramps', after.moved >= 4, JSON.stringify(after));
check('no page errors (no Rapier crash)', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nphysics-level probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

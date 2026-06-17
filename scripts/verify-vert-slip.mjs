// Runtime probe for vertical "slip": rising past a small wall nub instead of
// catching a shoulder on it (the climbing mirror of the run's stepUp). Builds a
// narrow vertical tunnel with a 2-cell nub jutting from one wall, then checks
// (1) the physics primitive slips sideways to clear it when asked and stays
// blocked when not, and (2) a real levitating player rises past the nub.
// Usage: node scripts/verify-vert-slip.mjs [url]
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
await page.waitForFunction(() => window.__game?.ctx?.physics, { timeout: 20000 });
await page.evaluate(() => window.__game.ctx.levels.startRun(window.__game.ctx, { mode: 'test', worldSource: 'campaign-level', levelId: 'physics-test', seed: 1, loadout: 'fresh' }));
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'physics-test', { timeout: 20000 });
await page.waitForFunction(() => window.__game.ctx.levels._transitioning === false, { timeout: 10000 });

// paint a vertical tunnel (gap x=200..211) with a 2-cell nub on the LEFT wall
await page.evaluate(() => {
  const w = window.__game.ctx.world;
  const stone = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = w.idx(x, y); w.types[i] = 12; w.colors[i] = 0x6b6b6b; } };
  stone(190, 350, 199, 450); // left wall
  stone(212, 350, 221, 450); // right wall
  stone(200, 398, 201, 402); // nub jutting 2 cells into the gap
});

// ---- 1. the physics primitive: blocked without slip, slips through with it --
const prim = await page.evaluate(() => {
  const phys = window.__game.ctx.physics;
  // feet at y=410: the 17-tall body (rows 394..410) straddles the nub at x=201
  const a = { x: 205, y: 410 };
  const blocked = phys.tryMoveEntity(a, 0, -1, 4, 17, 0, 0); // no slip
  const b = { x: 205, y: 410 };
  const slipped = phys.tryMoveEntity(b, 0, -1, 4, 17, 0, 3); // slip up to 3
  return { blocked, aStill: a.x === 205 && a.y === 410, slipped, bx: b.x, by: b.y };
});
check('without slip, a rising body is pinned by the nub', prim.blocked === false && prim.aStill, JSON.stringify(prim));
check('with slip, it nudges aside (away from the nub) and rises', prim.slipped === true && prim.bx === 206 && prim.by === 409, JSON.stringify(prim));

// ---- 2. integration: a levitating player rises PAST the nub ----------------
const climb = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.paused = false;
  const p = ctx.player;
  p.x = 205; p.y = 440; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
  p.dead = false; p.crawling = false; p.climbing = false; p.swinging = false; p.grounded = false;
  const startY = p.y;
  let minReached = p.y;
  for (let f = 0; f < 240; f++) {
    p.levit = p.maxLevit;          // hold the jet lit
    ctx.input.keys.jump = true;     // hold to levitate up
    window.__game.tick();
    if (p.y < minReached) minReached = p.y;
    if (p.dead) break;
  }
  ctx.input.keys.jump = false;
  return { startY, endY: p.y, minReached, endX: p.x, dead: p.dead };
});
// nub bottom is y=398; pinned-without-slip would stall the feet near ~410.
check('a levitating player climbs clear past the nub', climb.minReached < 390 && !climb.dead, JSON.stringify(climb));
check('clearing the nub slipped the body off-center', climb.endX !== 205, JSON.stringify(climb));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nvertical slip probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

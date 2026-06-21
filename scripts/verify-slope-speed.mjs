// Runtime probe for grounded run speed on steep inclines.
// Usage: node scripts/verify-slope-speed.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
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

const results = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const p = ctx.player;
  const STONE = 12;
  const EMPTY = 0;
  const region = { x0: 180, x1: 820, y0: 300, y1: 980 };
  const startX = 260;
  const baseFloorY = 700;
  const bodyHalfW = 4;
  const frames = 110;

  const setCell = (x, y, t) => {
    if (!w.inBounds(x, y)) return;
    const i = w.idx(x, y);
    if (t === EMPTY) w.clearCellAt(i);
    else w.replaceCellAt(i, t, 0x6b6b6b);
  };
  const clearRegion = () => {
    for (let y = region.y0; y <= region.y1; y++) {
      for (let x = region.x0; x <= region.x1; x++) setCell(x, y, EMPTY);
    }
  };
  const floorYFor = (kind, x) => {
    if (kind === 'uphill') return baseFloorY - (x - startX);
    if (kind === 'downhill') return baseFloorY + (x - startX);
    return baseFloorY;
  };
  const standingYFor = (kind, x) => {
    let topFloor = Infinity;
    for (let dx = -bodyHalfW; dx <= bodyHalfW; dx++) topFloor = Math.min(topFloor, floorYFor(kind, x + dx));
    return topFloor - 1;
  };
  const paintTerrain = (kind) => {
    clearRegion();
    for (let x = region.x0; x <= region.x1; x++) {
      const floorY = Math.max(region.y0 + 24, Math.min(region.y1 - 8, floorYFor(kind, x)));
      for (let y = floorY; y <= region.y1; y++) setCell(x, y, STONE);
    }
  };
  const resetPlayer = (kind) => {
    p.x = startX;
    p.y = standingYFor(kind, startX);
    p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
    p.dead = false; p.hp = p.maxHp = 9999;
    p.crawling = false; p.inLiquid = false; p.climbing = false; p.swinging = false;
    p.diveT = 0; p.pullT = 0; p.recharge = 0;
    for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
    ctx.enemies.length = 0;
    ctx.projectiles.length = 0;
    ctx.rigidBodies.bodies.length = 0;
    const rt = ctx.levels.current;
    if (rt) {
      rt.mechanisms.length = 0;
      rt.pickups.length = 0;
      rt.waystones.length = 0;
      rt.portal = null;
    }
    ctx.camera.snapTo(p.x, p.y);
    for (let f = 0; f < 8; f++) window.__game.tick();
  };
  const measure = (kind) => {
    paintTerrain(kind);
    resetPlayer(kind);
    const x0 = p.x;
    const y0 = p.y;
    let lastX = p.x;
    let lastY = p.y;
    let path = 0;
    let groundedFrames = 0;
    ctx.input.keys.right = true;
    for (let f = 0; f < frames; f++) {
      window.__game.tick();
      path += Math.hypot(p.x - lastX, p.y - lastY);
      lastX = p.x;
      lastY = p.y;
      if (p.grounded) groundedFrames++;
    }
    ctx.input.keys.right = false;
    return {
      kind,
      dx: p.x - x0,
      dy: p.y - y0,
      path,
      groundedFrames,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
    };
  };

  return {
    flat: measure('flat'),
    uphill: measure('uphill'),
    downhill: measure('downhill'),
  };
});

const { flat, uphill, downhill } = results;
console.log('  ..    slope results:', JSON.stringify({
  flat: { dx: flat.dx, dy: flat.dy, path: +flat.path.toFixed(1), grounded: flat.groundedFrames },
  uphill: { dx: uphill.dx, dy: uphill.dy, path: +uphill.path.toFixed(1), grounded: uphill.groundedFrames },
  downhill: { dx: downhill.dx, dy: downhill.dy, path: +downhill.path.toFixed(1), grounded: downhill.groundedFrames },
}));

check('flat run still covers substantial ground', flat.dx >= 160 && flat.path >= 160, JSON.stringify(flat));
check('uphill horizontal progress is reduced by path-length budgeting', uphill.dx > 0 && uphill.dx <= flat.dx * 0.82, JSON.stringify({ flat, uphill }));
check('downhill horizontal progress is reduced by path-length budgeting', downhill.dx > 0 && downhill.dx <= flat.dx * 0.82, JSON.stringify({ flat, downhill }));
check('incline path distance stays near flat run distance', uphill.path <= flat.path * 1.18 && downhill.path <= flat.path * 1.18, JSON.stringify({ flat, uphill, downhill }));
check('player remains grounded on the measured slopes', uphill.groundedFrames >= 90 && downhill.groundedFrames >= 90, JSON.stringify({ uphill, downhill }));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nslope speed probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

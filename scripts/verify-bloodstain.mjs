// Verifies blood stains sturdy terrain: a blood particle reddens the wall it
// strikes, and pooling/flowing blood reddens the floor it touches.
// Usage: node scripts/verify-bloodstain.mjs [url]   (dev server running)
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
await page.waitForTimeout(800);

// Shared helpers in-page (Blood cell id = 18; stone grey = 0x777777 = G 119).
await page.evaluate(() => {
  window.__bs = {
    G: (c) => (c >> 8) & 255,
    R: (c) => (c >> 16) & 255,
    scene() {
      const ctx = window.__game.ctx;
      const w = ctx.world;
      ctx.state.mode = 'play';
      ctx.state.paused = false;
      ctx.fx.hitstop = 0;
      w.clear();
      w.simBounds.x0 = 290;
      w.simBounds.y0 = 280;
      w.simBounds.x1 = 360;
      w.simBounds.y1 = 430;
      return { w, ctx };
    },
    stone(w, x, y) {
      const i = w.idx(x, y);
      w.types[i] = 12; // Stone
      w.colors[i] = 0x777777;
    },
  };
});

// ---- A: a blood particle stains the wall it hits --------------------------
const wall = await page.evaluate(() => {
  const { w } = window.__bs.scene();
  const ctx = window.__game.ctx;
  for (let x = 320; x <= 323; x++) for (let y = 296; y <= 304; y++) window.__bs.stone(w, x, y);
  // Blood particle flying right into the wall (type 18 = Cell.Blood).
  ctx.particles.spawn(310, 300, 4, 0, 18, 0xb4232a, 200);
  for (let f = 0; f < 12; f++) window.__game.tick();
  let minG = 255;
  let rAtMin = 0;
  for (let x = 320; x <= 323; x++) {
    for (let y = 296; y <= 304; y++) {
      const c = w.colors[w.idx(x, y)];
      const g = window.__bs.G(c);
      if (g < minG) {
        minG = g;
        rAtMin = window.__bs.R(c);
      }
    }
  }
  return { minG, rAtMin };
});
check('blood particle reddens the wall it strikes (green drops from 119)', wall.minG < 100, JSON.stringify(wall));
check('the stain reads RED (red channel stays above green)', wall.rAtMin > wall.minG + 20, JSON.stringify(wall));

// ---- B: pooling/flowing blood stains the floor it touches -----------------
// tick() rederives simBounds from the camera, so park the player (and thus the
// camera) beside the test area to keep the cell sim running over it.
const floor = await page.evaluate(() => {
  const { w } = window.__bs.scene();
  const ctx = window.__game.ctx;
  for (let x = 300; x <= 345; x++) for (let y = 400; y <= 404; y++) window.__bs.stone(w, x, y);
  const p = ctx.player;
  p.x = 332;
  p.y = 399;
  p.fx = p.fy = p.vx = p.vy = 0;
  p.dead = false;
  p.crawling = false;
  p.climbing = false;
  for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  ctx.camera.snapTo(332, 395);
  // A blob of blood resting on the floor, away from the player.
  for (let x = 316; x <= 322; x++) for (let y = 396; y <= 399; y++) {
    const i = w.idx(x, y);
    w.types[i] = 18; // Blood
    w.colors[i] = 0xb4232a;
  }
  for (let f = 0; f < 60; f++) window.__game.tick();
  let minG = 255;
  let stained = 0;
  for (let x = 312; x <= 326; x++) {
    const c = w.colors[w.idx(x, 400)];
    const g = window.__bs.G(c);
    if (g < minG) minG = g;
    if (g < 110) stained++;
  }
  return { minG, stained };
});
check('flowing blood reddens the floor beneath it', floor.minG < 100, JSON.stringify(floor));
check('multiple floor cells get stained as blood spreads', floor.stained >= 2, JSON.stringify(floor));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\nbloodstain probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

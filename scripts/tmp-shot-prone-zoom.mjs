// One-off: tight zoom on the prone crawl pose — open floor, gauge-tight
// ceiling (cheek-flat CRAMPED variant), and a dead-end scrunch. Throwaway.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
await page.click('#mode-play-btn');
await page.waitForFunction(() => {
  const l = window.__game.ctx.levels;
  return l.current !== null && !l.transitioning;
}, { timeout: 15000 });
await page.waitForTimeout(400);

const setup = (slab, endWall) => page.evaluate(({ slab, endWall }) => {
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
  if (slab) solid(560, 760, 524, 526);
  if (endWall) solid(700, 760, 420, 540);
  ctx.enemies.length = 0;
  const p = ctx.player;
  p.x = 620; p.y = 535; p.vx = 0; p.vy = 0; p.hp = p.maxHp; p.invuln = 30000;
  ctx.params.global.ambient = 0.7;
  ctx.camera.zoomLock = 5.5;
  ctx.input.mouse.x = 5000; // aim far right: facing locked rightward
  ctx.input.mouse.y = p.y - 4;
}, { slab, endWall });

const key = (code, down) =>
  page.evaluate(({ code, down }) => {
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
  }, { code, down });
const shot = async (name) => {
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.state.paused = true; // freeze the tick FIRST so the camera can't re-ease away
    ctx.camera.snapTo(ctx.player.x, ctx.player.y - 9);
    ctx.particles.clear();
  });
  await page.waitForTimeout(150);
  const clip = await page.evaluate(() => {
    const c = document.querySelector('#canvas-holder > canvas');
    const r = c.getBoundingClientRect();
    const ctx = window.__game.ctx;
    const z = ctx.camera.zoom;
    const ux = (((ctx.player.x - ctx.camera.renderX) / 525 - 0.5) * z + 0.5);
    const uy = (((ctx.player.y - 5 - ctx.camera.renderY) / 357 - 0.5) * z + 0.5);
    return {
      x: Math.max(0, r.left + ux * r.width - 180),
      y: Math.max(0, r.top + uy * r.height - 110),
      width: 360,
      height: 220,
    };
  });
  await page.screenshot({ path: `verify-out/pronezoom-${name}.png`, clip });
  await page.evaluate(() => { window.__game.ctx.state.paused = false; });
};

// open floor, moving + still
await setup(false, false);
await key('KeyS', true);
await key('KeyD', true);
await page.waitForTimeout(500);
await shot('open-moving');
await key('KeyD', false);
await page.waitForTimeout(300);
await shot('still');
await key('KeyS', false);
await page.waitForTimeout(400);

// jagged ascending slope (run 6, rises 3-5): crawl up it, shoot mid-climb
// moving and parked — the body should lie along the incline both ways
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
  solid(500, 579, 536, 540);
  const rises = [4, 5, 3, 5, 4, 4, 5, 3, 5, 4];
  let feetRow = 535;
  for (let k = 0; k <= 10; k++) {
    if (k > 0) feetRow -= rises[k - 1];
    solid(580 + k * 6, 585 + k * 6, feetRow + 1, 540);
  }
  solid(646, 760, feetRow + 1, 540);
  const p = ctx.player;
  p.x = 560; p.y = 535; p.vx = 0; p.vy = 0;
  ctx.input.mouse.x = 5000;
  ctx.input.mouse.y = p.y - 30;
});
await key('KeyS', true);
await key('KeyD', true);
await page.waitForTimeout(1100); // mid-staircase
await shot('slope-moving');
await key('KeyD', false);
await page.waitForTimeout(500);
await shot('slope-parked');
await key('KeyS', false);
await page.waitForTimeout(400);

// gauge-tight ceiling: cheek-flat cramped variant
await setup(true, false);
await key('KeyS', true);
await key('KeyD', true);
await page.waitForTimeout(700);
await shot('cramped');
await key('KeyD', false);
await key('KeyS', false);
await page.waitForTimeout(400);

// dead-end wall: nose-to-the-rock scrunch
await setup(false, true);
await key('KeyS', true);
await key('KeyD', true);
await page.waitForTimeout(1200);
await shot('deadend');
await browser.close();
console.log('zoom shots written');

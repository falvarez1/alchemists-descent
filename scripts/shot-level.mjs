// Screenshot a generated earthen level to confirm the cauldron/waystone spacing
// and the new vine variety. Usage: node scripts/shot-level.mjs [url]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
mkdirSync('verify-out', { recursive: true });

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.levels, { timeout: 20000 });
await page.waitForTimeout(400);

const info = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level d1 --world campaign-level');
  for (let f = 0; f < 60; f++) window.__game.tick();
  ctx.levels._transitioning = false;
  const w = ctx.world, rt = ctx.levels.current;
  const cau = rt.cauldron, ws = rt.waystones?.[0];
  // count vines + find the DENSEST vine patch (most vine cells in a 15x15 box)
  let vines = 0, bestX = -1, bestY = -1, bestRun = 0;
  for (let y = 20; y < w.height - 60; y++) for (let x = 4; x < w.width - 4; x++) if (w.types[w.idx(x, y)] === 15) vines++;
  for (let y = 30; y < w.height - 70; y += 6) {
    for (let x = 14; x < w.width - 14; x += 6) {
      let n = 0;
      for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) if (w.types[w.idx(x + dx, y + dy)] === 15) n++;
      if (n > bestRun) { bestRun = n; bestX = x; bestY = y; }
    }
  }
  return {
    cau, ws, vines, bestX, bestY, bestRun,
    dist: cau && ws ? Math.round(Math.hypot(cau.x - ws.x, cau.y - ws.y)) : -1,
  };
});
console.log(JSON.stringify(info));

const frame = async (fx, fy, zoom, name) => {
  await page.evaluate(({ fx, fy, zoom }) => {
    const ctx = window.__game.ctx;
    ctx.camera.zoomLock = zoom;
    ctx.camera.setInspectionFocus(fx, fy, { snap: true });
    for (let f = 0; f < 28; f++) { ctx.player.dead = false; window.__game.tick(); }
  }, { fx, fy, zoom });
  await page.waitForTimeout(450);
  const holder = await page.$('#canvas-holder');
  const b = await holder.boundingBox();
  const cw = Math.min(560, b.width), chh = Math.min(440, b.height);
  await page.screenshot({ path: `verify-out/${name}.png`, clip: { x: b.x + b.width / 2 - cw / 2, y: b.y + b.height / 2 - chh / 2, width: cw, height: chh } });
};

if (info.ws) await frame((info.cau.x + info.ws.x) / 2, info.ws.y - 12, 2.6, 'level-cauldron-waystone');

// light up a vine-dense region so the variety reads, then screenshot it
if (info.bestX >= 0) {
  const lit = await page.evaluate(({ bx, by }) => {
    const ctx = window.__game.ctx; const w = ctx.world;
    // scatter steady Glowshroom light around the vine cluster (id 22 = Glowshroom)
    const GLOW = 22;
    let lights = 0;
    for (let dy = -28; dy <= 28 && lights < 60; dy += 2) {
      for (let dx = -40; dx <= 40 && lights < 60; dx += 2) {
        const gx = bx + dx, gy = by + dy;
        if (w.inBounds(gx, gy) && w.types[w.idx(gx, gy)] === 0) { const i = w.idx(gx, gy); w.types[i] = GLOW; w.colors[i] = 0x88ffaa; lights++; }
      }
    }
    ctx.camera.zoomLock = 3.2;
    ctx.camera.setInspectionFocus(bx, by + 4, { snap: true });
    for (let f = 0; f < 40; f++) { ctx.player.dead = false; window.__game.tick(); }
    return true;
  }, { bx: info.bestX, by: info.bestY });
  void lit;
  await page.waitForTimeout(500);
  const holder = await page.$('#canvas-holder');
  const b = await holder.boundingBox();
  await page.screenshot({ path: 'verify-out/level-vines.png', clip: { x: b.x + b.width / 2 - 280, y: b.y + b.height / 2 - 220, width: 560, height: 440 } });
}
console.log('errors:', errs.join(' | ') || 'none');
await browser.close();

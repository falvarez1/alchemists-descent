import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 300 });
await page.evaluate(() => { const r = document.getElementById('game-hud'); if (r) r.style.opacity = '0'; });

// A thick stone wall with a water pool pressed against its left face.
const base = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world;
  const cx = 700, top = 686, bot = 742, wallX0 = 700, wallX1 = 716, poolX0 = 660;
  for (let x = poolX0 - 6; x <= wallX1 + 8; x++) for (let y = top - 8; y <= bot + 8; y++) {
    if (!w.inBounds(x, y)) continue; const i = w.idx(x, y);
    if (y > bot || x > wallX1 + 4) w.replaceCellAt(i, 12, 0x6f6f6f);          // basin floor / backstop
    else if (x >= wallX0 && x <= wallX1) w.replaceCellAt(i, 12, 0x7a7a7a);    // the STONE wall (target)
    else if (x >= poolX0 && x < wallX0 && y >= top) w.replaceCellAt(i, 2, 0x2a5cff); // water against the wall
    else w.clearCellAt(i);
  }
  for (const e of ctx.enemies) { e.attackCd = 9999; e.alerted = false; }
  ctx.player.x = poolX0 - 2; ctx.player.y = top - 24; ctx.player.vx = ctx.player.vy = 0;
  ctx.camera.zoomLock = 1; ctx.camera.snapTo((poolX0 + wallX1) / 2, (top + bot) / 2);
  return { cx, top, bot, wallX0, wallX1, poolX0 };
});

const wallCount = () => page.evaluate(({ top, bot, wallX0, wallX1 }) => {
  const w = window.__game.ctx.world; let solid = 0;
  for (let x = wallX0; x <= wallX1; x++) for (let y = top; y <= bot; y++) {
    if (w.inBounds(x, y) && w.types[w.idx(x, y)] === 12) solid++;
  }
  return solid;
}, base);

const grab = (file) => page.evaluate(({ top, bot, poolX0, wallX1 }) => new Promise((res) => {
  const ctx = window.__game.ctx; const mx = (poolX0 + wallX1) / 2, my = (top + bot) / 2;
  ctx.camera.zoomLock = 1; ctx.camera.snapTo(mx, my);
  requestAnimationFrame(() => {
    const cam = ctx.camera, gl = document.querySelector('#canvas-holder > canvas');
    const sx = gl.width / 575, sy = gl.height / 391;
    const px = (mx - cam.renderX) * sx, py = (my - cam.renderY) * sy;
    const hw = 50 * sx, hh = 42 * sy, Z = 7;
    const o = document.createElement('canvas'); o.width = Math.round(hw * 2 * Z); o.height = Math.round(hh * 2 * Z);
    const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(gl, px - hw, py - hh, hw * 2, hh * 2, 0, 0, o.width, o.height);
    res(o.toDataURL('image/png'));
  });
}), base).then((d) => writeFileSync(file, Buffer.from(d.split(',')[1], 'base64')));

// settle the water, snapshot the intact wall
const tick = (frames, charge) => page.evaluate(({ frames, charge, b }) => new Promise((res) => {
  const ctx = window.__game.ctx, w = ctx.world;
  let n = 0; const t = () => {
    if (charge) { // sustain a current in the BAND of water pressed on the wall (a
      // gradient — bright at the face, dark out in the pool — not a uniform slab)
      for (let x = b.wallX0 - 4; x < b.wallX0; x++) for (let y = b.top; y <= b.bot; y++) {
        if (!w.inBounds(x, y)) continue; const i = w.idx(x, y);
        if (w.types[i] === 2) w.setChargeAt(i, charge);
      }
    }
    ctx.camera.zoomLock = 1; ctx.camera.snapTo((b.poolX0 + b.wallX1) / 2, (b.top + b.bot) / 2);
    if (++n < frames) requestAnimationFrame(t);
    else res();
  }; requestAnimationFrame(t);
}), { frames, charge, b: base });

await tick(30, 0);
const before = await wallCount();
await grab('verify-out/erosion-before.png');
// drive a sustained current into the pool for ~2.5s and watch the wall face crumble
await tick(150, 30);
const after = await wallCount();
await grab('verify-out/erosion-after.png');

await browser.close();
const eaten = before - after;
console.log(`wall stone cells: before=${before} after=${after} eroded=${eaten} (${(100 * eaten / before).toFixed(0)}%)`);
if (!(eaten > 20)) { console.error(`FAIL: charge barely eroded the wall (only ${eaten} cells)`); process.exit(1); }
console.log('PASS — a sustained current eroded the stone wall.');

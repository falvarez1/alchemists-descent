import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 400 });
await page.evaluate(() => { const r = document.getElementById('game-hud'); if (r) r.style.opacity = '0'; });

await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world;
  const cx = 700, fy = 742;
  for (let x = cx - 120; x <= cx + 120; x++) for (let y = fy - 60; y <= fy + 6; y++) {
    if (!w.inBounds(x, y)) continue; const i = w.idx(x, y);
    if (y >= fy) w.replaceCellAt(i, 12, 0x6f6f6f); else w.clearCellAt(i);
  }
  for (const c of ctx.critters.list.slice()) ctx.critters.killAt(ctx, c.x, c.y, 2);
  const e = ctx.enemies.filter((g) => g.kind === 'weaver').sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0];
  e.__probeId = 1;
  for (const o of ctx.enemies) if (o.kind === 'weaver' && o !== e) { o.attackCd = 9999; o.alerted = false; }
  e.x = cx; e.y = fy - 26; e.vx = e.vy = 0; e.patrol = undefined; e.alerted = false; e.cranky = 0; e.attackCd = 9999;
  return { cx, fy };
});

const snap = (frames, mutate) => page.evaluate(({ frames, mutate }) => new Promise((res) => {
  const ctx = window.__game.ctx;
  const e = ctx.enemies.find((g) => g.__probeId === 1);
  let n = 0; const t = () => {
    if (mutate) eval(mutate); // re-pin every frame so an airborne player doesn't fall away
    ctx.camera.zoomLock = 1;
    ctx.camera.snapTo(e.x, e.y - 18);
    if (++n < frames) requestAnimationFrame(t);
    else res();
  }; requestAnimationFrame(t);
}), { frames, mutate });

const grab = (file) => page.evaluate(() => new Promise((res) => {
  const ctx = window.__game.ctx;
  const e = ctx.enemies.find((g) => g.__probeId === 1);
  const cx = e.x, cy = e.y - 18; ctx.camera.zoomLock = 1; ctx.camera.snapTo(cx, cy);
  requestAnimationFrame(() => {
    const cam = ctx.camera, gl = document.querySelector('#canvas-holder > canvas');
    const sx = gl.width / 575, sy = gl.height / 391;
    const px = (cx - cam.renderX) * sx, py = (cy - cam.renderY) * sy;
    const hw = 30 * sx, hh = 26 * sy, Z = 9;
    const o = document.createElement('canvas'); o.width = Math.round(hw * 2 * Z); o.height = Math.round(hh * 2 * Z);
    const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(gl, px - hw, py - hh, hw * 2, hh * 2, 0, 0, o.width, o.height);
    res(o.toDataURL('image/png'));
  });
})).then((d) => writeFileSync(file, Buffer.from(d.split(',')[1], 'base64')));

const head = () => page.evaluate(() => {
  const e = window.__game.ctx.enemies.find((g) => g.__probeId === 1);
  return { hx: +(e.weaverHeadX ?? 0).toFixed(2), hy: +(e.weaverHeadY ?? 0).toFixed(2) };
});

const out = {};
// idle scan (unaware)
await snap(80);
out.idle = await head();
await grab('verify-out/head-idle.png');
// alerted, player to the RIGHT and low
await snap(70, "ctx.player.x = e.x + 120; ctx.player.y = e.y; e.alerted = true;");
out.right = await head();
await grab('verify-out/head-right.png');
// player to the LEFT
await snap(70, "ctx.player.x = e.x - 120; ctx.player.y = e.y;");
out.left = await head();
await grab('verify-out/head-left.png');
// player ABOVE
await snap(70, "ctx.player.x = e.x + 8; ctx.player.y = e.y - 90;");
out.above = await head();
await grab('verify-out/head-above.png');

await browser.close();
console.log('HEAD', JSON.stringify(out));
const problems = [];
if (!(out.right.hx > 1.5)) problems.push(`head did not crane right toward player (hx=${out.right.hx})`);
if (!(out.left.hx < -1.5)) problems.push(`head did not crane left toward player (hx=${out.left.hx})`);
if (!(out.above.hy > 1)) problems.push(`head did not pitch up toward overhead player (hy=${out.above.hy})`);
if (problems.length) { console.error('FAIL:\n - ' + problems.join('\n - ')); process.exit(1); }
console.log('PASS — free head tracks the alchemist (right/left/up) and scans when idle.');

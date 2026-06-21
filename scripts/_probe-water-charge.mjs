import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const tag = process.argv[3] || 'before'; // 'before' | 'after'
const csOverride = process.argv[4] !== undefined ? Number(process.argv[4]) : null; // chargeStrength override
mkdirSync('verify-out', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 300 });
await page.evaluate(() => { const r = document.getElementById('game-hud'); if (r) r.style.opacity = '0'; });

// Carve a clean stone basin and fill it with a deep pool of water.
const base = await page.evaluate((cs) => {
  const ctx = window.__game.ctx, w = ctx.world;
  const cx = 700, surf = 700, depth = 46, halfW = 70; // pool surface y, depth, half-width
  for (let x = cx - halfW - 6; x <= cx + halfW + 6; x++) for (let y = surf - 8; y <= surf + depth + 8; y++) {
    if (!w.inBounds(x, y)) continue; const i = w.idx(x, y);
    const wall = x < cx - halfW || x > cx + halfW || y > surf + depth;
    if (wall) w.replaceCellAt(i, 12, 0x6f6f6f);           // stone basin
    else if (y >= surf) w.replaceCellAt(i, 2, 0x2a5cff);   // Water (Cell.Water=2)
    else w.clearCellAt(i);                                  // air above
  }
  // put the player (and thus the camera / sim window) ON the pool, so the
  // electrical grid actually ticks the charge here (off-window charge never spreads).
  for (const e of ctx.enemies) { e.attackCd = 9999; e.alerted = false; }
  ctx.player.x = cx; ctx.player.y = surf - 30; ctx.player.vx = ctx.player.vy = 0;
  ctx.camera.zoomLock = 1; ctx.camera.snapTo(cx, surf + 6);
  if (cs !== null && cs !== undefined) ctx.params.global.chargeStrength = cs;
  return { cx, surf, depth, halfW, chargeStrength: ctx.params.global.chargeStrength };
}, csOverride);

const measure = () => page.evaluate(({ cx, surf, depth, halfW }) => {
  const w = window.__game.ctx.world;
  let cells = 0, total = 0, maxD = 0, anyCharged = 0; const byType = {};
  for (let x = cx - halfW - 6; x <= cx + halfW + 6; x++) for (let y = surf - 12; y <= surf + depth + 8; y++) {
    if (!w.inBounds(x, y)) continue; const i = w.idx(x, y);
    if (w.charge[i] > 0) { anyCharged++; const t = w.types[i]; byType[t] = (byType[t] || 0) + 1; }
    if (w.types[i] === 2 && w.charge[i] > 0) { // charged Water cells = the ripple
      cells++; total += w.charge[i];
      maxD = Math.max(maxD, Math.hypot(x - cx, y - surf));
    }
  }
  return { chargedWaterCells: cells, totalCharge: total, maxSpread: Math.round(maxD), anyCharged, byType };
}, base);

const grab = (file) => page.evaluate(({ cx, surf }) => new Promise((res) => {
  const ctx = window.__game.ctx; ctx.camera.zoomLock = 1; ctx.camera.snapTo(cx, surf + 14);
  requestAnimationFrame(() => {
    const cam = ctx.camera, gl = document.querySelector('#canvas-holder > canvas');
    const sx = gl.width / 575, sy = gl.height / 391;
    const px = (cx - cam.renderX) * sx, py = (surf + 14 - cam.renderY) * sy;
    const hw = 78 * sx, hh = 46 * sy, Z = 5;
    const o = document.createElement('canvas'); o.width = Math.round(hw * 2 * Z); o.height = Math.round(hh * 2 * Z);
    const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(gl, px - hw, py - hh, hw * 2, hh * 2, 0, 0, o.width, o.height);
    res(o.toDataURL('image/png'));
  });
}), base).then((d) => writeFileSync(file, Buffer.from(d.split(',')[1], 'base64')));

// let the water settle into the basin, then fire the Spark Bolt's blast at the surface.
// Pin the camera/player on the pool every frame so it stays in the sim window.
const settle = (frames) => page.evaluate(({ frames, cx, surf }) => new Promise((res) => {
  const ctx = window.__game.ctx;
  let n = 0; const t = () => {
    ctx.player.x = cx; ctx.player.y = surf - 30; ctx.player.vx = ctx.player.vy = 0;
    ctx.camera.zoomLock = 1; ctx.camera.snapTo(cx, surf + 6);
    if (++n < frames) requestAnimationFrame(t);
    else res();
  }; requestAnimationFrame(t);
}), { frames, cx: base.cx, surf: base.surf });
await settle(40);
await page.evaluate(({ cx, surf }) => {
  // exactly what a Spark Bolt does on impact: triggerExplosion at bolt.explosionRadius (14)
  window.__game.ctx.explosions.trigger(cx, surf + 3, window.__game.ctx.params.spells.bolt.explosionRadius);
}, base);

// sample the ripple as it crawls, and grab the frame near peak brightness
const samples = [];
for (let f = 0; f < 16; f++) {
  samples.push(await measure());
  if (f === 4) await grab(`verify-out/water-charge-${tag}.png`);
  await settle(1);
}
const peak = samples.reduce((a, b) => (b.chargedWaterCells > a.chargedWaterCells ? b : a), samples[0]);
const peakAny = samples.reduce((a, b) => (b.anyCharged > a.anyCharged ? b : a), samples[0]);

await browser.close();
console.log(`[${tag}] chargeStrength=${base.chargeStrength} peak water ripple:`, JSON.stringify({ chargedWaterCells: peak.chargedWaterCells, totalCharge: peak.totalCharge, maxSpread: peak.maxSpread }));
console.log(`[${tag}] peak ANY charged:`, peakAny.anyCharged, 'byType:', JSON.stringify(peakAny.byType));
console.log(`[${tag}] water-cell series:`, samples.map((s) => s.chargedWaterCells).join(','));
console.log(`[${tag}] any-cell series:`, samples.map((s) => s.anyCharged).join(','));

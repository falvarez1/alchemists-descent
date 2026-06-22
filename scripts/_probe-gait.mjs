// Capture a WALK cycle (flat ground) and a CLIMB cycle (up a wall) as frame sequences,
// to assess gait elegance. Zoomed, HUD hidden.
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';
const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const grab = (file, cx, cy, half = 50, Z = 5) => page.evaluate(({ cx, cy, half, Z }) => new Promise((res) => {
  const ctx = window.__game.ctx; ctx.camera.zoomLock = 1; ctx.camera.snapTo(cx, cy);
  requestAnimationFrame(() => {
    const cam = ctx.camera, gl = document.querySelector('#canvas-holder > canvas');
    const sx = gl.width / 575, sy = gl.height / 391, px = (cx - cam.renderX) * sx, py = (cy - cam.renderY) * sy, hw = half * sx, hh = half * sy;
    const o = document.createElement('canvas'); o.width = Math.round(hw * 2 * Z); o.height = Math.round(hh * 2 * Z);
    const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(gl, px - hw, py - hh, hw * 2, hh * 2, 0, 0, o.width, o.height);
    res(o.toDataURL('image/png'));
  });
}), { cx, cy, half, Z }).then((d) => writeFileSync(file, Buffer.from(d.split(',')[1], 'base64')));
const adv = (n) => page.evaluate((n) => new Promise((res) => { let k = 0; const t = () => { if (++k >= n) return res(); requestAnimationFrame(t); }; requestAnimationFrame(t); }), n);
const wx = () => page.evaluate(() => { const e = window.__game.ctx.enemies.find(g => g.__w === 1); return { x: Math.round(e.x), y: Math.round(e.y) }; });
try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 400 });
  await page.evaluate(() => { const r = document.getElementById('game-hud'); if (r) r.style.opacity = '0'; });
  // ---- WALK: flat thick floor, weaver chasing a level player ----
  await page.evaluate(() => {
    const ctx = window.__game.ctx, w = ctx.world; const fy = 742;
    for (let x = 300; x <= 1000; x++) for (let y = fy; y <= fy + 40; y++) if (w.inBounds(x, y)) w.replaceCellAt(w.idx(x, y), 12, 0x6f6f6f);
    for (let x = 300; x <= 1000; x++) for (let y = fy - 60; y < fy; y++) if (w.inBounds(x, y)) w.clearCellAt(w.idx(x, y));
    const all = ctx.enemies.filter(g => g.kind === 'weaver'); for (const o of all) o.x = 40;
    const e = all[0]; e.__w = 1; for (const c of ctx.critters.list.slice()) ctx.critters.killAt(ctx, c.x, c.y, 2);
    e.x = 520; e.y = fy - 1; e.vx = e.vy = 0; e.alerted = true; e.cranky = 0; e.sleeping = false; e.attackCd = 9999; e.patrol = undefined;
    ctx.player.x = 900; ctx.player.y = fy - 2; ctx.player.hp = ctx.player.maxHp = 99999;
  });
  await adv(60);
  for (let k = 0; k < 4; k++) { const s = await wx(); await grab(`verify-out/gait-walk-${k}.png`, s.x, s.y - 12, 44, 5); await adv(7); }
  // ---- CLIMB: wall on the right, player on top ----
  await page.evaluate(() => {
    const ctx = window.__game.ctx, w = ctx.world; const fy = 742, wallX = 720, top = fy - 80;
    for (let x = 360; x <= 900; x++) for (let y = top - 30; y <= fy + 40; y++) { if (!w.inBounds(x, y)) continue; const i = w.idx(x, y); if (y >= fy) w.replaceCellAt(i, 12, 0x6f6f6f); else if (x >= wallX) w.replaceCellAt(i, 12, 0x6f6f6f); else w.clearCellAt(i); }
    const e = ctx.enemies.find(g => g.__w === 1); e.x = wallX - 10; e.y = top + 30; e.vx = e.vy = 0; e.alerted = true; e.cranky = 600; e.attackCd = 9999; e.weaverClimbT = 0; e.weaverClimbDir = 0;
    ctx.player.x = wallX + 30; ctx.player.y = top - 2; ctx.player.hp = ctx.player.maxHp = 99999;
  });
  for (let k = 0; k < 5; k++) { await page.evaluate(() => { const e = window.__game.ctx.enemies.find(g => g.__w === 1); e.cranky = 600; window.__game.ctx.player.hp = window.__game.ctx.player.maxHp = 99999; }); const s = await wx(); await grab(`verify-out/gait-climb-${k}.png`, s.x, s.y - 12, 44, 5); await adv(6); }
  console.log('captured walk 0-3, climb 0-4');
} finally { await browser.close(); }

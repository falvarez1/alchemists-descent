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

// Carve a long flat stone runway and drop the gaiter on it.
const base = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world;
  const W = w.types[w.idx(512, 741)]; void W;
  const cx = 700, fy = 742;
  for (let x = cx - 280; x <= cx + 280; x++) for (let y = fy - 30; y <= fy + 6; y++) {
    if (!w.inBounds(x, y)) continue; const i = w.idx(x, y);
    if (y >= fy) w.replaceCellAt(i, 12, 0x777777); else w.clearCellAt(i);
  }
  const e = ctx.enemies.filter((g) => g.kind === 'weaver').sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0];
  for (const o of ctx.enemies) if (o.kind === 'weaver' && o !== e) { o.attackCd = 9999; o.alerted = false; }
  // float the body well above the floor so the legs have their natural ~28px reach
  // and the IK forms a stable stance instead of collapsing onto a cramped one.
  e.x = cx - 200; e.y = fy - 26; e.vx = e.vy = 0; e.weaverAggro = 0; e.patrol = undefined;
  return { id: 'set', cx, fy };
});

const grab = (file, cx, cy) => page.evaluate(({ cx, cy }) => new Promise((res) => {
  const ctx = window.__game.ctx; ctx.camera.zoomLock = 1; ctx.camera.snapTo(cx, cy);
  requestAnimationFrame(() => {
    const cam = ctx.camera, gl = document.querySelector('#canvas-holder > canvas');
    const sx = gl.width / 575, sy = gl.height / 391;
    const px = (cx - cam.renderX) * sx, py = (cy - cam.renderY) * sy;
    const hw = 60 * sx, hh = 38 * sy, Z = 5;
    const o = document.createElement('canvas'); o.width = Math.round(hw * 2 * Z); o.height = Math.round(hh * 2 * Z);
    const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(gl, px - hw, py - hh, hw * 2, hh * 2, 0, 0, o.width, o.height);
    res(o.toDataURL('image/png'));
  });
}), { cx, cy }).then((d) => writeFileSync(file, Buffer.from(d.split(',')[1], 'base64')));

const sample = () => page.evaluate(() => {
  const e = window.__game.ctx.enemies.filter((g) => g.kind === 'weaver').sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0];
  return { aggro: +(e.weaverAggro ?? 0).toFixed(2), bodyLift: +(e.weaverBodyLift ?? 0).toFixed(1), x: Math.round(e.x), stride: +(e.stride ?? 0).toFixed(2), vx: +(e.vx ?? 0).toFixed(2), grounded: e.grounded === true };
});

// keep the camera glued to the weaver so it stays in the sim window (off-window
// enemies freeze) and on-camera (off-camera sprites don't re-solve the IK).
const snapWait = (frames) => page.evaluate((frames) => new Promise((res) => {
  const ctx = window.__game.ctx;
  const pick = () => ctx.enemies.filter((g) => g.kind === 'weaver').sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0];
  let n = 0; const t = () => { const e = pick(); ctx.camera.zoomLock = 1; ctx.camera.snapTo(e.x, e.y - 16); if (++n < frames) requestAnimationFrame(t); else res(); }; requestAnimationFrame(t);
}), frames);

// --- calm walk: not alerted; let the legs settle so bodyLift reflects the stance ---
await page.evaluate(() => { const e = window.__game.ctx.enemies.filter((g) => g.kind === 'weaver').sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0]; e.alerted = false; e.cranky = 0; e.vx = 0; window.__game.ctx.player.x = 130; });
await snapWait(110);
const calm = await sample();
await grab('verify-out/gait-walk.png', calm.x, base.fy - 16);

// --- aggressive chase: alerted + cranky + a player a short way ahead ---
await page.evaluate(() => { const ctx = window.__game.ctx; const e = ctx.enemies.filter((g) => g.kind === 'weaver').sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0]; e.alerted = true; e.cranky = 400; e.attackCd = 9999; ctx.player.x = e.x + 150; ctx.player.y = e.y; });
const s0 = await sample();
await snapWait(110);
const chase = await sample();
await grab('verify-out/gait-chase.png', chase.x, base.fy - 16);

await browser.close();
const _strideRateCalm = calm.stride; // (rough)
console.log('CALM', JSON.stringify(calm), 'CHASE', JSON.stringify(chase));
void s0;
const problems = [];
if (!(calm.aggro < 0.2)) problems.push(`calm weaver was already aggressive (aggro=${calm.aggro})`);
if (!(chase.aggro > 0.7)) problems.push(`chase did not raise aggression (aggro=${chase.aggro})`);
if (!(chase.vx > 0.1)) problems.push(`chase weaver did not pursue (vx=${chase.vx})`);
if (!(chase.bodyLift <= calm.bodyLift)) problems.push(`chase body not lower than walk (calm=${calm.bodyLift} chase=${chase.bodyLift})`);
if (problems.length) { console.error('FAIL:\n - ' + problems.join('\n - ')); process.exit(1); }
console.log('PASS — calm walk switches to an aggressive low chase gait (aggro 0→' + chase.aggro + ').');

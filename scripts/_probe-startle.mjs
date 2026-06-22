// Threat-telegraph probe: verify the new "startle" tell (EnemySprites.ts) that
// pops above a creature's crown the instant it commits a dodge/flee. Two parts:
//  (A) NATURAL: spawn a bat, hurl a fast body across it, poll dodgeT — proving a
//      real threat drives the timer to the tell threshold (>=10).
//  (B) RENDER: force the exact dodge state on an alerted enemy and screenshot a
//      tight crop with the tell OFF then ON, so the mark can be eyeballed.
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';
const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'physics-test', world: 'campaign-level', seed: 1, settleMs: 400 });
  await page.evaluate(() => { const r = document.getElementById('game-hud'); if (r) r.style.opacity = '0'; });

  // --- Build a small lit arena and a single alerted bat in front of the player ---
  const geo = await page.evaluate(() => {
    const ctx = window.__game.ctx, w = ctx.world;
    const fy = 720, cx = 640;
    for (let x = cx - 90; x <= cx + 90; x++) for (let y = fy - 60; y <= fy + 20; y++) {
      if (!w.inBounds(x, y)) continue; const i = w.idx(x, y);
      if (y >= fy) w.replaceCellAt(i, 12, 0x6f6f6f); else w.clearCellAt(i);
    }
    ctx.enemies.length = 0;
    ctx.player.x = cx - 40; ctx.player.y = fy - 2; ctx.player.hp = ctx.player.maxHp = 99999; ctx.player.vx = ctx.player.vy = 0;
    ctx.enemyCtl.spawn('bat', cx + 24, fy - 34);
    const bat = ctx.enemies[ctx.enemies.length - 1];
    bat.__watch = 1; bat.alerted = true;
    return { fy, cx };
  });

  // ---------- (A) NATURAL: hurl a body across the bat, watch dodgeT peak ----------
  await page.evaluate(({ cx, fy }) => {
    const ctx = window.__game.ctx;
    // a fast rigid body crossing the bat's lane (left->right, level with it)
    ctx.rigidBodies.spawn({ kind: 'box', halfW: 5, halfH: 5 }, cx - 70, fy - 34, { vx: 7.5, vy: 0, material: 'wood' });
  }, geo);
  let peakDodge = 0, sawTell = false;
  for (let f = 0; f < 70; f++) {
    const s = await page.evaluate(() => {
      const ctx = window.__game.ctx, e = ctx.enemies.find(g => g.__watch === 1);
      return new Promise(r => requestAnimationFrame(() => r({ d: e?.dodgeT ?? 0, fl: e?.fleeT ?? 0, fear: +(e?.fear ?? 0).toFixed(2) })));
    });
    peakDodge = Math.max(peakDodge, s.d);
    if (s.d >= 10 || s.fl >= 23) sawTell = true;
    if (f % 12 === 0) console.log('t' + f, JSON.stringify(s));
  }
  console.log('PEAK dodgeT (natural):', peakDodge, '| tell window reached:', sawTell);

  // ---------- (B) RENDER: force the dodge state, crop OFF vs ON ----------
  // Zoom in tight and PIN the bat each frame (re-forcing the tell state) so a
  // 3px mark is legible and doesn't drift out of frame during settle.
  const grab = (name, force) => page.evaluate(({ force }) => new Promise(res => {
    const ctx = window.__game.ctx, e = ctx.enemies.find(g => g.__watch === 1);
    const HX = ctx.player.x + 64, HY = e.y;
    ctx.camera.zoomLock = 6; ctx.camera.zoom = 6;
    let n = 0;
    const tick = () => {
      e.x = HX; e.y = HY; e.vx = e.vy = 0; e.alerted = true;
      e.fleeT = 0;
      if (force) { e.dodgeT = 12; e.dodgeVX = 2.7; e.fear = 0.6; } else { e.dodgeT = 0; }
      ctx.camera.zoom = 6; ctx.camera.snapTo(HX, HY - 4);
      if (++n < 6) { requestAnimationFrame(tick); return; }
      requestAnimationFrame(() => res(document.querySelector('#canvas-holder > canvas').toDataURL('image/png')));
    };
    requestAnimationFrame(tick);
  }), { force }).then(d => writeFileSync('verify-out/startle-' + name + '.png', Buffer.from(d.split(',')[1], 'base64')));

  await grab('off', false);
  await grab('on', true);
  console.log('wrote verify-out/startle-off.png and verify-out/startle-on.png');

  if (!sawTell) { console.error('FAIL — a natural thrown-body threat never drove the bat into the tell window'); process.exitCode = 1; }
  else console.log('PASS — natural threat lit the tell window; screenshots captured for eyeball.');
} finally { await browser.close(); }

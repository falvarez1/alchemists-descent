// Reproduces the two new reports: (1) the Weaver spasming in a vertical tunnel even
// when paused (orientation flip-flopping between the two walls), and (2) trouble
// climbing up the tunnel. Builds a chimney, drops the weaver in with the quarry above,
// and measures BOTH the per-frame orientation jitter (the spasm) and how high it rises.
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 400 });
  await page.evaluate(() => { const r = document.getElementById('game-hud'); if (r) r.style.opacity = '0'; });

  const env = await page.evaluate(() => {
    const ctx = window.__game.ctx, w = ctx.world;
    const fy = 742, gapL = 596, gapR = 624, top = fy - 90; // a 28-wide chimney, 90 tall
    for (let x = 520; x <= 700; x++) for (let y = top - 30; y <= fy + 10; y++) {
      if (!w.inBounds(x, y)) continue;
      const i = w.idx(x, y);
      if (y >= fy) w.replaceCellAt(i, 12, 0x6f6f6f);                 // floor
      else if (x > gapL && x < gapR) w.clearCellAt(i);              // the open shaft
      else w.replaceCellAt(i, 12, 0x6f6f6f);                        // the two walls
    }
    // open a mouth at the top so it can crest out
    for (let x = 540; x <= 680; x++) for (let y = top - 30; y < top; y++) if (w.inBounds(x, y)) w.clearCellAt(w.idx(x, y));
    const e = ctx.enemies.filter((g) => g.kind === 'weaver').sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0];
    e.__probeId = 1;
    for (const o of ctx.enemies) if (o.kind === 'weaver' && o !== e) o.x = 30;
    for (const c of ctx.critters.list.slice()) ctx.critters.killAt(ctx, c.x, c.y, 2);
    e.x = (gapL + gapR) >> 1; e.y = fy - 1; e.vx = e.vy = 0; e.alerted = true; e.cranky = 600; e.sleeping = false; e.attackCd = 9999;
    e.weaverClimbT = 0; e.weaverClimbDir = 0;
    ctx.player.x = (gapL + gapR) >> 1; ctx.player.y = top - 6; ctx.player.hp = ctx.player.maxHp = 99999;
    return { fy, gapL, gapR, top };
  });

  const sample = () => page.evaluate(() => {
    const e = window.__game.ctx.enemies.find((g) => g.__probeId === 1);
    return { x: Math.round(e.x), y: Math.round(e.y), orient: +(e.weaverOrient ?? 0).toFixed(3), climbT: e.weaverClimbT ?? 0, vp: e.weaverVisualPlanted ?? 0 };
  });

  // PHASE A — let it act (climb). Track ascent.
  let minY = 99999, maxOrientSwing = 0, prevOrient = null, everClimbed = false;
  for (let f = 0; f < 220; f++) {
    await page.evaluate(() => {
      const ctx = window.__game.ctx; const e = ctx.enemies.find((g) => g.__probeId === 1);
      e.cranky = 600; ctx.player.hp = ctx.player.maxHp = 99999;
      return new Promise((res) => { ctx.camera.zoomLock = 1; ctx.camera.snapTo(e.x, e.y - 16); requestAnimationFrame(res); });
    });
    const s = await sample();
    minY = Math.min(minY, s.y);
    if (s.climbT > 0) everClimbed = true;
    if (prevOrient !== null) maxOrientSwing = Math.max(maxOrientSwing, Math.abs(s.orient - prevOrient));
    prevOrient = s.orient;
    if (f % 40 === 0) console.log('act f' + f, JSON.stringify(s));
    if (f === 24) {
      const d = await page.evaluate(({ cx, cy }) => new Promise((res) => {
        const ctx = window.__game.ctx; ctx.camera.zoomLock = 1; ctx.camera.snapTo(cx, cy);
        requestAnimationFrame(() => {
          const cam = ctx.camera, gl = document.querySelector('#canvas-holder > canvas');
          const sx = gl.width / 575, sy = gl.height / 391, half = 60, Z = 5;
          const px = (cx - cam.renderX) * sx, py = (cy - cam.renderY) * sy, hw = half * sx, hh = half * sy;
          const o = document.createElement('canvas'); o.width = Math.round(hw * 2 * Z); o.height = Math.round(hh * 2 * Z);
          const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
          g.drawImage(gl, px - hw, py - hh, hw * 2, hh * 2, 0, 0, o.width, o.height);
          res(o.toDataURL('image/png'));
        });
      }), { cx: s.x, cy: s.y - 16 });
      writeFileSync('verify-out/tunnel-climb.png', Buffer.from(d.split(',')[1], 'base64'));
    }
  }
  const climbedCells = env.fy - 1 - minY;

  // PHASE B — the PAUSE spasm test: stop the AI (debug freeze) and keep RENDERING.
  // Measure the per-frame orientation jitter with the body held still — this is what
  // the three paused screenshots captured.
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.debug.active = true; // global debug freeze: AI stops, the renderer keeps solving — the PAUSE case
  });
  let pausedSwing = 0, pPrev = null, pMin = 9, pMax = -9, legSwing = 0;
  for (let f = 0; f < 40; f++) {
    await page.evaluate(() => new Promise((res) => {
      const ctx = window.__game.ctx; const e = ctx.enemies.find((g) => g.__probeId === 1);
      // re-pin the body so it can't move; only the RENDER's leg/orient solve runs
      e.vx = 0; e.vy = 0;
      ctx.camera.zoomLock = 1; ctx.camera.snapTo(e.x, e.y - 16); requestAnimationFrame(res);
    }));
    const s = await page.evaluate(() => {
      const e = window.__game.ctx.enemies.find((g) => g.__probeId === 1);
      const l0 = (e.weaverLegs && e.weaverLegs[0]) ? { x: e.weaverLegs[0].x, y: e.weaverLegs[0].y } : { x: 0, y: 0 };
      return { orient: e.weaverOrient ?? 0, l0 };
    });
    if (pPrev !== null) {
      pausedSwing = Math.max(pausedSwing, Math.abs(s.orient - pPrev.orient));
      legSwing = Math.max(legSwing, Math.hypot(s.l0.x - pPrev.l0.x, s.l0.y - pPrev.l0.y));
    }
    pPrev = s;
    pMin = Math.min(pMin, s.orient); pMax = Math.max(pMax, s.orient);
  }

  console.log('RESULT', JSON.stringify({ climbedCells, minY, top: env.top, everClimbed, maxOrientSwing: +maxOrientSwing.toFixed(3), pausedSwing: +pausedSwing.toFixed(3), pausedRange: +(pMax - pMin).toFixed(3), legSwing: +legSwing.toFixed(2) }));
  const problems = [];
  if (pausedSwing > 0.25) problems.push(`SPASM: orientation jitters ${(pausedSwing).toFixed(2)} rad/frame while held (should be ~0)`);
  if (pMax - pMin > 0.6) problems.push(`SPASM: orientation ranges ${(pMax - pMin).toFixed(2)} rad while held`);
  if (legSwing > 14) problems.push(`SPASM: leg 0 jumps ${legSwing.toFixed(1)} px/frame while held`);
  if (!(climbedCells > 24)) problems.push(`did not climb the chimney (rose only ${climbedCells} cells)`);
  if (problems.length) { console.error('FAIL:\n - ' + problems.join('\n - ')); process.exitCode = 1; }
  else console.log(`PASS — chimney: climbed ${climbedCells} cells, stable while held (swing ${pausedSwing.toFixed(3)} rad/f).`);
} finally {
  await browser.close();
}

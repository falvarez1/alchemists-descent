// Reproduce the report: the alchemist is on a SHELF overhead (attached to a wall a bit
// to the side), the weaver on the floor below. A climber should range to the wall,
// climb it, crest onto the shelf and come for the player — not stand under it pawing.
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';
const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 400 });
  await page.evaluate(() => { const r = document.getElementById('game-hud'); if (r) r.style.opacity = '0'; });
  const env = await page.evaluate(() => {
    const ctx = window.__game.ctx, w = ctx.world;
    const fy = 742, shelfTop = fy - 90, plateauL = 720;
    // lower floor on the left (the weaver), a higher PLATEAU on the right (solid step up
    // to its top, no overhang) with the alchemist on it. The weaver must range to the
    // plateau's left face, climb the ~90-cell step and crest onto the top to reach prey.
    for (let x = 360; x <= 1060; x++) for (let y = shelfTop - 4; y <= fy + 44; y++) {
      if (!w.inBounds(x, y)) continue; const i = w.idx(x, y);
      if (x >= plateauL && y >= shelfTop) w.replaceCellAt(i, 12, 0x6f6f6f);  // raised plateau (solid)
      else if (y >= fy) w.replaceCellAt(i, 12, 0x6f6f6f);                    // lower floor
      else w.clearCellAt(i);
    }
    const all = ctx.enemies.filter(g => g.kind === 'weaver');
    for (const o of all) o.x = 40;
    const e = all[0]; e.__watch = 1;
    for (const c of ctx.critters.list.slice()) ctx.critters.killAt(ctx, c.x, c.y, 2);
    e.x = 560; e.y = fy - 1; e.vx = e.vy = 0; e.sleeping = false; e.alerted = true; e.cranky = 0; e.attackCd = 60;
    e.weaverClimbT = 0; e.weaverClimbDir = 0; e.patrol = undefined;
    ctx.player.x = 860; ctx.player.y = shelfTop - 2; ctx.player.hp = ctx.player.maxHp = 99999; ctx.player.vx = ctx.player.vy = 0;
    return { fy, shelfTop, plateauL };
  });
  const sample = () => page.evaluate(() => {
    const ctx = window.__game.ctx, p = ctx.player, e = ctx.enemies.find(g => g.__watch === 1);
    // replicate wallColumnHeight to confirm a tall wall is detectable to the right
    const w = ctx.world; const foot = Math.floor(e.y); let wallRightAt = -1;
    for (let dist = 11; dist <= 300 && wallRightAt < 0; dist += 2) {
      const X = Math.floor(e.x) + dist; let footed = false;
      for (let Y = foot - 1; Y <= foot + 2; Y++) { const t = w.types[w.idx(X, Y)]; if (t === 3 || t === 12 || t === 13) { footed = true; break; } }
      if (!footed) continue; let h = 0;
      for (let Y = foot - 1; Y >= foot - 96; Y--) { const t = w.types[w.idx(X, Y)]; if (t === 3 || t === 12 || t === 13) h = foot - Y; else break; }
      if (h > 7) wallRightAt = dist;
    }
    // count solid floor cells directly under the body, and vine cells in the stance box
    let floorBelow = 0, vinesNear = 0;
    for (let xx = Math.floor(e.x) - 56; xx <= Math.floor(e.x) + 56; xx++) {
      for (let yy = foot + 1; yy <= foot + 6; yy++) { const t = w.types[w.idx(xx, yy)]; if (t === 3 || t === 12 || t === 13) floorBelow++; }
      for (let yy = foot - 18; yy <= foot + 22; yy++) { if (w.types[w.idx(xx, yy)] === 15) vinesNear++; }
    }
    return { x: Math.round(e.x), y: Math.round(e.y), floorBelow, vinesNear, dx: Math.round(p.x - e.x), dy: Math.round(p.y - e.y), dist: Math.round(Math.hypot(p.x - e.x, p.y - e.y)), climbT: e.weaverClimbT ?? 0, grounded: e.grounded === true, vx: +(e.vx ?? 0).toFixed(2), wallRightAt, pSup: +(e.weaverPhysicalSupport ?? 0).toFixed(2), anc: e.weaverAnchorCount ?? -1, fallT: e.weaverFallT ?? 0, scx: Math.round((e.weaverSupportCenterX ?? e.x) - e.x), reach: +(e.weaverReach ?? 0).toFixed(2) };
  });
  const grab = (f, s) => page.evaluate(() => new Promise(res => { const ctx = window.__game.ctx, e = ctx.enemies.find(g => g.__watch === 1); ctx.camera.zoomLock = 1; ctx.camera.snapTo((e.x + ctx.player.x) / 2, (e.y + ctx.player.y) / 2 - 10); requestAnimationFrame(() => res(document.querySelector('#canvas-holder > canvas').toDataURL('image/png'))); })).then(d => writeFileSync('verify-out/overhead-' + f + '.png', Buffer.from(d.split(',')[1], 'base64')));
  let minDist = 99999, everClimbed = false, minY = 99999;
  for (let f = 0; f <= 900; f++) {
    await page.evaluate(() => { const ctx = window.__game.ctx; ctx.player.hp = ctx.player.maxHp = 99999; return new Promise(r => requestAnimationFrame(r)); });
    const s = await sample(); minDist = Math.min(minDist, s.dist); minY = Math.min(minY, s.y); if (s.climbT > 0) everClimbed = true;
    if (f % 75 === 0) console.log('t' + f, JSON.stringify(s));
    if (f === 900) await grab(f, s);
  }
  // It must actually GET UP onto the shelf (minY near shelfTop), not just stand
  // directly below the quarry (where straight-line dist is small but it never climbed).
  const gotUp = minY <= env.shelfTop + 14;
  console.log('RESULT', JSON.stringify({ minDist, minY, everClimbed, gotUp, shelfTop: env.shelfTop }));
  if (!everClimbed || !gotUp) { console.error(`FAIL — did not climb to the overhead shelf (everClimbed ${everClimbed}, minY ${minY} vs shelfTop ${env.shelfTop}). Stood below pawing instead of climbing the wall.`); process.exitCode = 1; }
  else console.log(`PASS — ranged to the wall, climbed onto the shelf (minY ${minY}) and closed to ${minDist}px.`);
} finally { await browser.close(); }

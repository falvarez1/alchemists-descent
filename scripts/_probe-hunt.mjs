// Reproduce the report: a weaver up on a pillar/in its web, the alchemist on the floor
// to the lower-left. The weaver is AWARE (alerted, like it has clocked you) but we do
// NOT force cranky or teleport. Question: does it actually HUNT — descend the pillar
// and pursue — or sit there looking dumb? Watch 12s, screenshot the arc.
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
  await page.evaluate(() => {
    const ctx = window.__game.ctx, w = ctx.world;
    const fy = 742, pL = 600, pR = 630, top = fy - 120; // a tall pillar
    // wide floor + tall central pillar; everything else open
    for (let x = 120; x <= 1000; x++) for (let y = top - 20; y <= fy + 40; y++) {
      if (!w.inBounds(x, y)) continue; const i = w.idx(x, y);
      if (y >= fy) w.replaceCellAt(i, 12, 0x6f6f6f);
      else if (x >= pL && x <= pR && y >= top) w.replaceCellAt(i, 12, 0x6f6f6f);
      else w.clearCellAt(i);
    }
    const all = ctx.enemies.filter(g => g.kind === 'weaver');
    for (const o of all) o.x = 40; // park the others off to the side
    const e = all[0];
    e.__watch = 1;
    // place it clinging high on the LEFT face of the pillar, AWARE of the player below-left
    e.x = pL - 10; e.y = top + 30; e.vx = e.vy = 0; e.sleeping = false; e.alerted = true;
    e.cranky = 0; e.attackCd = 60; e.patrol = undefined; e.weaverClimbT = 0; e.weaverClimbDir = 0;
    for (const c of ctx.critters.list.slice()) ctx.critters.killAt(ctx, c.x, c.y, 2);
    ctx.player.x = 280; ctx.player.y = fy - 2; ctx.player.hp = ctx.player.maxHp = 99999;
    ctx.player.vx = ctx.player.vy = 0;
    return { fy, pL, pR, top };
  });
  const sample = () => page.evaluate(() => {
    const ctx = window.__game.ctx, p = ctx.player, e = ctx.enemies.find(g => g.__watch === 1);
    return { x: Math.round(e.x), y: Math.round(e.y), dx: Math.round(p.x - e.x), dy: Math.round(p.y - e.y),
      dist: Math.round(Math.hypot(p.x - e.x, p.y - e.y)), alerted: e.alerted === true, cranky: Math.round(e.cranky ?? 0),
      vx: +(e.vx ?? 0).toFixed(2), vy: +(e.vy ?? 0).toFixed(2), grounded: e.grounded === true, climbT: e.weaverClimbT ?? 0,
      blink: e.blink ?? 0, windup: e.windup ?? 0, pSup: +(e.weaverPhysicalSupport ?? 0).toFixed(2), anc: e.weaverAnchorCount ?? 0, fallT: e.weaverFallT ?? 0, attackCd: Math.round(e.attackCd ?? 0), feedT: e.weaverFeedT ?? 0, stalk: +(e.weaverStalk ?? 0).toFixed(2) };
  });
  const grab = (f) => page.evaluate(() => new Promise(res => {
    const ctx = window.__game.ctx, e = ctx.enemies.find(g => g.__watch === 1);
    ctx.camera.zoomLock = 1; ctx.camera.snapTo((e.x + ctx.player.x) / 2, (e.y + ctx.player.y) / 2 - 10);
    requestAnimationFrame(() => res(document.querySelector('#canvas-holder > canvas').toDataURL('image/png')));
  })).then(d => writeFileSync('verify-out/hunt-' + f + '.png', Buffer.from(d.split(',')[1], 'base64')));
  let minDist = 99999;
  for (let f = 0; f <= 720; f++) {
    await page.evaluate(() => { const ctx = window.__game.ctx; ctx.player.hp = ctx.player.maxHp = 99999; return new Promise(r => requestAnimationFrame(r)); });
    const s = await sample(); minDist = Math.min(minDist, s.dist);
    if (f % 90 === 0) console.log('t' + f, JSON.stringify(s));
    if (f === 0 || f === 360 || f === 720) await grab(f);
  }
  // Started ~320px up on a pillar; a smart hunter descends and closes to engagement
  // range (needle/bite). It must NOT sit in its web, climb the pillar away from the
  // quarry, free-fall into a recovery stall, or break off to feed mid-hunt.
  console.log('MIN DIST TO PLAYER:', minDist, '(started ~322)');
  if (minDist > 120) {
    console.error(`FAIL — weaver did not close on the quarry (minDist ${minDist}; expected <120). It descended/pursued poorly.`);
    process.exitCode = 1;
  } else {
    console.log(`PASS — weaver descended its pillar and closed to ${minDist}px (engagement range).`);
  }
} finally { await browser.close(); }

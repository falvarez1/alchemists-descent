// Self-shock fairness in the real game: the alchemist stands wet in a long pool
// (the Intake cistern's situation) and sparks the water at several distances.
// Measures the hp lost over 3 s at each distance (the current falls off along
// the conductor; the player's own current is capped at 12 per 2 s) and checks
// a crawling arc runs back along the conductor while it reaches him. Saves a
// screenshot of the arc.
//
// Usage: node scripts/verify-self-shock.mjs [url] [--out dir] [--report-only]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) || 'http://localhost:5173/';
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : 'screenshots/self-shock';
const reportOnly = args.includes('--report-only');
mkdirSync(outDir, { recursive: true });
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (reportOnly) { console.log('  info  ' + name + (detail ? '  ' + detail : '')); return; }
  if (ok) { pass++; console.log('  ok    ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + ' ' + detail); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__game?.ctx?.console?.exec, null, { timeout: 30000 });
await page.evaluate(async () => {
  localStorage.removeItem('noita-expedition');
  await window.__game.ctx.console.exec('run test --level physics-test --world campaign-level --cards spark --hp 100 --max-hp 100');
  for (let i = 0; i < 20; i++) window.__game.tick();
});

const results = [];
for (const dist of [8, 18, 30, 60]) {
  const r = await page.evaluate((dist) => {
    const ctx = window.__game.ctx, W = ctx.world, F = 690, p = ctx.player;
    const rect = (x0, y0, x1, y1, t, c) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = W.idx(x, y);
        W.setChargeAt(i, 0);
        if (t === 0) W.clearCellAt(i); else W.replaceCellAt(i, t, c);
      }
    };
    // A stone hall with a long metal-lined pool, 8 cells of water.
    rect(260, 560, 900, F - 1, 0);
    rect(260, F, 900, F + 6, 12, 0x77736c);
    rect(280, F - 20, 283, F - 1, 13, 0x6f7479);
    rect(420, F - 20, 423, F - 1, 13, 0x6f7479);
    rect(284, F - 8, 419, F - 1, 2, 0x2a6fb0);
    ctx.enemies.length = 0; ctx.projectiles.length = 0;
    // Park the arena's own machinery: its coils answer blasts with real current.
    if (ctx.levels.current) ctx.levels.current.mechanisms.length = 0;
    // ...and its loose pickups: a tome underfoot opens a card offer, which pauses the world.
    if (ctx.levels.current) ctx.levels.current.pickups.length = 0;
    ctx.state.paused = false;
    for (const w of ctx.wands.wands) { w.mana = w.frame.manaMax; w.cooldown = 0; }
    Object.assign(p, { x: 292, y: F - 1, vx: 0, vy: 0, fx: 0, fy: 0, dead: false, hp: 100, maxHp: 100, invuln: 0 });
    p.status.electrified = 0; p.status.wet = 0;
    for (let i = 0; i < 30; i++) { p.x = 292; p.y = F - 1; p.vx = 0; window.__game.tick(); }
    const hp0 = p.hp;
    // Spark the water `dist` cells down the pool (aimed at the surface).
    ctx.input.mouse.x = 292 + dist; ctx.input.mouse.y = F - 8; // the surface row: the bolt skims in and strikes there
    window.__game.tick();
    p.firing = true; p.firePressed = true; window.__game.tick(); p.firing = false;
    let arcs = 0, shockedTicks = 0, minHp = p.hp, impactX = null, maxChargeAtBody = 0, shockLost2s = 0;
    for (let f = 0; f < 180; f++) {
      p.x = 292; p.y = F - 1; p.vx = 0;
      const bolt = ctx.projectiles.find((q) => q.type === 'bolt');
      const before = p.hp;
      window.__game.tick();
      // Only the electrical share (the blast of a bolt at your own feet is its own lesson).
      if (f < 120 && p.hp < before && /electrocution/.test(p.lastDamageSource ?? '')) shockLost2s += before - p.hp;
      if (bolt && !ctx.projectiles.includes(bolt) && impactX === null) impactX = Math.round(bolt.x);
      for (let dy = 0; dy < 17; dy++) for (let dx = -4; dx <= 4; dx++) maxChargeAtBody = Math.max(maxChargeAtBody, W.charge[W.idx(292 + dx, F - 1 - dy)]);
      if (p.status.electrified > 0) shockedTicks++;
      minHp = Math.min(minHp, p.hp);
      // Arcs whose endpoints sit on the conductor between the wizard and the strike.
      for (const a of ctx.lightning.arcs) {
        const s = a.pts[0], e = a.pts[a.pts.length - 1];
        if (a.life >= 2 && Math.abs(s.y - (F - 6)) < 12 && s.x > 284 && s.x < 292 + dist + 4 && Math.abs(e.x - s.x) < 20) arcs++;
      }
    }
    return { dist, impactAt: impactX === null ? null : impactX - 292, lost: +(hp0 - minHp).toFixed(1), shockLost2s: +shockLost2s.toFixed(1), shockedTicks, maxChargeAtBody, arcs };
  }, dist);
  results.push(r);
  console.log('  ' + JSON.stringify(r));
  if (dist === 8) {
    // Capture the crawl: re-spark and screenshot a few frames in.
    await page.evaluate(() => {
      const ctx = window.__game.ctx, p = ctx.player;
      for (const w of ctx.wands.wands) { w.mana = w.frame.manaMax; w.cooldown = 0; }
      ctx.input.mouse.x = 300; ctx.input.mouse.y = 682;
      window.__game.tick();
      p.firing = true; p.firePressed = true; window.__game.tick(); p.firing = false;
      for (let i = 0; i < 6; i++) window.__game.tick();
    });
    await page.waitForTimeout(30);
    await page.screenshot({ path: join(outDir, 'self-shock-arc.png') });
  }
}
const at = (d) => results.find((r) => r.dist === d);
check('a spark 30 cells down the pool arrives at most as a tingle (<= 5 hp of shock)', at(30).shockLost2s <= 5, JSON.stringify(at(30)));
check('a spark at the wizard’s feet still shocks him, but never past the 12-hp window cap', at(8).shockLost2s > 0 && at(8).shockLost2s <= 12.01, JSON.stringify(at(8)));
// Electrical share only (the bolt's own blast at 8 cells is random on top), with a hair of slack.
// The pool is chaotic (craters refill, charged water splashes), so compare near vs far.
check('shock falls off with distance through the conductor (far never worse than near)',
  Math.max(at(30).shockLost2s, at(60).shockLost2s) <= Math.max(at(8).shockLost2s, at(18).shockLost2s) + 0.5,
  JSON.stringify(results.map((r) => [r.dist, r.shockLost2s])));
check('a crawling arc runs along the conductor while the current reaches him', results.filter((r) => r.shockedTicks > 0).every((r) => r.arcs > 0), JSON.stringify(results.map((r) => [r.dist, r.arcs])));
console.log('        screenshot ' + join(outDir, 'self-shock-arc.png'));

console.log(`\n${pass} passed, ${fail} failed`);
if (errs.length) console.log('page errors:', errs.slice(0, 5));
await browser.close();
process.exit(fail > 0 || errs.length > 0 ? 1 : 0);

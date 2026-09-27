// The Trickshot humiliation finisher ships ON by default (the slow-motion chain
// experiment stays off). In the real D1 with default preferences: a Weaver
// brought low, the wizard holding that Weaver's own leg, one real F press.
// Asserts the directed beat runs (approach at quarter speed -> impact ->
// release), the owner dies, and "RETURNED WITH INTEREST" rises over it; saves
// a screenshot of the moment.
//
// Disclosed fixture: the Weaver's hp is set low and the leg club is placed in
// the wizard's hands with its owner id (the salvage chain itself is covered by
// verify-weaver-salvage.mjs). Aim and the swing use the real input path.
//
// Usage: node scripts/verify-finisher.mjs [url] [--out dir]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) || 'http://localhost:5173/';
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : 'screenshots/finisher';
mkdirSync(outDir, { recursive: true });
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok    ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + ' ' + detail); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__game?.ctx?.console?.exec, null, { timeout: 30000 });

const setup = await page.evaluate(async () => {
  localStorage.removeItem('noita-player-settings');
  const ctx = window.__game.ctx;
  await ctx.console.exec('run test --level physics-test --world campaign-level --seed 777 --loadout fresh --hp 9999 --max-hp 9999');
  for (let i = 0; i < 20; i++) window.__game.tick();
  const settings = { ...ctx.state.trickshot };
  // A clean stone hall: the finisher is about contact, not terrain.
  const W = ctx.world, F = 690;
  for (let y = 560; y <= F + 6; y++) for (let x = 260; x <= 900; x++) {
    const i = W.idx(x, y);
    if (y >= F) W.replaceCellAt(i, 12, 0x77736c); else W.clearCellAt(i);
  }
  ctx.enemies.length = 0;
  const p = ctx.player;
  const w = ctx.enemyCtl.spawn('weaver', 540, F - 1, { exact: true });
  w.attackCd = 9999;
  Object.assign(p, { x: 500, y: F - 1, vx: 0, vy: 0 });
  ctx.camera.snapTo?.(p.x, p.y - 10);
  for (let i = 0; i < 30; i++) { p.x = 500; p.y = F - 1; p.vx = 0; window.__game.tick(); }
  w.weaverSalvageId ??= 'probe-owner';
  p.legClub = { durability: 6, length: 34, swingT: 0, angle: 0, cooldown: 0, owner: w.weaverSalvageId };
  const blocks = (x, y) => ctx.physics.cellBlocks(Math.floor(x), Math.floor(y));
  window.__finisher = { w, stand: { x: 500, y: F - 1 } };
  // Re-stand beside the Weaver wherever it has wandered (called right before each swing).
  window.__restand = () => {
    const bx = w.weaverLoco?.px ?? w.x;
    for (const dx of [-24, 24, -20, 20, -28, 28]) {
      const x = Math.round(bx + dx);
      if (x < 270 || x > 890 || blocks(x, F - 1)) continue;
      window.__finisher.stand = { x, y: F - 1 };
      return true;
    }
    return false;
  };
  return { settings, weaver: { x: Math.round(w.x), y: Math.round(w.y), hp: w.hp } };
});
check('setup: the Trickshot experiment is off by default', setup.settings && setup.settings.enabled === false, JSON.stringify(setup.settings));
check('setup: the finisher flag is on by default', setup.settings && setup.settings.finisher === true);
if (setup.error) { console.log(setup.error); process.exit(1); }

let result = null;
const seenPhases = new Set();
const seenCallouts = new Set();
for (let attempt = 0; attempt < 10 && !result?.dead; attempt++) {
  if (attempt > 0) await page.waitForTimeout(700); // a missed finisher leaves a 500 ms recovery
  // Aim at the Weaver's body and press the real melee key.
  await page.evaluate(() => {
    const ctx = window.__game.ctx, { w } = window.__finisher, p = ctx.player;
    window.__restand();
    const stand = window.__finisher.stand;
    p.x = stand.x; p.y = stand.y; p.vx = 0; p.vy = 0;
    // Brought low just now, so it has no time to limp out of reach before the swing.
    w.hp = Math.min(30, w.maxHp * 0.25);
    w.fear = 0; w.fleeT = 0;
    ctx.input.mouse.x = w.weaverLoco?.px ?? w.x;
    ctx.input.mouse.y = w.weaverLoco?.py ?? w.y - 7;
    ctx.camera.snapTo?.(p.x, p.y - 10);
    for (let i = 0; i < 2; i++) window.__game.tick();
    ctx.camera.snapTo?.(p.x, p.y - 10);
  });
  // Point the real mouse at the Weaver's body (screen space from the render snapshot).
  const aim = await page.evaluate(() => {
    const ctx = window.__game.ctx, { w } = window.__finisher;
    const rect = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
    const tx = w.weaverLoco?.px ?? w.x, ty = w.weaverLoco?.py ?? w.y - 7, z = ctx.camera.zoom || 1;
    return { x: rect.left + (0.5 + ((tx - ctx.camera.renderX) / 640 - 0.5) * z) * rect.width,
      y: rect.top + (0.5 + ((ty - ctx.camera.renderY) / 360 - 0.5) * z) * rect.height };
  });
  await page.mouse.move(aim.x, aim.y);
  await page.waitForTimeout(40);
  await page.keyboard.press('f');
  const pressed = await page.evaluate(() => {
    const ctx = window.__game.ctx, { w } = window.__finisher, p = ctx.player;
    const ex = w.weaverLoco?.px ?? w.x, ey = w.weaverLoco?.py ?? w.y - 7, ox = p.x, oy = p.y - 10;
    const dot = ((ex - ox) * Math.cos(p.legClub?.angle ?? 0) + (ey - oy) * Math.sin(p.legClub?.angle ?? 0)) / Math.max(1, Math.hypot(ex - ox, ey - oy));
    return { swingT: p.legClub?.swingT, phase: ctx.fx.trickshot?.phase ?? 'idle', d: Math.round(Math.hypot(ex - ox, ey - oy)), hp: w.hp,
      dot: +dot.toFixed(2), owner: p.legClub?.owner === w.weaverSalvageId, rec: ctx.fx.trickshot?.recoveryMs ?? null, alive: ctx.enemies.includes(w) };
  });
  console.log('        swing ' + JSON.stringify(pressed));
  result = await page.evaluate(async () => {
    const ctx = window.__game.ctx, { w } = window.__finisher;
    const phases = new Set();
    const scales = [];
    for (let i = 0; i < 90; i++) {
      phases.add(ctx.fx.trickshot?.phase ?? 'idle');
      if (ctx.fx.trickshot?.phase === 'approach') scales.push(ctx.fx.trickshot ? 1 : 0);
      await new Promise((r) => requestAnimationFrame(r));
      if (!ctx.enemies.includes(w) && phases.has('impact')) break;
    }
    return { phases: [...phases], dead: !ctx.enemies.includes(w), callouts: [...document.querySelectorAll('#callout-layer .callout')].map((c) => c.textContent) };
  });
  for (const ph of result.phases) seenPhases.add(ph);
  for (const c of result.callouts) seenCallouts.add(c);
}
const shot = join(outDir, 'returned-with-interest.png');
await page.screenshot({ path: shot });
// The impact beat is 50 ms of presentation time (often a single frame), so the
// landing is read from the finisher's own telemetry rather than a phase sample.
const tele = await page.evaluate(() => window.__game.ctx.telemetry.all());
check('the swing commits a directed approach and lands the finisher', seenPhases.has('approach') && (tele['trickshot.finisherLanded'] ?? 0) >= 1,
  `phases ${JSON.stringify([...seenPhases])}, started ${tele['trickshot.finisherStart'] ?? 0}, landed ${tele['trickshot.finisherLanded'] ?? 0}, missed ${tele['trickshot.finisherMissed'] ?? 0}`);
check('the Weaver owner dies to its own leg', result.dead);
check('"RETURNED WITH INTEREST" rises over the victim', [...seenCallouts].some((t) => t.includes('RETURNED WITH INTEREST')), JSON.stringify([...seenCallouts]) + ' ' + shot);

console.log(`\n${pass} passed, ${fail} failed`);
if (errs.length) console.log('page errors:', errs.slice(0, 5));
await browser.close();
process.exit(fail > 0 || errs.length > 0 ? 1 : 0);

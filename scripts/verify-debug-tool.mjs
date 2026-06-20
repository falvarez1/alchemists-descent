import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5174/';
mkdirSync('verify-out', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 400 });

const problems = [];
const ok = (c, m) => { if (!c) problems.push(m); };

// Alert every weaver and put the player far left so a LIVE weaver visibly chases.
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  for (const e of ctx.enemies) if (e.kind === 'weaver') { e.sleeping = false; e.alerted = true; e.attackCd = 600; e.cranky = 0; }
  ctx.player.x = 130; ctx.player.y = 741;
});

// --- open the Runtime panel and flip Debug ---
await page.click('#runtime-inspector-toggle');
await page.waitForSelector('#runtime-inspector.open', { timeout: 5000 });
await page.click('#brt-debug');
const active = await page.evaluate(() => window.__game.ctx.debug.active === true);
ok(active, 'Debug toggle did not set ctx.debug.active');

// --- debug-active poses are transient: saving is blocked while active ---
const saveProbe = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const priorPlaytestSource = ctx.state.playtestSource;
  const priorDebugGodMode = ctx.state.debugGodMode;
  localStorage.removeItem('noita-expedition');
  ctx.state.playtestSource = null;
  ctx.state.debugGodMode = false;
  ctx.levels.saveExpedition(ctx);
  const blockedWhileDebugActive = localStorage.getItem('noita-expedition') === null;
  ctx.debug.setActive(false);
  ctx.levels.saveExpedition(ctx);
  const savedWhenDebugOff = localStorage.getItem('noita-expedition') !== null;
  localStorage.removeItem('noita-expedition');
  ctx.state.playtestSource = priorPlaytestSource;
  ctx.state.debugGodMode = priorDebugGodMode;
  ctx.debug.setActive(true);
  return { blockedWhileDebugActive, savedWhenDebugOff };
});
ok(saveProbe.blockedWhileDebugActive, 'saveExpedition wrote a save while Debug was active');
ok(saveProbe.savedWhenDebugOff, 'saveExpedition did not write after Debug was disabled for the control check');

// --- leaving Play clears the freeze instead of leaking into Build/Sandbox ---
const modeClear = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  ctx.debug.setActive(true);
  ctx.debug.toggleLive('player');
  ctx.state.mode = 'build';
  ctx.events.emit('modeChanged', { mode: 'build' });
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const afterBuild = {
    active: ctx.debug.active,
    live: ctx.debug.live.size,
    frozenPlayer: ctx.debug.frozenPlayer(),
  };
  ctx.state.mode = 'play';
  ctx.events.emit('modeChanged', { mode: 'play' });
  return afterBuild;
});
ok(!modeClear.active && modeClear.live === 0 && !modeClear.frozenPlayer, `Debug leaked after leaving Play (${JSON.stringify(modeClear)})`);

await page.click('#runtime-inspector-toggle');
await page.waitForSelector('#runtime-inspector.open', { timeout: 5000 });
await page.click('#brt-debug');
const reactivated = await page.evaluate(() => window.__game.ctx.debug.active === true);
ok(reactivated, 'Debug toggle did not reactivate after returning to Play');

// --- freeze: alerted weavers must hold still ---
const before = await page.evaluate(() => window.__game.ctx.enemies.filter((e) => e.kind === 'weaver').map((e) => e.x));
await page.waitForTimeout(700);
const frozen = await page.evaluate((before) => {
  const xs = window.__game.ctx.enemies.filter((e) => e.kind === 'weaver').map((e) => e.x);
  return xs.every((x, i) => Math.abs(x - before[i]) < 0.001);
}, before);
ok(frozen, 'Weavers moved while debug-frozen (freeze not applied)');

// --- selective live: tick one weaver row, it should resume while others stay frozen ---
const liveId = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#runtime-inspector .brt-row')];
  const row = rows.find((r) => /weaver/i.test(r.querySelector('.bo-row-title')?.textContent ?? ''));
  if (!row) return null;
  const cb = row.querySelector('input.brt-live');
  cb.click();
  return row.dataset.runtimeId ?? null;
});
ok(liveId !== null, 'No weaver row with a live checkbox found');
const liveInSet = await page.evaluate((id) => window.__game.ctx.debug.live.has(id), liveId);
ok(liveInSet, 'Ticking a row did not add it to ctx.debug.live');
const beforeLive = await page.evaluate(() => window.__game.ctx.enemies.filter((e) => e.kind === 'weaver').map((e) => ({ x: e.x, y: e.y })));
await page.waitForTimeout(800);
const liveMove = await page.evaluate((b) => {
  const ws = window.__game.ctx.enemies.filter((e) => e.kind === 'weaver');
  let moved = 0, still = 0;
  ws.forEach((e, i) => {
    if (Math.hypot(e.x - b[i].x, e.y - b[i].y) > 1) moved++;
    else still++;
  });
  return { moved, still };
}, beforeLive);
ok(liveMove.moved >= 1, `Live weaver did not resume (moved=${liveMove.moved})`);
ok(liveMove.still >= 1, `Selective-live failed — all weavers moved (still=${liveMove.still})`);
await page.screenshot({ path: 'verify-out/debug-panel.png' });

// --- drag follows the cursor + legs keep solving (direct grab + mouse path) ---
const dragRes = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const w = ctx.enemies.filter((e) => e.kind === 'weaver').sort((a, b) => Math.abs(a.x - 1260) - Math.abs(b.x - 1260))[0];
  // Keep the camera glued to the weaver each frame — the renderer (which solves
  // the IK legs) skips off-camera sprites, and the camera otherwise drifts back
  // toward the frozen player.
  ctx.camera.zoomLock = 1;
  const grabbed = ctx.debug.grabAt(w.x, w.y); // offset (0,0) → follows the mouse exactly
  const tx = 1300, ty = 400; // up in clearly open air (above the attack lane)
  ctx.input.mouse.x = tx; ctx.input.mouse.y = ty;
  await new Promise((r) => {
    let n = 0;
    const t = () => {
      ctx.camera.snapTo(w.x, w.y);
      if (++n < 40) requestAnimationFrame(t);
      else r();
    };
    requestAnimationFrame(t);
  });
  const legs = w.weaverLegs ?? [];
  return { grabbed, x: w.x, y: w.y, tx, ty, grounded: w.grounded === true, planted: legs.filter((l) => l.planted).length, footBelow: legs.reduce((m, l) => Math.max(m, l.y - w.y), -99) };
});
ok(dragRes.grabbed, 'grabAt did not grab the weaver body');
ok(Math.hypot(dragRes.x - dragRes.tx, dragRes.y - dragRes.ty) < 4, `dragged weaver did not follow the cursor (at ${dragRes.x.toFixed(0)},${dragRes.y.toFixed(0)} vs ${dragRes.tx},${dragRes.ty})`);
ok(!dragRes.grounded && dragRes.footBelow > 4, `held-in-air legs did not dangle below the body (grounded=${dragRes.grounded} footBelow=${dragRes.footBelow.toFixed(1)})`);
await page.evaluate(() => { const c = window.__game.ctx; c.camera.zoomLock = 1; const w = c.debug.dragRef; c.camera.snapTo(w.x, w.y); });
await page.screenshot({ path: 'verify-out/debug-dangle.png' });

// --- lower it near the floor: legs should PLANT on the ground ---
const plantRes = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const w = ctx.debug.dragRef;
  ctx.input.mouse.x = 1300; ctx.input.mouse.y = 741; // feet on the floor (floor top = 742)
  await new Promise((r) => {
    let n = 0;
    const t = () => {
      ctx.camera.snapTo(w.x, w.y);
      if (++n < 120) requestAnimationFrame(t);
      else r();
    };
    requestAnimationFrame(t);
  });
  const legs = w.weaverLegs ?? [];
  const floor = legs.filter((l) => l.planted && l.surface === 'floor').length;
  return { grounded: w.grounded === true, planted: legs.filter((l) => l.planted).length, floor };
});
ok(plantRes.grounded, 'lowered-to-floor weaver not grounded');
// A spider replants a few legs at a time (the tetrapod gait), so it won't slam
// all 8 down at once — confirming several found the floor is the real check.
ok(plantRes.planted >= 3 && plantRes.floor >= 2, `legs did not plant on the floor when lowered (planted=${plantRes.planted} floor=${plantRes.floor})`);

// --- turn Debug off: the world resumes ---
await page.evaluate(() => window.__game.ctx.debug.release());
await page.click('#brt-debug');
const offState = await page.evaluate(() => ({ active: window.__game.ctx.debug.active, live: window.__game.ctx.debug.live.size }));
ok(!offState.active && offState.live === 0, `Debug off did not clear state (${JSON.stringify(offState)})`);
const beforeOff = await page.evaluate(() => window.__game.ctx.enemies.filter((e) => e.kind === 'weaver').map((e) => e.x));
await page.waitForTimeout(500);
const resumed = await page.evaluate((b) => {
  const xs = window.__game.ctx.enemies.filter((e) => e.kind === 'weaver').map((e) => e.x);
  return xs.some((x, i) => Math.abs(x - b[i]) > 0.5);
}, beforeOff);
ok(resumed, 'Entities did not resume after Debug off');

await browser.close();
console.log('freeze=' + frozen, 'live=' + JSON.stringify(liveMove), 'drag=' + JSON.stringify(dragRes), 'plant=' + JSON.stringify(plantRes), 'resumed=' + resumed);
if (pageErrors.length) problems.push('pageErrors: ' + pageErrors.join('; '));
if (problems.length) { console.error('\nFAIL:\n - ' + problems.join('\n - ')); process.exit(1); }
console.log('\nPASS — debug freeze, selective-live, drag-with-IK, dangle/plant all work.');

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 400 });

const GAIT_TARGET_X = 512;
const problems = [];
const ok = (c, m) => { if (!c) problems.push(m); };

// Alert every weaver, then configure the open-lane gaiter so a LIVE row has a
// deterministic walk target. The sleeping-alcove Weaver is intentionally boxed
// in, so selecting the first row makes the probe test level geometry instead.
await page.evaluate((targetX) => {
  const ctx = window.__game.ctx;
  const weavers = ctx.enemies.filter((e) => e.kind === 'weaver');
  for (const e of weavers) {
    e.sleeping = false;
    e.alerted = true;
    e.attackCd = 9999;
    e.cranky = 0;
    e.windup = 0;
    e.blink = 0;
  }
  for (const cr of ctx.critters.list.slice()) ctx.critters.remove(cr);
  const gaiter = weavers.sort((a, b) => Math.abs(a.x - targetX) - Math.abs(b.x - targetX))[0];
  if (!gaiter) return;
  gaiter.weaverFeedT = 0;
  gaiter.patrol = [
    [512, 742],
    [900, 741],
  ];
  gaiter.patrolIdx = 1;
  gaiter.attackCd = 600;
  ctx.player.x = gaiter.x - 70;
  ctx.player.y = 741;
  ctx.player.vx = ctx.player.vy = ctx.player.fx = ctx.player.fy = 0;
  ctx.camera.snapTo(gaiter.x + 120, gaiter.y - 100);
}, GAIT_TARGET_X);

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
  const priorDebugTainted = ctx.state.debugTainted;
  localStorage.removeItem('noita-expedition');
  ctx.state.playtestSource = null;
  ctx.state.debugGodMode = false;
  ctx.state.debugTainted = false;
  ctx.debug.setActive(true);
  ctx.levels.saveExpedition(ctx);
  const blockedWhileDebugActive = localStorage.getItem('noita-expedition') === null;
  ctx.debug.setActive(false);
  ctx.levels.saveExpedition(ctx);
  const blockedAfterDebugOff = localStorage.getItem('noita-expedition') === null;
  ctx.state.debugTainted = false;
  ctx.levels.saveExpedition(ctx);
  const savedWhenClean = localStorage.getItem('noita-expedition') !== null;
  localStorage.removeItem('noita-expedition');
  ctx.state.playtestSource = priorPlaytestSource;
  ctx.state.debugGodMode = priorDebugGodMode;
  ctx.state.debugTainted = priorDebugTainted;
  ctx.debug.setActive(true);
  return { blockedWhileDebugActive, blockedAfterDebugOff, savedWhenClean };
});
ok(saveProbe.blockedWhileDebugActive, 'saveExpedition wrote a save while Debug was active');
ok(saveProbe.blockedAfterDebugOff, 'saveExpedition wrote a save after Debug was disabled but the run was tainted');
ok(saveProbe.savedWhenClean, 'saveExpedition did not write after clearing debug taint for the control check');

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

const unsupportedLiveRows = await page.evaluate(() =>
  [...document.querySelectorAll('#runtime-inspector .brt-row')]
    .filter((row) => {
      const id = row.dataset.runtimeId ?? '';
      return (
        id.startsWith('projectile:') ||
        id.startsWith('pickup:') ||
        id.startsWith('mechanism:') ||
        id.startsWith('portal:')
      ) && row.querySelector('input.brt-live') !== null;
    })
    .map((row) => row.dataset.runtimeId ?? ''),
);
ok(unsupportedLiveRows.length === 0, `Unsupported runtime rows exposed live toggles (${unsupportedLiveRows.join(', ')})`);

// --- freeze: alerted weavers must hold still ---
const before = await page.evaluate(() => window.__game.ctx.enemies.filter((e) => e.kind === 'weaver').map((e) => e.x));
await page.waitForTimeout(700);
const frozen = await page.evaluate((before) => {
  const xs = window.__game.ctx.enemies.filter((e) => e.kind === 'weaver').map((e) => e.x);
  return xs.every((x, i) => Math.abs(x - before[i]) < 0.001);
}, before);
ok(frozen, 'Weavers moved while debug-frozen (freeze not applied)');

// --- selective live: tick one weaver row, it should resume while others stay frozen ---
const livePick = await page.evaluate((targetX) => {
  const rows = [...document.querySelectorAll('#runtime-inspector .brt-row')];
  const rowX = (row) => {
    const sub = row.querySelector('.bo-row-sub')?.textContent ?? '';
    const match = sub.match(/(-?\d+(?:\.\d+)?),/);
    return match ? Number(match[1]) : NaN;
  };
  const row = rows
    .filter((r) => /weaver/i.test(r.querySelector('.bo-row-title')?.textContent ?? ''))
    .map((r) => ({ row: r, x: rowX(r) }))
    .filter((r) => Number.isFinite(r.x))
    .sort((a, b) => Math.abs(a.x - targetX) - Math.abs(b.x - targetX))[0]?.row ?? null;
  if (!row) return null;
  const cb = row.querySelector('input.brt-live');
  cb.click();
  return { id: row.dataset.runtimeId ?? null, x: rowX(row) };
}, GAIT_TARGET_X);
const liveId = livePick?.id ?? null;
ok(liveId !== null, 'No weaver row with a live checkbox found');
const liveInSet = await page.evaluate((id) => window.__game.ctx.debug.live.has(id), liveId);
ok(liveInSet, 'Ticking a row did not add it to ctx.debug.live');
const beforeLive = await page.evaluate((targetX) => {
  const ws = window.__game.ctx.enemies.filter((e) => e.kind === 'weaver');
  let targetIndex = -1;
  let best = Infinity;
  ws.forEach((e, i) => {
    const dist = Math.abs(e.x - targetX);
    if (dist < best) {
      best = dist;
      targetIndex = i;
    }
  });
  return { targetIndex, positions: ws.map((e) => ({ x: e.x, y: e.y })) };
}, GAIT_TARGET_X);
ok(beforeLive.targetIndex >= 0, 'No gait-lane Weaver found for selective-live movement check');
await page.waitForTimeout(800);
const liveMove = await page.evaluate(({ b, id }) => {
  const ctx = window.__game.ctx;
  const ws = ctx.enemies.filter((e) => e.kind === 'weaver');
  let moved = 0, still = 0;
  const sim = ctx.world.simBounds;
  const detail = ws.map((e, i) => {
    const def = ctx.enemyCtl.defs.weaver;
    return { x: Math.round(e.x), dx: Math.round(e.x - b.positions[i].x), alerted: e.alerted, vx: +e.vx.toFixed(2),
      grounded: e.grounded === true, freeL: ctx.physics.entityFree(e.x - 2, e.y, def.halfW, def.h),
      pSup: +(e.weaverPhysicalSupport ?? -1).toFixed(2), cenDx: Math.round((e.weaverSupportCenterX ?? e.x) - e.x),
      inSim: e.x >= sim.x0 - 60 && e.x <= sim.x1 + 60 };
  });
  ws.forEach((e, i) => {
    if (Math.hypot(e.x - b.positions[i].x, e.y - b.positions[i].y) > 1) moved++;
    else still++;
  });
  const target = ws[b.targetIndex];
  const targetBefore = b.positions[b.targetIndex];
  const selectedMoved = target && targetBefore ? Math.hypot(target.x - targetBefore.x, target.y - targetBefore.y) > 1 : false;
  const sl = target ?? ws[0];
  const blockers = [];
  const w = ctx.world;
  for (let yy = Math.round(sl.y) - 18; yy <= Math.round(sl.y); yy++) for (let xx = Math.round(sl.x) - 11; xx <= Math.round(sl.x) - 7; xx++) {
    const t = w.types[w.idx(xx, yy)]; if (t !== 0 && ![15, 30, 33, 34].includes(t)) blockers.push(`${xx},${yy}=${t}`);
  }
  const bodies = ctx.rigidBodies.bodies.map((bd) => `${Math.round(bd.x)},${Math.round(bd.y)}`);
  return { moved, still, selectedMoved, targetIndex: b.targetIndex, liveId: id, liveMatched: ctx.debug.live.has(id), sim: { x0: Math.round(sim.x0), x1: Math.round(sim.x1) }, detail, blockers: blockers.slice(0, 12), bodies };
}, { b: beforeLive, id: liveId });
console.log('LIVE DETAIL', JSON.stringify(liveMove));
ok(liveMove.liveMatched, `Selective-live set did not retain ${liveId}`);
ok(liveMove.selectedMoved, `Live gait Weaver did not resume (moved=${liveMove.moved})`);
ok(liveMove.still >= 1, `Selective-live failed — all weavers moved (still=${liveMove.still})`);

// --- selective live is locomotion/debug-only: live enemies must not attack into frozen projectiles ---
const attackSetup = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.projectiles.length = 0;
  const before = ctx.enemies.length;
  ctx.enemyCtl.spawn('spitter', ctx.player.x + 120, ctx.player.y - 24);
  const spitter = ctx.enemies.slice(before).find((e) => e.kind === 'spitter') ?? ctx.enemies.find((e) => e.kind === 'spitter');
  if (!spitter) return null;
  spitter.x = ctx.player.x + 118;
  spitter.y = ctx.player.y;
  spitter.vx = 0;
  spitter.vy = 0;
  spitter.fx = 0;
  spitter.fy = 0;
  spitter.attackCd = 0;
  spitter.alerted = true;
  spitter.sleeping = false;
  ctx.camera.snapTo(ctx.player.x + 60, ctx.player.y - 90);
  return { x: spitter.x, y: spitter.y, timer: spitter.timer };
});
ok(attackSetup !== null, 'Could not spawn a Spitter for debug attack suppression');
await page.click('#runtime-inspector-toggle');
await page.click('#runtime-inspector-toggle');
const spitterLiveId = await page.evaluate((setup) => {
  const rows = [...document.querySelectorAll('#runtime-inspector .brt-row')];
  const row = rows
    .filter((r) => /spitter/i.test(r.querySelector('.bo-row-title')?.textContent ?? ''))
    .map((r) => {
      const sub = r.querySelector('.bo-row-sub')?.textContent ?? '';
      const match = sub.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
      const x = match ? Number(match[1]) : NaN;
      const y = match ? Number(match[2]) : NaN;
      return { row: r, dist: Number.isFinite(x) && Number.isFinite(y) ? Math.hypot(x - setup.x, y - setup.y) : Infinity };
    })
    .sort((a, b) => a.dist - b.dist)[0]?.row ?? null;
  if (!row) return null;
  const cb = row.querySelector('input.brt-live');
  cb?.click();
  return row.dataset.runtimeId ?? null;
}, attackSetup ?? { x: 0, y: 0 });
ok(spitterLiveId !== null, 'No Spitter row with a live checkbox found');
await page.waitForTimeout(900);
const attackSuppression = await page.evaluate(({ id, setup }) => {
  const ctx = window.__game.ctx;
  const spitter = ctx.enemies
    .filter((e) => e.kind === 'spitter')
    .sort((a, b) => Math.hypot(a.x - setup.x, a.y - setup.y) - Math.hypot(b.x - setup.x, b.y - setup.y))[0];
  return {
    liveMatched: ctx.debug.live.has(id),
    timerAdvanced: spitter ? spitter.timer > setup.timer : false,
    attackCd: spitter?.attackCd ?? -1,
    projectiles: ctx.projectiles.length,
  };
}, { id: spitterLiveId, setup: attackSetup ?? { x: 0, y: 0, timer: 0 } });
ok(attackSuppression.liveMatched, `Spitter live row did not retain ${spitterLiveId}`);
ok(attackSuppression.timerAdvanced, `Live Spitter did not update under debug freeze (${JSON.stringify(attackSuppression)})`);
ok(
  attackSuppression.projectiles === 0 && attackSuppression.attackCd === 0,
  `Live Spitter attacked while projectile sim was frozen (${JSON.stringify(attackSuppression)})`,
);
await page.screenshot({ path: 'verify-out/debug-panel.png' });

// --- dragging a critter must not add player/enemy force fields to its data shape ---
const critterShape = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.debug.release();
  const c = ctx.critters.spawn('moth', ctx.player.x + 18, ctx.player.y - 24);
  const grabbed = ctx.debug.grabAt(c.x, c.y);
  ctx.input.mouse.x = c.x + 12;
  ctx.input.mouse.y = c.y - 10;
  ctx.debug.update();
  ctx.debug.release();
  return {
    grabbed,
    hasFx: Object.prototype.hasOwnProperty.call(c, 'fx'),
    hasFy: Object.prototype.hasOwnProperty.call(c, 'fy'),
  };
});
ok(critterShape.grabbed, 'debug drag did not grab a critter');
ok(!critterShape.hasFx && !critterShape.hasFy, `dragging a critter added non-contract force fields (${JSON.stringify(critterShape)})`);

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

// --- debug level jumps are tainted and cannot checkpoint progression ---
const jumpSaveProbe = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  localStorage.removeItem('noita-expedition');
  ctx.state.playtestSource = null;
  ctx.state.debugGodMode = false;
  ctx.state.debugTainted = false;
  const jumped = ctx.levels.debugEnterLevel(ctx, 'd1');
  const tainted = ctx.state.debugTainted === true;
  ctx.levels.saveExpedition(ctx);
  const blocked = localStorage.getItem('noita-expedition') === null;
  localStorage.removeItem('noita-expedition');
  return { jumped, tainted, blocked };
});
ok(jumpSaveProbe.jumped, `debugEnterLevel failed (${JSON.stringify(jumpSaveProbe)})`);
ok(jumpSaveProbe.tainted && jumpSaveProbe.blocked, `debugEnterLevel did not taint/block saves (${JSON.stringify(jumpSaveProbe)})`);

await browser.close();
console.log(
  'freeze=' + frozen,
  'live=' + JSON.stringify(liveMove),
  'attackSuppression=' + JSON.stringify(attackSuppression),
  'drag=' + JSON.stringify(dragRes),
  'plant=' + JSON.stringify(plantRes),
  'resumed=' + resumed,
);
if (pageErrors.length) problems.push('pageErrors: ' + pageErrors.join('; '));
if (problems.length) { console.error('\nFAIL:\n - ' + problems.join('\n - ')); process.exit(1); }
console.log('\nPASS — debug freeze, selective-live, attack suppression, drag-with-IK, dangle/plant all work.');

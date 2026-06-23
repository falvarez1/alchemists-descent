// Focused runtime probe for the two reported Weaver movement faults:
//  1) it never rears up / reaches toward a player hovering overhead;
//  2) when the ground under its legs is cut away it dangles instead of
//     recentring onto solid footing;
//  3) it climbs a wall toward a platform, then retreats from the lip instead
//     of committing onto the platform.
// Writes zoomed screenshots and prints pass/fail metrics.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 400 });

// Zoomed crop centred on a focus world-point.
const grab = (file, fxn) => page.evaluate((fxn) => new Promise((res) => {
  const ctx = window.__game.ctx;
  ctx.camera.zoomLock = 1;
  const f = (0, eval)('(' + fxn + ')')(ctx);
  ctx.camera.snapTo(f.cx, f.cy);
  requestAnimationFrame(() => {
    const cam = ctx.camera;
    const gl = document.querySelector('#canvas-holder > canvas');
    const sx = gl.width / 575, sy = gl.height / 391;
    const cx = (f.cx - cam.renderX) * sx, cy = (f.cy - cam.renderY) * sy;
    const halfW = 70 * sx, halfH = 52 * sy, Z = 4;
    const o = document.createElement('canvas');
    o.width = Math.round(halfW * 2 * Z); o.height = Math.round(halfH * 2 * Z);
    const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(gl, cx - halfW, cy - halfH, halfW * 2, halfH * 2, 0, 0, o.width, o.height);
    res(o.toDataURL('image/png'));
  });
}), fxn.toString()).then((d) => writeFileSync(file, Buffer.from(d.split(',')[1], 'base64')));

const pickWeaver = (targetX) => page.evaluate((tx) => {
  const ctx = window.__game.ctx;
  const w = ctx.enemies.filter((e) => e.kind === 'weaver').sort((a, b) => Math.abs(a.x - tx) - Math.abs(b.x - tx))[0];
  for (const e of ctx.enemies) if (e.kind === 'weaver' && e !== w) { e.attackCd = 9999; e.blink = 0; e.windup = 0; }
  return { x: w.x, y: w.y };
}, targetX);

// ---------------- Scenario 1: rear up to reach an overhead player ----------------
const base = await pickWeaver(512);
const reach = await page.evaluate((bx) => {
  const ctx = window.__game.ctx;
  const w = ctx.enemies.filter((e) => e.kind === 'weaver').sort((a, b) => Math.abs(a.x - bx.x) - Math.abs(b.x - bx.x))[0];
  // solid stone shelf under it; the player hovering directly overhead
  const world = ctx.world, cx = Math.round(w.x), cy = Math.round(w.y);
  for (let x = cx - 75; x <= cx + 75; x++) for (let y = cy + 1; y <= cy + 8; y++) if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), 12, 0x777777);
  w.sleeping = false; w.alerted = true; w.cranky = 0; w.attackCd = 240; w.windup = 0; w.blink = 0;
  w.weaverSupport = 1; w.weaverPhysicalSupport = 1; w.weaverAnchorCount = 8; w.weaverFallT = 0; w.vx = 0; w.vy = 0;
  // The player hovers on a ledge directly OVERHEAD (else gravity drops him out of
  // the "overhead" arc within a few frames and the reach never builds).
  const px = Math.round(w.x), py = Math.round(w.y) - 72;
  for (let x = px - 12; x <= px + 12; x++) for (let y = py + 1; y <= py + 3; y++) if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), 12, 0x777777);
  ctx.player.x = px; ctx.player.y = py;
  ctx.player.vx = ctx.player.vy = ctx.player.fx = ctx.player.fy = 0;
  return { x: w.x, y: w.y };
}, base);
await page.waitForTimeout(1600);
const reachState = await page.evaluate((s) => {
  const w = window.__game.ctx.enemies.filter((e) => e.kind === 'weaver').sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x))[0];
  const legs = w.weaverLegs ?? [];
  // highest-reaching foot, measured as cells ABOVE the body origin
  const topReach = legs.reduce((m, l) => Math.max(m, w.y - l.y), 0);
  return { reach: w.weaverReach ?? 0, bodyLift: w.weaverBodyLift ?? 0, topReach };
}, reach);
await grab('verify-out/weaver-reach.png', (ctx) => {
  const w = ctx.enemies.filter((e) => e.kind === 'weaver').sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0];
  return { cx: w.x, cy: w.y - 28 };
});
console.log('REACH:', JSON.stringify(reachState));

// ---------------- Scenario 2: cut footing under HALF the stance ----------------
const cut = await page.evaluate((s) => {
  const ctx = window.__game.ctx, world = ctx.world;
  const w = ctx.enemies.filter((e) => e.kind === 'weaver').sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x))[0];
  const cx = Math.round(w.x), cy = Math.round(w.y);
  // Solid platform first, then blow a hole out of the LEFT side only — the body
  // is left teetering on the right lip (the user's exact scenario).
  for (let x = cx - 90; x <= cx + 90; x++) for (let y = cy + 1; y <= cy + 10; y++) if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), 12, 0x777777);
  for (let x = cx - 80; x <= cx + 4; x++) for (let y = cy - 30; y <= cy + 40; y++) if (world.inBounds(x, y)) world.clearCellAt(world.idx(x, y));
  w.sleeping = false; w.alerted = true; w.cranky = 0; w.attackCd = 240; w.windup = 0; w.blink = 0;
  w.weaverLegs = undefined; w.weaverFallT = 0; w.weaverTilt = 0; w.vx = 0; w.vy = 0; w.recoil = 0;
  ctx.player.x = cx - 200; ctx.player.y = cy; ctx.player.vx = ctx.player.vy = 0;
  ctx.camera.snapTo(cx, cy - 20);
  return { x: w.x, y: w.y, startX: w.x };
}, base);
await page.waitForTimeout(140);
await grab('verify-out/weaver-cut-immediate.png', (c) => {
  const w = c.enemies.filter((e) => e.kind === 'weaver').sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0];
  return { cx: w.x + 10, cy: w.y - 20 };
});
await page.waitForTimeout(1500);
const cutState = await page.evaluate((s) => {
  const w = window.__game.ctx.enemies.filter((e) => e.kind === 'weaver').sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x))[0];
  const legs = w.weaverLegs ?? [];
  const maxDangle = legs.reduce((m, l) => Math.max(m, l.y - w.y), -99); // cells a foot hangs BELOW the body
  const planted = legs.filter((l) => l.planted === true).length;
  return { x: w.x, y: w.y, vy: w.vy, grounded: w.grounded === true, movedRight: w.x - s.startX, maxDangle, planted, fallT: w.weaverFallT ?? 0 };
}, cut);
await grab('verify-out/weaver-cut-recovered.png', (c) => {
  const w = c.enemies.filter((e) => e.kind === 'weaver').sort((a, b) => Math.abs(a.x - 512) - Math.abs(b.x - 512))[0];
  return { cx: w.x + 10, cy: w.y - 20 };
});
console.log('CUT:', JSON.stringify(cutState));

// ---------------- Scenario 3: wall-climb dismount onto a far separated platform ----------------
const crestSetup = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const world = ctx.world;
  const STONE = 12;
  for (let y = 430; y <= 700; y++) {
    for (let x = 500; x <= 980; x++) {
      if (world.inBounds(x, y)) world.clearCellAt(world.idx(x, y));
    }
  }
  for (let y = 501; y <= 660; y++) {
    for (let x = 650; x <= 652; x++) {
      if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), STONE, 0x777777);
    }
  }
  const platformStart = 820;
  for (let y = 501; y <= 508; y++) {
    for (let x = platformStart; x <= 960; x++) {
      if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), STONE, 0x777777);
    }
  }
  for (let y = 661; y <= 668; y++) {
    for (let x = 520; x <= 650; x++) {
      if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), STONE, 0x777777);
    }
  }
  ctx.enemies.length = 0;
  ctx.enemyCtl.spawn('weaver', 640, 660);
  const w = ctx.enemies[0];
  w.x = 640; w.y = 660; w.vx = 0; w.vy = 0; w.fx = 0; w.fy = 0;
  w.sleeping = false; w.alerted = true; w.attackCd = 9999; w.blink = 0; w.windup = 0; w.cranky = 180;
  ctx.player.x = 885; ctx.player.y = 500; ctx.player.vx = 0; ctx.player.vy = 0; ctx.player.fx = 0; ctx.player.fy = 0;
  ctx.camera.snapTo(760, 560);
  return { x: w.x, y: w.y, platformStart };
});
const crestState = await page.evaluate((s) => new Promise((resolve) => {
  const ctx = window.__game.ctx;
  const def = ctx.enemyCtl.defs.weaver;
  const start = performance.now();
  let last = null;
  let maxFrameJump = 0;
  let maxFrameDt = 0;
  let sampleCount = 0;
  let leapSeen = false;

  const read = () => {
    const w = ctx.enemies[0];
    if (!w) return null;
    return {
      x: w.x,
      y: w.y,
      t: performance.now(),
      leapActive: (w.weaverLeapDuration ?? 0) > 0 || (w.weaverLeapT ?? 0) > 0,
    };
  };

  const finish = () => {
    const w = ctx.enemies[0];
    const onPlatform =
      w.x >= s.platformStart + def.halfW &&
      w.x < 960 &&
      w.y <= 505 &&
      !ctx.physics.entityFree(w.x, w.y + 1, def.halfW, 1);
    resolve({
      x: w.x,
      y: w.y,
      vx: w.vx,
      vy: w.vy,
      grounded: w.grounded === true,
      climbT: w.weaverClimbT ?? 0,
      crest: w.weaverCrest ?? 0,
      climbDir: w.weaverClimbDir ?? 0,
      fallT: w.weaverFallT ?? 0,
      onPlatform,
      platformStart: s.platformStart,
      requiredX: s.platformStart + def.halfW,
      maxFrameJump,
      maxFrameDt,
      sampleCount,
      leapSeen,
    });
  };

  const step = () => {
    const next = read();
    if (next) {
      sampleCount++;
      leapSeen = leapSeen || next.leapActive;
      if (last) {
        const dt = next.t - last.t;
        maxFrameDt = Math.max(maxFrameDt, dt);
        if (dt < 80) maxFrameJump = Math.max(maxFrameJump, Math.hypot(next.x - last.x, next.y - last.y));
      }
      last = next;
    }
    if (performance.now() - start >= 4500) finish();
    else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}), crestSetup);
await grab('verify-out/weaver-wall-dismount.png', (c) => {
  const w = c.enemies[0];
  return { cx: w.x, cy: w.y - 22 };
});
console.log('CREST:', JSON.stringify(crestState));

await browser.close();

const problems = [];
if (!(reachState.reach > 0.4)) problems.push(`did not rear-reach overhead (weaverReach=${reachState.reach.toFixed(2)})`);
if (!(reachState.bodyLift > 16)) problems.push(`body did not rise to reach (bodyLift=${reachState.bodyLift.toFixed(1)}, normal ~13.5)`);
if (!(reachState.topReach > 24)) problems.push(`no leg reached up toward the player (topReach=${reachState.topReach.toFixed(1)})`);
if (!(cutState.movedRight > 8)) problems.push(`did not recentre onto solid ground after cut (movedRight=${cutState.movedRight.toFixed(1)})`);
if (!(cutState.grounded && Math.abs(cutState.vy) < 2)) problems.push(`did not restabilise (grounded=${cutState.grounded} vy=${cutState.vy.toFixed(2)})`);
if (!(cutState.maxDangle < 16)) problems.push(`legs still dangle deep into the hole (maxDangle=${cutState.maxDangle.toFixed(1)} cells below body)`);
if (!crestState.onPlatform) problems.push(`did not commit from wall onto platform (x=${crestState.x.toFixed(1)} required>=${crestState.requiredX}, y=${crestState.y.toFixed(1)}, grounded=${crestState.grounded})`);
if (!crestState.leapSeen) problems.push('far wall dismount did not use the visible leap state');
if (!(crestState.maxFrameJump <= 24)) problems.push(`wall dismount moved too far in one frame (maxFrameJump=${crestState.maxFrameJump.toFixed(1)} cells)`);
if (pageErrors.length) problems.push('pageErrors: ' + pageErrors.join('; '));

console.log('\nrear-up: reach=' + reachState.reach.toFixed(2) + ' bodyLift=' + reachState.bodyLift.toFixed(1) + ' topReach=' + reachState.topReach.toFixed(1));
console.log('cut-recover: movedRight=' + cutState.movedRight.toFixed(1) + ' grounded=' + cutState.grounded + ' maxDangle=' + cutState.maxDangle.toFixed(1));
console.log('wall-dismount: x=' + crestState.x.toFixed(1) + ' y=' + crestState.y.toFixed(1) + ' grounded=' + crestState.grounded + ' onPlatform=' + crestState.onPlatform + ' maxFrameJump=' + crestState.maxFrameJump.toFixed(1));
if (problems.length) { console.error('\nFAIL:\n - ' + problems.join('\n - ')); process.exit(1); }
console.log('\nPASS — Weaver rears, recentres, and visibly commits from wall to platform.');

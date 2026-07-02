// Weaver surface-crawler probe: the movement contract, end to end, in the
// REAL game (entities/weaverLocomotion): floor chase, wall climb to a perch,
// ceiling hang + traverse, gap pounce, and a NATURAL pillar hunt with no
// forcing (the forced-scenario trap: mechanics can pass while the emergent
// hunt is broken). Saves freeze-frames to verify-out/weaver-loco-*.png.
//
// Run with the dev server up: node scripts/verify-weaver-loco.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { getGameViewSize, startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
mkdirSync('verify-out', { recursive: true });
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
const viewSize = await getGameViewSize(page);
await startConsoleTestRun(page, { settleMs: 400 });

const shotAt = async (name, wx, wy) => {
  const clip = await page.evaluate(({ x, y, view }) => {
    const c = document.querySelector('#canvas-holder > canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const cam = window.__game.ctx.camera;
    const ux = ((x - cam.renderX) / view.w - 0.5) * cam.zoom + 0.5;
    const uy = ((y - cam.renderY) / view.h - 0.5) * cam.zoom + 0.5;
    return {
      x: Math.max(0, r.left + ux * r.width - 200),
      y: Math.max(0, r.top + uy * r.height - 150),
      width: 400,
      height: 300,
    };
  }, { x: wx, y: wy, view: viewSize });
  if (clip) await page.screenshot({ path: `verify-out/weaver-loco-${name}.png`, clip });
};

// Build one wide arena strip and reuse sub-regions per scenario. Player is
// made effectively invincible; enemy attacks are NOT suppressed (real hunt).
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  for (let y = 320; y <= 560; y++) {
    for (let x = 380; x <= 980; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  }
  window.__solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = 13; w.colors[i] = 0x7a8a99; w.life[i] = 0; w.charge[i] = 0;
      }
  };
  window.__clearBand = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
      }
  };
  ctx.enemies.length = 0;
  // pickups pause the game behind choice overlays (spell tomes) the moment a
  // knocked-around player touches one — clear them so the hunt runs unpaused
  ctx.pickups.length = 0;
  const p = ctx.player;
  p.hp = p.maxHp = 1e6;
});

// safety net: if a choice overlay still opens (level-up, onboarding grant),
// dismiss it with a REAL click so the game unpauses
const dismissOverlays = async () => {
  const card = page.locator('.card-offer-card').first();
  if (await card.isVisible().catch(() => false)) {
    const box = await card.boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
  }
};

const spawnWeaver = (x, y, opts = {}) =>
  page.evaluate(({ x, y, opts }) => {
    const ctx = window.__game.ctx;
    ctx.enemies.length = 0;
    const e = ctx.enemyCtl.spawn('weaver', x, y);
    if (!e) return false;
    if (opts.cranky) { e.alerted = true; e.cranky = 600; }
    e.sleeping = false;
    return true;
  }, { x, y, opts });

const sample = () =>
  page.evaluate(() => {
    const ctx = window.__game.ctx;
    const e = ctx.enemies.find((f) => f.kind === 'weaver');
    if (!e) return null;
    return {
      x: e.x, y: e.y,
      px: ctx.player.x, py: ctx.player.y,
      mode: e.weaverLoco?.mode ?? 'none',
      orient: e.weaverOrient ?? 0,
      speed: e.weaverLoco?.speed ?? 0,
      planted: e.weaverLoco?.legs?.filter((l) => l.planted).length ?? 0,
      blocked: e.weaverLoco?.blocked ?? 0,
      alerted: e.alerted === true,
      timer: e.timer,
      cranky: e.cranky ?? 0,
      windup: e.windup ?? 0,
      blink: e.blink ?? 0,
      fleeT: e.fleeT ?? 0,
      gap: e.weaverLoco?.gapAhead ?? 0,
      dir: e.weaverLoco?.dir ?? 0,
    };
  });

/** poll the weaver for `ms`, collecting samples every ~100ms */
const DEBUG_WATCH = process.env.WEAVER_DEBUG === '1';
const watch = async (ms) => {
  const out = [];
  const until = Date.now() + ms;
  let tick = 0;
  while (Date.now() < until) {
    if (tick++ % 8 === 0) await dismissOverlays();
    const s = await sample();
    if (s) {
      out.push(s);
      if (DEBUG_WATCH && out.length % 5 === 1) {
        console.log(
          `    t=${s.timer} pos=${s.x},${s.y} p=${s.px},${s.py} mode=${s.mode} spd=${s.speed.toFixed(2)} dir=${s.dir} blocked=${s.blocked} gap=${s.gap} windup=${s.windup} blink=${s.blink} flee=${s.fleeT} cranky=${s.cranky}`,
        );
      }
    }
    await page.waitForTimeout(100);
  }
  return out;
};
const maxFrameJump = (samples) => {
  let m = 0;
  for (let i = 1; i < samples.length; i++) {
    m = Math.max(m, Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
  }
  return m;
};

// ---------------------------------------------------------------- 1) FLOOR CHASE
console.log('scenario: floor chase');
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__solid(400, 800, 500, 512); // thick floor
  const p = ctx.player;
  p.x = 720; p.y = 498; p.vx = 0; p.vy = 0;
  ctx.camera.snapTo(660, 470);
});
await spawnWeaver(480, 494, { cranky: true });
{
  const t = await watch(6500);
  const d0 = Math.abs(t[0].x - t[0].px);
  const dMin = Math.min(...t.map((s) => Math.abs(s.x - s.px)));
  const attachedFrac = t.filter((s) => s.mode === 'attached').length / t.length;
  const plantedAvg = t.reduce((a, s) => a + s.planted, 0) / t.length;
  check('floor: closes on the player', dMin < 45, `d0=${d0} dMin=${dMin}`);
  check('floor: stays attached', attachedFrac > 0.8, `attached=${(attachedFrac * 100).toFixed(0)}%`);
  check('floor: legs carry it (planted avg >= 4)', plantedAvg >= 4, `avg=${plantedAvg.toFixed(1)}`);
  const uprightFrac = t.filter((s) => Math.abs(s.orient) < 0.9).length / t.length;
  check('floor: mostly upright', uprightFrac > 0.85, `upright=${(uprightFrac * 100).toFixed(0)}%`);
  // 100ms sample gap: a full-speed pounce covers ~30 cells; only a genuine
  // teleport (the old scripted dismount) exceeds this
  check('floor: no teleporting', maxFrameJump(t) < 42, `jump=${maxFrameJump(t).toFixed(1)}`);
  await shotAt('floor', t[t.length - 1].x, t[t.length - 1].y);
}

// ---------------------------------------------------------------- 2) WALL CLIMB TO PERCH
console.log('scenario: wall climb to an overhead perch');
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__clearBand(380, 980, 320, 560);
  window.__solid(400, 800, 500, 512); // ground
  window.__solid(640, 800, 380, 512); // massive step; face at x=640, top y=380
  const p = ctx.player;
  p.x = 700; p.y = 378; p.vx = 0; p.vy = 0; // perched on the step top
  ctx.camera.snapTo(620, 430);
});
await spawnWeaver(480, 494, { cranky: true });
{
  const t = await watch(11000);
  const minY = Math.min(...t.map((s) => s.y));
  const end = t[t.length - 1];
  const dEnd = Math.hypot(end.x - end.px, end.y - end.py);
  check('climb: went up the face (y above 420)', minY < 420, `minY=${minY}`);
  check('climb: reached the quarry region', dEnd < 90, `dEnd=${dEnd.toFixed(0)}`);
  check('climb: no teleporting', maxFrameJump(t) < 30, `jump=${maxFrameJump(t).toFixed(1)}`);
  await shotAt('climb', end.x, end.y);
}

// ---------------------------------------------------------------- 3) CEILING HANG + TRAVERSE
console.log('scenario: ceiling hang and traverse');
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__clearBand(380, 980, 320, 560);
  window.__solid(400, 800, 500, 512); // ground
  window.__solid(430, 780, 380, 396); // ceiling slab overhead
  const p = ctx.player;
  p.x = 700; p.y = 498; p.vx = 0; p.vy = 0;
  ctx.camera.snapTo(620, 450);
});
// drop the weaver just under the ceiling so the airborne catch grabs the underside
await spawnWeaver(500, 410, { cranky: true });
{
  const t = await watch(9000);
  const hung = t.filter((s) => s.mode === 'attached' && Math.abs(s.orient) > 2.2);
  const traversed = hung.length >= 2 ? Math.abs(hung[hung.length - 1].x - hung[0].x) : 0;
  check('ceiling: hung upside-down for a stretch', hung.length >= 5, `hungSamples=${hung.length}`);
  check('ceiling: crawled along the underside', traversed > 12, `traversed=${traversed.toFixed(0)}`);
  if (hung.length > 0) await shotAt('ceiling', hung[Math.floor(hung.length / 2)].x, hung[Math.floor(hung.length / 2)].y);
}

// ---------------------------------------------------------------- 4) GAP POUNCE
console.log('scenario: pounce across a gap');
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__clearBand(380, 980, 320, 560);
  window.__solid(400, 610, 500, 540); // left platform (deep, so the gap is real)
  window.__solid(660, 900, 500, 540); // right platform; a 50-cell chasm between
  const p = ctx.player;
  p.x = 760; p.y = 498; p.vx = 0; p.vy = 0;
  ctx.camera.snapTo(640, 460);
});
await spawnWeaver(480, 494, { cranky: true });
{
  const t = await watch(12000);
  const flew = t.some((s) => s.mode === 'airborne');
  const end = t[t.length - 1];
  const crossed = t.some((s) => s.x > 655 && s.mode === 'attached');
  check('gap: went airborne (a real leap, not a walk)', flew, '');
  check('gap: made it across the chasm', crossed, `endX=${end.x}`);
  await shotAt('gap', end.x, end.y);
}

// ---------------------------------------------------------------- 5) NATURAL PILLAR HUNT (no forcing)
console.log('scenario: natural pillar hunt (no forced state)');
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  window.__clearBand(380, 980, 320, 560);
  window.__solid(400, 900, 500, 540); // ground
  window.__solid(600, 640, 400, 512); // a pillar; top at y=400
  const p = ctx.player;
  p.x = 730; p.y = 498; p.vx = 0; p.vy = 0; // on the floor, ~110 from the pillar top
  ctx.camera.snapTo(640, 450);
});
await spawnWeaver(620, 396, {}); // asleep-free, unalerted, perched on the pillar
{
  const t = await watch(14000);
  const end = t[t.length - 1];
  const alertedAt = t.findIndex((s) => s.alerted);
  const dMin = Math.min(...t.map((s) => Math.hypot(s.x - s.px, s.y - s.py)));
  const descended = t.some((s) => s.y > 460);
  check('hunt: noticed the player naturally', alertedAt >= 0, '');
  check('hunt: came down off the pillar', descended, `endY=${end.y}`);
  // needle range is 92 — inside that it is landing strikes, which is the hunt
  check('hunt: closed to striking range', dMin < 95, `dMin=${dMin.toFixed(0)}`);
  check('hunt: no teleporting', maxFrameJump(t) < 42, `jump=${maxFrameJump(t).toFixed(1)}`);
  await shotAt('hunt', end.x, end.y);
}

console.log(`\n${pass} ok, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

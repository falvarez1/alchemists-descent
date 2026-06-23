// Focused regression benchmark for the expensive Weaver wall-to-platform mount.
// The reported failure mode was one visible Weaver dropping the entity bucket to
// ~28ms while climbing near a ledge. This scenario forces that path and times the
// specific dismount helpers in addition to normal frame buckets.
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';
import {
  addSampleBuckets,
  currentCommandLine,
  currentGitState,
  emptyBuckets,
  printBucketSummary,
  sanitizeLabel,
  summarizeBuckets,
  writeJson,
} from './perf-harness.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const durationMs = Number(process.argv[3] || 5000);
if (!Number.isFinite(durationMs) || durationMs < 500) throw new Error('durationMs must be >= 500.');

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 500 });

  const setup = await page.evaluate(async ({ durationMs }) => {
    const ctx = window.__game.ctx;
    const proto = Object.getPrototypeOf(ctx.enemyCtl);
    const methodNames = [
      'weaverFooting',
      'weaverPhysicalFooting',
      'findWeaverAnchor',
      'weaverSeekWall',
      'findWeaverWallDismount',
      'weaverLandingSupported',
      'weaverLandingSupportedFast',
      'weaverBodySpaceClearFast',
      'weaverWallDismountPathClear',
      'tryWeaverWallDismount',
      'tickWeaverWallLeap',
      'weaveFootTrail',
      'weaveThread',
      'dropAhead',
    ];
    window.__weaverTimers = Object.fromEntries(methodNames.map((name) => [name, { count: 0, total: 0, max: 0 }]));
    for (const name of methodNames) {
      const original = proto[name];
      if (typeof original !== 'function' || original.__wrappedForWeaverPerf) continue;
      const wrapped = function wrappedForWeaverPerf(...args) {
        const t0 = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          const dt = performance.now() - t0;
          const bucket = window.__weaverTimers[name];
          bucket.count++;
          bucket.total += dt;
          bucket.max = Math.max(bucket.max, dt);
        }
      };
      wrapped.__wrappedForWeaverPerf = true;
      proto[name] = wrapped;
    }

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
    ctx.projectiles.length = 0;
    ctx.shockwaves.length = 0;
    ctx.particles.clear();
    ctx.enemyCtl.spawn('weaver', 640, 660);
    const weaver = ctx.enemies[0];
    weaver.x = 640;
    weaver.y = 660;
    weaver.vx = 0;
    weaver.vy = 0;
    weaver.fx = 0;
    weaver.fy = 0;
    weaver.sleeping = false;
    weaver.alerted = true;
    weaver.attackCd = 9999;
    weaver.blink = 0;
    weaver.windup = 0;
    weaver.cranky = 600;

    ctx.player.x = 885;
    ctx.player.y = 500;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    ctx.player.fx = 0;
    ctx.player.fy = 0;
    ctx.player.hp = 999999;
    ctx.player.maxHp = 999999;
    ctx.camera.zoomLock = 1;
    ctx.camera.snapTo(760, 560);

    window.__perfSamples = [];
    window.__perfRecord = true;
    await new Promise((resolve) => {
      const end = performance.now() + durationMs;
      const tick = () => {
        if (performance.now() >= end) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    window.__perfRecord = false;

    return {
      samples: window.__perfSamples,
      timers: window.__weaverTimers,
      enemy: {
        x: weaver.x,
        y: weaver.y,
        vx: weaver.vx,
        vy: weaver.vy,
        blink: weaver.blink,
        windup: weaver.windup,
        faceDir: weaver.weaverFaceDir,
        climbT: weaver.weaverClimbT,
        climbDir: weaver.weaverClimbDir,
        crest: weaver.weaverCrest,
        leapT: weaver.weaverLeapT,
        leapDuration: weaver.weaverLeapDuration,
        nextDismount: weaver.weaverDismountCheckFrame,
      },
    };
  }, { durationMs });

  const raw = emptyBuckets();
  addSampleBuckets(raw, setup.samples);
  const summary = summarizeBuckets(raw);
  printBucketSummary('weaver-wall-dismount', summary, ['entities', 'compose', 'render', 'frame']);
  console.log(JSON.stringify({ enemy: setup.enemy, timers: setup.timers }, null, 2));

  if (pageErrors.length || consoleErrors.length) {
    throw new Error(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }
  const dismountMax = setup.timers.tryWeaverWallDismount?.max ?? 0;
  const failures = [];
  if (dismountMax > 8) failures.push(`tryWeaverWallDismount.max ${dismountMax.toFixed(2)}ms > 8ms`);
  if (summary.entities.p95 > 4) failures.push(`entities.p95 ${summary.entities.p95.toFixed(2)}ms > 4ms`);
  if (summary.frame.p95 > 25) failures.push(`frame.p95 ${summary.frame.p95.toFixed(2)}ms > 25ms`);

  const out = `verify-out/perf-weaver-wall-dismount-${sanitizeLabel(String(durationMs))}-${Date.now()}.json`;
  writeJson(out, {
    command: currentCommandLine(),
    git: currentGitState(),
    url,
    durationMs,
    summary,
    timers: setup.timers,
    enemy: setup.enemy,
    pageErrors,
    consoleErrors,
    failures,
  });
  console.log(`Wrote ${out}`);
  if (failures.length) throw new Error(failures.join('; '));
} finally {
  await browser.close();
}

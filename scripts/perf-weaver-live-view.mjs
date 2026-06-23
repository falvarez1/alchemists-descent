// Real-map Weaver view benchmark. Reproduces the reported symptom more closely
// than the synthetic crowd probe by using the Weaver test map, capturing a
// no-Weaver-visible control, then moving the player/camera to an active visible
// Weaver and recording the same perf buckets plus direction-flip diagnostics.
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';
import {
  addSampleBuckets,
  captureCanvasPng,
  currentCommandLine,
  currentGitState,
  emptyBuckets,
  printBucketComparison,
  printBucketSummary,
  sanitizeLabel,
  summarizeBuckets,
  writeJson,
} from './perf-harness.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const durationMs = Number(process.argv[3] || 3500);
if (!Number.isFinite(durationMs) || durationMs < 800) throw new Error('durationMs must be >= 800.');

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error' && !text.includes('[vite] failed to connect to websocket')) {
    consoleErrors.push(text);
  }
});

async function installWeaverTimers() {
  await page.evaluate(() => {
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
      if (typeof original !== 'function' || original.__wrappedForLiveViewPerf) continue;
      const wrapped = function wrappedForLiveViewPerf(...args) {
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
      wrapped.__wrappedForLiveViewPerf = true;
      proto[name] = wrapped;
    }
  });
}

async function prepareScene() {
  return page.evaluate(async () => {
    const { VIEW_W, VIEW_H } = await import('/src/config/constants.ts');
    const ctx = window.__game.ctx;
    const world = ctx.world;
    const weavers = ctx.enemies.filter((e) => e.kind === 'weaver' && (e.hp ?? 1) > 0);
    if (weavers.length === 0) throw new Error('Weaver test map has no Weaver enemies.');

    const target = weavers
      .slice()
      .sort((a, b) => Math.abs(a.x - ctx.player.x) + Math.abs(a.y - ctx.player.y) - (Math.abs(b.x - ctx.player.x) + Math.abs(b.y - ctx.player.y)))[0];

    for (const e of weavers) {
      e.sleeping = e !== target;
      e.alerted = e === target;
      e.cranky = e === target ? 600 : 0;
      e.attackCd = 9999;
      e.windup = 0;
      e.blink = 0;
      e.recoil = 0;
    }

    ctx.player.hp = 999999;
    ctx.player.maxHp = 999999;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    ctx.player.fx = 0;
    ctx.player.fy = 0;
    ctx.camera.zoomLock = 1;
    ctx.params.global.ambientLight = Math.max(ctx.params.global.ambientLight, 0.5);
    ctx.params.global.maxBrightness = Math.max(ctx.params.global.maxBrightness, 2.2);
    ctx.perf.setVisible(true);

    const halfW = 5;
    const halfH = 10;
    const floorClear = (x, y) =>
      x > 20 &&
      y > 20 &&
      x < world.width - 20 &&
      y < world.height - 20 &&
      ctx.physics.entityFree(x, y, halfW, halfH) &&
      !ctx.physics.entityFree(x, y + 1, halfW, 1);

    let controlSpot = null;
    const minDist = Math.min(360, Math.max(180, VIEW_W * 0.55));
    for (let y = 90; y < world.height - 40 && !controlSpot; y += 4) {
      for (let x = 40; x < world.width - 40; x += 4) {
        if (Math.hypot(x - target.x, y - target.y) < minDist) continue;
        if (!floorClear(x, y)) continue;
        const wouldShowWeaver = weavers.some((e) => Math.abs(e.x - x) < VIEW_W * 0.6 && Math.abs(e.y - y) < VIEW_H * 0.6);
        if (!wouldShowWeaver) {
          controlSpot = { x, y };
          break;
        }
      }
    }
    if (!controlSpot) {
      controlSpot = {
        x: Math.max(40, Math.min(world.width - 40, target.x + Math.sign(world.width / 2 - target.x || 1) * minDist)),
        y: Math.max(80, Math.min(world.height - 60, target.y)),
      };
    }

    const visibleSpot = { x: target.x + 44, y: target.y - 2 };
    if (!floorClear(visibleSpot.x, visibleSpot.y)) {
      const STONE = 12;
      for (let x = Math.round(visibleSpot.x) - 10; x <= Math.round(visibleSpot.x) + 10; x++) {
        for (let y = Math.round(visibleSpot.y) + 2; y <= Math.round(visibleSpot.y) + 5; y++) {
          if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), STONE, 0x777777);
        }
      }
    }

    return {
      view: { w: VIEW_W, h: VIEW_H },
      weavers: weavers.map((e) => ({ x: e.x, y: e.y })),
      target: { x: target.x, y: target.y },
      controlSpot,
      visibleSpot,
    };
  });
}

async function runScenario(name, spot, target, options = {}) {
  const setup = await page.evaluate(
    async ({ durationMs, name, spot, target, active }) => {
      const { VIEW_W, VIEW_H } = await import('/src/config/constants.ts');
      const ctx = window.__game.ctx;
      const targetWeaver = ctx.enemies
        .filter((e) => e.kind === 'weaver')
        .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))[0];
      if (!targetWeaver) throw new Error('Target Weaver missing.');

      targetWeaver.sleeping = !active;
      targetWeaver.alerted = active;
      targetWeaver.cranky = active ? 600 : 0;
      targetWeaver.attackCd = 9999;
      targetWeaver.windup = 0;
      targetWeaver.blink = 0;
      targetWeaver.recoil = 0;
      targetWeaver.vx = 0;
      targetWeaver.vy = 0;
      targetWeaver.fx = 0;
      targetWeaver.fy = 0;

      ctx.player.x = spot.x;
      ctx.player.y = spot.y;
      ctx.player.vx = 0;
      ctx.player.vy = 0;
      ctx.player.fx = 0;
      ctx.player.fy = 0;
      ctx.player.hp = 999999;
      ctx.player.maxHp = 999999;
      ctx.camera.zoomLock = 1;
      ctx.camera.snapTo(active ? (spot.x + targetWeaver.x) * 0.5 : spot.x, active ? targetWeaver.y - 25 : spot.y - 20);

      for (const key of Object.keys(window.__weaverTimers ?? {})) {
        const bucket = window.__weaverTimers[key];
        bucket.count = 0;
        bucket.total = 0;
        bucket.max = 0;
      }
      window.__weaverFlipTrace = [];
      window.__perfSamples = [];
      window.__perfRecord = true;

      let lastFace = targetWeaver.weaverFaceDir === -1 || targetWeaver.weaverFaceDir === 1 ? targetWeaver.weaverFaceDir : 0;
      let lastMove = Math.abs(targetWeaver.vx) > 0.05 ? Math.sign(targetWeaver.vx) : 0;
      let faceFlips = 0;
      let moveFlips = 0;
      let samples = 0;
      const started = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          ctx.camera.snapTo(active ? (ctx.player.x + targetWeaver.x) * 0.5 : ctx.player.x, active ? targetWeaver.y - 25 : ctx.player.y - 20);
          const face = targetWeaver.weaverFaceDir === -1 || targetWeaver.weaverFaceDir === 1 ? targetWeaver.weaverFaceDir : lastFace;
          const move = Math.abs(targetWeaver.vx) > 0.05 ? Math.sign(targetWeaver.vx) : lastMove;
          if (lastFace && face && face !== lastFace) faceFlips++;
          if (lastMove && move && move !== lastMove) moveFlips++;
          lastFace = face;
          lastMove = move;
          samples++;
          window.__weaverFlipTrace.push({
            t: performance.now() - started,
            x: targetWeaver.x,
            y: targetWeaver.y,
            vx: targetWeaver.vx,
            face,
          });
          if (performance.now() - started >= durationMs) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      window.__perfRecord = false;
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const visibleWeavers = ctx.enemies.filter(
        (e) =>
          e.kind === 'weaver' &&
          e.x >= ctx.camera.renderX - 90 &&
          e.x <= ctx.camera.renderX + VIEW_W + 90 &&
          e.y >= ctx.camera.renderY - 120 &&
          e.y <= ctx.camera.renderY + VIEW_H + 120,
      );
      return {
        name,
        active,
        spot,
        samples: window.__perfSamples,
        timers: JSON.parse(JSON.stringify(window.__weaverTimers ?? {})),
        visibleWeavers: visibleWeavers.length,
        target: {
          x: targetWeaver.x,
          y: targetWeaver.y,
          vx: targetWeaver.vx,
          vy: targetWeaver.vy,
          faceDir: targetWeaver.weaverFaceDir ?? null,
          sleeping: targetWeaver.sleeping === true,
          alerted: targetWeaver.alerted === true,
        },
        camera: {
          renderX: ctx.camera.renderX,
          renderY: ctx.camera.renderY,
        },
        direction: {
          faceFlips,
          moveFlips,
          samples,
          traceTail: window.__weaverFlipTrace.slice(-20),
        },
      };
    },
    { durationMs, name, spot, target, active: options.active === true },
  );

  const raw = emptyBuckets();
  addSampleBuckets(raw, setup.samples);
  const summary = summarizeBuckets(raw);
  setup.sampleCount = setup.samples.length;
  delete setup.samples;
  return { raw, summary, setup };
}

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 600 });
  await installWeaverTimers();
  const scene = await prepareScene();

  const control = await runScenario('control-no-visible-weaver', scene.controlSpot, scene.target, { active: false });
  const controlPng = `verify-out/perf-weaver-live-view-control-${sanitizeLabel(String(durationMs))}.png`;
  await captureCanvasPng(page, controlPng);

  const visible = await runScenario('visible-active-weaver', scene.visibleSpot, scene.target, { active: true });
  const visiblePng = `verify-out/perf-weaver-live-view-visible-${sanitizeLabel(String(durationMs))}.png`;
  await captureCanvasPng(page, visiblePng);

  printBucketSummary('control-no-visible-weaver', control.summary, ['entities', 'compose', 'render', 'frame']);
  printBucketSummary('visible-active-weaver', visible.summary, ['entities', 'compose', 'render', 'frame']);
  const comparison = printBucketComparison(
    'control-no-visible-weaver',
    'visible-active-weaver',
    control.raw,
    visible.raw,
    ['entities', 'compose', 'render', 'frame'],
  );

  const failures = [];
  if (control.setup.visibleWeavers !== 0) failures.push(`control expected 0 visible Weavers, saw ${control.setup.visibleWeavers}`);
  if (visible.setup.visibleWeavers < 1) failures.push('visible scenario did not keep a Weaver in view');
  if (visible.summary.entities.p95 > 4) failures.push(`visible entities.p95 ${visible.summary.entities.p95.toFixed(2)}ms > 4ms`);
  const renderP95Limit = Math.max(14, control.summary.render.p95 + 8);
  if (visible.summary.render.p95 > renderP95Limit) {
    failures.push(`visible render.p95 ${visible.summary.render.p95.toFixed(2)}ms > ${renderP95Limit.toFixed(2)}ms`);
  }
  if (visible.summary.frame.p95 > 25) failures.push(`visible frame.p95 ${visible.summary.frame.p95.toFixed(2)}ms > 25ms`);
  if (visible.setup.direction.faceFlips > Math.max(6, Math.floor(visible.setup.direction.samples / 30))) {
    failures.push(`visible Weaver face flipped ${visible.setup.direction.faceFlips} times over ${visible.setup.direction.samples} frames`);
  }
  if (pageErrors.length || consoleErrors.length) {
    failures.push(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }

  const out = `verify-out/perf-weaver-live-view-${sanitizeLabel(String(durationMs))}-${Date.now()}.json`;
  writeJson(out, {
    command: currentCommandLine(),
    git: currentGitState(),
    url,
    durationMs,
    scene,
    screenshots: { control: controlPng, visible: visiblePng },
    control: { summary: control.summary, setup: control.setup },
    visible: { summary: visible.summary, setup: visible.setup },
    comparison,
    pageErrors,
    consoleErrors,
    failures,
  });
  console.log(`Wrote ${out}`);
  console.log(`Screenshots: ${controlPng}, ${visiblePng}`);
  if (failures.length) throw new Error(failures.join('; '));
} finally {
  await browser.close();
}

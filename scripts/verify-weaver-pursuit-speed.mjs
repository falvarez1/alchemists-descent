// Runtime browser probe for Weaver pursuit feel: it must close distance like a
// predator while keeping the constrained leg gait planted enough to read naturally.
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';
import { captureCanvasPng, currentCommandLine, currentGitState, sanitizeLabel, writeJson } from './perf-harness.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const durationMs = Number(process.argv[3] || 2600);
if (!Number.isFinite(durationMs) || durationMs < 1200) throw new Error('durationMs must be >= 1200.');

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error' && !text.includes('[vite] failed to connect to websocket')) consoleErrors.push(text);
});

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 500 });

  const result = await page.evaluate(async ({ duration }) => {
    const ctx = window.__game.ctx;
    const world = ctx.world;
    const STONE = 12;
    const startX = 500;
    const playerX = 900;
    const floorY = 660;

    ctx.enemies.length = 0;
    ctx.projectiles.length = 0;
    ctx.shockwaves.length = 0;
    ctx.particles.clear();
    for (let y = floorY - 95; y <= floorY + 16; y++) {
      for (let x = startX - 120; x <= playerX + 130; x++) {
        if (world.inBounds(x, y)) world.clearCellAt(world.idx(x, y));
      }
    }
    for (let y = floorY + 1; y <= floorY + 9; y++) {
      for (let x = startX - 130; x <= playerX + 140; x++) {
        if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), STONE, 0x777777);
      }
    }

    ctx.enemyCtl.spawn('weaver', startX, floorY);
    const weaver = ctx.enemies[0];
    weaver.x = startX;
    weaver.y = floorY;
    weaver.vx = 0;
    weaver.vy = 0;
    weaver.fx = 0;
    weaver.fy = 0;
    weaver.sleeping = false;
    weaver.alerted = true;
    weaver.cranky = 260;
    weaver.attackCd = 9999;
    weaver.blink = 0;
    weaver.windup = 0;
    weaver.patrol = undefined;
    weaver.weaverLegs = undefined;

    ctx.player.x = playerX;
    ctx.player.y = floorY;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    ctx.player.fx = 0;
    ctx.player.fy = 0;
    ctx.player.hp = 999999;
    ctx.player.maxHp = 999999;
    ctx.camera.zoomLock = 1;

    const samples = [];
    const started = performance.now();
    let maxAbsVx = 0;
    let speedSum = 0;
    let speedSamples = 0;
    let maxSwingingLegs = 0;
    let minPlantedLegs = Infinity;
    let maxRawLift = 0;

    await new Promise((resolve) => {
      const tick = () => {
        ctx.player.x = playerX;
        ctx.player.y = floorY;
        ctx.player.vx = 0;
        ctx.player.vy = 0;
        weaver.attackCd = 9999;
        weaver.cranky = Math.max(weaver.cranky ?? 0, 90);
        ctx.camera.snapTo((weaver.x + ctx.player.x) * 0.5, floorY - 34);

        const legs = weaver.weaverLegs ?? [];
        const planted = legs.filter((leg) => leg.planted === true).length;
        const swinging = Math.max(0, legs.length - planted);
        maxSwingingLegs = Math.max(maxSwingingLegs, swinging);
        if (legs.length > 0) minPlantedLegs = Math.min(minPlantedLegs, planted);
        for (const leg of legs) maxRawLift = Math.max(maxRawLift, leg.lift ?? 0);

        const distance = ctx.player.x - weaver.x;
        const absVx = Math.abs(weaver.vx ?? 0);
        maxAbsVx = Math.max(maxAbsVx, absVx);
        if (distance > 95) {
          speedSum += absVx;
          speedSamples++;
        }
        samples.push({
          t: performance.now() - started,
          x: weaver.x,
          y: weaver.y,
          vx: weaver.vx,
          distance,
          planted,
          swinging,
          aggro: weaver.weaverAggro ?? 0,
        });
        if (performance.now() - started >= duration) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const first = samples[0];
    const last = samples[samples.length - 1];
    return {
      startX,
      playerX,
      floorY,
      frames: samples.length,
      durationMs: last?.t ?? 0,
      startDistance: first?.distance ?? 0,
      finalDistance: last?.distance ?? 0,
      closed: (first?.distance ?? 0) - (last?.distance ?? 0),
      finalX: last?.x ?? weaver.x,
      maxAbsVx,
      avgPursuitVx: speedSamples > 0 ? speedSum / speedSamples : 0,
      maxSwingingLegs,
      minPlantedLegs: Number.isFinite(minPlantedLegs) ? minPlantedLegs : 0,
      maxRawLift,
      tail: samples.slice(-18),
    };
  }, { duration: durationMs });

  const png = `verify-out/weaver-pursuit-speed-${sanitizeLabel(String(durationMs))}.png`;
  await captureCanvasPng(page, png);

  const failures = [];
  if (result.closed < 170) failures.push(`closed too little distance (${result.closed.toFixed(1)} cells)`);
  if (result.maxAbsVx < 1.8) failures.push(`maxAbsVx too low (${result.maxAbsVx.toFixed(2)})`);
  if (result.avgPursuitVx < 0.95) failures.push(`avgPursuitVx too low (${result.avgPursuitVx.toFixed(2)})`);
  if (result.maxSwingingLegs > 5) failures.push(`too many legs off-plant (${result.maxSwingingLegs})`);
  if (result.minPlantedLegs < 3) failures.push(`too few planted legs (${result.minPlantedLegs})`);
  if (result.maxRawLift > 0.9) failures.push(`foot lift too high (${result.maxRawLift.toFixed(2)})`);
  if (pageErrors.length || consoleErrors.length) failures.push(`browser errors ${JSON.stringify({ pageErrors, consoleErrors })}`);

  const out = `verify-out/weaver-pursuit-speed-${sanitizeLabel(String(durationMs))}-${Date.now()}.json`;
  writeJson(out, {
    command: currentCommandLine(),
    git: currentGitState(),
    url,
    durationMs,
    screenshot: png,
    result,
    failures,
    pageErrors,
    consoleErrors,
  });

  console.log(JSON.stringify({ result, screenshot: png }, null, 2));
  console.log(`Wrote ${out}`);
  if (failures.length) throw new Error(failures.join('; '));
  console.log('\nPASS - Weaver pursuit is fast while the live gait remains planted.');
} finally {
  await browser.close();
}

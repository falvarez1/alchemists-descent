// Regression probe for the wake-up charge feel: a sleeping Weaver should wake
// into a committed rush, not a slow stalk. Builds a flat controlled arena,
// wakes by player proximity, records displacement/speed, and saves a screenshot.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';
import { currentCommandLine, currentGitState, sanitizeLabel, writeJson } from './perf-harness.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const durationMs = Number(process.argv[3] || 1600);
if (!Number.isFinite(durationMs) || durationMs < 800) throw new Error('durationMs must be >= 800.');

mkdirSync('verify-out', { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error' && !text.includes('[vite] failed to connect to websocket')) {
    consoleErrors.push(text);
  }
});

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 500 });

  const result = await page.evaluate(async ({ durationMs }) => {
    const ctx = window.__game.ctx;
    const world = ctx.world;
    const STONE = 12;
    const cx = 620;
    const floorY = 660;

    ctx.enemies.length = 0;
    ctx.projectiles.length = 0;
    ctx.shockwaves.length = 0;
    ctx.particles.clear();

    for (let y = floorY - 95; y <= floorY + 16; y++) {
      for (let x = cx - 160; x <= cx + 220; x++) {
        if (world.inBounds(x, y)) world.clearCellAt(world.idx(x, y));
      }
    }
    for (let y = floorY + 1; y <= floorY + 8; y++) {
      for (let x = cx - 170; x <= cx + 230; x++) {
        if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), STONE, 0x777777);
      }
    }

    ctx.enemyCtl.spawn('weaver', cx, floorY);
    const w = ctx.enemies[0];
    w.x = cx;
    w.y = floorY;
    w.vx = 0;
    w.vy = 0;
    w.fx = 0;
    w.fy = 0;
    w.sleeping = true;
    w.alerted = false;
    w.cranky = 0;
    w.attackCd = 60;
    w.windup = 0;
    w.blink = 0;
    w.recoil = 0;
    w.weaverFallT = 0;
    w.weaverCrest = 0;
    w.weaverClimbT = 0;
    w.weaverClimbDir = 0;

    ctx.player.x = cx + 78;
    ctx.player.y = floorY;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    ctx.player.fx = 0;
    ctx.player.fy = 0;
    ctx.player.hp = 999999;
    ctx.player.maxHp = 999999;
    ctx.camera.zoomLock = 1;
    ctx.camera.snapTo(cx + 46, floorY - 36);

    const startX = w.x;
    const targetX = ctx.player.x;
    const startDistance = Math.abs(targetX - startX);
    let maxAbsVx = 0;
    let maxClosingSpeed = 0;
    let maxAdvance = 0;
    let minDistance = startDistance;
    let wakeSeen = false;
    let wakeAtMs = null;
    let crankyFramesSeen = 0;
    let faceFlips = 0;
    let lastFace = w.weaverFaceDir === -1 || w.weaverFaceDir === 1 ? w.weaverFaceDir : 0;
    const samples = [];
    const started = performance.now();

    await new Promise((resolve) => {
      const tick = () => {
        ctx.camera.snapTo((ctx.player.x + w.x) * 0.5, floorY - 36);
        const elapsed = performance.now() - started;
        const distance = Math.abs(targetX - w.x);
        const advance = Math.max(0, w.x - startX);
        const closingSpeed = Math.max(0, -Math.sign(targetX - w.x || 1) * (w.vx - ctx.player.vx));
        maxAbsVx = Math.max(maxAbsVx, Math.abs(w.vx));
        maxClosingSpeed = Math.max(maxClosingSpeed, closingSpeed);
        maxAdvance = Math.max(maxAdvance, advance);
        minDistance = Math.min(minDistance, distance);
        if (!w.sleeping && !wakeSeen) {
          wakeSeen = true;
          wakeAtMs = elapsed;
        }
        if ((w.cranky ?? 0) > 0) crankyFramesSeen++;
        const face = w.weaverFaceDir === -1 || w.weaverFaceDir === 1 ? w.weaverFaceDir : lastFace;
        if (lastFace && face && face !== lastFace) faceFlips++;
        lastFace = face;
        samples.push({
          t: elapsed,
          x: w.x,
          vx: w.vx,
          distance,
          sleeping: w.sleeping === true,
          cranky: w.cranky ?? 0,
          windup: w.windup ?? 0,
          attackCd: w.attackCd ?? 0,
          face,
        });
        if (elapsed >= durationMs) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const canvas = document.querySelector('#canvas-holder > canvas');
    const image = canvas.toDataURL('image/png');
    return {
      startX,
      targetX,
      startDistance,
      wakeSeen,
      wakeAtMs,
      crankyFramesSeen,
      maxAbsVx,
      maxClosingSpeed,
      maxAdvance,
      minDistance,
      faceFlips,
      final: {
        x: w.x,
        y: w.y,
        vx: w.vx,
        vy: w.vy,
        sleeping: w.sleeping === true,
        alerted: w.alerted === true,
        cranky: w.cranky ?? 0,
        windup: w.windup ?? 0,
        attackCd: w.attackCd ?? 0,
      },
      samples: samples.filter((_, i) => i % 5 === 0).slice(0, 80),
      image,
    };
  }, { durationMs });

  const png = `verify-out/weaver-charge-${sanitizeLabel(String(durationMs))}.png`;
  writeFileSync(png, Buffer.from(result.image.split(',')[1], 'base64'));
  delete result.image;

  const failures = [];
  if (!result.wakeSeen) failures.push('sleeping Weaver did not wake by proximity');
  if (result.wakeAtMs !== null && result.wakeAtMs > 220) failures.push(`wake took ${result.wakeAtMs.toFixed(1)}ms > 220ms`);
  if (result.crankyFramesSeen < 20) failures.push(`wake rush did not stay cranky long enough (${result.crankyFramesSeen} frames)`);
  if (result.maxAbsVx < 1.05) failures.push(`peak horizontal speed ${result.maxAbsVx.toFixed(2)} < 1.05`);
  if (result.maxAdvance < 42) failures.push(`advanced only ${result.maxAdvance.toFixed(1)} cells toward player`);
  if (result.minDistance > 40) failures.push(`never closed inside 40 cells (minDistance=${result.minDistance.toFixed(1)})`);
  if (result.faceFlips > 4) failures.push(`face flipped ${result.faceFlips} times during wake rush`);
  if (pageErrors.length || consoleErrors.length) {
    failures.push(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }

  const out = `verify-out/weaver-charge-${sanitizeLabel(String(durationMs))}-${Date.now()}.json`;
  writeJson(out, {
    command: currentCommandLine(),
    git: currentGitState(),
    url,
    durationMs,
    screenshot: png,
    result,
    pageErrors,
    consoleErrors,
    failures,
  });
  console.log(JSON.stringify(result, null, 2));
  console.log(`Wrote ${out}`);
  console.log(`Screenshot: ${png}`);
  if (failures.length) throw new Error(failures.join('; '));
  console.log('\nPASS - Weaver wakes into a committed charge.');
} finally {
  await browser.close();
}

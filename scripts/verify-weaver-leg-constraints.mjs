// Runtime verification for the Weaver's constrained leg IK. It samples live
// renderer-owned leg diagnostics during a flat wake-charge and a wall/platform
// mount, catching hyper-extension, joint folding, and pole-side flips that unit
// tests cannot see through the full AI/terrain/render path.
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';
import { captureCanvasPng, currentCommandLine, currentGitState, sanitizeLabel, writeJson } from './perf-harness.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const durationMs = Number(process.argv[3] || 1800);
if (!Number.isFinite(durationMs) || durationMs < 800) throw new Error('durationMs must be >= 800.');

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

async function runIkScenario(name, setup, duration) {
  return page.evaluate(
    async ({ duration, setupSource }) => {
      const setupFn = (0, eval)(`(${setupSource})`);
      const ctx = window.__game.ctx;
      const setup = setupFn(ctx);
      const stats = {
        frames: 0,
        ikSamples: 0,
        minUpperFlex: Infinity,
        minLowerFlex: Infinity,
        maxUpperFlex: 0,
        maxLowerFlex: 0,
        maxExtension: 0,
        minPoleSide: Infinity,
        maxPoleSide: -Infinity,
        flagsOr: 0,
        angleLimited: 0,
        clamped: 0,
        missingIkFrames: 0,
        maxRawLift: 0,
        maxSwingingLegs: 0,
        minPlantedLegs: Infinity,
        tail: [],
      };

      const sampleLegs = () => {
        const weaver = ctx.enemies[0];
        const legs = weaver?.weaverLegs ?? [];
        if (legs.length === 0 || legs.some((leg) => !leg.ik)) stats.missingIkFrames++;
        const settled = stats.frames > 20;
        let plantedNow = 0;
        let swingingNow = 0;
        for (const leg of legs) {
          if (settled) {
            stats.maxRawLift = Math.max(stats.maxRawLift, leg.lift ?? 0);
            if (leg.planted === true) plantedNow++;
            else swingingNow++;
          }
          const ik = leg.ik;
          if (!ik) continue;
          stats.ikSamples++;
          stats.minUpperFlex = Math.min(stats.minUpperFlex, ik.upperFlex);
          stats.minLowerFlex = Math.min(stats.minLowerFlex, ik.lowerFlex);
          stats.maxUpperFlex = Math.max(stats.maxUpperFlex, ik.upperFlex);
          stats.maxLowerFlex = Math.max(stats.maxLowerFlex, ik.lowerFlex);
          stats.maxExtension = Math.max(stats.maxExtension, ik.extension);
          stats.minPoleSide = Math.min(stats.minPoleSide, ik.poleSide);
          stats.maxPoleSide = Math.max(stats.maxPoleSide, ik.poleSide);
          stats.flagsOr |= ik.flags;
          if ((ik.flags & (1 << 5)) !== 0) stats.angleLimited++;
          if ((ik.flags & ((1 << 0) | (1 << 1))) !== 0) stats.clamped++;
        }
        if (settled && legs.length > 0) {
          stats.minPlantedLegs = Math.min(stats.minPlantedLegs, plantedNow);
          stats.maxSwingingLegs = Math.max(stats.maxSwingingLegs, swingingNow);
        }
        if (weaver && stats.frames % 12 === 0) {
          stats.tail.push({
            frame: stats.frames,
            x: weaver.x,
            y: weaver.y,
            vx: weaver.vx,
            vy: weaver.vy,
            minFlex: Math.min(
              ...legs
                .map((leg) => leg.ik)
                .filter(Boolean)
                .flatMap((ik) => [ik.upperFlex, ik.lowerFlex]),
            ),
          });
          if (stats.tail.length > 20) stats.tail.shift();
        }
      };

      const started = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          setup.tick?.(ctx);
          sampleLegs();
          stats.frames++;
          if (performance.now() - started >= duration) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      if (!Number.isFinite(stats.minUpperFlex)) stats.minUpperFlex = 0;
      if (!Number.isFinite(stats.minLowerFlex)) stats.minLowerFlex = 0;
      if (!Number.isFinite(stats.minPoleSide)) stats.minPoleSide = 0;
      if (!Number.isFinite(stats.maxPoleSide)) stats.maxPoleSide = 0;
      if (!Number.isFinite(stats.minPlantedLegs)) stats.minPlantedLegs = 0;
      return { setup: setup.info, stats };
    },
    { duration, setupSource: setup.toString() },
  );
}

function setupCharge(ctx) {
  const world = ctx.world;
  const STONE = 12;
  const cx = 620;
  const floorY = 660;
  ctx.enemies.length = 0;
  ctx.projectiles.length = 0;
  ctx.shockwaves.length = 0;
  ctx.particles.clear();
  for (let y = floorY - 100; y <= floorY + 16; y++) {
    for (let x = cx - 170; x <= cx + 230; x++) {
      if (world.inBounds(x, y)) world.clearCellAt(world.idx(x, y));
    }
  }
  for (let y = floorY + 1; y <= floorY + 8; y++) {
    for (let x = cx - 180; x <= cx + 240; x++) {
      if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), STONE, 0x777777);
    }
  }
  ctx.enemyCtl.spawn('weaver', cx, floorY);
  const weaver = ctx.enemies[0];
  weaver.x = cx;
  weaver.y = floorY;
  weaver.vx = 0;
  weaver.vy = 0;
  weaver.fx = 0;
  weaver.fy = 0;
  weaver.sleeping = true;
  weaver.alerted = false;
  weaver.cranky = 0;
  weaver.attackCd = 60;
  weaver.windup = 0;
  weaver.blink = 0;
  ctx.player.x = cx + 78;
  ctx.player.y = floorY;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
  ctx.player.hp = 999999;
  ctx.player.maxHp = 999999;
  ctx.camera.zoomLock = 1;
  return {
    info: { kind: 'charge', start: { x: cx, y: floorY }, player: { x: ctx.player.x, y: ctx.player.y } },
    tick: () => ctx.camera.snapTo((ctx.player.x + weaver.x) * 0.5, floorY - 36),
  };
}

function setupWallMount(ctx) {
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
  for (let y = 501; y <= 508; y++) {
    for (let x = 820; x <= 960; x++) {
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
  weaver.cranky = 180;
  weaver.attackCd = 9999;
  weaver.blink = 0;
  weaver.windup = 0;
  ctx.player.x = 885;
  ctx.player.y = 500;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
  ctx.player.hp = 999999;
  ctx.player.maxHp = 999999;
  ctx.camera.zoomLock = 1;
  return {
    info: { kind: 'wall-mount', start: { x: 640, y: 660 }, player: { x: ctx.player.x, y: ctx.player.y } },
    tick: () => ctx.camera.snapTo((ctx.player.x + weaver.x) * 0.5, weaver.y - 40),
  };
}

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await startConsoleTestRun(page, { level: 'weaver-test', world: 'campaign-level', seed: 1, settleMs: 500 });

  const charge = await runIkScenario('charge', setupCharge, durationMs);
  const chargePng = `verify-out/weaver-leg-constraints-charge-${sanitizeLabel(String(durationMs))}.png`;
  await captureCanvasPng(page, chargePng);
  const wall = await runIkScenario('wall-mount', setupWallMount, Math.max(durationMs, 3600));
  const wallPng = `verify-out/weaver-leg-constraints-wall-${sanitizeLabel(String(durationMs))}.png`;
  await captureCanvasPng(page, wallPng);

  const failures = [];
  for (const [label, result] of [
    ['charge', charge],
    ['wall-mount', wall],
  ]) {
    const s = result.stats;
    if (s.ikSamples < s.frames * 4) failures.push(`${label}: too few IK samples (${s.ikSamples}/${s.frames})`);
    if (s.minUpperFlex < 0.1) failures.push(`${label}: upper joint near-straight minFlex=${s.minUpperFlex.toFixed(3)}`);
    if (s.minLowerFlex < 0.1) failures.push(`${label}: lower joint near-straight minFlex=${s.minLowerFlex.toFixed(3)}`);
    if (s.maxUpperFlex > 2.85) failures.push(`${label}: upper joint over-folded maxFlex=${s.maxUpperFlex.toFixed(3)}`);
    if (s.maxLowerFlex > 2.85) failures.push(`${label}: lower joint over-folded maxFlex=${s.maxLowerFlex.toFixed(3)}`);
    if (s.maxExtension > 1.02) failures.push(`${label}: chain overextended maxExtension=${s.maxExtension.toFixed(3)}`);
    if (s.minPoleSide < -0.5) failures.push(`${label}: knee crossed pole side minPoleSide=${s.minPoleSide.toFixed(3)}`);
    if (s.maxRawLift > 0.82) failures.push(`${label}: foot lift too high maxRawLift=${s.maxRawLift.toFixed(3)}`);
    if (label === 'charge' && s.maxSwingingLegs > 5) failures.push(`${label}: too many legs swing at once (${s.maxSwingingLegs})`);
    if (label === 'charge' && s.minPlantedLegs < 3) failures.push(`${label}: too few planted legs (${s.minPlantedLegs})`);
  }
  if (pageErrors.length || consoleErrors.length) {
    failures.push(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }

  const out = `verify-out/weaver-leg-constraints-${sanitizeLabel(String(durationMs))}-${Date.now()}.json`;
  writeJson(out, {
    command: currentCommandLine(),
    git: currentGitState(),
    url,
    durationMs,
    screenshots: { charge: chargePng, wall: wallPng },
    charge,
    wall,
    pageErrors,
    consoleErrors,
    failures,
  });
  console.log(JSON.stringify({ charge: charge.stats, wall: wall.stats, screenshots: { chargePng, wallPng } }, null, 2));
  console.log(`Wrote ${out}`);
  if (failures.length) throw new Error(failures.join('; '));
  console.log('\nPASS - Weaver live leg IK stayed inside constrained animator limits.');
} finally {
  await browser.close();
}

import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';
import { collectBackendCapabilities, currentGitState } from './perf-harness.mjs';

const output = 'verify-out/living-descent';
const duration = Math.max(5, Number(process.argv[3] ?? 60));
const levels = (process.argv[4] ?? 'd1,d4').split(',');
mkdirSync(output, { recursive: true });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], report = { startedAt: new Date().toISOString(), git: currentGitState(), errors, scenes: [] };
page.on('pageerror', e => errors.push(String(e)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/', { waitUntil: 'networkidle' });
  await waitForConsoleApi(page);
  report.environment = await collectBackendCapabilities(page);
  await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run new --seed 777');
  await waitForRunReady(page); await page.waitForTimeout(5000);
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  await page.waitForTimeout(1500); // Repay work queued behind the final repair before a steady-state window.
  report.checkpoints = await page.evaluate(async () => {
    const ctx = window.__game.ctx, samples = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      await ctx.console.exec('run save');
      const mainThreadMs = performance.now() - start;
      const status = await ctx.levels.flushSaves();
      samples.push({ mainThreadMs, durableMs: performance.now() - start, ...status });
      await new Promise(r => setTimeout(r, 200));
    }
    return samples;
  });
  assert.ok(report.checkpoints.every(c => c.state === 'ready' && c.revision > 0));
  // Actual 60-second wall-clock windows, with frame intervals and debt separate
  // from CPU work. Only recording is controlled through the diagnostic hook.
  for (const level of levels) {
    if (level !== 'd1') {
      await execConsoleCommand(page, `run test --level ${level} --world campaign-level --seed 777 --loadout fresh`);
      await waitForRunReady(page); await page.waitForTimeout(5000);
      await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
      await page.waitForTimeout(1500);
    }
    const started = await page.evaluate(() => {
      window.__perfRecord = true; window.__perfSamples = []; window.__perfTicks = [];
      return { time: performance.now(), tick: window.__game.ctx.state.frameCount, debt: window.__game.cadence.debt };
    });
    // Keep each external wait short enough for progress reporting by the agent.
    for (let elapsed = 0; elapsed < duration; elapsed += 5) await page.waitForTimeout(Math.min(5, duration - elapsed) * 1000);
    const scene = await page.evaluate(({ started, level }) => {
      window.__perfRecord = false;
      const ctx = window.__game.ctx, samples = window.__perfSamples;
      const elapsed = performance.now() - started.time;
      const quantile = (values, q) => { values.sort((a, b) => a - b); return values[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0; };
      const summarize = values => ({ mean: values.reduce((a, b) => a + b, 0) / Math.max(1, values.length), p95: quantile([...values], .95), p99: quantile([...values], .99), max: Math.max(0, ...values) });
      const buckets = {};
      for (const key of ['interval', 'sim', 'entities', 'compose', 'gl', 'render', 'frame', 'debt']) {
        const values = samples.map(s => s[key]);
        buckets[key] = summarize(values);
      }
      buckets.submission = summarize(samples.map(s => s.compose + s.gl));
      buckets.ui = summarize(samples.map(s => Math.max(0, s.render - s.compose - s.gl)));
      const fixedTicks = {};
      for (const key of ['sim', 'creatures', 'gameplay', 'total']) fixedTicks[key] = summarize(window.__perfTicks.map(tick => tick[key]));
      return { level, elapsed, frames: samples.length, startingDebtMs: started.debt, endingDebtMs: window.__game.cadence.debt,
        ticksPerSecond: (ctx.state.frameCount - started.tick) * 1000 / elapsed,
        droppedMs: samples.reduce((sum, s) => sum + s.dropped, 0), buckets, fixedTicks,
        activeChunks: ctx.world.activity.activeChunks, sleepingChunks: ctx.world.activity.sleepingChunks,
        coarseChunks: ctx.world.activity.coarseChunks, gpuComposeRequested: ctx.state.postFx.gpuCompose,
        enemies: ctx.enemies.length, fauna: ctx.critters.list.length, playerAlive: !ctx.player.dead };
    }, { started, level });
    report.scenes.push(scene); console.log(JSON.stringify(scene));
    assert.equal(scene.playerAlive, true, `${level} must remain a live gameplay scene throughout timing`);
    await page.screenshot({ path: `${output}/performance-${level}.png` });
  }
  report.acceptance = report.scenes.map(scene => ({ level: scene.level,
    cadence: scene.buckets.interval.p95 <= 18 && scene.buckets.interval.p99 <= 25,
    simulationRate: scene.ticksPerSecond >= 59 && scene.droppedMs === 0 && scene.endingDebtMs <= scene.startingDebtMs + 1000 / 60,
    materialBudget: scene.fixedTicks.sim.p95 <= 4,
    creatureBudget: scene.fixedTicks.creatures.p95 <= 2,
    gameplayBudget: scene.fixedTicks.gameplay.p95 <= 1.5,
    renderPreparationBudget: scene.buckets.submission.p95 <= 3,
    uiBudget: scene.buckets.ui.p95 <= .5,
  }));
  if (duration >= 60 && report.acceptance.some(gate => Object.entries(gate).some(([key, value]) => key !== 'level' && value === false))) process.exitCode = 1;
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(`${output}/performance-${duration}s.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5182/';
const output = 'verify-out/living-descent';
mkdirSync(output, { recursive: true });
const browser = await launchBrowser({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
const report = { url, errors, checkpoints: [], cadence: null, restored: null };
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await waitForConsoleApi(page);
  await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run new --seed 777');
  await waitForRunReady(page);
  await page.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await execConsoleCommand(page, 'run save');
    const queuedMs = performance.now() - start;
    const saved = await page.evaluate(() => window.__game.ctx.levels.flushSaves());
    assert.equal(saved.state, 'ready', saved.error ?? 'Checkpoint must durably finish');
    assert.ok(saved.revision > 0);
    report.checkpoints.push({ queuedMs, completedMs: performance.now() - start, ...saved });
  }
  report.cadence = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    window.__perfRecord = true;
    window.__perfSamples = [];
    const started = performance.now();
    const firstTick = ctx.state.frameCount;
    await new Promise((resolve) => setTimeout(resolve, 5000));
    window.__perfRecord = false;
    const elapsed = performance.now() - started;
    const samples = window.__perfSamples;
    const intervals = samples.map((sample) => sample.interval).sort((a, b) => a - b);
    return { elapsed, ticksPerSecond: (ctx.state.frameCount - firstTick) * 1000 / elapsed,
      intervalP95: intervals[Math.floor(intervals.length * 0.95)],
      droppedMs: samples.reduce((sum, sample) => sum + sample.dropped, 0), frames: samples.length };
  });
  await execConsoleCommand(page, 'run save');
  await page.evaluate(() => window.__game.ctx.levels.flushSaves());
  await page.reload({ waitUntil: 'networkidle' });
  await waitForConsoleApi(page);
  await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run continue');
  await waitForRunReady(page);
  report.restored = await page.evaluate(() => ({
    status: window.__game.ctx.levels.runStatus(window.__game.ctx),
    persistence: window.__game.ctx.levels.persistenceStatus(),
    minds: window.__game.ctx.enemies.filter((enemy) => enemy.mind).length,
  }));
  assert.equal(report.restored.status.worldSeed, 777);
  assert.ok(report.restored.persistence.revision >= report.checkpoints.at(-1).revision);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${output}/runtime-foundations.png` });
  writeFileSync(`${output}/runtime-foundations.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  writeFileSync(`${output}/runtime-foundations.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

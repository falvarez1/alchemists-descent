// Repeatable worst-case perf scene + autosave hitch benchmark.
// Usage: node scripts/perf-scene.mjs <label> [url] [runs] [frames]
// Writes verify-out/perf-<label>.json. If verify-out/perf-before.json exists
// and label !== "before", prints a Welch t-test comparison per bucket.
// PERF_GPU_COMPOSE=1 enables the GPU frame-composition flag for the run,
// PERF_GPU_COMPOSE=0 disables it, and PERF_GPU_COMPOSE=current leaves the
// current app setting untouched
// (cross-session comparison only — scripts/perf-ab-compose.mjs is the
// drift-proof same-session A/B).
import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';
import {
  addSampleBuckets,
  collectBackendCapabilities,
  collectWebGpuAdapterCapabilities,
  currentCommandLine,
  currentGitCommit,
  currentGitState,
  emptyBuckets,
  newBenchmarkPage,
  printBucketSummary,
  summarizeBuckets,
  welchT,
  writeJson,
} from './perf-harness.mjs';

const label = process.argv[2] ?? 'before';
const url = process.argv[3] ?? 'http://localhost:5173/';
const RUNS = Number(process.argv[4] ?? 3);
const FRAMES = Number(process.argv[5] ?? 700);
const GPU_COMPOSE_MODE = process.env.PERF_GPU_COMPOSE ?? 'current';
if (!['0', '1', 'current'].includes(GPU_COMPOSE_MODE)) {
  throw new Error('PERF_GPU_COMPOSE must be 0, 1, or current');
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const all = emptyBuckets(['autosaveMs', 'heapUsedDeltaMB', 'heapTotalDeltaMB']);
let firstRunCapabilities = null;
let webgpuCapabilities = null;
const gpuComposeRuns = [];

for (let run = 0; run < RUNS; run++) {
  const page = await newBenchmarkPage(browser, { diagnosticsLabel: `perf-scene-${run + 1}` });
  page.on('pageerror', (e) => console.error('PAGE ERROR:', String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await startConsoleTestRun(page, { seed: 777, settleMs: 1500 });
  const gpuComposeAppliedBeforeScene = await page.evaluate((mode) => {
    const ctx = window.__game.ctx;
    if (mode === '1') ctx.state.postFx.gpuCompose = true;
    else if (mode === '0') ctx.state.postFx.gpuCompose = false;
    return Boolean(ctx.state.postFx.gpuCompose);
  }, GPU_COMPOSE_MODE);
  firstRunCapabilities ??= await collectBackendCapabilities(page, 'current');
  webgpuCapabilities ??= await collectWebGpuAdapterCapabilities(page);

  const result = await page.evaluate(
    async ({ FRAMES }) => {
      const ctx = window.__game.ctx;

      const w = ctx.world;
      const px = Math.floor(ctx.player.x);
      const py = Math.floor(ctx.player.y);
      const writeCell = (x, y, type, color, life = 0, charge = 0) => {
        if (!w.inBounds(x, y)) return;
        const i = w.idx(x, y);
        w.types[i] = type;
        w.colors[i] = color;
        w.life[i] = life;
        w.charge[i] = charge;
      };
      ctx.player.hp = 999999;
      ctx.player.maxHp = 999999;
      ctx.player.invuln = 999999;
      ctx.enemies.length = 0;
      ctx.projectiles.length = 0;
      ctx.shockwaves.length = 0;
      if (ctx.lightning?.arcs) ctx.lightning.arcs.length = 0;
      ctx.particles.clear();
      if (ctx.levels.current?.authoredLights) ctx.levels.current.authoredLights.length = 0;

      // ---- CHAOS SCENE (fixed layout relative to spawn) ----
      // big cavity so everything interacts on screen
      for (let dx = -120; dx <= 120; dx++) {
        for (let dy = -70; dy <= 20; dy++) {
          const X = px + dx,
            Y = py + dy;
          if (!w.inBounds(X, Y)) continue;
          const edge = Math.abs(dx) === 120 || dy === 20 || dy === -70;
          if (edge) {
            writeCell(X, Y, 13, 0x606870);
          } else {
            writeCell(X, Y, 0, 0x08080c);
          }
        }
      }
      // floor
      for (let dx = -119; dx <= 119; dx++) {
        writeCell(px + dx, py + 19, 12, 0x8a8a92);
      }
      // water slab (left), lava slab (right) -> permanent steam front
      for (let dx = -110; dx <= -40; dx++)
        for (let dy = -60; dy <= -40; dy++) {
          writeCell(px + dx, py + dy, 2, 0x1e8ce6);
        }
      for (let dx = 40; dx <= 110; dx++)
        for (let dy = -60; dy <= -40; dy++) {
          writeCell(px + dx, py + dy, 11, 0xfc3c08);
        }
      // oil pond + sand columns mid-air
      for (let dx = -30; dx <= 30; dx++)
        for (let dy = 10; dy <= 16; dy++) {
          writeCell(px + dx, py + dy, 6, 0x55401e);
        }
      for (const cx of [-70, 0, 70])
        for (let dy = -35; dy <= -20; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            writeCell(px + cx + dx, py + dy, 1, 0xd2b45e);
          }
      // ignite the oil
      for (let dx = -3; dx <= 3; dx++) {
        writeCell(px + dx, py + 9, 5, 0xe65c00, 90);
      }
      // hostile crowd
      const roster = [
        ['slime', -80], ['slime', -60], ['slime', 60], ['slime', 80],
        ['imp', -50], ['imp', 50], ['imp', 90],
        ['golem', -90], ['golem', 95],
        ['bat', -30], ['bat', 30], ['bat', 0],
        ['spitter', -100], ['spitter', 100],
      ];
      for (const [kind, dx] of roster) ctx.enemyCtl.spawn(kind, px + dx, py + 10);

      // scripted explosions during recording keep particle pressure high
      const offsets = [-90, -45, 0, 45, 90];
      let bomb = 0;
      const bomber = setInterval(() => {
        ctx.explosions.trigger(px + offsets[bomb % offsets.length], py - 10 - (bomb % 3) * 12, 11);
        bomb++;
      }, 700);

      await new Promise((r) => setTimeout(r, 1500)); // warm-up / JIT
      const readHeap = () => {
        const memory = performance.memory;
        return memory
          ? {
              usedJSHeapSize: memory.usedJSHeapSize,
              totalJSHeapSize: memory.totalJSHeapSize,
              jsHeapSizeLimit: memory.jsHeapSizeLimit,
            }
          : null;
      };
      const heapBeforeRecord = readHeap();

      window.__perfSamples = [];
      window.__perfRecord = true;
      await new Promise((resolve) => {
        const check = () => {
          if ((window.__perfSamples?.length ?? 0) >= FRAMES) resolve();
          else setTimeout(check, 200);
        };
        check();
      });
      window.__perfRecord = false;
      clearInterval(bomber);
      const samples = window.__perfSamples;
      const heapAfterRecord = readHeap();

      // ---- AUTOSAVE HITCH: visit 5 levels, then time saveExpedition ----
      for (const id of ['d2', 'd3', 'd4', 'd5']) {
        ctx.levels.leaveLevel();
        ctx.levels.enterLevel(ctx, id);
        await new Promise((r) => setTimeout(r, 250));
      }
      const saves = [];
      for (let k = 0; k < 5; k++) {
        const t0 = performance.now();
        ctx.levels.saveExpedition(ctx);
        saves.push(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 120));
      }
      const heapAfterSaves = readHeap();
      return {
        samples,
        saves,
        heap: {
          beforeRecord: heapBeforeRecord,
          afterRecord: heapAfterRecord,
          afterSaves: heapAfterSaves,
        },
        particles: ctx.particles.list?.length ?? -1,
        enemies: ctx.enemies.length,
        projectiles: ctx.projectiles.length,
        authoredLights: ctx.levels.current?.authoredLights?.length ?? 0,
        gpuComposeApplied: Boolean(ctx.state.postFx.gpuCompose),
      };
    },
    { FRAMES },
  );

  addSampleBuckets(all, result.samples);
  all.autosaveMs.push(...result.saves);
  const heapBefore = result.heap.beforeRecord;
  const heapAfter = result.heap.afterSaves ?? result.heap.afterRecord;
  if (heapBefore && heapAfter) {
    all.heapUsedDeltaMB.push((heapAfter.usedJSHeapSize - heapBefore.usedJSHeapSize) / (1024 * 1024));
    all.heapTotalDeltaMB.push((heapAfter.totalJSHeapSize - heapBefore.totalJSHeapSize) / (1024 * 1024));
  }
  gpuComposeRuns.push({
    run: run + 1,
    requested: GPU_COMPOSE_MODE,
    appliedBeforeScene: gpuComposeAppliedBeforeScene,
    appliedAfterScene: result.gpuComposeApplied,
  });
  console.log(
    `run ${run + 1}/${RUNS}: ${result.samples.length} frames, autosave [${result.saves
      .map((v) => v.toFixed(1))
      .join(', ')}]ms, gpuCompose=${result.gpuComposeApplied}`,
  );
  await page.context().close();
}
await browser.close();

const summaryKeys = [
  'sim',
  'entities',
  'compose',
  'gl',
  'render',
  'frame',
  'autosaveMs',
  'heapUsedDeltaMB',
  'heapTotalDeltaMB',
];
const summary = summarizeBuckets(all, summaryKeys);

const payload = {
  createdAt: new Date().toISOString(),
  commit: currentGitCommit(),
  git: currentGitState(),
  command: currentCommandLine(),
  label,
  url,
  runs: RUNS,
  frames: FRAMES,
  gpuCompose: {
    requested: GPU_COMPOSE_MODE,
    runs: gpuComposeRuns,
  },
  scenario: 'chaos',
  seed: 777,
  capabilities: {
    initial: firstRunCapabilities,
    webgpuAdapter: webgpuCapabilities,
  },
  summary,
  raw: all,
};
writeJson(`verify-out/perf-${label}.json`, payload);
writeJson(`verify-out/perf-${label}-${Date.now()}.json`, payload);

printBucketSummary(label, summary, summaryKeys);

if (label !== 'before' && existsSync('verify-out/perf-before.json')) {
  const before = JSON.parse(readFileSync('verify-out/perf-before.json', 'utf8'));
  console.log('\n=== WELCH T-TEST vs BEFORE (negative t = faster now) ===');
  for (const k of summaryKeys) {
    const a = before.raw[k] ?? [];
    const b = all[k];
    if (a.length === 0 || b.length === 0) continue;
    const result = welchT(a, b);
    console.log(
      `${k.padEnd(10)} ${result.control.mean.toFixed(3)} -> ${result.variant.mean.toFixed(3)}ms  (${
        result.pct >= 0 ? '+' : ''
      }${result.pct.toFixed(1)}%)  t=${result.t.toFixed(1)}  ${result.sig}`,
    );
  }
}

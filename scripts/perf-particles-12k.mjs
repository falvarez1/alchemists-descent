// Measure real in-engine frame cost of a sustained high particle population on
// the current AoS Particles, isolating the particle delta: record buckets with
// 0 particles (baseline), then with ~12k held alive, same scene/session.
// Usage: node scripts/perf-particles-12k.mjs [count] [frames]
import { chromium } from 'playwright-core';
import {
  newBenchmarkPage,
  summarizeBuckets,
  addSampleBuckets,
  emptyBuckets,
  printBucketSummary,
  writeJson,
  evaluateSummaryThresholds,
  parseThresholdEnv,
  printThresholdFailures,
} from './perf-harness.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const COUNT = Number(process.argv[3] ?? 12000);
const FRAMES = Number(process.argv[4] ?? 300);
const SUMMARY_THRESHOLDS = parseThresholdEnv('PERF_PARTICLE_THRESHOLDS');
const MAX_PARTICLE_DELTA_MS = parseThresholdEnv('PERF_PARTICLE_DELTA_MS');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await newBenchmarkPage(browser, { diagnosticsLabel: 'perf-12k' });
page.on('pageerror', (e) => console.error('PAGE ERROR:', String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await startConsoleTestRun(page, { seed: 777, settleMs: 1500 });

async function record(label, setup) {
  await page.evaluate(setup, { COUNT });
  await page.waitForTimeout(400); // settle
  const samples = await page.evaluate(async (FRAMES) => {
    window.__perfSamples = [];
    window.__perfRecord = true;
    await new Promise((resolve) => {
      const check = () => ((window.__perfSamples?.length ?? 0) >= FRAMES ? resolve() : setTimeout(check, 100));
      check();
    });
    window.__perfRecord = false;
    return { samples: window.__perfSamples, live: window.__game.ctx.particles.list.length };
  }, FRAMES);
  const buckets = emptyBuckets();
  addSampleBuckets(buckets, samples.samples);
  const summary = summarizeBuckets(buckets);
  console.log(`\n--- ${label} (live particles: ${samples.live}) ---`);
  printBucketSummary(label, summary, ['sim', 'entities', 'compose', 'gl', 'render', 'frame']);
  return summary;
}

const baseline = await record('BASELINE (0 particles)', () => {
  window.__game.ctx.particles.clear();
});

const loaded = await record('LOADED (~12k particles)', ({ COUNT }) => {
  const ctx = window.__game.ctx;
  ctx.particles.clear();
  ctx.particles.pool.max = COUNT + 1000; // robust vs HMR state
  const w = ctx.world;
  const cx = Math.floor(ctx.camera.x), cy = Math.floor(ctx.camera.y);
  const canvas = document.querySelector('canvas');
  const VW = Math.max(1, Math.floor((canvas?.width ?? 1050) / 2));
  const VH = Math.max(1, Math.floor((canvas?.height ?? 714) / 2));
  let placed = 0;
  for (let attempt = 0; attempt < COUNT * 8 && placed < COUNT; attempt++) {
    const x = cx + (Math.random() * VW | 0), y = cy + (Math.random() * VH | 0);
    if (!w.inBounds(x, y) || w.types[w.idx(x, y)] !== 0) continue;
    const spark = Math.random() < 0.5;
    const color = spark ? 0xff8c1e : (130 + (Math.random() * 80 | 0)) << 16 | 0x2020;
    ctx.particles.spawn(x + 0.5, y + 0.5, 0, 0, null, color, 99999, { grav: 0, glow: spark ? 1.2 : 0.0 });
    placed++;
  }
});

console.log('\n=== PARTICLE DELTA (12k − baseline), per frame ===');
const thresholdFailures = evaluateSummaryThresholds(loaded, SUMMARY_THRESHOLDS);
for (const k of ['sim', 'entities', 'compose', 'gl', 'render', 'frame']) {
  const d = loaded[k].mean - baseline[k].mean;
  const limit = MAX_PARTICLE_DELTA_MS?.[k];
  if (Number.isFinite(limit) && d > limit) thresholdFailures.push(`${k}.deltaMean ${d.toFixed(3)}ms > ${limit}ms`);
  console.log(`${k.padEnd(10)} ${baseline[k].mean.toFixed(3)} -> ${loaded[k].mean.toFixed(3)}ms   Δ ${d >= 0 ? '+' : ''}${d.toFixed(3)}ms`);
}
writeJson('verify-out/perf-particles-12k.json', { createdAt: new Date().toISOString(), count: COUNT, frames: FRAMES, baseline, loaded });

await page.context().close();
await browser.close();
console.log('\nwrote verify-out/perf-particles-12k.json');
printThresholdFailures('perf-particles-12k', thresholdFailures);
if (thresholdFailures.length > 0) process.exitCode = 1;

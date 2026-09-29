// The multithreaded Sandbox sweep (docs/SANDBOX-MT.md), in the real game.
//
// 1. isolation + workers: crossOriginIsolated, the parallel sweep ready and
//    handling the Sandbox world;
// 2. a flood scene (sand/water/oil bands over a fire line, a whole view wide)
//    recorded with the sweep serial (parallel.enabled = false) and parallel,
//    interleaved in blocks, on the SAME shared world — sim ms per tick;
// 3. screenshots of both.
//
// Usage: node scripts/probe-sandbox-mt.mjs [--url http://127.0.0.1:5191/] [--threads N] [--frames 240] [--blocks 2]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const BASE = arg('url', 'http://127.0.0.1:5191/');
const THREADS = arg('threads', 'auto');
const FRAMES = Number(arg('frames', 240));
const BLOCKS = Number(arg('blocks', 2));
const SCENE = arg('scene', 'flood');
const HEADED = argv.includes('--headed');
mkdirSync('verify-out', { recursive: true });

const browser = await launchBrowser({ headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.text().includes('[sandbox-mt]')) console.log(`  [page:${msg.type()}] ${msg.text()}`);
});

const url = `${BASE}?threads=${THREADS}`;
console.log('navigating to', url);
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.locator('#expedition-entry').waitFor({ state: 'visible', timeout: 30000 });
if (!(await page.locator('#expedition-entry .entry-workshops').evaluate((d) => d.open))) {
  await page.locator('#expedition-entry .entry-workshops > summary').click();
}
await page.locator('#expedition-entry [data-entry="sandbox"]').click();
await page.locator('#expedition-entry').waitFor({ state: 'hidden', timeout: 10000 });
await page.waitForTimeout(1500);

const status = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const p = ctx.simulation.parallel;
  return {
    crossOriginIsolated: window.crossOriginIsolated,
    cores: navigator.hardwareConcurrency,
    mode: ctx.state.mode,
    hasParallel: !!p,
    threads: p?.threads ?? 0,
    ready: p?.ready ?? false,
    failure: p?.failure ?? null,
    handles: p ? p.handles(ctx.world) : false,
    substeps: p?.stats.substeps ?? 0,
    sharedWorld: ctx.world.types.buffer instanceof SharedArrayBuffer,
  };
});
console.log('status', JSON.stringify(status));
const SERIAL_ONLY = String(THREADS) === '0';
if (!SERIAL_ONLY && (!status.crossOriginIsolated || !status.handles)) {
  console.error('FAIL: the parallel sweep is not handling the Sandbox world');
  await browser.close();
  process.exit(1);
}

// ---------------------------------------------------------------- scene
async function buildScene() {
  return page.evaluate((scene) => {
    const ctx = window.__game.ctx, world = ctx.world;
    ctx.particles.clear();
    const writeCell = (x, y, type, color, life = 0) => {
      if (!world.inBounds(x, y)) return;
      const i = world.idx(x, y);
      world.types[i] = type; world.colors[i] = color; world.life[i] = life; world.charge[i] = 0;
      world.activity.touchIndex(i);
    };
    // A sealed metal box one view wide in the middle of the world.
    const cx = 800, floorY = 900, W = 640, H = 340;
    for (let x = cx - W / 2 - 1; x <= cx + W / 2 + 1; x++) for (let y = floorY - H - 1; y <= floorY + 1; y++) {
      const edge = x <= cx - W / 2 - 1 || x >= cx + W / 2 + 1 || y <= floorY - H - 1 || y >= floorY;
      writeCell(x, y, edge ? 13 : 0, edge ? 0x606870 : 0x08080c);
    }
    const X0 = cx - W / 2, X1 = cx + W / 2 - 1, Y0 = floorY - H;
    let cells = 0;
    if (scene === 'flood') {
      for (let x = X0; x <= X1; x++) for (let y = Y0; y < Y0 + 90; y++) {
        const band = (((x - X0) / 40) | 0) % 3;
        const t = band === 0 ? 1 : band === 1 ? 2 : 6;
        writeCell(x, y, t, t === 1 ? 0xd2b45e : t === 2 ? 0x1e8ce6 : 0x55401e);
        cells++;
      }
      for (let x = X0; x <= X1; x += 3) writeCell(x, Y0 + 91, 5, 0xe65c00, 90);
    } else if (scene === 'pool') {
      // a deep water tank draining through a slot into a basin: pressure flow
      for (let x = X0; x <= X1; x++) for (let y = Y0; y < Y0 + 200; y++) {
        if (x < X0 + 300) { writeCell(x, y, 2, 0x1e8ce6); cells++; }
      }
      for (let y = Y0; y < floorY - 12; y++) writeCell(X0 + 300, y, 13, 0x606870);
    }
    ctx.camera.x = ctx.camera.tx = cx - 320; ctx.camera.y = ctx.camera.ty = floorY - H + 10;
    return { cells };
  }, SCENE);
}

async function record(parallelOn) {
  await page.evaluate((on) => { const p = window.__game.ctx.simulation.parallel; if (p) p.enabled = on; }, parallelOn);
  await buildScene();
  await page.waitForTimeout(700);
  return page.evaluate(async (FRAMES) => {
    const ctx = window.__game.ctx, sim = ctx.simulation, p = sim.parallel ?? { enabled: false, stats: {} };
    const samples = [];
    const origProcess = sim.processFrame.bind(sim);
    let acc = 0, n = 0;
    sim.processFrame = (c) => { const t0 = performance.now(); origProcess(c); acc += performance.now() - t0; n++; phase.ticks++; };
    // phase split: activity reclassify, flow decay, the sweep call
    const phase = { activity: 0, flush: 0, flow: 0, sweep: 0, electrical: 0, ticks: 0 };
    const wrap = (obj, key, bucket) => {
      const orig = obj[key];
      obj[key] = function (...args) { const t = performance.now(); const r = orig.apply(this, args); phase[bucket] += performance.now() - t; return r; };
      return () => { obj[key] = orig; };
    };
    const unwrap = [wrap(ctx.world.activity, 'beginStep', 'activity'), wrap(ctx.world.activity, 'flushTouches', 'flush'), wrap(ctx.world.flow, 'beginStep', 'flow')];
    if (sim.parallel) unwrap.push(wrap(sim.parallel, 'sweep', 'sweep'));
    const stats = { sweep: 0, wait: 0, merge: 0, chunks: 0, mainChunks: 0, count: 0 };
    const t0 = performance.now();
    let frames = 0;
    await new Promise((resolve) => {
      const tick = () => {
        frames++;
        if (n > 0) { samples.push(acc / n); acc = 0; n = 0; }
        if (p.enabled) {
          stats.sweep += p.stats.sweepMs; stats.wait += p.stats.waitMs; stats.merge += p.stats.mergeMs;
          stats.chunks += p.stats.chunks; stats.mainChunks += p.stats.mainChunks; stats.count++;
        }
        if (samples.length >= FRAMES) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    sim.processFrame = origProcess;
    for (const u of unwrap) u();
    const wall = performance.now() - t0;
    const sorted = [...samples].sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const k = Math.max(1, stats.count);
    return {
      mean, p50: sorted[sorted.length >> 1], p95: sorted[Math.floor(sorted.length * 0.95)],
      fps: frames / (wall / 1000),
      phase: Object.fromEntries(Object.entries(phase).map(([k, v]) => [k, v / phase.ticks])),
      parallel: p.enabled ? {
        sweepMs: stats.sweep / k, waitMs: stats.wait / k, mergeMs: stats.merge / k,
        chunks: stats.chunks / k, mainChunks: stats.mainChunks / k,
      } : null,
      samples,
    };
  }, FRAMES);
}

const results = { serial: [], parallel: [] };
for (let b = 0; b < BLOCKS; b++) {
  const order = SERIAL_ONLY ? [false] : b % 2 === 0 ? [false, true] : [true, false];
  for (const on of order) {
    const r = await record(on);
    results[on ? 'parallel' : 'serial'].push(r);
    console.log(`  block ${b} ${on ? 'parallel' : 'serial  '}: sim ${r.mean.toFixed(2)} ms/tick (p50 ${r.p50.toFixed(2)}, p95 ${r.p95.toFixed(2)}) fps ${r.fps.toFixed(0)}` +
      `  {activity ${r.phase.activity.toFixed(2)} (flush ${r.phase.flush.toFixed(2)}) flow ${r.phase.flow.toFixed(2)} sweepCall ${r.phase.sweep.toFixed(2)}}` +
      (r.parallel ? `  [main sweep ${r.parallel.sweepMs.toFixed(2)} wait ${r.parallel.waitMs.toFixed(2)} merge ${r.parallel.mergeMs.toFixed(2)} chunks ${r.parallel.chunks.toFixed(1)} (main ${r.parallel.mainChunks.toFixed(1)})]` : ''));
  }
}
const pool = (rs) => rs.flatMap((r) => r.samples);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const s = mean(pool(results.serial)), p = SERIAL_ONLY ? NaN : mean(pool(results.parallel));
console.log(`\n${SCENE} threads=${status.threads}: serial ${s.toFixed(2)} ms/tick -> parallel ${p.toFixed(2)} ms/tick  (${(s / p).toFixed(2)}x)`);

await page.evaluate(() => { const p = window.__game.ctx.simulation.parallel; if (p) p.enabled = true; });
await buildScene();
await page.waitForTimeout(1500);
await page.screenshot({ path: `verify-out/sandbox-mt-${SCENE}.png` });
writeFileSync(`verify-out/sandbox-mt-${SCENE}-t${status.threads}.json`, JSON.stringify({ status, results: {
  serial: results.serial.map(({ samples, ...r }) => r), parallel: results.parallel.map(({ samples, ...r }) => r),
}, serialMean: s, parallelMean: p }, null, 2));
if (errors.length) console.log('page errors:', errors);
await browser.close();

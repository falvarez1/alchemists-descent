// Same-session A/B for GPU frame composition (perf ticket #8): one page, the
// perf-scene chaos layout, alternating CPU/GPU measurement blocks so machine
// drift (±3-5% between sessions) cancels out. Welch t-test per bucket.
// Usage: node scripts/perf-ab-compose.mjs [url] [framesPerBlock] [blocks]
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const FRAMES = Number(process.argv[3] ?? 360);
const BLOCKS = Number(process.argv[4] ?? 4); // per mode, interleaved

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR:', String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await startConsoleTestRun(page, { seed: 777, settleMs: 1500 });

const result = await page.evaluate(
  async ({ FRAMES, BLOCKS }) => {
    const ctx = window.__game.ctx;

    const w = ctx.world;
    const px = Math.floor(ctx.player.x);
    const py = Math.floor(ctx.player.y);
    ctx.player.hp = 999999;
    ctx.player.maxHp = 999999;
    ctx.player.invuln = 999999;

    // ---- the perf-scene chaos layout (kept identical for comparability) ----
    for (let dx = -120; dx <= 120; dx++) {
      for (let dy = -70; dy <= 20; dy++) {
        const X = px + dx,
          Y = py + dy;
        if (!w.inBounds(X, Y)) continue;
        const i = w.idx(X, Y);
        const edge = Math.abs(dx) === 120 || dy === 20 || dy === -70;
        if (edge) {
          w.types[i] = 13;
          w.colors[i] = 0x606870;
        } else if (w.types[i] !== 0) {
          w.types[i] = 0;
          w.colors[i] = 0x08080c;
        }
      }
    }
    for (let dx = -119; dx <= 119; dx++) w.types[w.idx(px + dx, py + 19)] = 12;
    for (let dx = -110; dx <= -40; dx++)
      for (let dy = -60; dy <= -40; dy++) {
        const i = w.idx(px + dx, py + dy);
        w.types[i] = 2;
        w.colors[i] = 0x1e8ce6;
      }
    for (let dx = 40; dx <= 110; dx++)
      for (let dy = -60; dy <= -40; dy++) {
        const i = w.idx(px + dx, py + dy);
        w.types[i] = 11;
        w.colors[i] = 0xfc3c08;
      }
    for (let dx = -30; dx <= 30; dx++)
      for (let dy = 10; dy <= 16; dy++) {
        const i = w.idx(px + dx, py + dy);
        w.types[i] = 6;
        w.colors[i] = 0x55401e;
      }
    for (const cx of [-70, 0, 70])
      for (let dy = -35; dy <= -20; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const i = w.idx(px + cx + dx, py + dy);
          w.types[i] = 1;
          w.colors[i] = 0xd2b45e;
        }
    for (let dx = -3; dx <= 3; dx++) {
      const i = w.idx(px + dx, py + 9);
      w.types[i] = 5;
      w.life[i] = 90;
    }
    const roster = [
      ['slime', -80], ['slime', -60], ['slime', 60], ['slime', 80],
      ['imp', -50], ['imp', 50], ['imp', 90],
      ['golem', -90], ['golem', 95],
      ['bat', -30], ['bat', 30], ['bat', 0],
      ['spitter', -100], ['spitter', 100],
    ];
    for (const [kind, dx] of roster) ctx.enemyCtl.spawn(kind, px + dx, py + 10);
    const offsets = [-90, -45, 0, 45, 90];
    let bomb = 0;
    const bomber = setInterval(() => {
      ctx.explosions.trigger(px + offsets[bomb % offsets.length], py - 10 - (bomb % 3) * 12, 11);
      bomb++;
    }, 700);

    await new Promise((r) => setTimeout(r, 1500)); // warm-up / JIT

    const recordBlock = async (gpu) => {
      ctx.state.postFx.gpuCompose = gpu;
      await new Promise((r) => setTimeout(r, 300)); // settle after the toggle
      window.__perfSamples = [];
      window.__perfRecord = true;
      await new Promise((resolve) => {
        const check = () => {
          if ((window.__perfSamples?.length ?? 0) >= FRAMES) resolve();
          else setTimeout(check, 100);
        };
        check();
      });
      window.__perfRecord = false;
      return window.__perfSamples;
    };

    const cpu = { sim: [], render: [], compose: [], gl: [], frame: [] };
    const gpu = { sim: [], render: [], compose: [], gl: [], frame: [] };
    for (let b = 0; b < BLOCKS; b++) {
      for (const [mode, sink] of [[false, cpu], [true, gpu]]) {
        const samples = await recordBlock(mode);
        for (const s of samples) {
          sink.sim.push(s.sim);
          sink.render.push(s.render);
          sink.compose.push(s.compose ?? 0);
          sink.gl.push(s.gl ?? 0);
          sink.frame.push(s.frame);
        }
      }
    }
    clearInterval(bomber);
    return { cpu, gpu, gpuAvailable: true };
  },
  { FRAMES, BLOCKS },
);
await browser.close();

const stats = (arr) => {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const sorted = [...arr].sort((a, b) => a - b);
  return { n, mean, sd, p50: sorted[Math.floor(n * 0.5)], p95: sorted[Math.floor(n * 0.95)] };
};

console.log(`\n=== SAME-SESSION A/B (${BLOCKS} interleaved blocks x ${FRAMES} frames each) ===`);
console.log('bucket       CPU mean    GPU mean    delta       t       p');
let ok = true;
for (const k of ['sim', 'render', 'compose', 'gl', 'frame']) {
  const a = stats(result.cpu[k]);
  const b = stats(result.gpu[k]);
  const t = (b.mean - a.mean) / Math.sqrt((a.sd * a.sd) / a.n + (b.sd * b.sd) / b.n);
  const sig = Math.abs(t) > 3.29 ? 'p<0.001' : Math.abs(t) > 1.96 ? 'p<0.05' : 'ns';
  console.log(
    `${k.padEnd(10)} ${a.mean.toFixed(3).padStart(8)}ms ${b.mean.toFixed(3).padStart(8)}ms ${(b.mean - a.mean >= 0 ? '+' : '') + (b.mean - a.mean).toFixed(3).padStart(7)}ms t=${t.toFixed(1).padStart(6)}  ${sig}`,
  );
  if (k === 'sim' && t > 3.29) ok = false; // sim must not regress
}
const dRender = stats(result.gpu.render).mean - stats(result.cpu.render).mean;
console.log(`\nrender bucket delta: ${dRender.toFixed(2)}ms (gate: <= -3.0ms)`);
process.exit(ok && dRender <= -3.0 ? 0 : 1);

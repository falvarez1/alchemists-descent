// GPU particle parity probe (render/GpuFxLayer). One frozen frame, drawn with
// postFx.gpuParticles on (GPU points in the FX layer) and off (FxSprites
// setPx into the overlay), read back and diffed. Particles cover the cases
// that matter: self-lit (glow) and light-sampled motes, overlapping motes
// (last write in list order must win), motes over terrain and over open air,
// and motes under the player sprite (the overlay must still draw on top).
//
// Rig: sim paused (rendering continues), frameCount frozen, postFx off (raw
// frame), Math.random pinned and shader flicker pinned, so the only
// difference between the two captures is the particle path.
//
// Usage: node scripts/probe-gpu-particles.mjs [url]   (dev server running)
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { readCanvasPixels, diffPixelSnapshots, captureCanvasPng } from './perf-harness.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5190/';
const outDir = 'verify-out/gpu-particles';
mkdirSync(outDir, { recursive: true });

const browser = await launchBrowser({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await startConsoleTestRun(page, { seed: 777, level: 'physics-test', settleMs: 2000 });

const info = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  ctx.enemies.length = 0;
  ctx.projectiles.length = 0;
  ctx.particles.clear();
  const px = 800, floorY = 690;
  // A stone shelf with an open cave above it; part of the view stays terrain.
  for (let x = px - 200; x <= px + 200; x++) for (let y = floorY - 160; y <= floorY + 1; y++) {
    const i = w.idx(x, y);
    const solid = y >= floorY || (x > px + 90 && y > floorY - 60);
    w.types[i] = solid ? 12 : 0; w.colors[i] = solid ? 0x8a8a92 : 0x08080c; w.life[i] = 0; w.charge[i] = 0;
    w.activity.touchIndex(i);
  }
  ctx.player.x = px; ctx.player.y = floorY - 1; ctx.player.vx = ctx.player.vy = 0;
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  // 3000 motes across the view: half self-lit embers, half light-sampled grit.
  for (let n = 0; n < 3000; n++) {
    const glow = n % 2 === 0;
    const color = glow ? 0xff8c1e : (((110 + ((rnd() * 120) | 0)) << 16) | (((60 + ((rnd() * 80) | 0))) << 8) | 40);
    ctx.particles.spawn(px - 300 + rnd() * 600, floorY - 170 + rnd() * 200, 0, 0, null, color, 1e9, { grav: 0, glow: glow ? 0.6 + rnd() : 0 });
  }
  // Overlapping motes on one cell: the LAST spawned (cyan) must win.
  for (const c of [0xff0000, 0x00ff00, 0x00ffff]) ctx.particles.spawn(px - 40.2, floorY - 40.3, 0, 0, null, c, 1e9, { grav: 0, glow: 1 });
  // Motes right on the player: the sprite overlay must cover them.
  for (let k = 0; k < 40; k++) ctx.particles.spawn(px - 3 + (k % 7), floorY - 14 + (k / 7 | 0), 0, 0, null, 0xffffff, 1e9, { grav: 0, glow: 1.5 });
  return { live: ctx.particles.list.length };
});

// Let the camera settle on the scene, then freeze everything.
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.paused = true;
  let frozen = ctx.state.frameCount;
  Object.defineProperty(ctx.state, 'frameCount', { configurable: true, get: () => frozen, set: () => {} });
  Math.random = () => 0.5;
  window.__composeFlickerMid = true;
  ctx.state.postFx.enabled = false;
});
await page.waitForTimeout(500);

async function capture(gpu, name) {
  await page.evaluate((on) => { window.__game.ctx.state.postFx.gpuParticles = on; }, gpu);
  await page.waitForTimeout(400);
  await captureCanvasPng(page, `${outDir}/${name}.png`);
  return readCanvasPixels(page);
}

const gpuA = await capture(true, 'gpu');
const cpu = await capture(false, 'cpu');
const gpuB = await capture(true, 'gpu-again');

const noise = diffPixelSnapshots(gpuA, gpuB, 0);
const diff = diffPixelSnapshots(gpuA, cpu, 2);
// Where do they differ? (bounding box + a count of big deltas)
let big = 0;
for (let i = 0; i < cpu.data.length; i += 4) {
  const d = Math.max(Math.abs(cpu.data[i] - gpuA.data[i]), Math.abs(cpu.data[i + 1] - gpuA.data[i + 1]), Math.abs(cpu.data[i + 2] - gpuA.data[i + 2]));
  if (d > 24) big++;
}
const gpuUsed = await page.evaluate(() => window.__game.ctx.state.postFx.gpuParticles);
const result = {
  info, gpuUsed,
  noiseFloor: { differingPixels: noise.differingPixels, maxChannelDelta: noise.maxChannelDelta },
  gpuVsCpu: { differingPixels: diff.differingPixels, pct: +diff.differingPixelPct.toFixed(4), maxChannelDelta: diff.maxChannelDelta, meanChannelDelta: +diff.meanChannelDelta.toFixed(4), bigDeltaPixels: big },
  errors,
};
writeFileSync(`${outDir}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
const pass = errors.length === 0 && noise.differingPixels === 0 && big === 0 && diff.differingPixelPct < 0.05;
console.log(pass ? 'PASS gpu particles match the CPU path' : 'FAIL gpu particles differ from the CPU path');
process.exitCode = pass ? 0 : 1;

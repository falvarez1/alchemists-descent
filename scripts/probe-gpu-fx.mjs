// GPU FX parity probe (render/GpuFxLayer). One frozen frame, drawn with the
// GPU paths on (postFx.gpuParticles: particles as GPU points; postFx.gpuOverlay:
// every sprite pixel write scattered on the GPU) and off (FxSprites setPx and
// the staged CPU overlay upload), read back and diffed. The frame carries the
// cases that matter: self-lit and light-sampled motes, overlapping motes (last
// write in list order must win), motes over terrain and open air, motes under
// the player sprite, rigid bodies (Pen art: replace writes) and creatures
// (blitFine: blended gel + additive glow).
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
const outDir = 'verify-out/gpu-fx';
mkdirSync(outDir, { recursive: true });

const browser = await launchBrowser({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await startConsoleTestRun(page, { seed: 777, level: 'physics-test', settleMs: 2000 });

// STRICT=1 leaves the creatures out (they animate at render time), so the
// GPU-vs-CPU diff can be held to the true noise floor.
const STRICT = process.env.STRICT === '1';
const info = await page.evaluate((strict) => {
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
  // Rigid bodies (crates, planks, a keg, boulders) and a few creatures.
  ctx.rigidBodies.clear();
  const mats = ['wood', 'stone', 'metal'];
  for (let k = 0; k < 18; k++) {
    const x = px - 170 + k * 18, y = floorY - 8;
    if (k % 5 === 4) ctx.rigidBodies.spawn({ kind: 'circle', radius: 3 + (k % 3) }, x, y, { material: mats[k % 3] });
    else ctx.rigidBodies.spawn({ kind: 'box', halfW: 3 + (k % 4), halfH: 3 + (k % 3) }, x, y, { material: mats[k % 3], angle: k * 0.3 });
  }
  if (!strict) for (const [kind, dx] of [['slime', -60], ['imp', 60], ['bat', 120], ['golem', -120]]) ctx.enemyCtl.spawn(kind, px + dx, floorY - 2);
  return { live: ctx.particles.list.length, bodies: ctx.rigidBodies.bodies.length, enemies: ctx.enemies.length };
}, STRICT);

// Let the camera settle and the bodies fall asleep (the resting-body art
// cache only serves sleeping bodies), then freeze everything.
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.__game.ctx.rigidBodies.bodies.every((b) => b.sleeping), null, { timeout: 20000 }).catch(() => {});
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
  await page.evaluate((on) => {
    const post = window.__game.ctx.state.postFx;
    post.gpuParticles = on; post.gpuOverlay = on;
  }, gpu);
  await page.waitForTimeout(400);
  await captureCanvasPng(page, `${outDir}/${name}.png`);
  return readCanvasPixels(page);
}

const gpuA = await capture(true, 'gpu');
const cpu = await capture(false, 'cpu');
const gpuB = await capture(true, 'gpu-again');
// Resting-body art: replayed recordings vs drawing every body directly.
const asleep = await page.evaluate(() => window.__game.ctx.rigidBodies.bodies.filter((b) => b.sleeping).length);
await page.evaluate(() => { window.__bodyArtCache = false; window.__game.ctx.state.postFx.gpuParticles = false; });
await page.waitForTimeout(200);
const direct = await capture(true, 'art-direct');
await page.evaluate(() => { window.__bodyArtCache = true; });
const cached = await capture(true, 'art-cached');
const artDiff = diffPixelSnapshots(direct, cached, 0);

const noise = diffPixelSnapshots(gpuA, gpuB, 0);
const diff = diffPixelSnapshots(gpuA, cpu, 2);
// Where do they differ? (bounding box + a count of big deltas)
let big = 0;
for (let i = 0; i < cpu.data.length; i += 4) {
  const d = Math.max(Math.abs(cpu.data[i] - gpuA.data[i]), Math.abs(cpu.data[i + 1] - gpuA.data[i + 1]), Math.abs(cpu.data[i + 2] - gpuA.data[i + 2]));
  if (d > 24) big++;
}
const gpuUsed = await page.evaluate(() => window.__game.ctx.state.postFx.gpuParticles && window.__game.ctx.state.postFx.gpuOverlay);
const result = {
  info, gpuUsed,
  noiseFloor: { differingPixels: noise.differingPixels, maxChannelDelta: noise.maxChannelDelta },
  bodyArtCache: { asleep, differingPixels: artDiff.differingPixels, maxChannelDelta: artDiff.maxChannelDelta },
  gpuVsCpu: { differingPixels: diff.differingPixels, pct: +diff.differingPixelPct.toFixed(4), maxChannelDelta: diff.maxChannelDelta, meanChannelDelta: +diff.meanChannelDelta.toFixed(4), bigDeltaPixels: big },
  errors,
};
writeFileSync(`${outDir}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
// Creatures animate at render time, so two GPU captures already differ a
// little (the noise floor); the GPU-vs-CPU diff must stay within it.
const pass = errors.length === 0 && artDiff.differingPixels <= noise.differingPixels && diff.differingPixels <= Math.max(50, noise.differingPixels * 2) && big <= Math.max(20, noise.differingPixels * 2);
console.log(pass ? 'PASS gpu fx matches the CPU paths' : 'FAIL gpu fx differs from the CPU paths');
process.exitCode = pass ? 0 : 1;

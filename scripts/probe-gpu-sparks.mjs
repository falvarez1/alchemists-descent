// GPU sparks probe (particles/Sparks + render/GpuSparkSim): sets off a blast
// and a lightning strike beside a wall and a floor in the physics arena,
// captures a strip of frames (sparks fan out, bounce, embers rise, smoke
// curls), and fails on any shader/console error. Also reports frame cost
// while a heavy spark storm runs.
// Usage: node scripts/probe-gpu-sparks.mjs [url]   (dev server running)
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { captureCanvasPng } from './perf-harness.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5190/';
const out = 'verify-out/gpu-sparks';
mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
page.on('console', (m) => {
  const t = m.text();
  if ((m.type() === 'error' || /THREE\.WebGLProgram|shader/i.test(t)) && !/Vite server|send error/i.test(t)) errors.push(t.slice(0, 300));
});
await page.goto(url, { waitUntil: 'networkidle' });
await startConsoleTestRun(page, { seed: 777, level: 'physics-test', settleMs: 1500 });
await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world;
  ctx.enemies.length = 0; ctx.rigidBodies.clear(); ctx.particles.clear();
  if (ctx.levels.current) ctx.levels.current.mechanisms.length = 0;
  ctx.player.hp = ctx.player.maxHp = ctx.player.invuln = 999999;
  const px = 800, floorY = 690;
  const cell = (x, y, t, c) => { const i = w.idx(x, y); w.types[i] = t; w.colors[i] = c; w.life[i] = 0; w.charge[i] = 0; w.activity.touchIndex(i); };
  for (let x = px - 250; x <= px + 250; x++) for (let y = floorY - 180; y <= floorY + 1; y++) {
    const wall = x >= px + 60 && x <= px + 70 && y > floorY - 120;
    cell(x, y, y >= floorY || wall ? 12 : 0, y >= floorY || wall ? 0x8a8a92 : 0x08080c);
  }
  ctx.player.x = px - 200; ctx.player.y = floorY - 1;
  ctx.camera.x = ctx.camera.tx = px - 320; ctx.camera.y = ctx.camera.ty = floorY - 250;
});
await page.waitForTimeout(800);
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.explosions.trigger(830, 660, 12);
  ctx.lightning.cast(760, 560, Math.PI / 2);
});
for (const ms of [60, 200, 450, 900, 1600]) {
  await page.waitForTimeout(ms === 60 ? 60 : ms - [60, 200, 450, 900, 1600][[60, 200, 450, 900, 1600].indexOf(ms) - 1]);
  await captureCanvasPng(page, `${out}/blast-${String(ms).padStart(4, '0')}ms.png`);
}
// Storm: a boss-fight's worth of spark emission, measured.
const storm = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const t = setInterval(() => {
    for (let k = 0; k < 4; k++) {
      ctx.sparks.burst(600 + Math.random() * 400, 560 + Math.random() * 100, { count: 400, speed: 3, kind: 'spark', glow: 1.3, colors: [0xffd27a, 0xff8030, 0x80d0ff] });
      ctx.sparks.burst(600 + Math.random() * 400, 600, { count: 100, speed: 1, kind: 'ember', colors: [0xff6a10] });
      ctx.sparks.burst(600 + Math.random() * 400, 640, { count: 120, speed: 0.4, kind: 'smoke', colors: [0x5a5048] });
    }
  }, 50);
  await new Promise((r) => setTimeout(r, 1500));
  window.__perfSamples = []; window.__perfRecord = true;
  await new Promise((r) => setTimeout(r, 3000));
  window.__perfRecord = false; clearInterval(t);
  const s = window.__perfSamples, mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  return { frames: s.length, fps: s.length / 3, frameMs: mean(s.map((x) => x.frame)), composeMs: mean(s.map((x) => x.compose)), requested: ctx.sparks.requested };
});
await captureCanvasPng(page, `${out}/storm.png`);
const result = { storm, errors };
writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exitCode = errors.length ? 1 : 0;

// Surface-flora paint cost, measured in the real compose path on a fresh dev
// server this script starts itself (so edited modules never load twice).
//   node scripts/perf-flora.mjs [--profile] [--frames=40] [--level=d1]
// Prints per-spot ms for the cover plants (front), the ground cover (growth:
// drawSceneFidelity with and without surfaceGrowth) and, with --profile, the
// top self-time functions over the whole measurement.
import { spawn } from 'node:child_process';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, startConsoleTestRun } from './run-helpers.mjs';

const arg = (name, d) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? d;
const profile = process.argv.includes('--profile'), frames = Number(arg('frames', 40)), level = arg('level', 'd1');
const port = 5194;
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
const browser = await launchBrowser();
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 500));
  }
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/?link=off`, { waitUntil: 'networkidle', timeout: 90000 });
  await leaveTitleIfShown(page);
  await startConsoleTestRun(page, { level, world: 'campaign-level', seed: 1337, settleMs: 1500, timeout: 90000 });
  const cdp = await page.context().newCDPSession(page);
  if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start'); }
  const result = await page.evaluate(async (frames) => {
    const g = window.__game, ctx = g.ctx, c = g.composer;
    const { drawForegroundFoliage, drawSceneFidelity } = await import('/src/render/SceneFidelity.ts');
    const { surfaceFoliageInBounds } = await import('/src/game/SurfaceFoliage.ts');
    const { VISUAL_FIDELITY: V } = await import('/src/config/visualFidelity.ts');
    const { floraCacheStats: stats } = await import('/src/render/FloraPainter.ts');
    ctx.state.paused = true;
    const w = ctx.world, fg = surfaceFoliageInBounds(w, 0, 0, w.width, w.height).filter(p => p.foreground);
    const spots = [];
    for (const p of fg.filter((_, i) => i % 3 === 0).slice(0, 6)) {
      ctx.camera.snapTo(p.x, p.y); Object.assign(ctx.player, { x: p.x, y: p.y });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      // Advance the clock between draws, as play does: caches must earn their keep under motion.
      const time = (fn) => {
        fn(); const t0 = performance.now();
        for (let i = 0; i < frames; i++) { ctx.state.frameCount++; fn(); }
        return (performance.now() - t0) / frames;
      };
      const sg = V.surfaceGrowth;
      const scene = time(() => drawSceneFidelity(c, c.light, ctx));
      V.surfaceGrowth = 0; const rest = time(() => drawSceneFidelity(c, c.light, ctx)); V.surfaceGrowth = sg;
      const h0 = stats.hits, p0 = stats.paints;
      time(() => drawSceneFidelity(c, c.light, ctx));
      const hitRate = +((stats.hits - h0) / Math.max(1, stats.hits - h0 + stats.paints - p0)).toFixed(2);
      spots.push({ x: p.x, y: p.y, hitRate, front: +time(() => drawForegroundFoliage(c, c.light, ctx)).toFixed(2), growth: +(scene - rest).toFixed(2) });
    }
    const avg = k => +(spots.reduce((s, v) => s + v[k], 0) / spots.length).toFixed(2);
    return { spots, mean: { front: avg('front'), growth: avg('growth') } };
  }, frames);
  console.log(JSON.stringify(result.spots));
  console.log('mean ms/frame', JSON.stringify(result.mean));
  if (profile) {
    const { profile: prof } = await cdp.send('Profiler.stop');
    const self = new Map(), dt = new Map();
    for (let i = 0; i < prof.samples.length; i++) dt.set(prof.samples[i], (dt.get(prof.samples[i]) ?? 0) + (prof.timeDeltas[i] ?? 0));
    for (const n of prof.nodes) {
      const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (dt.get(n.id) ?? 0));
    }
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`);
  }
} finally { await browser.close(); vite.kill(); }

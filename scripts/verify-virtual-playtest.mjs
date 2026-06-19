// Phase 5 runtime render audit: enter a REAL virtual-world playtest and verify the rendered
// frame is rich (biome colors + scene lighting), not the dull/dark grid the plan warns about.
// Data parity is unit-tested (materializeChunks/cropMaterializedWindow); this checks the
// renderer end of the pipeline in the actual game.
//
// Usage: node scripts/verify-virtual-playtest.mjs [url]  (needs a DEV server + Edge)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = 'verify-out';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e)));

// Sample the GL canvas inside rAF (no preserveDrawingBuffer needed). Reports coverage,
// average brightness, and bright-pixel count (scene lights make bright spots).
const samplePixels = () =>
  page.evaluate(() => new Promise((res) => {
    requestAnimationFrame(() => {
      const gl = document.querySelector('#canvas-holder > canvas');
      if (!gl) return res({ error: 'no canvas' });
      const c = document.createElement('canvas');
      c.width = gl.width; c.height = gl.height;
      const g = c.getContext('2d');
      g.drawImage(gl, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let nonBlack = 0, sum = 0, bright = 0, maxV = 0;
      for (let i = 0; i < d.length; i += 4) {
        const v = d[i] + d[i + 1] + d[i + 2];
        sum += v;
        if (v > 30) nonBlack++;
        if (v > 420) bright++;
        if (v > maxV) maxV = v;
      }
      const total = d.length / 4;
      res({
        w: c.width, h: c.height,
        nonBlackPct: +((nonBlack / total) * 100).toFixed(1),
        avg: +(sum / total / 3).toFixed(1),
        brightPct: +((bright / total) * 100).toFixed(2),
        maxV,
      });
    });
  }));

// drawImage of a WebGL canvas (no preserveDrawingBuffer) intermittently catches a cleared
// frame, so sample several frames and keep the richest reading.
async function sampleBest(n) {
  let best = { nonBlackPct: 0, avg: 0, brightPct: 0, maxV: 0 };
  for (let i = 0; i < n; i++) {
    const s = await samplePixels();
    if (s && !s.error && s.nonBlackPct > best.nonBlackPct) best = s;
    await page.waitForTimeout(80);
  }
  return best;
}

console.log('navigating to', url);
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => !!(window.__game && window.__game.ctx), null, { timeout: 30000 });
await page.waitForTimeout(1500);

const buildSample = await sampleBest(8);
console.log('build-mode canvas:', JSON.stringify(buildSample));

// Enter the virtual-world test playtest through the public Levels API on the debug handle.
const start = await page.evaluate((seed) => {
  const g = window.__game;
  const r = g.ctx.levels.startRun(g.ctx, { mode: 'test', worldSource: 'virtual-world', seed, loadout: 'advanced' });
  return { ok: r.ok, message: r.message, levelId: r.levelId, reason: r.reason ?? null };
}, 1313162580);
console.log('startRun(virtual-world,test):', JSON.stringify(start));
if (!start.ok) throw new Error('virtual playtest did not start: ' + JSON.stringify(start));

await page.waitForFunction(() => document.body.classList.contains('play-active'), null, { timeout: 20000 });
await page.waitForTimeout(3000); // let worldgen settle + lighting rebuild over many frames

const runtime = await page.evaluate(() => {
  const lv = window.__game.ctx.levels.current;
  return {
    id: lv?.def?.id ?? null,
    worldW: lv?.world?.width ?? null,
    worldH: lv?.world?.height ?? null,
    authoredLights: lv?.authoredLights?.length ?? 0,
    generatedScenes: lv?.generatedScenes?.length ?? 0,
  };
});
console.log('virtual runtime:', JSON.stringify(runtime));

const playSample = await sampleBest(12);
console.log('virtual playtest canvas:', JSON.stringify(playSample));
await page.screenshot({ path: `${outDir}/virtual-playtest.png` });

// --- Assertions ---
// This is a deliberately dark cave game: even the proven-good sandbox build view is only
// ~20% non-black, so "rich vs dull" is judged RELATIVE to that reference, not absolutely.
const fail = [];
if (runtime.id !== 'virtual-test') fail.push(`expected virtual-test runtime, got ${runtime.id}`);
if (playSample.error) fail.push('play canvas sample failed: ' + playSample.error);
// Not blank / genuinely dull. The build-mode reference can include a much brighter
// editor view than this cave playtest, so cap the relative threshold and keep the
// scene-light assertions below as the stronger parity signal.
const minNonBlack = Math.max(5, Math.min(12, buildSample.nonBlackPct * 0.7));
const minAvg = Math.max(4, Math.min(5, buildSample.avg * 0.7));
if (!(playSample.nonBlackPct >= minNonBlack)) fail.push(`playtest sparser than reference: nonBlackPct=${playSample.nonBlackPct} < ${minNonBlack.toFixed(1)}`);
if (!(playSample.avg >= minAvg)) fail.push(`playtest darker than reference: avg=${playSample.avg} < ${minAvg.toFixed(1)}`);
// Content pipeline: this fixed seed materializes generated scenes AND scene lights into the runtime...
if (!(runtime.generatedScenes > 0)) fail.push(`no generated scenes materialized (got ${runtime.generatedScenes})`);
if (!(runtime.authoredLights > 0)) fail.push(`no scene lights materialized (got ${runtime.authoredLights})`);
// ...and those scene lights must actually light the rendered frame (bright pixels present).
if (runtime.authoredLights > 0 && !(playSample.brightPct > 0)) {
  fail.push(`runtime has ${runtime.authoredLights} authored lights but the frame has no bright pixels (lights not rendering)`);
}
if (consoleErrors.length) fail.push('console errors: ' + JSON.stringify(consoleErrors.slice(0, 4)));
if (pageErrors.length) fail.push('page errors: ' + JSON.stringify(pageErrors.slice(0, 4)));

await browser.close();
if (fail.length) {
  console.error('FAIL:\n - ' + fail.join('\n - '));
  process.exit(1);
}
console.log(`PASS: virtual playtest renders rich — ${runtime.generatedScenes} scenes, ${runtime.authoredLights} scene lights, ` +
  `coverage ${playSample.nonBlackPct}% (ref ${buildSample.nonBlackPct}%), avg ${playSample.avg} (ref ${buildSample.avg}), ` +
  `brightPct ${playSample.brightPct}, maxV ${playSample.maxV}`);

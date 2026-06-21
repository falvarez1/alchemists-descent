// Phase 5 render audit: enter a fixed-campaign level in Play Mode and verify it renders rich
// (biome terrain + generated lights), not the dull/dark grid the plan worried about.
//
// NOTE: there is no "Builder Playtest of a campaign level" — the Builder playtests authored
// EditorDocuments via PreviewRuntime, while campaign levels come from CaveGenerator. Both use
// the SAME renderer, and campaign light/cell restore parity is covered by unit tests
// (tests/level-lights.test.ts, tests/worldgen.test.ts). This probe adds the runtime confirmation
// that a campaign level actually renders rich in the real game.
//
// Usage: node scripts/verify-campaign-playtest.mjs [url] [levelId]  (needs a DEV server + Edge)
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const levelId = (process.argv[3] || 'd1').toLowerCase();
const outDir = 'verify-out';
mkdirSync(outDir, { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !isBenignDevConsoleError(m.text())) consoleErrors.push(m.text());
});
page.on('pageerror', (e) => pageErrors.push(String(e)));

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
      res({ nonBlackPct: +((nonBlack / total) * 100).toFixed(1), avg: +(sum / total / 3).toFixed(1), brightPct: +((bright / total) * 100).toFixed(2), maxV });
    });
  }));

// drawImage of a no-preserveDrawingBuffer WebGL canvas intermittently catches a cleared frame.
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

const start = await page.evaluate((lvl) => {
  const g = window.__game;
  const r = g.ctx.levels.startRun(g.ctx, { mode: 'test', worldSource: 'campaign-level', levelId: lvl, seed: 1337, loadout: 'advanced' });
  return { ok: r.ok, message: r.message, levelId: r.levelId, reason: r.reason ?? null };
}, levelId);
console.log(`startRun(campaign-level ${levelId}):`, JSON.stringify(start));
if (!start.ok) throw new Error('campaign level did not start: ' + JSON.stringify(start));

await page.waitForFunction(() => document.body.classList.contains('play-active'), null, { timeout: 20000 });
await page.waitForTimeout(3000); // worldgen settle + lighting rebuild over many frames

const runtime = await page.evaluate(() => {
  const lv = window.__game.ctx.levels.current;
  return {
    id: lv?.def?.id ?? null,
    biome: lv?.def?.biome ?? null,
    worldW: lv?.world?.width ?? null,
    authoredLights: lv?.authoredLights?.length ?? 0,
  };
});
console.log('campaign runtime:', JSON.stringify(runtime));

const playSample = await sampleBest(12);
console.log('campaign play canvas:', JSON.stringify(playSample));
await page.screenshot({ path: `${outDir}/campaign-playtest-${levelId}.png` });

// Judge richness mostly relative to the proven-good sandbox build view, but cap
// the relative target. The build view can be brighter and denser than a real
// campaign cave after spawn framing; the authored-light/bright-pixel checks
// below still catch the broken "dull black grid" failure this probe targets.
const fail = [];
if (runtime.id !== levelId) fail.push(`expected ${levelId} runtime, got ${runtime.id}`);
if (playSample.error) fail.push('play canvas sample failed: ' + playSample.error);
const minNonBlack = Math.min(Math.max(5, buildSample.nonBlackPct * 0.6), 32);
const minAvg = Math.min(Math.max(4, buildSample.avg * 0.6), 10);
if (!(playSample.nonBlackPct >= minNonBlack)) fail.push(`campaign render sparse: nonBlackPct=${playSample.nonBlackPct} < ${minNonBlack.toFixed(1)}`);
if (!(playSample.avg >= minAvg)) fail.push(`campaign render dark: avg=${playSample.avg} < ${minAvg.toFixed(1)}`);
if (!(runtime.authoredLights > 0)) fail.push(`campaign level authored no lights (got ${runtime.authoredLights})`);
if (runtime.authoredLights > 0 && !(playSample.brightPct > 0)) fail.push(`has ${runtime.authoredLights} authored lights but no bright pixels (lights not rendering)`);
if (consoleErrors.length) fail.push('console errors: ' + JSON.stringify(consoleErrors.slice(0, 4)));
if (pageErrors.length) fail.push('page errors: ' + JSON.stringify(pageErrors.slice(0, 4)));

await browser.close();
if (fail.length) {
  console.error('FAIL:\n - ' + fail.join('\n - '));
  process.exit(1);
}
console.log(`PASS: campaign ${levelId} (${runtime.biome}) renders rich — ${runtime.authoredLights} authored lights, ` +
  `coverage ${playSample.nonBlackPct}% (ref ${buildSample.nonBlackPct}%), avg ${playSample.avg} (ref ${buildSample.avg}), ` +
  `brightPct ${playSample.brightPct}, maxV ${playSample.maxV}`);

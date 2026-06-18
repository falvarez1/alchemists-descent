// Measure grass fire-spread rate across flammability values: ignite one end of a
// 30-blade row, count how far it burns. "Low percentage" = fire usually fizzles
// partway instead of crossing the whole patch.
//   node scripts/_grassburn.mjs
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const VALUES = [0.12, 0.06, 0.03];
const TRIALS = 10;
const N = 30;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const F of VALUES) {
  const context = await browser.newContext();
  await context.addInitScript((f) => {
    try { localStorage.setItem('ad:tuning:v1', JSON.stringify({ materials: { 37: { flammability: f } } })); } catch {}
  }, F);
  const page = await context.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await startConsoleTestRun(page, { seed: 1337, settleMs: 200 });

  const out = await page.evaluate(async ({ n, trials }) => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    const GRASS = 37, FIRE = 5, METAL = 13, EMPTY = 0;
    let crossed = 0, totalBurned = 0;
    for (let tr = 0; tr < trials; tr++) {
      const y = (ctx.camera.y | 0) + 50 + tr * 3;
      const x0 = (ctx.camera.x | 0) + 30;
      for (let x = x0 - 1; x <= x0 + n; x++) {
        const fi = w.idx(x, y + 1); w.types[fi] = METAL; w.colors[fi] = 0x6a7280; w.life[fi] = 0; w.charge[fi] = 0;
        for (const yy of [y, y - 1]) { const ai = w.idx(x, yy); w.types[ai] = EMPTY; w.colors[ai] = 0; w.life[ai] = 0; }
      }
      for (let k = 0; k < n; k++) { const i = w.idx(x0 + k, y); w.types[i] = GRASS; w.colors[i] = 0x7cb034; w.life[i] = -1; }
      const fi = w.idx(x0, y); w.types[fi] = FIRE; w.colors[fi] = 0xff5a00; w.life[fi] = 30;
      for (let s = 0; s < 220; s++) await new Promise((r) => setTimeout(r, 12));
      let remaining = 0; for (let k = 0; k < n; k++) if (w.types[w.idx(x0 + k, y)] === GRASS) remaining++;
      const burned = n - remaining;
      totalBurned += burned;
      if (w.types[w.idx(x0 + n - 1, y)] !== GRASS) crossed++; // far end consumed
    }
    return { crossed, avgBurned: totalBurned / trials };
  }, { n: N, trials: TRIALS });

  console.log(`flammability=${F}: crossed whole patch ${out.crossed}/${TRIALS} trials, avg ${out.avgBurned.toFixed(1)}/${N} blades burned`);
  await context.close();
}
await browser.close();

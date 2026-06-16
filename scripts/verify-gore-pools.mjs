// Runtime-verify the gore POOLING/DRYING enhancement in the real game: kill a
// crowd on a solid floor, then confirm (1) a wet pool of real Cell.Blood liquid
// forms and stacks (depth>=2), (2) it does not flood unbounded — the thin film
// dries to permanent floor stains so the blood-cell count comes back down, and
// screenshots at kill / settled / dried. Drives headless Edge.
import { chromium } from 'playwright-core';
import { captureCanvasPng, newBenchmarkPage } from './perf-harness.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await newBenchmarkPage(browser, { diagnosticsLabel: 'verify-gore-pools' });
page.on('pageerror', (e) => console.error('PAGE ERROR:', String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await startConsoleTestRun(page, { seed: 777, settleMs: 1200 });

const setup = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const px = Math.floor(ctx.player.x), py = Math.floor(ctx.player.y);
  ctx.player.hp = 9e9; ctx.player.maxHp = 9e9; ctx.player.invuln = 9e9;
  ctx.enemies.length = 0; ctx.particles.clear();
  // box with a solid Metal floor + walls so blood has somewhere to pool
  for (let dx = -60; dx <= 60; dx++)
    for (let dy = -40; dy <= 12; dy++) {
      const x = px + dx, y = py + dy;
      if (!w.inBounds(x, y)) continue;
      const solid = dy === 12 || Math.abs(dx) === 60;
      w.replaceCellAt(w.idx(x, y), solid ? 13 : 0, solid ? 0x606870 : 0x08080c);
    }
  const roster = ['golem', 'slime', 'bat', 'mage', 'slime', 'bat', 'mage', 'golem', 'slime', 'mage'];
  let n = 0;
  roster.forEach((kind, i) => { if (ctx.enemyCtl.spawn(kind, px + (i - 5) * 9, py + 9)) n++; });
  return { px, py, spawned: n };
});
console.log(`arena at (${setup.px},${setup.py}); spawned ${setup.spawned} enemies`);

const countBlood = () => page.evaluate(() => {
  const t = window.__game.ctx.world.types; let n = 0;
  for (let i = 0; i < t.length; i++) if (t[i] === 18) n++;
  return n;
});

const bloodBefore = await countBlood();
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  for (const e of [...ctx.enemies]) ctx.enemyCtl.damage(e, 99999, 0, -3);
});
await page.waitForTimeout(150);
const bloodAtKill = await countBlood();
await captureCanvasPng(page, 'verify-out/gore-at-kill.png');

await page.waitForTimeout(2500);
const bloodSettled = await countBlood();
const poolStats = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world;
  const px = Math.floor(ctx.player.x), py = Math.floor(ctx.player.y);
  let maxDepth = 0, pooledCols = 0;
  for (let dx = -58; dx <= 58; dx++) {
    let depth = 0;
    for (let dy = 11; dy >= -25; dy--) if (w.types[w.idx(px + dx, py + dy)] === 18) depth++;
    if (depth >= 2) pooledCols++;
    if (depth > maxDepth) maxDepth = depth;
  }
  return { maxDepth, pooledCols };
});
await captureCanvasPng(page, 'verify-out/gore-settled.png');

await page.waitForTimeout(9000);
const bloodDried = await countBlood();
await captureCanvasPng(page, 'verify-out/gore-dried.png');

console.log(`blood cells: before ${bloodBefore} | at-kill ${bloodAtKill} | +2.5s ${bloodSettled} | +11.5s ${bloodDried}`);
console.log(`pool: maxColumnDepth ${poolStats.maxDepth}, columns depth>=2 ${poolStats.pooledCols}`);
const pooled = poolStats.maxDepth >= 2 && poolStats.pooledCols >= 2;
const dries = bloodDried < bloodSettled;
console.log(`POOLED (wet liquid stacks): ${pooled ? 'PASS' : 'FAIL'}`);
console.log(`BOUNDED (dries over time):  ${dries ? 'PASS' : 'FAIL (still ' + bloodDried + ')'}`);

await page.context().close();
await browser.close();
process.exit(pooled && dries ? 0 : 1);

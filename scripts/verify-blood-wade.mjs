// Runtime verification for the blood-wading feature (drag + robe stain + wake).
// Drives the real game in headless Edge via playwright-core and window.__game.ctx.
// Usage: node scripts/verify-blood-wade.mjs [url]   (needs `npm run dev` running)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = 'verify-out';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e)));

console.log('navigating to', url);
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await startConsoleTestRun(page);
await page.waitForTimeout(600); // let the camera settle on the spawn

// Carve a clean, flat runway around the player and (optionally) flood it with a
// shin-deep fresh-blood pool. Returns the geometry so Node can screenshot.
const setupRunway = (withBlood) =>
  page.evaluate((withBlood) => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    const BLOOD = 18, WALL = 3, EMPTY = 0;
    const wallCol = (90 << 16) | (90 << 8) | 95;
    const p = ctx.player;
    const baseX = Math.round(p.x);
    const floorY = Math.round(p.y) + 1; // solid cell just under the feet
    const RUN = 130, DEPTH = 4;
    for (let x = baseX - 6; x <= baseX + RUN; x++) {
      for (let y = floorY - 30; y <= floorY; y++) {
        const i = w.idx(x, y);
        if (y === floorY) { w.types[i] = WALL; w.colors[i] = wallCol; }
        else { w.types[i] = EMPTY; w.colors[i] = 0; }
      }
      for (let y = floorY + 1; y <= floorY + 3; y++) { const i = w.idx(x, y); w.types[i] = WALL; w.colors[i] = wallCol; }
    }
    if (withBlood) {
      for (let x = baseX - 2; x <= baseX + RUN; x++) {
        for (let y = floorY - 1; y >= floorY - DEPTH; y--) {
          const i = w.idx(x, y);
          w.types[i] = BLOOD;
          w.colors[i] = ((160 + ((Math.random() * 40) | 0)) << 16) | ((12 + ((Math.random() * 18) | 0)) << 8) | (25 + ((Math.random() * 12) | 0));
        }
      }
    }
    // Reset the player onto the runway, stationary, unbuffed, unbothered.
    p.x = baseX; p.y = floorY - 1; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0;
    p.grounded = true; p.crawling = false; p.crawlT = 0; p.dead = false;
    p.hp = p.maxHp; p.invuln = 9999; p.bloodStain = 0;
    p.status.swift = 0; p.status.frozen = 0; p.status.electrified = 0;
    ctx.enemies.length = 0;
    return { baseX, floorY, width: w.width, height: w.height };
  }, withBlood);

// Hold 'd' for ~40 ticks; sample peak/steady horizontal speed, distance, the
// blood-soak timer, and how many blood-coloured wake droplets fly.
const runStint = async () => {
  await page.keyboard.down('d');
  const out = await page.evaluate(() => new Promise((res) => {
    const ctx = window.__game.ctx;
    const p = ctx.player;
    const x0 = p.x;
    let peakVx = 0, n = 0, sumTail = 0, tailN = 0, peakRed = 0;
    const tick = () => {
      const vx = Math.abs(p.vx);
      if (vx > peakVx) peakVx = vx;
      if (n >= 30) { sumTail += vx; tailN++; }
      let red = 0;
      for (const q of ctx.particles.list) {
        const c = q.color | 0;
        const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
        if (r > 90 && r > g * 2 && r > b * 2) red++;
      }
      if (red > peakRed) peakRed = red;
      n++;
      if (n < 40) requestAnimationFrame(tick);
      else res({ peakVx, steadyVx: tailN ? sumTail / tailN : 0, dist: p.x - x0, bloodStain: p.bloodStain, grounded: p.grounded, peakRed });
    };
    requestAnimationFrame(tick);
  }));
  await page.keyboard.up('d');
  await page.waitForTimeout(150);
  return out;
};

// --- Baseline: dry runway ---
const geo = await setupRunway(false);
console.log('runway geo:', JSON.stringify(geo));
const dry = await runStint();
console.log('DRY  run:', JSON.stringify(dry));

// --- Wading: same runway, flooded with fresh blood. The soak should BUILD
// the longer he stands in it (faint → deep), not snap to full on first touch. ---
await setupRunway(true);
await page.waitForTimeout(250); // a quick step in it
const stainBrief = await page.evaluate(() => window.__game.ctx.player.bloodStain);
await page.screenshot({ path: `${outDir}/blood-01-standing.png` });
await page.waitForTimeout(1700); // keep wading → the soak deepens
const stainLong = await page.evaluate(() => window.__game.ctx.player.bloodStain);
const wet = await runStint();
console.log('WADE run:', JSON.stringify(wet), 'soak brief->long:', stainBrief.toFixed(0), '->', stainLong.toFixed(0));
await page.screenshot({ path: `${outDir}/blood-02-wading.png` });

// Let the soak start to fade after leaving the blood, to prove the ~1-min timer counts down.
await setupRunway(false); // dry ground, but keep the existing stain
await page.evaluate(() => { window.__game.ctx.player.bloodStain = 600; }); // jump near the tail of the fade
await page.waitForTimeout(80);
const stainFading = await page.evaluate(() => window.__game.ctx.player.bloodStain);

// ---- Assertions ----
const problems = [];
if (dry.peakVx < 1.2) problems.push(`dry run barely moved (peakVx=${dry.peakVx.toFixed(2)}) — input/movement may not be driving`);
if (!(wet.peakVx < dry.peakVx * 0.85)) problems.push(`no wade bog-down: wet peakVx=${wet.peakVx.toFixed(2)} vs dry=${dry.peakVx.toFixed(2)}`);
if (!(wet.steadyVx < dry.steadyVx * 0.85)) problems.push(`wade steady speed not slowed: wet=${wet.steadyVx.toFixed(2)} vs dry=${dry.steadyVx.toFixed(2)}`);
if (!(stainBrief > 0)) problems.push(`robe did not start soaking in blood (=${stainBrief})`);
if (!(stainLong > stainBrief * 1.5)) problems.push(`soak did not build with exposure: brief=${stainBrief.toFixed(0)} long=${stainLong.toFixed(0)}`);
if (!(stainLong >= 1000)) problems.push(`prolonged wade did not saturate to full crimson (=${stainLong.toFixed(0)}, want >= 1000)`);
if (!(wet.peakRed > 0)) problems.push('no blood-coloured wake droplets while wading');
if (!(dry.bloodStain === 0)) problems.push(`dry run wrongly stained (bloodStain=${dry.bloodStain})`);
if (!(stainFading > 0 && stainFading < 600)) problems.push(`stain did not count down after leaving blood (=${stainFading})`);

const slowPct = (100 * (1 - wet.steadyVx / (dry.steadyVx || 1))).toFixed(0);
console.log(`\nbog-down: steady speed ${dry.steadyVx.toFixed(2)} -> ${wet.steadyVx.toFixed(2)} cells/frame (${slowPct}% slower)`);
console.log(`robe soak builds: ${stainBrief.toFixed(0)} (quick step) -> ${stainLong.toFixed(0)} (waded), saturates at 1000; faded ${stainFading.toFixed(0)} after leaving`);
console.log(`wake: peak ${wet.peakRed} blood droplets airborne while wading (dry: ${dry.peakRed})`);
console.log('--- console errors:', consoleErrors.length ? JSON.stringify(consoleErrors) : 'none');
console.log('--- page errors:', pageErrors.length ? JSON.stringify(pageErrors) : 'none');

await browser.close();
if (problems.length || consoleErrors.length || pageErrors.length) {
  console.error('\nFAIL:\n - ' + [...problems, ...consoleErrors.map((e) => 'console: ' + e), ...pageErrors.map((e) => 'page: ' + e)].join('\n - '));
  process.exit(1);
}
console.log('\nPASS — blood wading drags, soaks, and throws a wake.');

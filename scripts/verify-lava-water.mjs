// Runtime probe: lava poured onto water should BOIL THROUGH it (water -> steam,
// lava bores down) instead of sealing into a stable lava/water cake.
// Usage: node scripts/verify-lava-water.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1300, height: 860 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.world, { timeout: 20000 });
await page.evaluate(() => window.__game.ctx.levels.startRun(window.__game.ctx, { mode: 'test', worldSource: 'campaign-level', levelId: 'physics-test', seed: 1, loadout: 'fresh' }));
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'physics-test', { timeout: 20000 });
await page.waitForFunction(() => window.__game.ctx.levels._transitioning === false, { timeout: 10000 });

// METAL box: water in the lower half, lava in the upper half. Cell ids:
// Water=2, Steam=9, Lava=11, Stone=12, Metal=13.
const result = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world;
  const X0 = 500, X1 = 540, Y0 = 640, Y1 = 700;
  const set = (x, y, t) => { const i = w.idx(x, y); w.types[i] = t; w.colors[i] = 0; };
  // walls
  for (let y = Y0; y <= Y1; y++) { set(X0, y, 13); set(X1, y, 13); }
  for (let x = X0; x <= X1; x++) set(x, Y1, 13);
  // fill: lower interior = water, upper interior = lava
  for (let y = Y0 + 1; y < Y1; y++) for (let x = X0 + 1; x < X1; x++) set(x, y, y >= 678 ? 2 : 11);
  const interior = () => {
    let water = 0, lava = 0, steam = 0, stone = 0, lavaMaxY = -1;
    for (let y = Y0 + 1; y < Y1; y++) for (let x = X0 + 1; x < X1; x++) {
      const t = w.types[w.idx(x, y)];
      if (t === 2) water++; else if (t === 11) { lava++; if (y > lavaMaxY) lavaMaxY = y; }
      else if (t === 9) steam++; else if (t === 12) stone++;
    }
    return { water, lava, steam, stone, lavaMaxY };
  };
  const before = interior();
  let steamPeak = 0;
  for (let f = 0; f < 700; f++) { window.__game.tick(); const s = interior(); if (s.steam > steamPeak) steamPeak = s.steam; }
  const after = interior();
  return { before, after, steamPeak, waterStartTop: 678, boxBottom: Y1 - 1 };
});
console.log(`  ..    water ${result.before.water} -> ${result.after.water} | steam peak ${result.steamPeak} | lava ${result.before.lava} -> ${result.after.lava} (lowest lava row ${result.after.lavaMaxY}/${result.boxBottom}) | stone ${result.after.stone}`);
check('lava boils DOWN into the water (sinks well past its start, not floating on top)', result.after.lavaMaxY > result.waterStartTop + 6, JSON.stringify(result));
check('a good chunk of the water boils off', result.after.water < result.before.water * 0.8, JSON.stringify(result));
check('steam billows up (the water flashed off)', result.steamPeak > 50, JSON.stringify(result));

// Scenario B: water RESTING ON lava should chill a THICK obsidian crust (not a faint line).
const crust = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world;
  const X0 = 500, X1 = 540, Y0 = 640, Y1 = 700;
  const set = (x, y, t) => { const i = w.idx(x, y); w.types[i] = t; w.colors[i] = 0; };
  for (let y = Y0; y <= Y1; y++) { set(X0, y, 13); set(X1, y, 13); }
  for (let x = X0; x <= X1; x++) set(x, Y1, 13);
  for (let y = Y0 + 1; y < Y1; y++) for (let x = X0 + 1; x < X1; x++) set(x, y, y >= 678 ? 11 : 2); // lava pool, water on top
  for (let f = 0; f < 160; f++) window.__game.tick();
  let maxRun = 0, sumRun = 0, cols = 0;
  for (let x = X0 + 1; x < X1; x++) {
    let y = Y0 + 1;
    while (y < Y1 && w.types[w.idx(x, y)] !== 12) y++; // first stone from the top
    if (y >= Y1) continue;
    let run = 0;
    while (y < Y1 && w.types[w.idx(x, y)] === 12) { run++; y++; }
    if (run > 0) { maxRun = Math.max(maxRun, run); sumRun += run; cols++; }
  }
  return { maxRun, avgRun: cols ? +(sumRun / cols).toFixed(2) : 0, cols };
});
console.log(`  ..    water-on-lava crust thickness: max=${crust.maxRun} avg=${crust.avgRun} over ${crust.cols} columns`);
check('water-on-lava chills a THICK crust (>= 3 cells somewhere, not a faint line)', crust.maxRun >= 3, JSON.stringify(crust));
check('the crust averages more than 1 cell thick', crust.avgRun > 1.4, JSON.stringify(crust));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\nlava-water probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

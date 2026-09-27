// D1 liquid containment audit: visit every Works room so the simulation runs
// there, let the liquids settle, and report where each room's water went.
// A safe room that fills, or a pool that empties into a corridor, shows up as
// water moving between rooms. Usage: node scripts/audit-works-liquids.mjs [url] [--passes 2]
import { chromium } from 'playwright-core';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const passes = Number(args[args.indexOf('--passes') + 1] || 2);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url); await waitForConsoleApi(page);
await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh');
await waitForRunReady(page);
const ROOMS = [
  ['intake', 45, 95, 470, 315], ['sluice', 455, 165, 475, 445], ['gallery', 910, 165, 615, 450], ['pressure', 1060, 480, 465, 730],
  ['refuge', 675, 540, 375, 760], ['silt', 160, 540, 485, 825], ['undertow', 310, 860, 620, 1010], ['lowerbell', 925, 825, 610, 1010],
];
const census = () => page.evaluate((rooms) => {
  const w = window.__game.ctx.world, out = {};
  let total = 0;
  for (let i = 0; i < w.types.length; i++) if (w.types[i] === 2) total++;
  for (const [id, x, y, wd, floor] of rooms) {
    let n = 0;
    for (let yy = y; yy <= floor + 6; yy++) for (let xx = x; xx < x + wd; xx++) if (w.types[w.idx(xx, yy)] === 2) n++;
    out[id] = n;
  }
  out.total = total;
  return out;
}, ROOMS);
await page.evaluate(() => { const c = window.__game.ctx; c.state.debugGodMode = true; c.enemies.length = 0; });
const start = await census();
console.log('start ', JSON.stringify(start));
for (let pass = 0; pass < passes; pass++) {
  for (const [id, x, , w, floor] of ROOMS) {
    await execConsoleCommand(page, `tp ${Math.round(x + w / 2)} ${floor - 30}`);
    await page.waitForTimeout(4500);
  }
  console.log(`pass ${pass + 1}`, JSON.stringify(await census()));
}
await browser.close();

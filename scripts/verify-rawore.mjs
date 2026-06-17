// Runtime probe for the mineral-vug fill + hidden RawOre cache:
//  - the fill pass places RawOre (id 36) caches in a generated level
//  - RawOre is diggable and pays out gold (score) when mined
//  - common fill (stone/coal) packs the swiss-cheese pockets
// Usage: node scripts/verify-rawore.mjs [url]
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
await page.waitForFunction(() => window.__game?.ctx?.levels, { timeout: 20000 });
await page.evaluate(() => window.__game.ctx.levels.startRun(window.__game.ctx, { mode: 'test', worldSource: 'campaign-level', levelId: 'd1', seed: 1337, difficulty: 2 }));
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'd1', { timeout: 40000 });
await page.waitForFunction(() => window.__game.ctx.levels._transitioning === false, { timeout: 15000 });

const RAW_ORE = 36;
const counts = await page.evaluate((RAW_ORE) => {
  const w = window.__game.ctx.world;
  let ore = 0, stone = 0, coal = 0;
  for (let i = 0; i < w.types.length; i++) {
    const t = w.types[i];
    if (t === RAW_ORE) ore++;
    else if (t === 12) stone++;
    else if (t === 28) coal++;
  }
  return { ore, stone, coal };
}, RAW_ORE);
console.log(`  ..    cells: RawOre=${counts.ore} Stone=${counts.stone} Coal=${counts.coal}`);
check('the fill pass seeds RawOre caches into the level', counts.ore > 0, JSON.stringify(counts));
check('the fill pass packs common rock (stone/coal present)', counts.stone > 0 && counts.coal > 0, JSON.stringify(counts));

// dig payout: paint a RawOre blob near the player, erode it, expect score + clearing
const dig = await page.evaluate((RAW_ORE) => {
  const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
  const cx = Math.round(p.x), cy = Math.max(20, Math.round(p.y) - 24);
  let painted = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const i = w.idx(cx + dx, cy + dy); w.types[i] = RAW_ORE; w.colors[i] = 0x705a2d; painted++;
  }
  ctx.state.score = 0;
  ctx.spells.erodeAt(cx, cy, 2);
  let remaining = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (w.types[w.idx(cx + dx, cy + dy)] === RAW_ORE) remaining++;
  }
  return { painted, remaining, score: ctx.state.score };
}, RAW_ORE);
console.log(`  ..    dig: painted=${dig.painted} remaining=${dig.remaining} score=${dig.score}`);
check('digging RawOre clears the mined cells', dig.remaining < dig.painted, JSON.stringify(dig));
check('digging RawOre pays out gold (score rises)', dig.score > 0, JSON.stringify(dig));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\nrawore probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

// Runtime probe for variable jump height: a quick jump tap is a low hop (land on
// a crate), a held jump is the full leap, and holding past the window still rolls
// into levitation. Usage: node scripts/verify-jump-precision.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.physics, { timeout: 20000 });
await page.evaluate(() => window.__game.ctx.levels.startRun(window.__game.ctx, { mode: 'test', worldSource: 'campaign-level', levelId: 'physics-test', seed: 1, loadout: 'fresh' }));
await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'physics-test', { timeout: 20000 });
await page.waitForFunction(() => window.__game.ctx.levels._transitioning === false, { timeout: 10000 });

// hold jump for `hold` frames (release after), with `levit` fuel; return peak rise (cells)
const jump = (hold, levit) => page.evaluate(({ hold, levit }) => {
  const ctx = window.__game.ctx, w = ctx.world, p = ctx.player;
  for (let y = 690; y <= 706; y++) for (let x = 460; x <= 680; x++) { const i = w.idx(x, y); w.types[i] = (y >= 700) ? 12 : 0; w.colors[i] = (y >= 700) ? 0x6b6b6b : 0; }
  p.x = 560; p.y = 699; p.vx = 0; p.vy = 0; p.fx = 0; p.fy = 0; p.dead = false; p.crawling = false; p.inLiquid = false; p.climbing = false;
  p.levit = levit; p.maxLevit = Math.max(100, levit);
  for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
  for (let f = 0; f < 4; f++) window.__game.tick(); // settle (grounded)
  const y0 = p.y;
  let minY = p.y;
  ctx.input.keys.jump = true;
  for (let f = 0; f < hold; f++) { window.__game.tick(); if (p.y < minY) minY = p.y; }
  ctx.input.keys.jump = false;
  for (let f = 0; f < 60; f++) { window.__game.tick(); if (p.y < minY) minY = p.y; if (p.grounded && f > 2) break; }
  return y0 - minY;
}, { hold, levit });

const tap1 = await jump(1, 0);
const tap4 = await jump(4, 0);
const hold = await jump(30, 0); // no fuel -> full ballistic leap, no jet
console.log(`  ..    jump peak rise: tap1=${tap1}c  tap4=${tap4}c  full-hold=${hold}c`);
check('a quick tap is a low hop (<= 10 cells, was ~24)', tap1 > 0 && tap1 <= 10, JSON.stringify({ tap1 }));
check('jump height scales with hold time (tap1 < tap4 < full)', tap1 < tap4 && tap4 < hold, JSON.stringify({ tap1, tap4, hold }));
check('a full hold still makes the big leap (>= 18 cells)', hold >= 18, JSON.stringify({ hold }));

// levitation still engages when held past the window (climbs past the ballistic peak)
const fly = await jump(45, 200);
check('holding past the window still levitates (climbs past the ballistic leap)', fly > hold, JSON.stringify({ fly, hold }));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
console.log(`\njump precision probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

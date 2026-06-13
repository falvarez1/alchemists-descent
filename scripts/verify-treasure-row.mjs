// Runtime verification: the header score box is gone; gold + collected
// treasures (card satchel, golden key) live in the HUD treasure row.
// Usage: node scripts/verify-treasure-row.mjs [url]  (dev server running)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = 'verify-out';
mkdirSync(outDir, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

check('header score box removed', await page.evaluate(() => !document.querySelector('.score-box') && !document.getElementById('score-val')));

// Enter play mode so the HUD shows.
await page.click('#mode-play-btn');
await page.waitForTimeout(1200);

let s = await page.evaluate(() => {
  const row = document.getElementById('treasure-row');
  const gold = document.getElementById('hud-gold');
  const cards = document.getElementById('hud-cards');
  const r = row?.getBoundingClientRect();
  return {
    rowVisible: !!r && r.width > 0 && r.height > 0,
    gold: gold?.textContent,
    goldIcon: !!document.querySelector('#gold-chip-icon canvas'),
    cards: cards?.textContent,
    cardsIcon: !!document.querySelector('#cards-chip-icon canvas'),
    keyHidden: getComputedStyle(document.getElementById('key-indicator')).display === 'none',
  };
});
check('treasure row visible in play HUD', s.rowVisible, JSON.stringify(s));
check('gold chip: pixel icon + count', s.goldIcon && s.gold === '0', JSON.stringify(s));
check('cards chip: pixel icon + satchel count', s.cardsIcon && Number(s.cards) >= 1, JSON.stringify(s));
check('key chip hidden until held', s.keyHidden, JSON.stringify(s));

// Income rolls: bump the score and watch the readout tick toward it.
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  ctx.state.score += 160;
  ctx.events.emit('scoreChanged', { score: ctx.state.score });
});
await page.waitForTimeout(250);
const midRoll = await page.evaluate(() => document.getElementById('hud-gold').textContent);
await page.waitForTimeout(1500);
s = await page.evaluate(() => ({
  gold: document.getElementById('hud-gold').textContent,
  rolling: document.getElementById('hud-gold').classList.contains('rolling'),
}));
check('gold rolls up to the new score', s.gold === '160' && !s.rolling, JSON.stringify({ midRoll, ...s }));

// Key + a granted card light their chips.
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const rt = ctx.levels.current;
  if (rt) rt.keyTaken = true;
  ctx.wands.grantCard(ctx, 'spark');
});
await page.waitForTimeout(300);
s = await page.evaluate(() => ({
  keyShown: getComputedStyle(document.getElementById('key-indicator')).display !== 'none',
  cards: document.getElementById('hud-cards').textContent,
}));
check('key chip appears once held', s.keyShown, JSON.stringify(s));
check('cards chip counts the granted card', Number(s.cards) >= 2, JSON.stringify(s));

await page.screenshot({ path: `${outDir}/treasure-row.png`, clip: { x: 900, y: 0, width: 600, height: 360 } });
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

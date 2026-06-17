// Focused probe for the Builder Gallery FORCE PUSH (F) rig on the Player entity:
// selecting it must run the real kick without errors and blow the ash patch into
// motes. Screenshot-free (robust against HMR). Usage: node scripts/verify-gallery-kick.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('  ok    ' + n); } else { fail++; console.log('  FAIL  ' + n + ' ' + d); } };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('dialog', (d) => d.accept());
const pageErrors = [], drawWarnings = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.text().includes('[gallery] preview draw failed')) drawWarnings.push(m.text()); });

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
await page.click('#mode-builder-btn');
await page.waitForTimeout(400);
await page.click('[data-menu="view"]');
await page.click('#b-gallery');
await page.waitForTimeout(500);
check('gallery opens', await page.isVisible('#builder-gallery'));

const clickByText = async (selector, text, textOf = null) => {
  const box = await page.evaluate(({ selector, text, textOf }) => {
    const el = [...document.querySelectorAll(selector)].find(
      (e) => (textOf ? e.querySelector(textOf)?.textContent : e.textContent) === text);
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { selector, text, textOf });
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(200);
  return true;
};

check('select The Alchemist', await clickByText('#builder-gallery .bg-item', 'The Alchemist', '.bg-name'));
check('FORCE PUSH chip present', await clickByText('#builder-gallery .bg-chip[data-sp]', 'FORCE PUSH (F)'));

await page.waitForFunction(() => !!window.__gallery?.world, { timeout: 8000 }).catch(() => {});
// count ash (type 32) in the rig's ash region over time — the gust must clear some
const ashCount = () => page.evaluate(() => {
  const g = window.__gallery; const w = g?.world;
  if (!w) return -1;
  let n = 0;
  for (let y = 113; y <= 119; y++) for (let x = 120; x <= 136; x++) if (w.types[x + y * w.width] === 32) n++;
  return n;
});

// sample across two full cycles (cycle=150 ticks ≈ 2.5s); the kick fires at t=40
let maxAsh = 0, minAsh = 999;
for (let i = 0; i < 12; i++) {
  const n = await ashCount();
  maxAsh = Math.max(maxAsh, n);
  minAsh = Math.min(minAsh, n);
  await page.waitForTimeout(300);
}

const caption = await page.evaluate(() => document.getElementById('bg-caption')?.textContent ?? '');
check('rig captions the kick', caption.includes('FORCE PUSH (F)'), caption);
check('ash patch paints (rig stage built)', maxAsh > 40, `max=${maxAsh}`);
check('the gust blows ash away (cleared some)', minAsh < maxAsh - 8, `min=${minAsh} max=${maxAsh}`);
check('no preview draw failures', drawWarnings.length === 0, drawWarnings.join(' | '));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\ngallery-kick probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

// Boot overlay check: styled cover from first paint, gone after the game starts.
// Usage: node scripts/verify-boot.mjs [url]   (dev server must be running)
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
const early = await page.evaluate(() => {
  const el = document.getElementById('boot-overlay');
  if (!el) return { exists: false };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    exists: true,
    fixed: cs.position === 'fixed',
    dark: cs.backgroundColor === 'rgb(7, 7, 10)',
    covers: r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2,
  };
});
check(
  'overlay styled and covering at first paint',
  early.exists && early.fixed && early.dark && early.covers,
  JSON.stringify(early),
);

await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1200); // fade + removal
const late = await page.evaluate(() => ({
  overlayGone: !document.getElementById('boot-overlay'),
  mode: window.__game.ctx.state.mode,
}));
check('overlay removed after boot', late.overlayGone && late.mode === 'build', JSON.stringify(late));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

// Drives the World Map (virtual/chunked) panel end-to-end: boots into the Builder,
// opens the World Map panel, flips the new "Use global dressing" toggle, and lets
// it regenerate — asserting the panel renders the toggle and nothing throws.
// Usage: node scripts/verify-worldmap-panel.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};
const clickReal = async (page, selector) => {
  const el = await page.$(selector);
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx, { timeout: 20000 });

// Boot into the Builder (dev mode restores the saved top-level mode on reload).
await page.evaluate(() => sessionStorage.setItem('ad-mode', 'builder'));
await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => document.body.classList.contains('builder-open'), { timeout: 20000 });
await page.waitForSelector('#b-world-map', { timeout: 10000, state: 'attached' });

// Open the World Map panel. The chrome button lives in a collapsed toolbar group,
// so invoke its real click handler (it routes to runUiCommand) to reach the panel.
const opened = await page.$eval('#b-world-map', (b) => { b.click(); return true; }).catch(() => false);
check('World Map button opens the panel', opened);
await page.waitForSelector('#vw-global-dressing', { timeout: 10000, state: 'attached' }).catch(() => {});
const toggle = await page.$('#vw-global-dressing');
check('World Map panel exposes the "Use global dressing" toggle', !!toggle);

if (toggle) {
  // Prefer a real hit-tested click on the actual control under test; fall back to
  // the native click handler if the section it lives in is collapsed (no box).
  const realClicked = await clickReal(page, '#vw-global-dressing');
  if (!realClicked) await page.$eval('#vw-global-dressing', (el) => el.click());
  await page.waitForTimeout(1800); // let the regenerate fire + settle
  const checked = await page.$eval('#vw-global-dressing', (el) => el.checked).catch(() => null);
  check('toggling global dressing flips the checkbox without throwing', checked === true, `checked=${checked} realClick=${realClicked}`);
  // Status line should not be an error after a global-dressing regenerate.
  const status = await page.$eval('#builder-virtual-world', (el) => el.textContent || '').catch(() => '');
  check('panel did not report an error after regenerate', !/error/i.test(status), status.slice(0, 120));
}

check('no page errors while driving the World Map panel', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\nworldmap-panel probe: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

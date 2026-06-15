// Dock tab-strip scrolling probe:
//  1) clicking an overflowed (scrolled-right) tab keeps it visible instead of
//     snapping the strip back to the start, and
//  2) the mouse wheel over the strip scrolls the tabs horizontally.
// Usage: node scripts/verify-tab-scroll.mjs [url]  (dev server must be running)
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5191/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('dialog', (d) => d.accept());
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
await page.click('#mode-builder-btn');
await page.waitForTimeout(400);

const SEL = '#builder-dock-right .builder-dock-tabs .editor-tabs-list';

// Stack several right-dock panels into a tab group (the View menu keeps itself
// open on checkable items, so one open + three clicks does it).
await page.click('.builder-menu-btn[data-menu="view"]');
await page.waitForTimeout(120);
for (const id of ['b-worldgen', 'b-global', 'b-postfx']) {
  await page.click('#' + id);
  await page.waitForTimeout(180);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

const info = () => page.evaluate((sel) => {
  const list = document.querySelector(sel);
  if (!list) return null;
  const lr = list.getBoundingClientRect(); // client coords already account for scroll
  const tabs = [...list.querySelectorAll('.editor-tab')].map((t) => {
    const r = t.getBoundingClientRect();
    return {
      id: t.dataset.tabId,
      active: t.classList.contains('active'),
      visible: r.right > lr.left + 4 && r.left < lr.right - 4,
    };
  });
  return {
    scrollLeft: list.scrollLeft,
    clientWidth: list.clientWidth,
    overflow: list.scrollWidth - list.clientWidth > 1,
    tabs,
  };
}, SEL);

const center = () => page.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, SEL);

let s = await info();
check('right dock formed a tab group', !!s && s.tabs.length >= 4, JSON.stringify(s?.tabs?.map((t) => t.id)));
check('tab strip overflows (some tabs hidden)', !!s && s.overflow, JSON.stringify({ ov: s?.overflow, w: s?.clientWidth }));

/* ---------- mouse-wheel scrolls the tabs horizontally ---------- */
console.log('-- wheel scroll');
const c = await center();
await page.mouse.move(c.x, c.y);
await page.mouse.wheel(0, -800); // start from the far left
await page.waitForTimeout(120);
const beforeWheel = (await info()).scrollLeft;
await page.mouse.wheel(0, 240); // vertical wheel notch(es) -> horizontal tab scroll
await page.waitForTimeout(120);
const afterWheel = (await info()).scrollLeft;
check('wheel down scrolls the tabs right', afterWheel > beforeWheel + 20, `before=${beforeWheel} after=${afterWheel}`);
await page.mouse.wheel(0, -400);
await page.waitForTimeout(120);
check('wheel up scrolls the tabs back left', (await info()).scrollLeft < afterWheel - 20, `after=${afterWheel}`);

/* ---------- clicking a scrolled-right tab keeps it visible ---------- */
console.log('-- click an overflowed tab preserves scroll');
await page.mouse.wheel(0, 800); // scroll to the far right
await page.waitForTimeout(150);
s = await info();
const scrolled = s.scrollLeft;
check('scrolled to reveal right-side tabs', scrolled > 20, `scrollLeft=${scrolled}`);
const target = s.tabs.filter((t) => t.visible && !t.active).at(-1) ?? s.tabs.filter((t) => t.visible).at(-1);
check('found a visible right-side tab to click', !!target, JSON.stringify(s.tabs));
if (target) {
  await page.click(`#builder-dock-right .builder-dock-tabs .editor-tab[data-tab-id="${target.id}"]`);
  await page.waitForTimeout(200);
  s = await info();
  const clicked = s.tabs.find((t) => t.id === target.id);
  check('clicked tab became active', !!clicked && clicked.active, JSON.stringify(clicked));
  check('scroll was NOT reset to the start', s.scrollLeft > 20, `scrollLeft=${s.scrollLeft}`);
  check('clicked tab stays visible (bug fixed)', !!clicked && clicked.visible, JSON.stringify(clicked));
}

check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);

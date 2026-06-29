// Dock-resize sash probe: VS Code-style splitters at each dock's inner edge.
// Drags each splitter and asserts the dock grows; verifies persistence across reload.
// Usage: node scripts/verify-builder-splitters.mjs [url]  (dev server must be running)
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1500);
await page.click('#mode-builder-btn');
await page.waitForTimeout(500);

const grid = () => page.evaluate(() => {
  const s = getComputedStyle(document.getElementById('builder-workspace-body'));
  const c = s.gridTemplateColumns.split(' ').map(parseFloat);
  const r = s.gridTemplateRows.split(' ').map(parseFloat);
  return { left: c[0], right: c[c.length - 1], bottom: r[r.length - 1] };
});

const splitterBox = (dock) => page.evaluate((d) => {
  const el = document.querySelector('.builder-splitter-' + d);
  if (!el || getComputedStyle(el).display === 'none') return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}, dock);

const drag = async (dock, dx, dy) => {
  const box = await splitterBox(dock);
  if (!box) return false;
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  // intermediate move proves live-resize during the drag, not only on drop
  await page.mouse.move(box.x + dx / 2, box.y + dy / 2, { steps: 8 });
  await page.mouse.move(box.x + dx, box.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(160);
  return true;
};

// Open a bottom-dock panel (Asset Browser) via the View menu so the bottom
// splitter is present. Real clicks — synthetic events fall through the menu.
const openAssetBrowser = async () => {
  await page.click('.builder-menu-btn[data-menu="view"]');
  await page.waitForTimeout(120);
  await page.click('#b-assets');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); // menu stays open by design; dismiss it
  await page.waitForTimeout(120);
};
await openAssetBrowser();

console.log('-- splitters present');
const v0 = await grid();
const haveLeft = !!(await splitterBox('left'));
const haveRight = !!(await splitterBox('right'));
const haveBottom = !!(await splitterBox('bottom'));
console.log(`  docks: left=${v0.left|0} right=${v0.right|0} bottom=${v0.bottom|0}  splitters: L=${haveLeft} R=${haveRight} B=${haveBottom}`);
check('at least one dock splitter is rendered', haveLeft || haveRight || haveBottom);

console.log('-- live drag resize');
if (haveRight) {
  const before = (await grid()).right;
  await drag('right', -110, 0); // drag inward → wider right dock
  const after = (await grid()).right;
  check('drag right splitter widens the right dock', after > before + 30, `before=${before|0} after=${after|0}`);
}
if (haveLeft) {
  const before = (await grid()).left;
  await drag('left', 110, 0); // drag outward → wider left dock
  const after = (await grid()).left;
  check('drag left splitter widens the left dock', after > before + 30, `before=${before|0} after=${after|0}`);
}
if (haveBottom) {
  const before = (await grid()).bottom;
  await drag('bottom', 0, -90); // drag up → taller bottom dock
  const after = (await grid()).bottom;
  check('drag bottom splitter grows the bottom dock', after > before + 25, `before=${before|0} after=${after|0}`);
}

console.log('-- clamp (cannot drag a side dock past max)');
if (haveRight) {
  await drag('right', -2000, 0);
  const huge = (await grid()).right;
  check('right dock clamps to a sane maximum', huge <= 600, `got ${huge|0}`);
  await drag('right', 2000, 0);
  const small = (await grid()).right;
  // floor is max(dock floor 160, panel minSize 220) → bottoms out around the panel min
  check('right dock clamps to a sane minimum', small >= 160 && small <= 240, `got ${small|0}`);
}

console.log('-- persistence across reload');
let persisted = null;
if (haveRight) {
  await drag('right', -80, 0);
  const target = (await grid()).right;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
  await page.waitForTimeout(1200);
  // Dev mode persistence may already have reopened the Builder on reload; only
  // click to open it if it isn't already (a click would otherwise toggle it shut).
  const reopened = await page.evaluate(() => document.body.classList.contains('builder-open'));
  if (!reopened) await page.click('#mode-builder-btn');
  await page.waitForTimeout(500);
  const restored = (await grid()).right;
  persisted = { target, restored };
  check('right dock size survives reload', Math.abs(restored - target) <= 8, JSON.stringify(persisted));
}

check('no page errors during resize', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);

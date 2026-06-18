// Side-dock vertical split + empty-dock drop-guide probe. Locks in the Builder
// docking behavior that is otherwise only manually verified: dragging a tab into
// the bottom zone of a side dock creates a top/bottom split; dragging the bottom
// panel out collapses it; an empty dock shows a single full-area drop guide (no
// doubled indicator); and every empty-dock guide brightens on hover.
// Usage: node scripts/verify-builder-dock-split.mjs [url]  (dev server must be running)
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
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

const enterBuilder = async () => {
  const open = await page.evaluate(() => document.body.classList.contains('builder-open'));
  if (!open) await page.click('#mode-builder-btn');
  await page.waitForFunction(() => document.body.classList.contains('builder-open'), { timeout: 10000 });
  await page.waitForTimeout(350);
};

// Seed a workspace layout (sanitize fills the rest), reload, re-enter the Builder.
const seed = async (panels) => {
  await page.evaluate((p) => localStorage.setItem('noita-builder-workspace-v1', JSON.stringify({ panels: p })), panels);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
  await page.waitForTimeout(900);
  await enterBuilder();
};

// Pointer drag a source element to (x,y); a sub-threshold first move starts the
// live drag, then we glide to the target so live drop-targeting runs.
const dragTo = async (startX, startY, x, y) => {
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 10, { steps: 4 });
  await page.mouse.move(x, y, { steps: 10 });
};

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1200);
await enterBuilder();

// ---------------------------------------------------------------------------
console.log('-- render: a seeded right-dock split shows two stacked panes + splitter');
await seed([
  { id: 'builder-palette', dock: 'left', open: false, size: 214 },
  { id: 'builder-inspector', dock: 'right', open: true, size: 252, tabGroupId: 'right-top' },
  { id: 'builder-issues', dock: 'right', open: true, size: 252, height: 280, tabGroupId: 'right-bottom' },
]);
const rendered = await page.evaluate(() => {
  const right = document.getElementById('builder-dock-right');
  return {
    panes: [...right.querySelectorAll('.builder-side-pane')].map((p) => p.dataset.sidePane),
    splitter: !!right.querySelector('.builder-side-pane-splitter'),
    hasSplits: right.classList.contains('has-splits'),
  };
});
check('two side panes (top + bottom) render', rendered.panes.length === 2 && rendered.panes.includes('top') && rendered.panes.includes('bottom'), JSON.stringify(rendered.panes));
check('a horizontal splitter sits between them', rendered.splitter);
check('the dock is flagged has-splits', rendered.hasSplits);

// ---------------------------------------------------------------------------
console.log('-- interaction: drag a tab into the bottom zone → split; drag it out → collapse');
await seed([
  { id: 'builder-palette', dock: 'left', open: false, size: 214 },
  { id: 'builder-inspector', dock: 'right', open: true, size: 252 },
  { id: 'builder-global', dock: 'right', open: true, size: 252 },
]);
const tabBox = await page.evaluate(() => {
  const t = document.querySelector('#builder-dock-right .builder-dock-tabs .editor-tab[data-tab-id="builder-global"]');
  const d = document.getElementById('builder-dock-right');
  if (!t || !d) return null;
  const tr = t.getBoundingClientRect();
  const dr = d.getBoundingClientRect();
  return { tx: tr.left + tr.width / 2, ty: tr.top + tr.height / 2, cx: dr.left + dr.width / 2, bottomY: dr.bottom - 25 };
});
check('right dock starts as a flat 2-tab group', !!tabBox);
if (tabBox) {
  await dragTo(tabBox.tx, tabBox.ty, tabBox.cx, tabBox.bottomY);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const split = await page.evaluate(() => document.querySelectorAll('#builder-dock-right .builder-side-pane').length);
  check('drop in the bottom zone creates a vertical split', split === 2, `panes=${split}`);

  const handle = await page.evaluate(() => {
    const h = document.querySelector('#builder-dock-right .builder-side-pane-bottom [data-panel-handle]');
    const d = document.getElementById('builder-dock-right');
    if (!h || !d) return null;
    const hr = h.getBoundingClientRect();
    const dr = d.getBoundingClientRect();
    return { hx: hr.left + hr.width / 2, hy: hr.top + hr.height / 2, cx: dr.left + dr.width / 2, topY: dr.top + dr.height * 0.2 };
  });
  if (handle) {
    await dragTo(handle.hx, handle.hy, handle.cx, handle.topY);
    await page.mouse.up();
    await page.waitForTimeout(200);
    const collapsed = await page.evaluate(() => document.querySelectorAll('#builder-dock-right .builder-side-pane').length);
    check('dragging the bottom panel out collapses back to a flat dock', collapsed === 0, `panes=${collapsed}`);
  } else {
    check('bottom pane panel handle is draggable', false, 'no [data-panel-handle] in bottom pane');
  }
}

// ---------------------------------------------------------------------------
console.log('-- guides: empty dock = one full-area drop target, no doubled indicator, brightens on hover');
await seed([
  { id: 'builder-palette', dock: 'left', open: false, size: 214 },
  { id: 'builder-inspector', dock: 'right', open: true, size: 252 },
  { id: 'builder-global', dock: 'right', open: true, size: 252 },
]);
const startTab = await page.evaluate(() => {
  const t = document.querySelector('#builder-dock-right .builder-dock-tabs .editor-tab[data-tab-id="builder-global"]');
  if (!t) return null;
  const tr = t.getBoundingClientRect();
  return { tx: tr.left + tr.width / 2, ty: tr.top + tr.height / 2 };
});
if (startTab) {
  await dragTo(startTab.tx, startTab.ty, 60, 500); // hold over the empty LEFT dock
  const left = await page.evaluate(() => {
    const g = document.getElementById('builder-dock-guide-left');
    const ind = document.querySelector('.builder-drop-indicator');
    const r = g.getBoundingClientRect();
    return {
      visible: getComputedStyle(g).display !== 'none',
      dropTarget: g.classList.contains('drop-target'),
      height: Math.round(r.height),
      indicatorVisible: ind ? getComputedStyle(ind).display !== 'none' : false,
    };
  });
  check('empty left dock shows one full-height guide as the drop target', left.visible && left.dropTarget && left.height > 400, JSON.stringify(left));
  check('the separate drop indicator is suppressed over the guide', left.indicatorVisible === false, JSON.stringify(left));

  const bg = await page.evaluate(() => {
    const r = document.getElementById('builder-dock-guide-bottom').getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  await page.mouse.move(bg.cx, bg.cy, { steps: 8 });
  const bottom = await page.evaluate(() => {
    const g = document.getElementById('builder-dock-guide-bottom');
    return { dropTarget: g.classList.contains('drop-target'), opacity: getComputedStyle(g).opacity };
  });
  check('bottom dock guide brightens on hover, like the side guides', bottom.dropTarget && parseFloat(bottom.opacity) >= 0.99, JSON.stringify(bottom));
  await page.mouse.up();
}

check('no page errors during the probe', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);

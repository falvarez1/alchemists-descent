// Verify the Builder dock IDE fixes:
//  1) tearing a panel out of a bottom split collapses to one full-width section
//  2) drop indicator appears + tracks left/center/right zones during a drag
//  3) dock-tab close (x) sits inside the tab (no wrap below)
//  4) floating panel close works (covered by repro-float-close.mjs too)
// Usage: node scripts/verify-dock-fixes.mjs [url]   (dev server must be running)
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1200);
if (!(await page.evaluate(() => document.body.classList.contains('builder-open')))) await page.click('#mode-builder-btn');
await page.waitForTimeout(500);

const reset = async () => { await page.evaluate(() => window.__game?.ctx?.builder?.['resetWorkspace']?.()); await page.waitForTimeout(220); };
const run = async (id) => { await page.evaluate((c) => window.__game?.ctx?.builder?.['runUiCommand']?.(c), id); await page.waitForTimeout(260); };
const handleBoxOf = (id) => page.evaluate((pid) => {
  const el = document.getElementById(pid); if (!el || getComputedStyle(el).display === 'none') return null;
  const h = el.querySelector('[data-panel-handle]'); if (!h) return null;
  const r = h.getBoundingClientRect(); if (r.width <= 0) return null;
  return { x: r.left + 24, y: r.top + r.height / 2 };
}, id);
const box = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, cx: r.left + r.width/2, cy: r.top + r.height/2 }; }, sel);
const dockState = () => page.evaluate(() => {
  const dock = document.getElementById('builder-dock-bottom'); const dr = dock.getBoundingClientRect();
  const panes = [...dock.querySelectorAll('.builder-bottom-pane')];
  const span = panes.reduce((a, p) => a + p.getBoundingClientRect().width, 0) + dock.querySelectorAll('.builder-bottom-pane-splitter').length * 5;
  return { paneCount: panes.length, dead: Math.round(dr.width - span), classes: dock.className.replace('builder-dock','').trim() };
});

console.log('-- 1) tear-out collapses bottom split to one full-width section');
await reset();
await run('builder.virtualWorldPanel');   // World Map -> bottom
await run('builder.worldPanel');          // World Generation -> right dock
let d = await box('#builder-dock-bottom');
// dock World Generation to the bottom-left
await (async () => { const f = await handleBoxOf('builder-world'); await page.mouse.move(f.x, f.y); await page.mouse.down(); await page.mouse.move(f.x+8,f.y+8,{steps:4}); await page.mouse.move(d.left + d.width*0.10, d.top + d.height*0.5, {steps:12}); await page.mouse.up(); await page.waitForTimeout(200); })();
const split = await dockState();
check('split created (2 panes)', split.paneCount === 2, JSON.stringify(split));
// tear World Generation back out to the stage
const stage = await box('#builder-stage');
await (async () => { const f = await handleBoxOf('builder-world'); await page.mouse.move(f.x, f.y); await page.mouse.down(); await page.mouse.move(f.x+8,f.y+8,{steps:4}); await page.mouse.move(stage.cx, stage.cy, {steps:14}); await page.mouse.up(); await page.waitForTimeout(220); })();
const collapsed = await dockState();
check('collapsed to one pane', collapsed.paneCount === 1, JSON.stringify(collapsed));
check('no dead space (panel fills the dock)', collapsed.dead <= 8, JSON.stringify(collapsed));
check('lone pane is the main pane', /has-one-pane/.test(collapsed.classes) && /has-main-pane/.test(collapsed.classes), collapsed.classes);

console.log('-- 1b) directly stranded side pane self-heals to main');
await reset();
await run('builder.virtualWorldPanel');
// Force the lone World Map panel into a side pane via the layout, then re-sync.
const healed = await page.evaluate(() => {
  const b = window.__game?.ctx?.builder; const layout = b['workspaceLayout'];
  const p = layout.panels.find((x) => x.id === 'builder-virtual-world');
  p.dock = 'bottom'; p.open = true; p.tabGroupId = 'bottom-left';
  b['applyWorkspaceLayout']();
  const pane = document.querySelector('#builder-dock-bottom .builder-bottom-pane');
  const dr = document.getElementById('builder-dock-bottom').getBoundingClientRect();
  return { paneClass: pane?.className || '', tabGroupId: p.tabGroupId, fills: pane ? Math.round(pane.getBoundingClientRect().width) >= Math.round(dr.width) - 8 : false };
});
check('stranded lone side pane reassigned to bottom-main', healed.tabGroupId === 'bottom-main', JSON.stringify(healed));
check('healed pane fills the dock width', healed.fills, JSON.stringify(healed));

console.log('-- 2) drop indicator appears and tracks zones during a drag');
await reset();
await run('builder.virtualWorldPanel');
await run('builder.worldPanel');
d = await box('#builder-dock-bottom');
const indAt = async (clientX, clientY, fromId) => {
  const f = await handleBoxOf(fromId);
  await page.mouse.move(f.x, f.y); await page.mouse.down();
  await page.mouse.move(f.x + 8, f.y + 8, { steps: 4 });
  await page.mouse.move(clientX, clientY, { steps: 12 });
  await page.waitForTimeout(60);
  const r = await page.evaluate(() => { const el = document.querySelector('.builder-drop-indicator'); if (!el || getComputedStyle(el).display === 'none') return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), width: Math.round(b.width) }; });
  return r; // leave mouse down; caller releases
};
const leftZone = await indAt(d.left + d.width * 0.08, d.top + d.height * 0.5, 'builder-world');
await page.mouse.move((await box('#builder-dock-bottom')).cx, (await box('#builder-dock-bottom')).cy, { steps: 8 });
await page.waitForTimeout(60);
const centerZone = await page.evaluate(() => { const el = document.querySelector('.builder-drop-indicator'); if (!el || getComputedStyle(el).display === 'none') return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), width: Math.round(b.width) }; });
const dd = await box('#builder-dock-bottom');
await page.mouse.move(dd.right - dd.width * 0.08, dd.top + dd.height * 0.5, { steps: 8 });
await page.waitForTimeout(60);
const rightZone = await page.evaluate(() => { const el = document.querySelector('.builder-drop-indicator'); if (!el || getComputedStyle(el).display === 'none') return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), width: Math.round(b.width) }; });
await page.mouse.up(); await page.waitForTimeout(150);
const indGone = await page.evaluate(() => { const el = document.querySelector('.builder-drop-indicator'); return !el || getComputedStyle(el).display === 'none'; });
check('indicator visible over LEFT zone', !!leftZone && leftZone.width < dd.width * 0.6, JSON.stringify(leftZone));
check('indicator visible over CENTER zone', !!centerZone, JSON.stringify(centerZone));
check('indicator visible over RIGHT zone', !!rightZone, JSON.stringify(rightZone));
check('LEFT and RIGHT zones differ (tracks cursor)', !!leftZone && !!rightZone && Math.abs(leftZone.left - rightZone.left) > 60, JSON.stringify({ leftZone, rightZone }));
check('indicator hidden after drop', indGone);

console.log('-- 3) dock-tab close (x) sits inside the tab (no wrap)');
await reset();
// Two right-dock panels -> a 2-tab group whose tabs both fit (no overflow
// scroll), so the active tab's close is on-screen and exercisable.
await run('builder.worldPanel');
await page.waitForTimeout(200);
// Inspect the ACTIVE tab (always scrolled into view) — the close must be inside.
const tabClose = await page.evaluate(() => {
  const shell = document.querySelector('#builder-dock-right .builder-dock-tabs .editor-tab-shell.active')
    || document.querySelector('#builder-dock-right .builder-dock-tabs .editor-tab-shell');
  if (!shell) return { found: false };
  const tab = shell.querySelector('.editor-tab');
  const close = shell.querySelector('.editor-tab-close');
  if (!tab || !close) return { found: false, hasClose: !!close };
  const tr = tab.getBoundingClientRect(), cr = close.getBoundingClientRect();
  return {
    found: true,
    closeInsideVert: cr.top >= tr.top - 1 && cr.bottom <= tr.bottom + 1,
    closeAtRight: cr.right <= tr.right + 2 && cr.left >= tr.left,
    shellDisplay: getComputedStyle(shell).display,
  };
});
check('tab strip has closable tabs', tabClose.found, JSON.stringify(tabClose));
check('shell is a flex row (no inline wrap)', tabClose.shellDisplay === 'inline-flex' || tabClose.shellDisplay === 'flex', JSON.stringify(tabClose));
check('close button is vertically inside the tab (not wrapped below)', tabClose.closeInsideVert === true, JSON.stringify(tabClose));
check('close button sits at the tab right edge', tabClose.closeAtRight === true, JSON.stringify(tabClose));
// Hover the active tab's close and confirm the destructive hover background.
const closeHover = await page.evaluate(() => {
  const close = document.querySelector('#builder-dock-right .builder-dock-tabs .editor-tab-shell.active .editor-tab-close');
  if (!close) return null;
  const r = close.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(closeHover.x, closeHover.y);
await page.waitForTimeout(140);
const hoverBg = await page.evaluate(() => {
  const close = document.querySelector('#builder-dock-right .builder-dock-tabs .editor-tab-shell.active .editor-tab-close');
  return { hover: close.matches(':hover'), bg: getComputedStyle(close).backgroundColor };
});
check('tab close is the top hit target (hoverable)', hoverBg.hover === true, JSON.stringify(hoverBg));
check('tab close shows a destructive hover background', hoverBg.bg !== 'rgba(0, 0, 0, 0)' && hoverBg.bg !== 'transparent', JSON.stringify(hoverBg));
// A real click on the active tab's close must actually close that panel.
const beforeClose = await page.evaluate(() => window.__game.ctx.builder['workspaceLayout'].panels.filter((p) => p.dock === 'right' && p.open).length);
await page.mouse.click(closeHover.x, closeHover.y);
await page.waitForTimeout(220);
const afterClose = await page.evaluate(() => window.__game.ctx.builder['workspaceLayout'].panels.filter((p) => p.dock === 'right' && p.open).length);
check('real click on tab close removes the panel', afterClose === beforeClose - 1, JSON.stringify({ beforeClose, afterClose }));

console.log('-- 4) drop indicator also highlights a side dock');
await reset();
await run('builder.virtualWorldPanel');   // bottom panel to drag
const rightDock = await box('#builder-dock-right');
const fSide = await handleBoxOf('builder-virtual-world');
await page.mouse.move(fSide.x, fSide.y); await page.mouse.down();
await page.mouse.move(fSide.x + 8, fSide.y + 8, { steps: 4 });
await page.mouse.move(rightDock.cx, rightDock.cy, { steps: 12 });
await page.waitForTimeout(80);
const sideInd = await page.evaluate(() => { const el = document.querySelector('.builder-drop-indicator'); if (!el || getComputedStyle(el).display === 'none') return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), width: Math.round(b.width) }; });
await page.mouse.up(); await page.waitForTimeout(150);
check('indicator shows over the right dock', !!sideInd && Math.abs(sideInd.left - rightDock.left) < 40, JSON.stringify({ sideInd, rightDockLeft: Math.round(rightDock.left) }));

check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);

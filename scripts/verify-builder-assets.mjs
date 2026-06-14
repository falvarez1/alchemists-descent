// Project Asset Browser probe: unified index, search/filter/details, sprite
// drag-to-stage placement, safe-delete usage blocking, and durable import reports.
// Usage: node scripts/verify-builder-assets.mjs [url]  (dev server running)
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
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.addInitScript(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('noita-builder-sprite:asset-probe')) localStorage.removeItem(key);
    if (!key.startsWith('noita-builder-import-report:')) continue;
    try {
      const report = JSON.parse(localStorage.getItem(key) || 'null');
      if (String(report?.sourceFile || '').startsWith('asset-probe-')) localStorage.removeItem(key);
    } catch {
      localStorage.removeItem(key);
    }
  }
  const px = btoa(String.fromCharCode(255, 80, 12, 255));
  localStorage.setItem(
    'noita-builder-sprite:asset-probe-sprite',
    JSON.stringify({
      v: 1,
      kind: 'sprite',
      id: 'asset-probe-sprite',
      name: 'Asset Probe Torch',
      w: 1,
      h: 1,
      frames: [{ durationMs: 100, px }],
      tags: [{ name: 'idle', from: 0, to: 0, dir: 'forward' }],
      emissive: true,
    }),
  );
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1800);
await page.click('#mode-builder-btn');
await page.waitForTimeout(300);

console.log('-- asset browser open/search/filter/details');
await page.click('#b-assets');
await page.waitForTimeout(200);

const openState = await page.evaluate(() => {
  const panel = document.getElementById('builder-assets');
  return {
    open: panel && getComputedStyle(panel).display !== 'none',
    rows: document.querySelectorAll('#builder-assets .ba-card, #builder-assets .ba-row').length,
    hasSprite: Boolean(document.querySelector('#builder-assets [data-asset-id="sprite:library:asset-probe-sprite"]')),
    hasBuiltin: [...document.querySelectorAll('#builder-assets [data-asset-id]')]
      .some((el) => String(el.getAttribute('data-asset-id')).startsWith('prefab:built-in:')),
    hasMaterial: [...document.querySelectorAll('#builder-assets [data-asset-id]')]
      .some((el) => String(el.getAttribute('data-asset-id')).startsWith('materialProfile:built-in:')),
  };
});
check('asset browser opens with unified indexed assets', openState.open && openState.rows > 5 && openState.hasSprite && openState.hasBuiltin && openState.hasMaterial, JSON.stringify(openState));

const dockLayout = await page.evaluate(() => {
  const panel = document.getElementById('builder-assets');
  const dock = document.getElementById('builder-dock-bottom');
  const rightDock = document.getElementById('builder-dock-right');
  const toolbar = panel?.querySelector('.ba-toolbar');
  const sourceRail = panel?.querySelector('.ba-sources');
  const content = panel?.querySelector('.ba-content');
  if (!panel || !dock || !rightDock || !toolbar || !sourceRail || !content) return { missing: true };
  const panelRect = panel.getBoundingClientRect();
  const dockRect = dock.getBoundingClientRect();
  const rightRect = rightDock.getBoundingClientRect();
  const cardRects = [...panel.querySelectorAll('.ba-card')].map((el) => {
    const rect = el.getBoundingClientRect();
    return { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width) };
  });
  const firstTop = cardRects[0]?.top ?? 0;
  const toolbarTops = [...toolbar.children].map((el) => Math.round(el.getBoundingClientRect().top));
  const toolbarTopSpread = toolbarTops.length > 0 ? Math.max(...toolbarTops) - Math.min(...toolbarTops) : 0;
  const nameStyles = [...panel.querySelectorAll('.ba-name, .ba-meta')].slice(0, 12).map((el) => {
    const style = getComputedStyle(el);
    return {
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  return {
    parentId: panel.parentElement?.id ?? '',
    position: getComputedStyle(panel).position,
    contained:
      panelRect.left >= dockRect.left - 1 &&
      panelRect.right <= dockRect.right + 1 &&
      panelRect.top >= dockRect.top - 1 &&
      panelRect.bottom <= dockRect.bottom + 1,
    widthUsesDock: panelRect.width >= dockRect.width * 0.9,
    clearOfRightDock: panelRect.top >= rightRect.bottom - 1,
    sameRowCards: cardRects.filter((rect) => rect.top === firstTop).length,
    sourceRailWidth: Math.round(sourceRail.getBoundingClientRect().width),
    contentWidth: Math.round(content.getBoundingClientRect().width),
    sourceTree: Boolean(sourceRail.querySelector('[role="tree"]')),
    sourceChips: sourceRail.querySelectorAll('.ba-chip').length,
    sourceButtons: sourceRail.querySelectorAll('button').length,
    treeRows: sourceRail.querySelectorAll('[role="treeitem"]').length,
    expandedTreeGroups: sourceRail.querySelectorAll('[role="treeitem"][aria-expanded="true"]').length,
    selectedTreeRows: sourceRail.querySelectorAll('.ba-tree-row.active').length,
    toolbarOneRow: toolbarTops.length > 0 && toolbarTopSpread <= 1,
    ellipsisReady: nameStyles.length > 0 && nameStyles.every((style) =>
      style.overflow !== 'visible' && style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap'
    ),
  };
});
check(
  'asset browser is a contained bottom-dock content browser',
  dockLayout.parentId === 'builder-dock-bottom' &&
    dockLayout.position !== 'absolute' &&
    dockLayout.contained &&
    dockLayout.widthUsesDock &&
    dockLayout.clearOfRightDock &&
    dockLayout.sourceRailWidth >= 160 &&
    dockLayout.contentWidth >= 900 &&
    dockLayout.sourceTree &&
    dockLayout.sourceChips === 0 &&
    dockLayout.sourceButtons === 0 &&
    dockLayout.treeRows >= 12 &&
    dockLayout.expandedTreeGroups >= 1 &&
    dockLayout.selectedTreeRows >= 1,
  JSON.stringify(dockLayout),
);
check('asset browser toolbar and tiles flow horizontally', dockLayout.sameRowCards >= 5 && dockLayout.toolbarOneRow && dockLayout.ellipsisReady, JSON.stringify(dockLayout));

await page.click('[data-section-toggle="assetBrowser.types"]');
await page.waitForTimeout(80);
const collapseState = await page.evaluate(() => {
  const section = document.querySelector('#builder-assets [data-section="assetBrowser.types"]');
  const raw = localStorage.getItem('noita-builder-workspace-v1');
  let stored = false;
  try {
    stored = JSON.parse(raw || '{}')?.collapsedSections?.['assetBrowser.types'] === true;
  } catch {
    stored = false;
  }
  return {
    collapsed: section?.classList.contains('collapsed') ?? false,
    aria: section?.querySelector('[data-section-toggle]')?.getAttribute('aria-expanded') ?? '',
    stored,
  };
});
check('asset browser source sections collapse and persist in workspace layout', collapseState.collapsed && collapseState.aria === 'false' && collapseState.stored, JSON.stringify(collapseState));
await page.click('[data-section-toggle="assetBrowser.types"]');
await page.waitForTimeout(80);

const scrollSetup = await page.evaluate(() => {
  const rail = document.querySelector('#builder-assets .ba-sources');
  const list = document.querySelector('#builder-assets #ba-list');
  if (!(rail instanceof HTMLElement) || !(list instanceof HTMLElement)) return { missing: true };
  rail.scrollTop = rail.scrollHeight;
  const railBefore = rail.scrollTop;
  document.querySelector('#builder-assets [data-asset-kind-filter="materialProfile"]')?.click();
  return { railBefore };
});
await page.waitForTimeout(80);
const scrollRetention = await page.evaluate((setup) => {
  const railAfterEl = document.querySelector('#builder-assets .ba-sources');
  const railAfter = railAfterEl instanceof HTMLElement ? railAfterEl.scrollTop : -1;
  const nextList = document.querySelector('#builder-assets #ba-list');
  if (!(nextList instanceof HTMLElement)) return { missingListAfterFilter: true, railBefore: setup.railBefore, railAfter };
  nextList.scrollTop = Math.min(180, nextList.scrollHeight);
  const listBefore = nextList.scrollTop;
  const listRect = nextList.getBoundingClientRect();
  const visibleRow = [...document.querySelectorAll('#builder-assets [data-asset-id]')]
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + 12, y: rect.top + 12, top: rect.top, bottom: rect.bottom };
    })
    .find((row) => row.top >= listRect.top + 4 && row.bottom <= listRect.bottom - 4);
  return { railBefore: setup.railBefore, railAfter, listBefore, clickPoint: visibleRow ?? null };
}, scrollSetup);
if (scrollRetention.clickPoint) await page.mouse.click(scrollRetention.clickPoint.x, scrollRetention.clickPoint.y);
await page.waitForTimeout(80);
const scrollRetentionAfterClick = await page.evaluate((state) => {
  const listAfterEl = document.querySelector('#builder-assets #ba-list');
  const listAfter = listAfterEl instanceof HTMLElement ? listAfterEl.scrollTop : -1;
  document.querySelector('#builder-assets [data-asset-kind-filter="materialProfile"]')?.click();
  return { ...state, listAfter };
}, scrollRetention);
check(
  'asset browser keeps pane scroll positions after tree and asset clicks',
  scrollRetentionAfterClick.railBefore > 0 &&
    scrollRetentionAfterClick.railAfter >= scrollRetentionAfterClick.railBefore - 2 &&
    scrollRetentionAfterClick.clickPoint !== null &&
    scrollRetentionAfterClick.listBefore > 0 &&
    scrollRetentionAfterClick.listAfter >= scrollRetentionAfterClick.listBefore - 2,
  JSON.stringify(scrollRetentionAfterClick),
);

await page.fill('#ba-search', 'probe torch');
await page.waitForTimeout(120);
const searchState = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('#builder-assets .ba-card, #builder-assets .ba-row')].map((el) => el.textContent.toLowerCase()),
}));
check('asset browser search narrows to seeded sprite', searchState.rows.length === 1 && searchState.rows[0].includes('asset probe torch'), JSON.stringify(searchState));

await page.fill('#ba-search', '');
await page.click('[data-asset-kind-filter="sprite"]');
await page.waitForTimeout(120);
const spriteFilter = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('#builder-assets .ba-card, #builder-assets .ba-row')].map((el) => el.getAttribute('data-asset-id') ?? ''),
}));
check('kind filter shows only sprite assets', spriteFilter.rows.length >= 1 && spriteFilter.rows.every((id) => id.startsWith('sprite:')), JSON.stringify(spriteFilter));
await page.click('[data-asset-kind-filter="sprite"]');

await page.click('#builder-assets [data-asset-id="sprite:library:asset-probe-sprite"]');
await page.waitForTimeout(180);
const detailState = await page.evaluate(() => {
  const detail = document.getElementById('builder-asset-details');
  return {
    open: detail && getComputedStyle(detail).display !== 'none',
    text: detail?.textContent ?? '',
    deleteDisabled: detail?.querySelector('button[data-asset-action="delete"]')?.hasAttribute('disabled') ?? true,
  };
});
check('asset details panel opens with metadata and actions', detailState.open && detailState.text.includes('Asset Probe Torch') && !detailState.deleteDisabled, JSON.stringify(detailState));

console.log('-- sprite asset drag/drop and safe delete');
await page.evaluate(() => window.__game.ctx.camera.snapTo(600, 500));
const beforeMarkers = await page.locator('.b-marker').count();
await page.evaluate(() => {
  const source = document.querySelector('#builder-assets [data-asset-id="sprite:library:asset-probe-sprite"]');
  const overlay = document.getElementById('builder-overlay');
  if (!source || !overlay) throw new Error('asset drag elements missing');
  const r = overlay.getBoundingClientRect();
  const dt = new DataTransfer();
  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  overlay.dispatchEvent(new DragEvent('dragover', {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: r.left + r.width * 0.52,
    clientY: r.top + r.height * 0.58,
  }));
  overlay.dispatchEvent(new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: r.left + r.width * 0.52,
    clientY: r.top + r.height * 0.58,
  }));
});
await page.waitForTimeout(200);
const afterDrop = await page.evaluate((before) => ({
  markers: document.querySelectorAll('.b-marker').length,
  status: document.getElementById('builder-status')?.textContent ?? '',
  detail: document.getElementById('builder-asset-details')?.textContent ?? '',
  deleteDisabled: document.querySelector('#builder-asset-details button[data-asset-action="delete"]')?.hasAttribute('disabled') ?? false,
}), beforeMarkers);
check('sprite asset drops onto stage as animated decor', afterDrop.markers > beforeMarkers && afterDrop.status.includes('ANIMATED DECOR'), JSON.stringify(afterDrop));
check('safe delete blocks a referenced sprite and explains usage', afterDrop.deleteDisabled && afterDrop.detail.includes('usage') && afterDrop.detail.includes('Current'), JSON.stringify(afterDrop));
const afterTextDragMarkers = await page.evaluate(() => {
  const overlay = document.getElementById('builder-overlay');
  if (!overlay) throw new Error('asset drag overlay missing');
  const before = document.querySelectorAll('.b-marker').length;
  const r = overlay.getBoundingClientRect();
  const dt = new DataTransfer();
  dt.setData('text/plain', 'sprite:library:asset-probe-sprite');
  overlay.dispatchEvent(new DragEvent('dragover', {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: r.left + r.width * 0.48,
    clientY: r.top + r.height * 0.54,
  }));
  overlay.dispatchEvent(new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt,
    clientX: r.left + r.width * 0.48,
    clientY: r.top + r.height * 0.54,
  }));
  return { before, after: document.querySelectorAll('.b-marker').length };
});
check('stage ignores generic text/plain drags that look like asset ids', afterTextDragMarkers.after === afterTextDragMarkers.before, JSON.stringify(afterTextDragMarkers));

console.log('-- invalid import creates durable report asset');
const chooserPromise = page.waitForEvent('filechooser');
await page.click('#ba-import');
const chooser = await chooserPromise;
await chooser.setFiles({
  name: 'asset-probe-bad.json',
  mimeType: 'application/json',
  buffer: Buffer.from('{nope'),
});
await page.waitForTimeout(250);
await page.click('[data-asset-collection="imported"]');
await page.waitForTimeout(120);
const importState = await page.evaluate(() => ({
  reportRows: [...document.querySelectorAll('#builder-assets .ba-card, #builder-assets .ba-row')]
    .map((el) => el.textContent.toLowerCase()),
  storedReports: Object.keys(localStorage).filter((key) => key.startsWith('noita-builder-import-report:')).length,
  status: document.getElementById('builder-status')?.textContent ?? '',
}));
check('invalid JSON import appears as durable import report asset', importState.storedReports > 0 && importState.reportRows.some((text) => text.includes('asset-probe-bad')), JSON.stringify(importState));

check('no page errors during asset browser probe', pageErrors.length === 0, pageErrors.join('\n'));

await browser.close();
console.log(`\nverify-builder-assets: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

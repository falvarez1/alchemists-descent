// Project Asset Browser probe: unified index, search/filter/details, sprite
// drag-to-stage placement, safe-delete usage blocking, and durable import reports.
// Usage: node scripts/verify-builder-assets.mjs [url]  (dev server running)
import { readFile } from 'node:fs/promises';
import { launchBrowser } from './browser-launch.mjs';
import { isBenignDevConsoleError } from './run-helpers.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !isBenignDevConsoleError(msg.text())) consoleErrors.push(msg.text());
});

await page.addInitScript(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('noita-builder-doc:asset-probe')) localStorage.removeItem(key);
    if (key.startsWith('noita-builder-sprite:asset-probe')) localStorage.removeItem(key);
    if (!key.startsWith('noita-builder-import-report:')) continue;
    try {
      const report = JSON.parse(localStorage.getItem(key) || 'null');
      const sourceFile = String(report?.sourceFile || '');
      const importedAssetId = String(report?.importedAssetId || '');
      const finalSourceId = String(report?.finalSourceId || '');
      const name = String(report?.name || '');
      if (
        sourceFile.startsWith('asset-probe-') ||
        sourceFile.includes('Asset Probe') ||
        importedAssetId.includes(':asset-probe') ||
        finalSourceId.startsWith('asset-probe') ||
        name.includes('Asset Probe')
      ) {
        localStorage.removeItem(key);
      }
    } catch {
      // Leave unrelated/corrupt project reports alone; this verifier only owns
      // parseable reports that carry the asset-probe marker.
    }
  }
  localStorage.setItem(
    'noita-builder-doc:asset-probe-open-doc',
    JSON.stringify({
      v: 2,
      id: 'asset-probe-open-doc',
      name: 'Asset Probe Open Doc',
      biome: 'frozen',
      size: { w: 1600, h: 1064 },
      world: null,
      objects: [{
        id: 'spawn-asset-probe',
        kind: 'spawn',
        x: 80,
        y: 80,
        rotation: 0,
        locked: false,
        hidden: false,
        params: {},
      }],
      links: [],
      lights: [],
      proceduralHistory: [],
      validation: null,
    }),
  );
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
  const deleteSpritePx = {
    a: btoa(String.fromCharCode(255, 80, 12, 255)),
    b: btoa(String.fromCharCode(80, 190, 255, 255)),
  };
  for (const suffix of ['a', 'b']) {
    localStorage.setItem(
      `noita-builder-sprite:asset-probe-delete-${suffix}`,
      JSON.stringify({
        v: 1,
        kind: 'sprite',
        id: `asset-probe-delete-${suffix}`,
        name: `Asset Probe Batch Delete ${suffix.toUpperCase()}`,
        w: 1,
        h: 1,
        frames: [{ durationMs: 100, px: deleteSpritePx[suffix] }],
        tags: [],
        emissive: false,
      }),
    );
  }
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(1800);
await page.click('#mode-builder-btn');
await page.waitForSelector('#builder-root .bp-swatch', { timeout: 15000 });

const clickBuilderStage = async (xFrac = 0.5, yFrac = 0.5) => {
  const point = await page.evaluate(({ xFrac: xf, yFrac: yf }) => {
    const overlay = document.getElementById('builder-overlay');
    if (!overlay) throw new Error('builder overlay missing');
    const r = overlay.getBoundingClientRect();
    return { x: r.left + r.width * xf, y: r.top + r.height * yf };
  }, { xFrac, yFrac });
  await page.mouse.click(point.x, point.y);
};

const dragAssetRowToStage = async (assetId, xFrac = 0.5, yFrac = 0.5) => {
  await page.waitForFunction(
    (id) => Boolean(document.querySelector(`#builder-assets [data-asset-id="${CSS.escape(id)}"]`)),
    assetId,
    { timeout: 5000 },
  ).catch(() => undefined);
  return page.evaluate(({ assetId: id, xFrac: xf, yFrac: yf }) => {
    const source = document.querySelector(`#builder-assets [data-asset-id="${CSS.escape(id)}"]`);
    const overlay = document.getElementById('builder-overlay');
    if (!source || !overlay) return { ok: false, reason: 'missing source or overlay' };
    source.scrollIntoView({ block: 'center', inline: 'nearest' });
    const overlayRect = overlay.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const draggable = source.getAttribute('draggable');
    const dt = new DataTransfer();
    const startOk = source.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: sourceRect.left + Math.min(12, sourceRect.width / 2),
      clientY: sourceRect.top + Math.min(12, sourceRect.height / 2),
    }));
    const payload = dt.getData('application/x-noita-asset-id');
    overlay.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: overlayRect.left + overlayRect.width * xf,
      clientY: overlayRect.top + overlayRect.height * yf,
    }));
    const dropOk = overlay.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: overlayRect.left + overlayRect.width * xf,
      clientY: overlayRect.top + overlayRect.height * yf,
    }));
    return { ok: payload === id, payload, draggable, startOk, dropOk };
  }, { assetId, xFrac, yFrac });
};

console.log('-- asset browser open/search/filter/details');
await page.click('[data-menu="view"]');
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
    hasCard: Boolean(document.querySelector('#builder-assets [data-asset-id="card:built-in:spark"]')),
    hasModifier: Boolean(document.querySelector('#builder-assets [data-asset-id="modifier:built-in:infuser"]')),
    hasPotion: Boolean(document.querySelector('#builder-assets [data-asset-id="potion:built-in:swift"]')),
    hasEnemy: Boolean(document.querySelector('#builder-assets [data-asset-id="enemy:built-in:slime"]')),
    hasCookReport: Boolean(document.querySelector('#builder-assets [data-asset-id="cookReport:built-in:builtin-content-cook"]')),
  };
});
check('asset browser opens with unified indexed assets', openState.open && openState.rows > 5 && openState.hasSprite && openState.hasBuiltin && openState.hasMaterial, JSON.stringify(openState));
check('asset browser indexes built-in gameplay content', openState.hasCard && openState.hasModifier && openState.hasPotion && openState.hasEnemy && openState.hasCookReport, JSON.stringify(openState));

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
    bottomPane: panel.closest('.builder-bottom-pane')?.getAttribute('data-bottom-pane') ?? '',
    dockId: panel.closest('#builder-dock-bottom')?.id ?? '',
    position: getComputedStyle(panel).position,
    contained:
      panelRect.left >= dockRect.left - 1 &&
      panelRect.right <= dockRect.right + 1 &&
      panelRect.top >= dockRect.top - 1 &&
      panelRect.bottom <= dockRect.bottom + 1,
    widthUsesDock: panelRect.width >= dockRect.width * 0.9,
    clearOfRightDock: panelRect.right <= rightRect.left + 1,
    sameRowCards: cardRects.filter((rect) => rect.top === firstTop).length,
    sourceRailWidth: Math.round(sourceRail.getBoundingClientRect().width),
    contentWidth: Math.round(content.getBoundingClientRect().width),
    sourceTree: Boolean(sourceRail.querySelector('[role="tree"]')),
    sourceChips: sourceRail.querySelectorAll('.ba-chip').length,
    sourceButtons: sourceRail.querySelectorAll('button').length,
    treeRows: sourceRail.querySelectorAll('[role="treeitem"]').length,
    expandedTreeGroups: sourceRail.querySelectorAll('[role="treeitem"][aria-expanded="true"]').length,
    selectedTreeRows: sourceRail.querySelectorAll('.ba-tree-row.active').length,
    contentGroup: Boolean(sourceRail.querySelector('[data-section="assetBrowser.content"]')),
    contentRows: sourceRail.querySelectorAll('[data-section="assetBrowser.content"] [role="treeitem"]').length,
    toolbarOneRow: toolbarTops.length > 0 && toolbarTopSpread <= 1,
    ellipsisReady: nameStyles.length > 0 && nameStyles.every((style) =>
      style.overflow !== 'visible' && style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap'
    ),
  };
});
check(
  'asset browser is a contained bottom-dock content browser',
  dockLayout.dockId === 'builder-dock-bottom' &&
    dockLayout.bottomPane === 'bottom-main' &&
    dockLayout.position !== 'absolute' &&
    dockLayout.contained &&
    dockLayout.widthUsesDock &&
    dockLayout.clearOfRightDock &&
    dockLayout.sourceRailWidth >= 160 &&
    dockLayout.contentWidth >= 700 &&
    dockLayout.sourceTree &&
    dockLayout.sourceChips === 0 &&
    dockLayout.sourceButtons === 0 &&
    dockLayout.treeRows >= 12 &&
    dockLayout.contentGroup &&
    dockLayout.contentRows >= 10 &&
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

await page.click('[data-asset-kind-filter="card"]');
await page.waitForTimeout(120);
const cardFilter = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('#builder-assets .ba-card, #builder-assets .ba-row')].map((el) => el.getAttribute('data-asset-id') ?? ''),
}));
check('content kind filter shows only spell card assets', cardFilter.rows.length >= 1 && cardFilter.rows.every((id) => id.startsWith('card:')), JSON.stringify(cardFilter));

await page.fill('#ba-search', 'spark');
await page.waitForTimeout(120);
const contentSearch = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('#builder-assets .ba-card, #builder-assets .ba-row')].map((el) => ({
    id: el.getAttribute('data-asset-id') ?? '',
    text: el.textContent.toLowerCase(),
  })),
}));
check(
  'asset browser search finds built-in spell content',
  contentSearch.rows.length === 1 &&
    contentSearch.rows[0].id === 'card:built-in:spark' &&
    contentSearch.rows[0].text.includes('spark bolt'),
  JSON.stringify(contentSearch),
);

await page.click('#builder-assets [data-asset-id="card:built-in:spark"]');
await page.waitForTimeout(180);
const contentDetail = await page.evaluate(() => {
  const detail = document.getElementById('builder-asset-details');
  return {
    open: detail && getComputedStyle(detail).display !== 'none',
    text: detail?.textContent ?? '',
    exportLabel: detail?.querySelector('button[data-asset-action="export"]')?.textContent?.trim() ?? '',
    duplicateDisabled: detail?.querySelector('button[data-asset-action="duplicate"]')?.hasAttribute('disabled') ?? false,
    deleteDisabled: detail?.querySelector('button[data-asset-action="delete"]')?.hasAttribute('disabled') ?? false,
    exportDisabled: detail?.querySelector('button[data-asset-action="export"]')?.hasAttribute('disabled') ?? true,
  };
});
check(
  'content asset details show source, status, dependencies, and immutable actions',
  contentDetail.open &&
    contentDetail.text.includes('Spark Bolt') &&
    contentDetail.text.includes('src/combat/wands/cards.ts:CARD_DEFS') &&
    contentDetail.text.includes('Status') &&
    contentDetail.text.includes('Dependencies') &&
    contentDetail.exportLabel === 'Export Metadata' &&
    contentDetail.duplicateDisabled &&
    contentDetail.deleteDisabled &&
    !contentDetail.exportDisabled,
  JSON.stringify(contentDetail),
);
await page.fill('#ba-search', '');
await page.click('[data-asset-kind-filter="card"]');
await page.waitForTimeout(120);

await page.click('[data-asset-collection="unused"]');
await page.waitForTimeout(120);
const unusedCollection = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('#builder-assets .ba-card, #builder-assets .ba-row')].map((el) => el.getAttribute('data-asset-id') ?? ''),
}));
check(
  'unused collection excludes immutable gameplay content noise',
  unusedCollection.rows.every((id) => !/^(card|modifier|wandFrame|wandLoadout|potion|elixir|recipe|material|enemy|encounterScenario|spellLabScenario|cookReport):built-in:/.test(id)),
  JSON.stringify(unusedCollection),
);
await page.click('[data-asset-collection="all"]');
await page.waitForTimeout(120);

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

console.log('-- reimport replaces local asset content with stable id');
const reimportChooserPromise = page.waitForEvent('filechooser');
await page.click('#builder-asset-details button[data-asset-action="reimport"]');
const reimportChooser = await reimportChooserPromise;
await reimportChooser.setFiles({
  name: 'asset-probe-reimport.sprite.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({
    v: 1,
    kind: 'sprite',
    id: 'asset-probe-sprite',
    name: 'Asset Probe Torch Reimported',
    w: 1,
    h: 1,
    frames: [{ durationMs: 120, px: Buffer.from([32, 220, 255, 255]).toString('base64') }],
    tags: [{ name: 'idle', from: 0, to: 0, dir: 'forward' }],
    emissive: false,
  })),
});
await page.waitForSelector('.app-dialog-panel', { timeout: 5000 });
const reimportDialog = await page.evaluate(() => document.querySelector('.app-dialog-panel')?.textContent ?? '');
await page.click('.app-dialog-btn.primary');
await page.waitForTimeout(250);
const reimportState = await page.evaluate((dialogText) => {
  const spriteKeys = Object.keys(localStorage).filter((key) => key.startsWith('noita-builder-sprite:asset-probe-sprite'));
  const sprite = JSON.parse(localStorage.getItem('noita-builder-sprite:asset-probe-sprite') || 'null');
  const reports = Object.keys(localStorage)
    .filter((key) => key.startsWith('noita-builder-import-report:'))
    .map((key) => {
      try { return JSON.parse(localStorage.getItem(key) || 'null'); }
      catch { return null; }
    })
    .filter(Boolean);
  const detail = document.getElementById('builder-asset-details')?.textContent ?? '';
  return {
    dialog: dialogText,
    spriteKeys,
    spriteName: sprite?.name ?? '',
    spriteEmissive: sprite?.emissive,
    reports: reports.map((report) => ({
      sourceFile: report.sourceFile,
      decision: report.decision,
      importedAssetId: report.importedAssetId,
      finalSourceId: report.finalSourceId,
    })),
    detail,
    status: document.getElementById('builder-status')?.textContent ?? '',
  };
}, reimportDialog);
check(
  'reimport shows diff and replaces sprite content without changing stable id',
  reimportState.dialog.includes('sprite:library:asset-probe-sprite') &&
    reimportState.dialog.includes('Content signature') &&
    reimportState.spriteKeys.length === 1 &&
    reimportState.spriteName === 'Asset Probe Torch Reimported' &&
    reimportState.spriteEmissive === false &&
    reimportState.detail.includes('Asset Probe Torch Reimported') &&
    reimportState.reports.some((report) =>
      report.sourceFile === 'asset-probe-reimport.sprite.json' &&
        report.decision === 'collision-replace' &&
        report.importedAssetId === 'sprite:library:asset-probe-sprite' &&
        report.finalSourceId === 'asset-probe-sprite'
    ),
  JSON.stringify(reimportState),
);

console.log('-- sprite asset drag/drop and safe delete');
await page.evaluate(() => window.__game.ctx.camera.snapTo(600, 500));
const beforeMarkers = await page.locator('.b-marker').count();
const spriteDrag = await dragAssetRowToStage('sprite:library:asset-probe-sprite', 0.52, 0.58);
await page.waitForTimeout(200);
const afterDrop = await page.evaluate(() => ({
  markers: document.querySelectorAll('.b-marker').length,
  status: document.getElementById('builder-status')?.textContent ?? '',
  detail: document.getElementById('builder-asset-details')?.textContent ?? '',
  deleteDisabled: document.querySelector('#builder-asset-details button[data-asset-action="delete"]')?.hasAttribute('disabled') ?? false,
}));
check('sprite asset row drag drops onto stage as animated decor', spriteDrag.ok && spriteDrag.draggable === 'true' && afterDrop.markers > beforeMarkers && afterDrop.status.includes('ANIMATED DECOR'), JSON.stringify({ spriteDrag, afterDrop }));
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

console.log('-- prefab asset drag/drop');
await page.click('[data-asset-collection="all"]');
await page.fill('#ba-search', 'Brazier Shrine');
await page.waitForTimeout(120);
const prefabAssetId = await page.evaluate(() =>
  document.querySelector('#builder-assets [data-asset-id^="prefab:built-in:"]')?.getAttribute('data-asset-id') ?? '',
);
const beforePrefabMarkers = await page.locator('.b-marker').count();
const prefabDrag = prefabAssetId ? await dragAssetRowToStage(prefabAssetId, 0.61, 0.57) : { ok: false, reason: 'no prefab row' };
await page.waitForTimeout(220);
const prefabDropState = await page.evaluate((before) => ({
  before,
  markers: document.querySelectorAll('.b-marker').length,
  status: document.getElementById('builder-status')?.textContent ?? '',
}), beforePrefabMarkers);
check(
  'prefab asset row drag drops onto stage through prefab placement path',
  prefabDrag.ok &&
    prefabDrag.draggable === 'true' &&
    prefabAssetId.startsWith('prefab:built-in:') &&
    prefabDropState.markers > prefabDropState.before &&
    /PASTED/.test(prefabDropState.status),
  JSON.stringify({ prefabAssetId, prefabDrag, prefabDropState }),
);

console.log('-- non-prefab asset drag/drop actions');
await page.click('[data-asset-collection="all"]');
await page.fill('#ba-search', 'Lava');
await page.waitForTimeout(120);
await page.click('#builder-root [data-kind="hazardEmitter"]');
await clickBuilderStage(0.47, 0.52);
await page.waitForTimeout(120);
const materialDrag = await dragAssetRowToStage('materialProfile:built-in:cell-11', 0.48, 0.53);
await page.waitForTimeout(180);
const materialDropState = await page.evaluate(() => ({
  status: document.getElementById('builder-status')?.textContent ?? '',
  activeMaterial: document.querySelector('#builder-root .bp-swatch.active')?.getAttribute('data-el') ?? '',
  emitterCell: document.querySelector('#builder-inspector select[data-p="cell"]')?.value ?? '',
  materialPanelOpen: getComputedStyle(document.getElementById('builder-matparams')).display !== 'none',
}));
check(
  'material profile drop arms the material and patches the compatible cursor target',
  materialDrag.ok &&
    materialDrag.draggable === 'true' &&
    materialDropState.activeMaterial === '11' &&
    materialDropState.emitterCell === 'lava' &&
    !materialDropState.materialPanelOpen &&
    /APPLIED LAVA/.test(materialDropState.status),
  JSON.stringify({ materialDrag, materialDropState }),
);

await page.fill('#ba-search', 'Torch');
await page.waitForTimeout(120);
const lightCountBeforePreset = await page.locator('.b-marker.k-light').count();
const torchDrag = await dragAssetRowToStage('lightPreset:built-in:torch', 0.56, 0.54);
await page.waitForTimeout(180);
const lightPlaceState = await page.evaluate((before) => ({
  before,
  lights: document.querySelectorAll('.b-marker.k-light').length,
  status: document.getElementById('builder-status')?.textContent ?? '',
  color: document.querySelector('#builder-inspector input[data-lf="color"]')?.value ?? '',
  radius: Number(document.querySelector('#builder-inspector input[data-lf="radius"]')?.value ?? 0),
}), lightCountBeforePreset);
check(
  'light preset drop creates an authored light through the document command path',
  torchDrag.ok &&
    torchDrag.draggable === 'true' &&
    lightPlaceState.lights === lightPlaceState.before + 1 &&
    lightPlaceState.color.toLowerCase() === '#ffb45a' &&
    lightPlaceState.radius === 48 &&
    /PLACED TORCH LIGHT/.test(lightPlaceState.status),
  JSON.stringify({ torchDrag, lightPlaceState }),
);

await page.fill('#ba-search', 'Crystal');
await page.waitForTimeout(120);
const crystalDrag = await dragAssetRowToStage('lightPreset:built-in:crystal', 0.56, 0.54);
await page.waitForTimeout(180);
const lightApplyState = await page.evaluate((previousLights) => ({
  previousLights,
  lights: document.querySelectorAll('.b-marker.k-light').length,
  status: document.getElementById('builder-status')?.textContent ?? '',
  color: document.querySelector('#builder-inspector input[data-lf="color"]')?.value ?? '',
  radius: Number(document.querySelector('#builder-inspector input[data-lf="radius"]')?.value ?? 0),
  falloff: document.querySelector('#builder-inspector select[data-lf="falloff"]')?.value ?? '',
}), lightPlaceState.lights);
check(
  'light preset drop applies when dropped onto an authored light instead of creating duplicates',
  crystalDrag.ok &&
    crystalDrag.draggable === 'true' &&
    lightApplyState.lights === lightApplyState.previousLights &&
    lightApplyState.color.toLowerCase() === '#7fd4ff' &&
    lightApplyState.radius === 40 &&
    lightApplyState.falloff === 'sharp' &&
    /APPLIED CRYSTAL TO 1 LIGHT/.test(lightApplyState.status),
  JSON.stringify({ crystalDrag, lightApplyState }),
);

await page.fill('#ba-search', 'Surface crowns');
await page.waitForTimeout(120);
const procDrag = await dragAssetRowToStage('procPreset:built-in:crowns', 0.52, 0.56);
await page.waitForTimeout(160);
const procDropState = await page.evaluate(() => ({
  procOpen: getComputedStyle(document.getElementById('builder-proc')).display !== 'none',
  pass: document.querySelector('#bp-pass')?.value ?? '',
  materialReadout: document.querySelector('#bp-material')?.textContent ?? '',
  status: document.getElementById('builder-status')?.textContent ?? '',
}));
check(
  'procedural preset drop opens and seeds the procedural panel without applying it',
  procDrag.ok &&
    procDrag.draggable === 'true' &&
    procDropState.procOpen &&
    procDropState.pass === 'crowns' &&
    procDropState.materialReadout.toLowerCase().includes('lava') &&
    /SEEDED PROCEDURAL PRESET/.test(procDropState.status),
  JSON.stringify({ procDrag, procDropState }),
);

console.log('-- multi-select batch export/delete');
await page.click('[data-asset-collection="all"]');
await page.waitForTimeout(100);
await page.fill('#ba-search', 'Asset Probe Batch Delete');
await page.waitForTimeout(120);
const batchRows = page.locator('#builder-assets .ba-card[data-asset-id^="sprite:library:asset-probe-delete-"], #builder-assets .ba-row[data-asset-id^="sprite:library:asset-probe-delete-"]');
await batchRows.nth(0).locator('input[data-asset-select]').click();
await batchRows.nth(1).click({ modifiers: ['Shift'] });
await batchRows.nth(0).click({ modifiers: ['Control'] });
await page.waitForTimeout(80);
await batchRows.nth(0).click({ modifiers: ['Control'] });
await page.waitForTimeout(120);
const multiSelectState = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('#builder-assets .ba-card[data-asset-id^="sprite:library:asset-probe-delete-"], #builder-assets .ba-row[data-asset-id^="sprite:library:asset-probe-delete-"]')].map((el) => ({
    id: el.getAttribute('data-asset-id') ?? '',
    multiSelected: el.classList.contains('multi-selected'),
    checked: el.querySelector('input[data-asset-select]')?.checked ?? false,
  })),
  selectedCount: document.querySelector('#builder-assets .ba-selected-count')?.textContent ?? '',
  visibleChecked: document.querySelector('#builder-assets #ba-select-visible')?.checked ?? false,
  exportDisabled: document.querySelector('#builder-assets #ba-batch-export')?.hasAttribute('disabled') ?? true,
  deleteDisabled: document.querySelector('#builder-assets #ba-batch-delete')?.hasAttribute('disabled') ?? true,
}));
check(
  'Asset Browser supports checkbox, Ctrl, and Shift multi-select',
  multiSelectState.rows.length === 2 &&
    multiSelectState.rows.every((row) => row.multiSelected && row.checked) &&
    multiSelectState.selectedCount === '2 selected' &&
    multiSelectState.visibleChecked &&
    !multiSelectState.exportDisabled &&
    !multiSelectState.deleteDisabled,
  JSON.stringify(multiSelectState),
);
await page.fill('#ba-search', 'spark');
await page.waitForTimeout(120);
await page.click('#builder-assets [data-asset-id="card:built-in:spark"] input[data-asset-select]');
await page.waitForTimeout(120);
const hiddenSelectionState = await page.evaluate(() => ({
  selectedCount: document.querySelector('#builder-assets .ba-selected-count')?.textContent ?? '',
  deleteDisabled: document.querySelector('#builder-assets #ba-batch-delete')?.hasAttribute('disabled') ?? false,
  deleteTitle: document.querySelector('#builder-assets #ba-batch-delete')?.getAttribute('title') ?? '',
}));
check(
  'batch bar discloses hidden selected assets and blocks immutable deletes',
  hiddenSelectionState.selectedCount === '3 selected (2 hidden)' &&
    hiddenSelectionState.deleteDisabled &&
    /Spark Bolt|read-only|immutable|Built-in/i.test(hiddenSelectionState.deleteTitle),
  JSON.stringify(hiddenSelectionState),
);
const downloadPromise = page.waitForEvent('download');
await page.click('#builder-assets #ba-batch-export');
const download = await downloadPromise;
const downloadPath = await download.path();
const bundleText = downloadPath ? await readFile(downloadPath, 'utf8') : '';
const bundle = bundleText ? JSON.parse(bundleText) : null;
check(
  'batch export downloads a round-trip bundle with content metadata',
  bundle?.kind === 'assetExportBundle' &&
    bundle.assets?.length === 3 &&
    bundle.assets.filter((asset) => String(asset.assetId).startsWith('sprite:library:asset-probe-delete-') && String(asset.filename).endsWith('.sprite.json')).length === 2 &&
    bundle.assets.some((asset) => asset.assetId === 'card:built-in:spark' && String(asset.filename).endsWith('.content-metadata.json') && String(asset.text).includes('"metadataOnly":true')),
  JSON.stringify(bundle),
);
await page.click('#builder-assets #ba-batch-clear');
await page.fill('#ba-search', 'Asset Probe Batch Delete');
await page.waitForTimeout(120);
await page.click('#builder-assets #ba-select-visible');
await page.waitForTimeout(120);
await page.click('#builder-assets #ba-batch-delete');
await page.waitForSelector('.app-dialog-panel', { timeout: 5000 });
const deleteDialog = await page.evaluate(() => document.querySelector('.app-dialog-panel')?.textContent ?? '');
await page.click('.app-dialog-btn.primary');
await page.waitForTimeout(250);
const batchDeleteState = await page.evaluate((dialogText) => ({
  dialogText,
  remainingDeleteSprites: Object.keys(localStorage).filter((key) => key.startsWith('noita-builder-sprite:asset-probe-delete-')),
  selectedCount: document.querySelector('#builder-assets .ba-selected-count')?.textContent ?? '',
  status: document.getElementById('builder-status')?.textContent ?? '',
}), deleteDialog);
check(
  'batch delete removes only allowed selected assets',
  batchDeleteState.dialogText.includes('Delete 2 selected assets') &&
    batchDeleteState.remainingDeleteSprites.length === 0 &&
    batchDeleteState.selectedCount === '0 selected' &&
    /DELETED 2\/2/.test(batchDeleteState.status),
  JSON.stringify(batchDeleteState),
);
const bundleChooserPromise = page.waitForEvent('filechooser');
await page.click('#ba-import');
const bundleChooser = await bundleChooserPromise;
await bundleChooser.setFiles({
  name: 'asset-probe-bundle.assets.json',
  mimeType: 'application/json',
  buffer: Buffer.from(bundleText),
});
await page.waitForTimeout(350);
const bundleImportState = await page.evaluate(() => {
  const restoredSprites = Object.keys(localStorage).filter((key) => key.startsWith('noita-builder-sprite:asset-probe-delete-'));
  const reports = Object.keys(localStorage)
    .filter((key) => key.startsWith('noita-builder-import-report:'))
    .map((key) => {
      try { return JSON.parse(localStorage.getItem(key) || 'null'); }
      catch { return null; }
    })
    .filter(Boolean);
  return {
    restoredSprites,
    bundleReports: reports.filter((report) => String(report.sourceFile || '').includes('bundle') || String(report.sourceFile || '').includes('Batch Delete')).map((report) => ({
      sourceFile: report.sourceFile,
      decision: report.decision,
      errors: report.errors,
    })),
    status: document.getElementById('builder-status')?.textContent ?? '',
  };
});
check(
  'batch export bundle reimports supported local assets with durable reports',
  bundleImportState.restoredSprites.length === 2 &&
    bundleImportState.bundleReports.some((report) => report.sourceFile === 'asset-probe-bundle.assets.json' && report.decision === 'rejected') &&
    bundleImportState.bundleReports.filter((report) => String(report.sourceFile).includes('Asset Probe Batch Delete')).length >= 2,
  JSON.stringify(bundleImportState),
);
await page.fill('#ba-search', 'Asset Probe Torch Reimported');
await page.waitForTimeout(120);
await page.click('#builder-assets #ba-select-visible');
await page.waitForTimeout(120);
const batchBlockedState = await page.evaluate(() => ({
  deleteDisabled: document.querySelector('#builder-assets #ba-batch-delete')?.hasAttribute('disabled') ?? false,
  deleteTitle: document.querySelector('#builder-assets #ba-batch-delete')?.getAttribute('title') ?? '',
  spriteStillStored: localStorage.getItem('noita-builder-sprite:asset-probe-sprite') !== null,
  status: document.getElementById('builder-status')?.textContent ?? '',
}));
check(
  'batch delete disables referenced assets before mutating storage',
  batchBlockedState.deleteDisabled &&
    batchBlockedState.deleteTitle.includes('usage') &&
    batchBlockedState.spriteStillStored &&
    !/DELETED/.test(batchBlockedState.status),
  JSON.stringify(batchBlockedState),
);
await page.click('#builder-assets #ba-batch-clear');
await page.fill('#ba-search', '');
await page.waitForTimeout(120);

console.log('-- batch import handles same-id collisions without overwrite');
const batchChooserPromise = page.waitForEvent('filechooser');
await page.click('#ba-import');
const batchChooser = await batchChooserPromise;
const batchSprite = (name, rgba) => ({
  v: 1,
  kind: 'sprite',
  id: 'asset-probe-batch-sprite',
  name,
  w: 1,
  h: 1,
  frames: [{ durationMs: 100, px: Buffer.from(rgba).toString('base64') }],
  tags: [],
  emissive: false,
});
await batchChooser.setFiles([
  {
    name: 'asset-probe-batch-a.sprite.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(batchSprite('Asset Probe Batch A', [200, 20, 20, 255]))),
  },
  {
    name: 'asset-probe-batch-b.sprite.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(batchSprite('Asset Probe Batch B', [20, 20, 220, 255]))),
  },
]);
await page.waitForTimeout(350);
const batchState = await page.evaluate(() => {
  const sprites = Object.keys(localStorage)
    .filter((key) => key.startsWith('noita-builder-sprite:'))
    .map((key) => {
      try { return JSON.parse(localStorage.getItem(key) || 'null'); }
      catch { return null; }
    })
    .filter(Boolean)
    .filter((sprite) => /^Asset Probe Batch [AB]$/.test(String(sprite.name || '')));
  const reports = Object.keys(localStorage)
    .filter((key) => key.startsWith('noita-builder-import-report:'))
    .map((key) => {
      try { return JSON.parse(localStorage.getItem(key) || 'null'); }
      catch { return null; }
    })
    .filter(Boolean)
    .filter((report) => String(report.sourceFile || '').startsWith('asset-probe-batch-'));
  return {
    sortValue: document.querySelector('#builder-assets #ba-sort')?.value ?? '',
    sprites: sprites.map((sprite) => ({ id: sprite.id, name: sprite.name })),
    reports: reports.map((report) => ({
      sourceFile: report.sourceFile,
      decision: report.decision,
      originalSourceId: report.originalSourceId,
      finalSourceId: report.finalSourceId,
      collisionWith: report.collisionWith,
    })),
  };
});
check(
  'same-batch same-id imports keep both assets via collision re-id',
  batchState.sortValue === 'modified' &&
    batchState.sprites.length === 2 &&
    new Set(batchState.sprites.map((sprite) => sprite.id)).size === 2 &&
    batchState.sprites.some((sprite) => sprite.id === 'asset-probe-batch-sprite' && sprite.name === 'Asset Probe Batch A') &&
    batchState.sprites.some((sprite) => sprite.id !== 'asset-probe-batch-sprite' && sprite.name === 'Asset Probe Batch B') &&
    batchState.reports.some((report) => report.sourceFile === 'asset-probe-batch-a.sprite.json' && report.decision === 'accepted') &&
    batchState.reports.some((report) =>
      report.sourceFile === 'asset-probe-batch-b.sprite.json' &&
        report.decision === 'collision-reid' &&
        report.originalSourceId === 'asset-probe-batch-sprite' &&
        report.finalSourceId !== 'asset-probe-batch-sprite' &&
        report.collisionWith === 'sprite:library:asset-probe-batch-sprite'
    ),
  JSON.stringify(batchState),
);

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

console.log('-- document/template explicit open actions');
await page.click('[data-asset-collection="all"]');
await page.fill('#ba-search', 'Frozen Depths Starter');
await page.waitForTimeout(120);
await page.click('#builder-assets [data-asset-id="template:built-in:template-frozen"]');
await page.waitForTimeout(160);
const templateOpenAffordance = await page.evaluate(() => ({
  draggable: document.querySelector('#builder-assets [data-asset-id="template:built-in:template-frozen"]')?.getAttribute('draggable') ?? '',
  detailsOpen: getComputedStyle(document.getElementById('builder-asset-details')).display !== 'none',
  hasOpenAction: Boolean(document.querySelector('#builder-asset-details button[data-asset-action="open"]')),
}));
await page.click('#builder-asset-details button[data-asset-action="open"]');
const templateDiscardDialog = await page.waitForSelector('.app-dialog-panel', { timeout: 5000 }).catch(() => null);
if (templateDiscardDialog) await page.click('.app-dialog-btn.primary');
await page.waitForTimeout(250);
const templateOpenState = await page.evaluate(({ hadDialog, affordance }) => ({
  ...affordance,
  hadDialog,
  docSelect: document.querySelector('#b-doc-select')?.value ?? '',
  docName: document.querySelector('#b-doc-name')?.value ?? '',
  biome: document.querySelector('#b-biome')?.value ?? '',
  markerCount: document.querySelectorAll('.b-marker').length,
  status: document.getElementById('builder-status')?.textContent ?? '',
}), { hadDialog: Boolean(templateDiscardDialog), affordance: templateOpenAffordance });
check(
  'template asset creates a fresh Builder document only through explicit Details action',
  templateOpenState.draggable === 'false' &&
    templateOpenState.detailsOpen &&
    templateOpenState.hasOpenAction &&
    templateOpenState.hadDialog &&
    templateOpenState.docSelect !== 'template-frozen' &&
    templateOpenState.docName === 'Frozen Depths Starter copy' &&
    templateOpenState.biome === 'frozen' &&
    templateOpenState.markerCount === 2 &&
    /CREATED "FROZEN DEPTHS STARTER COPY"/.test(templateOpenState.status),
  JSON.stringify(templateOpenState),
);

await page.click('[data-asset-collection="all"]');
await page.fill('#ba-search', 'Asset Probe Open Doc');
await page.waitForTimeout(120);
await page.click('#builder-assets [data-asset-id="document:project:asset-probe-open-doc"]');
await page.waitForTimeout(160);
const documentOpenAffordance = await page.evaluate(() => ({
  draggable: document.querySelector('#builder-assets [data-asset-id="document:project:asset-probe-open-doc"]')?.getAttribute('draggable') ?? '',
  detailsOpen: getComputedStyle(document.getElementById('builder-asset-details')).display !== 'none',
  hasOpenAction: Boolean(document.querySelector('#builder-asset-details button[data-asset-action="open"]')),
}));
await page.click('#builder-asset-details button[data-asset-action="open"]');
const discardDialog = await page.waitForSelector('.app-dialog-panel', { timeout: 5000 }).catch(() => null);
if (discardDialog) await page.click('.app-dialog-btn.primary');
await page.waitForTimeout(250);
const documentOpenState = await page.evaluate(({ hadDialog, affordance }) => ({
  ...affordance,
  hadDialog,
  docSelect: document.querySelector('#b-doc-select')?.value ?? '',
  docName: document.querySelector('#b-doc-name')?.value ?? '',
  biome: document.querySelector('#b-biome')?.value ?? '',
  markerCount: document.querySelectorAll('.b-marker').length,
  status: document.getElementById('builder-status')?.textContent ?? '',
}), { hadDialog: Boolean(discardDialog), affordance: documentOpenAffordance });
check(
  'document asset opens only through explicit Details action and Builder document lifecycle',
  documentOpenState.draggable === 'false' &&
    documentOpenState.detailsOpen &&
    documentOpenState.hasOpenAction &&
    documentOpenState.hadDialog &&
    documentOpenState.docSelect === 'asset-probe-open-doc' &&
    documentOpenState.docName === 'Asset Probe Open Doc' &&
    documentOpenState.biome === 'frozen' &&
    documentOpenState.markerCount === 1 &&
    /OPENED "ASSET PROBE OPEN DOC"/.test(documentOpenState.status),
  JSON.stringify(documentOpenState),
);

check(
  'no page or console errors during asset browser probe',
  pageErrors.length === 0 && consoleErrors.length === 0,
  [...pageErrors, ...consoleErrors].join('\n'),
);

await browser.close();
console.log(`\nverify-builder-assets: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

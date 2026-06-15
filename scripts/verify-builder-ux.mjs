// Backlog + sidebar wave probe: two-column filtered Sandbox toolbar, the
// Builder-native left panel (materials/brush/world-gen), drag-to-place,
// snap, spatial gizmos, group/align, command palette, layers, smooth,
// polygon/magic regions, patrol, hazard emitters, notes, mood ambient,
// bake-from-playtest, rotate, solo lights.
// Usage: node scripts/verify-builder-ux.mjs [url]  (dev server must be running)
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
page.on('dialog', (d) => d.accept());
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(() => window.__game?.ctx?.state, { timeout: 20000 });
await page.waitForTimeout(2200);

/* ---------- Sandbox sidebar: two columns + filter ---------- */
console.log('-- sandbox sidebar');
const cols = await page.evaluate(
  () => getComputedStyle(document.getElementById('left-toolbar')).gridTemplateColumns.split(' ').length,
);
check('sidebar lays out in two columns', cols === 2, `got ${cols}`);
await page.fill('#toolbar-filter', 'lava');
await page.waitForTimeout(150);
const filtered = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('#left-toolbar .tool-btn')];
  return {
    visible: btns.filter((b) => b.style.display !== 'none').length,
    lavaVisible: btns.some((b) => b.textContent.includes('Lava') && b.style.display !== 'none'),
  };
});
check('filter narrows the tool list to matches', filtered.visible === 1 && filtered.lavaVisible, JSON.stringify(filtered));
await page.fill('#toolbar-filter', '');
await page.waitForTimeout(150);

/* ---------- Builder-native left panel ---------- */
console.log('-- builder panel');
await page.click('#mode-builder-btn');
await page.waitForTimeout(300);
const panel = await page.evaluate(() => ({
  sidebarHidden: getComputedStyle(document.getElementById('left-toolbar')).display === 'none',
  swatches: document.querySelectorAll('.bp-swatch').length,
  floatingGuide: !!document.getElementById('builder-dock-guide-floating'),
}));
check('sandbox sidebar yields to the builder', panel.sidebarHidden);
check('material swatches cloned from the toolbar', panel.swatches >= 25, `got ${panel.swatches}`);
check('central FLOAT dock guide is removed', !panel.floatingGuide);
await page.keyboard.press('h');
await page.waitForTimeout(100);
const helpModal = await page.evaluate(() => {
  const help = document.getElementById('builder-help');
  const palette = document.getElementById('builder-palette').getBoundingClientRect();
  const hit = document.elementFromPoint(palette.left + 24, palette.top + 24);
  return {
    open: help?.classList.contains('open') === true && getComputedStyle(help).display !== 'none',
    fixed: help ? getComputedStyle(help).position : '',
    coversPalette: hit?.id === 'builder-help' || Boolean(hit?.closest?.('#builder-help')),
    globalHelp: document.getElementById('help-overlay')?.classList.contains('visible') === true,
    text: help?.textContent ?? '',
  };
});
check('H opens a Builder-owned help modal', helpModal.open && helpModal.text.includes('Ctrl+D') && !helpModal.globalHelp, JSON.stringify(helpModal));
check('Builder help is modal over docked panels', helpModal.fixed === 'fixed' && helpModal.coversPalette, JSON.stringify(helpModal));
await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', key: 'h', repeat: true, bubbles: true }));
});
await page.waitForTimeout(50);
const helpAfterRepeat = await page.evaluate(() => document.getElementById('builder-help')?.classList.contains('open') === true);
check('held H does not toggle Builder help closed', helpAfterRepeat);
await page.keyboard.press('Backquote');
await page.waitForTimeout(80);
const helpAfterBackquote = await page.evaluate(() => ({
  helpOpen: document.getElementById('builder-help')?.classList.contains('open') === true,
  consoleOpen: document.getElementById('dev-console')?.classList.contains('open') === true,
}));
check(
  'Builder help blocks console Backquote open',
  helpAfterBackquote.helpOpen && !helpAfterBackquote.consoleOpen,
  JSON.stringify(helpAfterBackquote),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
const helpClosed = await page.evaluate(() => document.getElementById('builder-help')?.classList.contains('open') === true);
check('Escape closes Builder help', !helpClosed);
await page.fill('#b-doc-name', '');
await page.focus('#b-doc-name');
await page.keyboard.press('h');
await page.waitForTimeout(80);
const textFieldH = await page.evaluate(() => ({
  value: document.getElementById('b-doc-name')?.value ?? '',
  helpOpen: document.getElementById('builder-help')?.classList.contains('open') === true,
  globalHelp: document.getElementById('help-overlay')?.classList.contains('visible') === true,
}));
check(
  'Builder text fields keep normal H typing precedence',
  textFieldH.value === 'h' && !textFieldH.helpOpen && !textFieldH.globalHelp,
  JSON.stringify(textFieldH),
);
await page.locator('#b-doc-name').blur();
await page.locator('#builder-palette [data-panel-handle]').first().click({ button: 'right' });
await page.waitForTimeout(120);
const panelMenu = await page.evaluate(() => {
  const menu = document.querySelector('.editor-command-menu');
  const rows = [...(menu?.querySelectorAll('button') ?? [])].map((button) => ({
    text: button.textContent ?? '',
    disabled: button.disabled,
    title: button.title,
  }));
  const r = menu?.getBoundingClientRect();
  return {
    open: menu?.classList.contains('open') === true && getComputedStyle(menu).display !== 'none',
    rows,
    onScreen: !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    z: menu ? Number(getComputedStyle(menu).zIndex) : 0,
  };
});
check(
  'panel chrome context menu opens from command ids',
  panelMenu.open &&
    panelMenu.onScreen &&
    panelMenu.z > 80 &&
    panelMenu.rows.some((row) => row.text.includes('Command Palette') && !row.disabled) &&
    panelMenu.rows.some((row) => row.text.includes('Delete Selection') && row.disabled && row.title.includes('Select')),
  JSON.stringify(panelMenu),
);
await page.keyboard.press('Tab');
await page.waitForTimeout(80);
const menuTabOwnership = await page.evaluate(() => ({
  menuOpen: document.querySelector('.editor-command-menu')?.classList.contains('open') === true,
  focusInsideMenu: Boolean(document.activeElement?.closest?.('.editor-command-menu')),
  focusedText: document.activeElement?.textContent ?? '',
  mode: window.__game.ctx.state.mode,
  keys: { ...window.__game.ctx.input.keys },
}));
check(
  'panel context menu owns Tab without mode or input leaks',
  menuTabOwnership.menuOpen &&
    menuTabOwnership.focusInsideMenu &&
    menuTabOwnership.mode === 'build' &&
    Object.values(menuTabOwnership.keys).every((value) => value === false),
  JSON.stringify(menuTabOwnership),
);
await page.evaluate(() => document.getElementById('btn-level-save')?.click());
await page.waitForSelector('.app-dialog-root', { timeout: 5000 });
const menuUnderDialog = await page.evaluate(() => ({
  menuOpen: document.querySelector('.editor-command-menu')?.classList.contains('open') === true,
  dialogOpen: document.querySelector('.app-dialog-root') !== null,
  focusedInDialog: Boolean(document.activeElement?.closest?.('.app-dialog-root')),
}));
check(
  'app dialogs dismiss command menus and own focus',
  !menuUnderDialog.menuOpen && menuUnderDialog.dialogOpen && menuUnderDialog.focusedInDialog,
  JSON.stringify(menuUnderDialog),
);
await page.keyboard.press('Escape');
await page.waitForFunction(() => document.querySelector('.app-dialog-root') === null, { timeout: 5000 });
await page.locator('#builder-palette [data-panel-handle]').first().click({ button: 'right' });
await page.waitForTimeout(120);
await page.keyboard.press('Space');
await page.waitForTimeout(120);
const cmdkFromMenu = await page.evaluate(() => ({
  menuOpen: document.querySelector('.editor-command-menu')?.classList.contains('open') === true,
  cmdkOpen: document.getElementById('builder-cmdk').style.display !== 'none',
  focused: document.activeElement?.id,
  mode: window.__game.ctx.state.mode,
  keys: { ...window.__game.ctx.input.keys },
}));
check(
  'panel context menu Space activates the focused command without gameplay leaks',
  !cmdkFromMenu.menuOpen &&
    cmdkFromMenu.cmdkOpen &&
    cmdkFromMenu.focused === 'bp-cmdk-input' &&
    cmdkFromMenu.mode === 'build' &&
    Object.values(cmdkFromMenu.keys).every((value) => value === false),
  JSON.stringify(cmdkFromMenu),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(80);
await page.locator('#builder-palette [data-panel-handle]').first().click({ button: 'right' });
await page.waitForTimeout(120);
await page.evaluate(() => {
  const button = [...document.querySelectorAll('.editor-command-menu button')].find((el) =>
    (el.textContent ?? '').includes('Builder Help'),
  );
  if (button instanceof HTMLButtonElement) button.click();
});
await page.waitForTimeout(120);
const helpFromMenu = await page.evaluate(() => ({
  menuOpen: document.querySelector('.editor-command-menu')?.classList.contains('open') === true,
  helpOpen: document.getElementById('builder-help')?.classList.contains('open') === true,
  focusInsideHelp: Boolean(document.activeElement?.closest?.('#builder-help')),
}));
check(
  'panel context menu yields cleanly to Builder Help',
  !helpFromMenu.menuOpen && helpFromMenu.helpOpen && helpFromMenu.focusInsideHelp,
  JSON.stringify(helpFromMenu),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(80);
await page.click('[data-section-toggle="palette.materials"]');
await page.waitForTimeout(50);
let materialSection = await page.evaluate(() => {
  const section = document.querySelector('.bp-section[data-section="palette.materials"]');
  const button = document.querySelector('[data-section-toggle="palette.materials"]');
  return { collapsed: section?.classList.contains('collapsed') === true, expanded: button?.getAttribute('aria-expanded') };
});
check('palette sections collapse with aria state', materialSection.collapsed && materialSection.expanded === 'false', JSON.stringify(materialSection));
await page.click('#b-reset-workspace');
await page.waitForTimeout(150);
materialSection = await page.evaluate(() => {
  const section = document.querySelector('.bp-section[data-section="palette.materials"]');
  const button = document.querySelector('[data-section-toggle="palette.materials"]');
  return { collapsed: section?.classList.contains('collapsed') === true, expanded: button?.getAttribute('aria-expanded') };
});
check('workspace reset restores collapsed palette sections', !materialSection.collapsed && materialSection.expanded === 'true', JSON.stringify(materialSection));
const bodyDragStart = await page.evaluate(() => {
  const body = document.querySelector('#builder-palette .bp-section-body');
  const r = body.getBoundingClientRect();
  return { x: r.left + Math.min(28, r.width / 2), y: r.top + Math.min(28, r.height / 2) };
});
await page.mouse.move(bodyDragStart.x, bodyDragStart.y);
await page.mouse.down();
await page.mouse.move(bodyDragStart.x + 160, bodyDragStart.y + 90, { steps: 8 });
await page.waitForTimeout(100);
const bodyDrag = await page.evaluate(() => {
  const panel = document.getElementById('builder-palette');
  return {
    dragging: panel.classList.contains('dragging-live'),
    parent: panel.parentElement?.id ?? '',
  };
});
check('dragging inside panel body does not move the panel', !bodyDrag.dragging && bodyDrag.parent === 'builder-dock-left', JSON.stringify(bodyDrag));
await page.mouse.up();
await page.waitForTimeout(80);
const dragStart = await page.evaluate(() => {
  const panel = document.getElementById('builder-palette');
  const handle = panel.querySelector('[data-panel-handle]');
  const pr = panel.getBoundingClientRect();
  const hr = handle.getBoundingClientRect();
  return {
    x: hr.left + hr.width / 2,
    y: hr.top + hr.height / 2,
    offsetX: hr.left + hr.width / 2 - pr.left,
    offsetY: hr.top + hr.height / 2 - pr.top,
  };
});
const dragTarget = await page.evaluate(() => {
  const r = document.getElementById('builder-stage').getBoundingClientRect();
  return { x: r.left + Math.min(190, r.width * 0.35), y: r.top + Math.min(120, r.height * 0.28) };
});
await page.mouse.move(dragStart.x, dragStart.y);
await page.mouse.down();
await page.mouse.move(dragTarget.x, dragTarget.y, { steps: 8 });
await page.waitForTimeout(100);
const livePanelDrag = await page.evaluate(() => {
  const panel = document.getElementById('builder-palette');
  const r = panel.getBoundingClientRect();
  return {
    dragging: panel.classList.contains('dragging-live'),
    parent: panel.parentElement?.id ?? '',
    left: Math.round(r.left),
    top: Math.round(r.top),
  };
});
check(
  'workspace panel visibly follows the pointer while dragging',
  livePanelDrag.dragging &&
    livePanelDrag.parent === 'builder-stage' &&
    Math.abs(livePanelDrag.left - (dragTarget.x - dragStart.offsetX)) < 50 &&
    Math.abs(livePanelDrag.top - (dragTarget.y - dragStart.offsetY)) < 50,
  JSON.stringify({ dragStart, dragTarget, livePanelDrag }),
);
await page.mouse.up();
await page.waitForTimeout(120);
const droppedPanel = await page.evaluate(() => {
  const panel = document.getElementById('builder-palette');
  return {
    dragging: panel.classList.contains('dragging-live'),
    floating: panel.classList.contains('floating'),
    parent: panel.parentElement?.id ?? '',
  };
});
check('workspace panel stays at the released floating position', !droppedPanel.dragging && droppedPanel.floating && droppedPanel.parent === 'builder-stage', JSON.stringify(droppedPanel));
await page.click('#b-reset-workspace');
await page.waitForTimeout(150);
const resetPanel = await page.evaluate(() => document.getElementById('builder-palette').parentElement?.id ?? '');
check('workspace reset restores the docked palette after drag probe', resetPanel === 'builder-dock-left', resetPanel);

const floatWorkspacePanel = async (panelId, ratioX, ratioY) => {
  const start = await page.evaluate((id) => {
    const panel = document.getElementById(id);
    const handle = panel?.querySelector('[data-panel-handle]');
    const r = handle?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, panelId);
  const drop = await page.evaluate(([xRatio, yRatio]) => {
    const r = document.getElementById('builder-stage').getBoundingClientRect();
    return { x: r.left + r.width * xRatio, y: r.top + r.height * yRatio };
  }, [ratioX, ratioY]);
  if (!start) return false;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  return true;
};
await floatWorkspacePanel('builder-palette', 0.36, 0.30);
await floatWorkspacePanel('builder-inspector', 0.40, 0.34);
const stackedBeforeRaise = await page.evaluate(() => {
  const palette = document.getElementById('builder-palette');
  const inspector = document.getElementById('builder-inspector');
  const pr = palette.getBoundingClientRect();
  const ir = inspector.getBoundingClientRect();
  const left = Math.max(pr.left, ir.left);
  const right = Math.min(pr.right, ir.right);
  const top = Math.max(pr.top, ir.top);
  const bottom = Math.min(pr.bottom, ir.bottom);
  const x = left + Math.max(1, (right - left) / 2);
  const y = top + Math.max(1, Math.min(18, (bottom - top) / 2));
  return {
    overlap: right > left && bottom > top,
    hit: document.elementFromPoint(x, y)?.closest?.('.builder-panel')?.id ?? '',
    paletteZ: Number(getComputedStyle(palette).zIndex),
    inspectorZ: Number(getComputedStyle(inspector).zIndex),
  };
});
const paletteRaisePoint = await page.evaluate(() => {
  const handle = document.querySelector('#builder-palette [data-panel-handle]');
  const r = handle.getBoundingClientRect();
  return { x: r.left + 12, y: r.top + Math.min(12, r.height / 2) };
});
await page.mouse.click(paletteRaisePoint.x, paletteRaisePoint.y);
await page.waitForTimeout(120);
const stackedAfterRaise = await page.evaluate(() => {
  const palette = document.getElementById('builder-palette');
  const inspector = document.getElementById('builder-inspector');
  const pr = palette.getBoundingClientRect();
  const ir = inspector.getBoundingClientRect();
  const left = Math.max(pr.left, ir.left);
  const right = Math.min(pr.right, ir.right);
  const top = Math.max(pr.top, ir.top);
  const bottom = Math.min(pr.bottom, ir.bottom);
  const x = left + Math.max(1, (right - left) / 2);
  const y = top + Math.max(1, Math.min(18, (bottom - top) / 2));
  return {
    overlap: right > left && bottom > top,
    hit: document.elementFromPoint(x, y)?.closest?.('.builder-panel')?.id ?? '',
    paletteZ: Number(getComputedStyle(palette).zIndex),
    inspectorZ: Number(getComputedStyle(inspector).zIndex),
  };
});
check(
  'floating panels raise deterministically with z-order',
  stackedBeforeRaise.overlap &&
    stackedBeforeRaise.hit === 'builder-inspector' &&
    stackedBeforeRaise.inspectorZ > stackedBeforeRaise.paletteZ &&
    stackedAfterRaise.hit === 'builder-palette' &&
    stackedAfterRaise.paletteZ > stackedAfterRaise.inspectorZ,
  JSON.stringify({ stackedBeforeRaise, stackedAfterRaise }),
);
await page.click('#b-reset-workspace');
await page.waitForTimeout(150);

const rightDragStart = await page.evaluate(() => {
  const panel = document.getElementById('builder-palette');
  const handle = panel.querySelector('[data-panel-handle]');
  const r = handle.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const rightDrop = await page.evaluate(() => {
  const r = document.getElementById('builder-dock-right').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + 48 };
});
await page.mouse.move(rightDragStart.x, rightDragStart.y);
await page.mouse.down();
await page.mouse.move(rightDrop.x, rightDrop.y, { steps: 10 });
await page.waitForTimeout(100);
await page.mouse.up();
await page.waitForTimeout(150);
const rightDockedPopover = await page.evaluate(() => document.getElementById('builder-palette').parentElement?.id ?? '');
check('palette can dock to the right side', rightDockedPopover === 'builder-dock-right', rightDockedPopover);
await page.hover('#builder-palette .bp-swatch[data-el="11"]');
await page.waitForTimeout(140);
const rightPopover = await page.evaluate(() => {
  const el = document.getElementById('bp-matpop');
  const r = el.getBoundingClientRect();
  return {
    visible: el.style.display !== 'none',
    parent: el.parentElement?.tagName ?? '',
    left: Math.round(r.left),
    right: Math.round(r.right),
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    vw: window.innerWidth,
    vh: window.innerHeight,
  };
});
check(
  'material popover stays onscreen after right docking',
  rightPopover.visible &&
    rightPopover.parent === 'BODY' &&
    rightPopover.left >= 0 &&
    rightPopover.top >= 0 &&
    rightPopover.right <= rightPopover.vw &&
    rightPopover.bottom <= rightPopover.vh,
  JSON.stringify(rightPopover),
);
const rightOrderBefore = await page.evaluate(() =>
  [...document.querySelectorAll('#builder-dock-right > .builder-panel')]
    .filter((el) => getComputedStyle(el).display !== 'none')
    .map((el) => el.id),
);
const reorderStart = await page.evaluate(() => {
  const handle = document.querySelector('#builder-palette [data-panel-handle]');
  const r = handle.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const reorderDrop = await page.evaluate(() => {
  const r = document.getElementById('builder-dock-right').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.bottom - 18 };
});
await page.mouse.move(reorderStart.x, reorderStart.y);
await page.mouse.down();
await page.mouse.move(reorderDrop.x, reorderDrop.y, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(150);
const rightOrderAfter = await page.evaluate(() =>
  [...document.querySelectorAll('#builder-dock-right > .builder-panel')]
    .filter((el) => getComputedStyle(el).display !== 'none')
    .map((el) => el.id),
);
check(
  'panels can reorder inside the same dock',
  rightOrderBefore.indexOf('builder-palette') < rightOrderBefore.indexOf('builder-inspector') &&
    rightOrderAfter.indexOf('builder-palette') > rightOrderAfter.indexOf('builder-inspector'),
  JSON.stringify({ rightOrderBefore, rightOrderAfter }),
);
const scrollbarStyles = await page.evaluate(() =>
  ['builder-dock-left', 'builder-dock-right', 'builder-palette', 'builder-inspector'].map((id) => {
    const cs = getComputedStyle(document.getElementById(id));
    return { id, width: cs.scrollbarWidth, color: cs.scrollbarColor };
  }),
);
check('Builder scrollbars share thin sizing', scrollbarStyles.every((s) => s.width === 'thin'), JSON.stringify(scrollbarStyles));
check(
  'Builder scrollbars share the right-dock colors',
  scrollbarStyles.every((s) => s.color.includes('rgb(44, 58, 76)') && s.color.includes('rgb(12, 15, 20)')),
  JSON.stringify(scrollbarStyles),
);
await page.click('#b-reset-workspace');
await page.waitForTimeout(150);
await page.evaluate(() => {
  const sw = document.querySelector('.bp-swatch[data-el="11"]'); // lava
  sw.click();
});
let el = await page.evaluate(() => window.__game.ctx.state.currentElement);
check('clicking a swatch arms the material', el === 11, `got ${el}`);
await page.evaluate(() => {
  const r = document.getElementById('bp-brush');
  r.value = '12';
  r.dispatchEvent(new Event('input'));
});
const brush = await page.evaluate(() => window.__game.ctx.state.brushSize);
check('brush slider drives state.brushSize', brush === 12, `got ${brush}`);

/* ---------- arena ---------- */
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  const Metal = 13;
  for (let y = 375; y <= 625; y++)
    for (let x = 430; x <= 770; x++) {
      const i = w.idx(x, y);
      w.types[i] = 0; w.colors[i] = 0; w.life[i] = 0; w.charge[i] = 0;
    }
  const solid = (x0, x1, y0, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = w.idx(x, y);
        w.types[i] = Metal; w.colors[i] = 0x7a8a99;
      }
  };
  solid(430, 770, 620, 625);
  solid(430, 436, 375, 625);
  solid(764, 770, 375, 625);
  solid(430, 770, 375, 380);
  ctx.camera.snapTo(600, 500);
});
await page.waitForTimeout(200);

const toClient = async (wx, wy) =>
  page.evaluate(([wx, wy]) => {
    const ctx = window.__game.ctx;
    const r = document.getElementById('builder-overlay').getBoundingClientRect();
    const ux = ((wx - ctx.camera.renderX) / 525 - 0.5) * ctx.camera.zoom + 0.5;
    const uy = ((wy - ctx.camera.renderY) / 357 - 0.5) * ctx.camera.zoom + 0.5;
    return { x: r.left + ux * r.width, y: r.top + uy * r.height };
  }, [wx, wy]);

/* ---------- material swatches: icons, popover, drag-to-paint, layout ---------- */
console.log('-- material swatches');
const swatchInfo = await page.evaluate(() => {
  const pal = document.getElementById('builder-palette');
  return {
    icons: document.querySelectorAll('.bp-swatch canvas').length,
    hOverflow: pal.scrollWidth > pal.clientWidth,
  };
});
check('swatches show real pixel icons', swatchInfo.icons >= 15, `got ${swatchInfo.icons}`);
check('palette has no horizontal overflow', swatchInfo.hOverflow === false, JSON.stringify(swatchInfo));
await page.hover('.bp-swatch[data-el="11"]'); // lava
await page.waitForTimeout(120);
const matPop = await page.evaluate(() => {
  const el = document.getElementById('bp-matpop');
  return {
    visible: el.style.display !== 'none',
    parent: el.parentElement?.tagName ?? '',
    text: el.textContent,
    props: el.querySelectorAll('.bp-pop-prop').length,
  };
});
check('hover popover shows the material name instantly', matPop.visible && matPop.parent === 'BODY' && matPop.text.includes('Lava'), JSON.stringify({ visible: matPop.visible, parent: matPop.parent }));
check('material popover lists the live properties', matPop.props >= 1, `got ${matPop.props}`);
// object buttons get popovers too: pixel preview + behavior note
await page.hover('.bp-tool[data-kind="waystone"]');
await page.waitForTimeout(120);
const objPop = await page.evaluate(() => {
  const el = document.getElementById('bp-matpop');
  return {
    visible: el.style.display !== 'none',
    text: el.textContent,
    hasPreview: !!el.querySelector('canvas'),
  };
});
check('object popover shows a preview image + info', objPop.visible && objPop.text.includes('Waystone') && objPop.hasPreview, JSON.stringify({ v: objPop.visible, p: objPop.hasPreview }));
const compactPalette = await page.evaluate(() => {
  const prefabHost = document.getElementById('bp-prefab-host');
  const spriteHost = document.getElementById('bp-sprite-host');
  const prefabRows = [...(prefabHost?.querySelectorAll('.ba-placement-row') ?? [])];
  const firstPrefab = prefabRows[0] ?? null;
  return {
    prefabRows: prefabRows.length,
    spriteRows: spriteHost?.querySelectorAll('.ba-placement-row').length ?? 0,
    hasCapture: Boolean(prefabHost?.querySelector('#bp-prefab-capture')),
    hasImport: Boolean(spriteHost?.querySelector('#bp-sprite-import')),
    detailButtons: prefabHost?.querySelectorAll('[data-asset-placement-details]').length ?? 0,
    draggable: firstPrefab?.getAttribute('draggable') ?? '',
    fakeTreeRows: prefabHost?.querySelectorAll('[role="treeitem"], .ba-chip').length ?? 0,
    rowText: firstPrefab?.textContent ?? '',
  };
});
check(
  'prefab and sprite palettes use compact Asset Browser rows',
  compactPalette.prefabRows > 0 &&
    compactPalette.hasCapture &&
    compactPalette.hasImport &&
    compactPalette.detailButtons > 0 &&
    compactPalette.draggable === 'true' &&
    compactPalette.fakeTreeRows === 0,
  JSON.stringify(compactPalette),
);
await page.fill('#bp-prefab-host [data-asset-placement-search]', 'brazier');
await page.waitForTimeout(100);
const compactSearch = await page.evaluate(() => ({
  activeSearch: document.activeElement?.matches('#bp-prefab-host [data-asset-placement-search]') ?? false,
  rows: [...document.querySelectorAll('#bp-prefab-host .ba-placement-row')].map((el) => el.textContent.toLowerCase()),
}));
check(
  'compact prefab palette search keeps focus and narrows results',
  compactSearch.activeSearch &&
    compactSearch.rows.length > 0 &&
    compactSearch.rows.every((row) => row.includes('brazier')),
  JSON.stringify(compactSearch),
);
await page.fill('#bp-prefab-host [data-asset-placement-search]', '');
await page.waitForTimeout(80);
const compactScrollSetup = await page.evaluate(() => {
  const list = document.querySelector('#bp-prefab-host .ba-placement-list');
  if (!(list instanceof HTMLElement)) return { missing: true };
  list.scrollTop = Math.min(120, list.scrollHeight);
  const before = list.scrollTop;
  const row = [...document.querySelectorAll('#bp-prefab-host .ba-placement-row')]
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      return { el, top: rect.top, bottom: rect.bottom, x: rect.left + 10, y: rect.top + 10, listTop: listRect.top, listBottom: listRect.bottom };
    })
    .find((entry) => entry.top >= entry.listTop && entry.bottom <= entry.listBottom);
  return { before, click: row ? { x: row.x, y: row.y } : null };
});
if (compactScrollSetup.click) await page.mouse.click(compactScrollSetup.click.x, compactScrollSetup.click.y);
await page.waitForTimeout(100);
const compactScrollAfter = await page.evaluate((setup) => {
  const list = document.querySelector('#bp-prefab-host .ba-placement-list');
  return {
    ...setup,
    after: list instanceof HTMLElement ? list.scrollTop : -1,
  };
}, compactScrollSetup);
check(
  'compact prefab palette keeps scroll position after row activation',
  compactScrollAfter.before > 0 &&
    compactScrollAfter.click !== null &&
    compactScrollAfter.after >= compactScrollAfter.before - 2,
  JSON.stringify(compactScrollAfter),
);
const compactKeyboardFocus = await page.evaluate(() => {
  const row = document.querySelector('#bp-prefab-host .ba-placement-row[data-asset-id]');
  if (!(row instanceof HTMLElement)) return { missing: true };
  row.focus();
  return { before: row.dataset.assetId ?? '', activeBefore: document.activeElement === row };
});
await page.keyboard.press('Enter');
await page.waitForTimeout(120);
const compactKeyboardFocusAfter = await page.evaluate((before) => {
  const active = document.activeElement;
  return {
    ...before,
    after: active instanceof HTMLElement ? active.dataset.assetId ?? '' : '',
    rowFocused: active instanceof HTMLElement && active.matches('#bp-prefab-host .ba-placement-row[data-asset-id]'),
  };
}, compactKeyboardFocus);
check(
  'compact prefab palette restores keyboard row focus after activation',
  compactKeyboardFocusAfter.activeBefore &&
    compactKeyboardFocusAfter.rowFocused &&
    compactKeyboardFocusAfter.after === compactKeyboardFocusAfter.before,
  JSON.stringify(compactKeyboardFocusAfter),
);
// arming a material draws an unmissable bounding box on its swatch
await page.evaluate(() => {
  document.querySelector('.bp-swatch[data-el="12"]').click();
});
await page.waitForTimeout(120);
const activeBox = await page.evaluate(() => {
  const sw = document.querySelector('.bp-swatch.active');
  const cs = sw ? getComputedStyle(sw) : null;
  return { el: sw?.dataset.el ?? null, outline: cs?.outlineWidth ?? null };
});
check('armed swatch shows a bounding selection box', activeBox.el === '12' && activeBox.outline === '2px', JSON.stringify(activeBox));

/* ---------- parameter windows (the right inspector yields to the builder) ---------- */
console.log('-- parameter windows');
const rightHidden = await page.evaluate(
  () => getComputedStyle(document.getElementById('right-inspector')).display === 'none',
);
check('sandbox right inspector yields to the builder', rightHidden);
await page.click('#bp-world-btn');
await page.waitForTimeout(120);
const worldPanel = await page.evaluate(() => {
  const panel = document.getElementById('builder-world');
  const rows = [...panel.querySelectorAll('.bw-row')];
  const ambient = rows.find((r) => r.textContent.includes('Ambient Light'));
  const input = ambient?.querySelector('input');
  if (input) {
    input.value = '0.4';
    input.dispatchEvent(new Event('input'));
  }
  return {
    visible: panel.style.display !== 'none',
    rows: rows.length,
    ambient: window.__game.ctx.params.global.ambient,
  };
});
check('WORLD window opens with the global controls', worldPanel.visible && worldPanel.rows >= 4, JSON.stringify(worldPanel));
check('WORLD ambient slider drives the live param', worldPanel.ambient === 0.4, `got ${worldPanel.ambient}`);
await page.evaluate(() => {
  // restore the default so later light checks aren't washed out
  window.__game.ctx.params.global.ambient = 0.18;
});
// arming LAVA AUTO-OPENS its tuning window (no extra click needed)
await page.evaluate(() => {
  document.querySelector('.bp-swatch[data-el="11"]').click();
});
await page.waitForTimeout(150);
const matPanel = await page.evaluate(() => {
  const panel = document.getElementById('builder-matparams');
  const world = document.getElementById('builder-world');
  const title = panel.querySelector('.bw-title')?.textContent ?? '';
  const firstRow = panel.querySelector('.bw-row');
  let tweaked = null;
  if (firstRow) {
    const label = firstRow.querySelector('.bw-label span')?.textContent ?? '';
    const input = firstRow.querySelector('input');
    input.value = String(Number(input.max));
    input.dispatchEvent(new Event('input'));
    const key = Object.keys(window.__game.ctx.params.materials[11]).find(
      (k) => k !== 'name' && window.__game.ctx.params.materials[11][k] === Number(input.max),
    );
    tweaked = { label, key };
  }
  return {
    visible: panel.style.display !== 'none',
    worldStillOpen: world.style.display !== 'none',
    title,
    tweaked,
  };
});
check('MATERIAL window shows the armed material', matPanel.visible && matPanel.title.includes('Config'), JSON.stringify(matPanel));
check('parameter panels can stack independently', matPanel.worldStillOpen);
check('material slider drives the live profile', matPanel.tweaked?.key != null, JSON.stringify(matPanel.tweaked));
await page.click('#bm-close');
await page.waitForTimeout(80);

/* ---------- drag-to-place ---------- */
console.log('-- drag to place');
const btnRect = await page.evaluate(() => {
  const b = document.querySelector('.bp-tool[data-kind="enemy"]');
  b.scrollIntoView({ block: 'center' });
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const dropAt = await toClient(540, 600);
await page.mouse.move(btnRect.x, btnRect.y);
await page.mouse.down();
await page.mouse.move(dropAt.x, dropAt.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
let markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('dragging an object button onto the canvas places it', markers === 1, `got ${markers}`);

/* ---------- snap ---------- */
console.log('-- snap');
await page.click('#bp-snap-btn'); // SNAP 4
let snapLabel = await page.evaluate(() => document.getElementById('bp-snap-btn')?.textContent ?? '');
check('snap cycle includes the 4-cell grid', snapLabel.includes('4'), snapLabel);
await page.click('.bp-tool[data-kind="waystone"]');
const oddSpot = await toClient(563, 611);
await page.mouse.click(oddSpot.x, oddSpot.y);
await page.waitForTimeout(120);
let snapped = await page.evaluate(() => {
  const xi = document.querySelector('#builder-inspector input[data-f="x"]');
  const yi = document.querySelector('#builder-inspector input[data-f="y"]');
  return { x: Number(xi.value), y: Number(yi.value) };
});
check('snap grid quantizes placement to 4 cells', snapped.x % 4 === 0 && snapped.y % 4 === 0, JSON.stringify(snapped));
await page.click('#bp-snap-btn'); // SNAP 8
const snapDragStart = await toClient(snapped.x, snapped.y);
const oddSpot8 = await toClient(571, 617);
await page.mouse.move(snapDragStart.x, snapDragStart.y);
await page.mouse.down();
await page.mouse.move(oddSpot8.x, oddSpot8.y, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(120);
snapped = await page.evaluate(() => {
  const xi = document.querySelector('#builder-inspector input[data-f="x"]');
  const yi = document.querySelector('#builder-inspector input[data-f="y"]');
  return { x: Number(xi.value), y: Number(yi.value) };
});
check('snap grid quantizes placement to 8 cells', snapped.x % 8 === 0 && snapped.y % 8 === 0, JSON.stringify(snapped));
await page.click('#bp-snap-btn'); // 16
await page.click('#bp-snap-btn'); // OFF
snapLabel = await page.evaluate(() => document.getElementById('bp-snap-btn')?.textContent ?? '');
check('snap cycle returns to off after 16', snapLabel.includes('OFF'), snapLabel);

/* ---------- spatial gizmos ---------- */
console.log('-- spatial gizmos');
await page.click('.bp-tool[data-kind="door"]');
let p = await toClient(735, 580);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(120);
let doorBox = await page.evaluate(() => {
  const n = (sel) => Number(document.querySelector(sel)?.value ?? 0);
  return {
    x: n('#builder-inspector input[data-f="x"]'),
    y: n('#builder-inspector input[data-f="y"]'),
    w: n('#builder-inspector input[data-p="w"]'),
    h: n('#builder-inspector input[data-p="h"]'),
  };
});
let handle = await toClient(doorBox.x + doorBox.w, doorBox.y + doorBox.h);
let gizmoTarget = await toClient(doorBox.x + 18, doorBox.y + 28);
await page.mouse.move(handle.x, handle.y);
const resizeCursor = await page.evaluate(() => document.getElementById('builder-overlay')?.style.cursor ?? '');
check('resize handle advertises a resize cursor on hover', resizeCursor.includes('resize'), resizeCursor);
let cancelTarget = await toClient(doorBox.x + 12, doorBox.y + 18);
await page.mouse.down();
await page.mouse.move(cancelTarget.x, cancelTarget.y, { steps: 5 });
await page.keyboard.press('Escape');
await page.mouse.up();
await page.waitForTimeout(120);
const cancelledDoorResize = await page.evaluate(() => ({
  w: Number(document.querySelector('#builder-inspector input[data-p="w"]')?.value ?? 0),
  h: Number(document.querySelector('#builder-inspector input[data-p="h"]')?.value ?? 0),
  status: document.getElementById('builder-status')?.textContent ?? '',
}));
check(
  'Escape cancels an in-flight resize handle without committing params',
  cancelledDoorResize.w === doorBox.w && cancelledDoorResize.h === doorBox.h,
  JSON.stringify(cancelledDoorResize),
);
handle = await toClient(doorBox.x + doorBox.w, doorBox.y + doorBox.h);
cancelTarget = await toClient(doorBox.x + 14, doorBox.y + 20);
await page.mouse.move(handle.x, handle.y);
await page.mouse.down();
await page.mouse.move(cancelTarget.x, cancelTarget.y, { steps: 5 });
await page.keyboard.press('Control+k');
await page.keyboard.press('Escape');
await page.mouse.up();
await page.waitForTimeout(120);
const focusStealResize = await page.evaluate(() => ({
  w: Number(document.querySelector('#builder-inspector input[data-p="w"]')?.value ?? 0),
  h: Number(document.querySelector('#builder-inspector input[data-p="h"]')?.value ?? 0),
  cmdkOpen: document.getElementById('builder-cmdk')?.style.display !== 'none',
  status: document.getElementById('builder-status')?.textContent ?? '',
}));
check(
  'active resize handles block command-palette focus stealing before Escape cancel',
  focusStealResize.w === doorBox.w && focusStealResize.h === doorBox.h && !focusStealResize.cmdkOpen,
  JSON.stringify(focusStealResize),
);
handle = await toClient(doorBox.x + doorBox.w, doorBox.y + doorBox.h);
await page.mouse.move(handle.x, handle.y);
await page.mouse.down();
await page.mouse.move(gizmoTarget.x, gizmoTarget.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(160);
let resizedDoor = await page.evaluate(() => ({
  w: Number(document.querySelector('#builder-inspector input[data-p="w"]')?.value ?? 0),
  h: Number(document.querySelector('#builder-inspector input[data-p="h"]')?.value ?? 0),
  status: document.getElementById('builder-status')?.textContent ?? '',
}));
check(
  'canvas resize handle commits door footprint through inspector state',
  resizedDoor.w >= 17 && resizedDoor.w <= 18 && resizedDoor.h >= 27 && resizedDoor.h <= 28,
  JSON.stringify(resizedDoor),
);
doorBox = { ...doorBox, w: resizedDoor.w, h: resizedDoor.h };
handle = await toClient(doorBox.x + doorBox.w / 2, doorBox.y);
handle.y -= 18;
await page.mouse.click(handle.x, handle.y);
await page.waitForTimeout(160);
const rotatedDoor = await page.evaluate(() => ({
  w: Number(document.querySelector('#builder-inspector input[data-p="w"]')?.value ?? 0),
  h: Number(document.querySelector('#builder-inspector input[data-p="h"]')?.value ?? 0),
}));
check('canvas rotate handle swaps slab width and height as one command', rotatedDoor.w === resizedDoor.h && rotatedDoor.h === resizedDoor.w, JSON.stringify(rotatedDoor));

await page.click('.bp-tool[data-tool="light"]');
p = await toClient(700, 540);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(120);
await page.keyboard.press('Escape');
let lightState = await page.evaluate(() => {
  const n = (sel) => Number(document.querySelector(sel)?.value ?? 0);
  return {
    x: n('#builder-inspector input[data-lf="x"]'),
    y: n('#builder-inspector input[data-lf="y"]'),
    radius: n('#builder-inspector input[data-lf="radius"]'),
    falloff: document.querySelector('#builder-inspector select[data-lf="falloff"]')?.value ?? '',
  };
});
handle = await toClient(lightState.x + lightState.radius, lightState.y);
gizmoTarget = await toClient(lightState.x + 82, lightState.y);
await page.mouse.move(handle.x, handle.y);
const radiusCursor = await page.evaluate(() => document.getElementById('builder-overlay')?.style.cursor ?? '');
check('light radius handle advertises a resize cursor on hover', radiusCursor.includes('resize'), radiusCursor);
await page.mouse.down();
await page.mouse.move(gizmoTarget.x, gizmoTarget.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(160);
lightState = await page.evaluate(() => {
  const n = (sel) => Number(document.querySelector(sel)?.value ?? 0);
  return {
    x: n('#builder-inspector input[data-lf="x"]'),
    y: n('#builder-inspector input[data-lf="y"]'),
    radius: n('#builder-inspector input[data-lf="radius"]'),
    falloff: document.querySelector('#builder-inspector select[data-lf="falloff"]')?.value ?? '',
  };
});
check('canvas light-radius handle commits radius through light command', Math.abs(lightState.radius - 82) <= 1, JSON.stringify(lightState));
handle = await toClient(lightState.x + lightState.radius * 0.707, lightState.y - lightState.radius * 0.707);
await page.mouse.click(handle.x, handle.y);
await page.waitForTimeout(120);
const falloffAfterHandle = await page.evaluate(() => document.querySelector('#builder-inspector select[data-lf="falloff"]')?.value ?? '');
check('canvas light-falloff handle cycles falloff', falloffAfterHandle !== lightState.falloff && falloffAfterHandle !== '', falloffAfterHandle);
const hiddenLightStart = await toClient(lightState.x, lightState.y);
const hiddenLightDragTarget = await toClient(lightState.x + 34, lightState.y);
await page.click('#builder-inspector input[data-lf="hidden"]');
await page.waitForTimeout(120);
await page.mouse.move(hiddenLightStart.x, hiddenLightStart.y);
await page.mouse.down();
await page.mouse.move(hiddenLightDragTarget.x, hiddenLightDragTarget.y, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(120);
await page.keyboard.press('Control+z');
await page.waitForTimeout(160);
await page.mouse.click(hiddenLightStart.x, hiddenLightStart.y);
await page.waitForTimeout(120);
const hiddenLightDrag = await page.evaluate(() => ({
  x: Number(document.querySelector('#builder-inspector input[data-lf="x"]')?.value ?? 0),
  y: Number(document.querySelector('#builder-inspector input[data-lf="y"]')?.value ?? 0),
  selectedLights: document.querySelectorAll('.b-marker.k-light.sel').length,
}));
check(
  'hidden lights refuse canvas click/drag until visible again',
  hiddenLightDrag.x === lightState.x && hiddenLightDrag.y === lightState.y && hiddenLightDrag.selectedLights === 1,
  JSON.stringify(hiddenLightDrag),
);

await page.keyboard.press('Control+k');
await page.waitForTimeout(80);
await page.fill('#bp-cmdk-input', 'fit authored');
await page.keyboard.press('Enter');
await page.waitForTimeout(160);
const fitZoom = await page.evaluate(() => window.__game.ctx.camera.zoomLock ?? window.__game.ctx.camera.zoom);
check('command palette runs Fit Authored Bounds view command', fitZoom >= 0.5 && fitZoom <= 4, `zoom ${fitZoom}`);
await page.keyboard.press('Control+k');
await page.waitForTimeout(80);
await page.fill('#bp-cmdk-input', 'reset zoom');
await page.keyboard.press('Enter');
await page.waitForTimeout(120);
const resetZoom = await page.evaluate(() => window.__game.ctx.camera.zoomLock ?? window.__game.ctx.camera.zoom);
check('command palette runs Reset Zoom view command', Math.abs(resetZoom - 1) < 0.01, `zoom ${resetZoom}`);
await page.evaluate(() => window.__game.ctx.camera.snapTo(600, 500));
await page.waitForTimeout(80);
await page.keyboard.press('Delete'); // remove the temporary light
await page.waitForTimeout(80);
const doorCenter = await toClient(doorBox.x + rotatedDoor.w / 2, doorBox.y + rotatedDoor.h / 2);
await page.mouse.click(doorCenter.x, doorCenter.y);
await page.waitForTimeout(80);
await page.keyboard.press('Delete'); // remove the temporary door
await page.waitForTimeout(120);
const emptyCanvasPoint = await toClient(900, 450);
await page.mouse.move(emptyCanvasPoint.x, emptyCanvasPoint.y);
await page.waitForTimeout(50);
const idleCursor = await page.evaluate(() => document.getElementById('builder-overlay')?.style.cursor ?? '');
check('idle select canvas uses an arrow cursor, not a paint crosshair', idleCursor === 'default' || idleCursor === '', idleCursor);

/* ---------- group + align ---------- */
console.log('-- group & align');
await page.click('.bp-tool[data-kind="enemy"]');
p = await toClient(620, 590);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(80);
p = await toClient(660, 605);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(80);
await page.keyboard.press('Escape');
// marquee the two new enemies
let a = await toClient(605, 575);
let b = await toClient(680, 615);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(120);
await page.evaluate(() => {
  document.querySelector('#builder-inspector button[data-align="y"]').click();
});
await page.waitForTimeout(120);
const ys = await page.evaluate(() => {
  // both enemy markers should now share a row with the primary
  const tops = [...document.querySelectorAll('.b-marker.k-enemy.sel')].map((m) => m.style.top);
  return [...new Set(tops)];
});
check('ALIGN Y rows up the selection', ys.length === 1, JSON.stringify(ys));
const multiInspector = await page.evaluate(() => {
  const locked = document.querySelector('#builder-inspector input[data-mf="locked"]');
  const hidden = document.querySelector('#builder-inspector input[data-mf="hidden"]');
  return {
    lockedCommand: locked?.getAttribute('data-command-id') ?? '',
    hiddenTarget: hidden?.getAttribute('data-command-target') ?? '',
    hiddenOwner: hidden?.getAttribute('data-command-owner') ?? '',
    section: document.querySelector('#builder-inspector [data-section-id="selection.flags"]')?.textContent ?? '',
  };
});
check(
  'multi-select shared flags are schema-backed document commands',
  multiInspector.lockedCommand === 'builder.inspector.selection.locked' &&
    multiInspector.hiddenTarget === 'builder-document' &&
    multiInspector.hiddenOwner === 'document-command' &&
    multiInspector.section.includes('SHARED FLAGS'),
  JSON.stringify(multiInspector),
);
await page.keyboard.press('Control+g');
await page.waitForTimeout(80);
await page.keyboard.press('Escape'); // deselect
const one = await toClient(620, 590);
await page.mouse.click(one.x, one.y);
await page.waitForTimeout(120);
const groupSel = await page.evaluate(() => document.querySelectorAll('.b-marker.sel').length);
check('clicking one grouped member selects the whole group', groupSel === 2, `got ${groupSel}`);
await page.keyboard.press('Escape');

/* ---------- command palette ---------- */
console.log('-- command palette');
await page.keyboard.press('Control+k');
await page.waitForTimeout(120);
let cmdkOpen = await page.evaluate(() => document.getElementById('builder-cmdk').style.display !== 'none');
check('Ctrl+K opens the command palette', cmdkOpen);
await page.fill('#bp-cmdk-input', 'overlay');
await page.keyboard.press('Tab');
await page.waitForTimeout(80);
const cmdkAfterTab = await page.evaluate(() => ({
  open: document.getElementById('builder-cmdk').style.display !== 'none',
  focused: document.activeElement?.id,
  value: document.getElementById('bp-cmdk-input').value,
  mode: window.__game.ctx.state.mode,
}));
check(
  'command palette owns Tab without flipping Builder mode',
  cmdkAfterTab.open && cmdkAfterTab.focused === 'bp-cmdk-input' && cmdkAfterTab.value === 'overlay' && cmdkAfterTab.mode === 'build',
  JSON.stringify(cmdkAfterTab),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(80);
const cmdkAfterEscape = await page.evaluate(() => ({
  open: document.getElementById('builder-cmdk').style.display !== 'none',
  builderOpen: document.body.classList.contains('builder-open'),
  mode: window.__game.ctx.state.mode,
}));
check(
  'command palette Escape closes only the palette',
  !cmdkAfterEscape.open && cmdkAfterEscape.builderOpen && cmdkAfterEscape.mode === 'build',
  JSON.stringify(cmdkAfterEscape),
);
await page.keyboard.press('Control+k');
await page.waitForTimeout(120);
cmdkOpen = await page.evaluate(() => document.getElementById('builder-cmdk').style.display !== 'none');
check('Ctrl+K reopens the command palette after Escape', cmdkOpen);
await page.fill('#bp-cmdk-input', 'overlay');
await page.keyboard.press('Enter');
await page.waitForTimeout(120);
const overlayLabel = await page.evaluate(() => document.getElementById('bp-overlay-btn').textContent);
check('palette runs the matched command', overlayLabel.includes('LIGHT'), overlayLabel);

/* zen mode: every panel yields to the canvas */
await page.click('[data-menu="view"]');
await page.click('#b-zen');
await page.waitForTimeout(120);
let zenHidden = await page.evaluate(() => getComputedStyle(document.getElementById('builder-palette')).display === 'none');
check('zen mode hides the side panels', zenHidden);
await page.click('[data-menu="view"]');
await page.click('#b-zen');
await page.waitForTimeout(120);
zenHidden = await page.evaluate(() => getComputedStyle(document.getElementById('builder-palette')).display === 'none');
check('zen toggles back', !zenHidden);
await page.keyboard.press('o');
await page.keyboard.press('o');
await page.keyboard.press('o'); // back to NONE

/* ---------- layers ---------- */
console.log('-- layers');
await page.evaluate(() => {
  document.querySelector('.bp-layer[data-layer="gameplay"] [data-vis]').click();
});
await page.waitForTimeout(120);
markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('hiding the gameplay layer hides its markers', markers === 0, `got ${markers}`);
await page.evaluate(() => {
  document.querySelector('.bp-layer[data-layer="gameplay"] [data-vis]').click();
});
await page.waitForTimeout(120);
markers = await page.evaluate(() => document.querySelectorAll('.b-marker').length);
check('showing it brings them back', markers === 4, `got ${markers}`);

/* ---------- outliner + link graph ---------- */
console.log('-- outliner & graph');
await page.click('#bp-outliner-btn');
await page.waitForTimeout(120);
let outliner = await page.evaluate(() => {
  const panel = document.getElementById('builder-outliner');
  return {
    open: getComputedStyle(panel).display !== 'none',
    rows: panel.querySelectorAll('.bo-row').length,
    layerCommand: panel.querySelector('.bo-layer[data-layer="gameplay"] [data-layer-vis]')?.getAttribute('data-command-id') ?? '',
    rowCommand: panel.querySelector('.bo-row button[data-row-toggle="hidden"]')?.getAttribute('data-command-id') ?? '',
  };
});
check(
  'outliner opens with command-backed layer controls',
  outliner.open &&
    outliner.rows >= 4 &&
    outliner.layerCommand === 'builder.layer.gameplay.visibility' &&
    outliner.rowCommand === 'builder.toggleSelectedHidden',
  JSON.stringify(outliner),
);
await page.click('#builder-outliner .bo-layer[data-layer="gameplay"] button[data-layer-vis]');
await page.waitForTimeout(80);
const layerPersist = await page.evaluate(() => {
  const raw = localStorage.getItem('noita-builder-workspace-v1');
  const workspace = raw ? JSON.parse(raw) : null;
  return {
    persisted: workspace?.layerState?.gameplay?.hidden === true,
    rowOff: document.querySelector('#builder-outliner .bo-layer[data-layer="gameplay"]')?.classList.contains('off') ?? false,
  };
});
check('outliner layer controls persist workspace-only visibility', layerPersist.persisted && layerPersist.rowOff, JSON.stringify(layerPersist));
await page.click('#builder-outliner .bo-layer[data-layer="gameplay"] button[data-layer-vis]');
await page.waitForTimeout(80);
await page.fill('#bo-search', 'waystone');
await page.keyboard.type('h');
await page.waitForTimeout(80);
const outlinerFocus = await page.evaluate(() => ({
  helpOpen: document.getElementById('builder-help')?.classList.contains('open') ?? false,
  value: document.getElementById('bo-search')?.value ?? '',
}));
check(
  'outliner search owns text input without opening Builder help',
  !outlinerFocus.helpOpen && outlinerFocus.value.includes('waystone') && outlinerFocus.value.includes('h'),
  JSON.stringify(outlinerFocus),
);
await page.fill('#bo-search', 'waystone');
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#builder-outliner .bo-row')]
    .find((el) => el.textContent.toLowerCase().includes('waystone'));
  row?.click();
});
await page.waitForTimeout(120);
let outlinerSelect = await page.evaluate(() => ({
  rowSelected: [...document.querySelectorAll('#builder-outliner .bo-row.selected')]
    .some((el) => el.textContent.toLowerCase().includes('waystone')),
  inspector: document.getElementById('builder-inspector')?.textContent.toLowerCase() ?? '',
}));
check('outliner row selects and syncs the inspector', outlinerSelect.rowSelected && outlinerSelect.inspector.includes('waystone'), JSON.stringify(outlinerSelect));
await page.evaluate(() => window.__game.ctx.camera.snapTo(40, 40));
const frameProbe = await page.evaluate(() => {
  const before = { x: window.__game.ctx.camera.x, y: window.__game.ctx.camera.y };
  const row = [...document.querySelectorAll('#builder-outliner .bo-row')]
    .find((el) => el.textContent.toLowerCase().includes('waystone'));
  row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  return new Promise((resolve) => requestAnimationFrame(() => resolve({
    before,
    after: { x: window.__game.ctx.camera.x, y: window.__game.ctx.camera.y },
  })));
});
check(
  'outliner double-click frames the selected row',
  Math.abs(frameProbe.after.x - frameProbe.before.x) > 8 || Math.abs(frameProbe.after.y - frameProbe.before.y) > 8,
  JSON.stringify(frameProbe),
);
await page.evaluate(() => window.__game.ctx.camera.snapTo(600, 500));
const outlinerScroll = await page.evaluate(() => {
  const panel = document.getElementById('builder-outliner');
  panel.style.maxHeight = '140px';
  panel.style.overflow = 'auto';
  panel.scrollTop = 48;
  const before = panel.scrollTop;
  const row = [...document.querySelectorAll('#builder-outliner .bo-row')]
    .find((el) => el.textContent.toLowerCase().includes('waystone'));
  row?.click();
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
    before,
    after: panel.scrollTop,
    scrollable: panel.scrollHeight > panel.clientHeight,
  }))));
});
check(
  'outliner preserves scroll position after row selection refresh',
  outlinerScroll.scrollable && outlinerScroll.before > 0 && outlinerScroll.after === outlinerScroll.before,
  JSON.stringify(outlinerScroll),
);
await page.locator('#builder-outliner .bo-row', { hasText: /waystone/i }).click({ button: 'right' });
await page.waitForTimeout(80);
const outlinerMenu = await page.evaluate(() => {
  const menu = document.getElementById('editor-menu-host');
  return {
    open: menu?.classList.contains('open') && getComputedStyle(menu).display !== 'none',
    text: menu?.textContent ?? '',
  };
});
check(
  'outliner row context menu exposes command-backed actions',
  outlinerMenu.open && outlinerMenu.text.includes('Toggle Selected Hidden') && outlinerMenu.text.includes('Frame Selection'),
  JSON.stringify(outlinerMenu),
);
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#builder-outliner .bo-row')]
    .find((el) => el.textContent.toLowerCase().includes('waystone'));
  row?.querySelector('button[data-row-toggle="hidden"]')?.click();
});
await page.waitForTimeout(120);
let outlinerHidden = await page.evaluate(() => {
  const row = [...document.querySelectorAll('#builder-outliner .bo-row')]
    .find((el) => el.textContent.toLowerCase().includes('waystone'));
  return {
    hidden: row?.classList.contains('hidden-row') ?? false,
    text: row?.textContent ?? '',
  };
});
check('outliner can hide a selected object while keeping it findable', outlinerHidden.hidden && outlinerHidden.text.includes('hidden'), JSON.stringify(outlinerHidden));
await page.click('#builder-outliner button[data-outliner-filter="hidden"]');
await page.waitForTimeout(80);
outlinerHidden = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('#builder-outliner .bo-row')].map((el) => el.textContent.toLowerCase()),
}));
check('outliner hidden filter keeps hidden rows visible', outlinerHidden.rows.some((text) => text.includes('waystone')), JSON.stringify(outlinerHidden));
await page.click('#builder-outliner button[data-outliner-filter="hidden"]');
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#builder-outliner .bo-row')]
    .find((el) => el.textContent.toLowerCase().includes('waystone'));
  row?.querySelector('button[data-row-toggle="hidden"]')?.click();
  row?.querySelector('button[data-row-toggle="locked"]')?.click();
});
await page.waitForTimeout(120);
let outlinerLocked = await page.evaluate(() => {
  const row = [...document.querySelectorAll('#builder-outliner .bo-row')]
    .find((el) => el.textContent.toLowerCase().includes('waystone'));
  return row?.textContent ?? '';
});
check('outliner can lock records through document commands', outlinerLocked.includes('locked'), outlinerLocked);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#builder-outliner .bo-row')]
    .find((el) => el.textContent.toLowerCase().includes('waystone'));
  row?.querySelector('button[data-row-toggle="locked"]')?.click();
});
await page.waitForTimeout(80);

await page.click('.bp-tool[data-kind="plate"]');
let gp = await toClient(710, 610);
await page.mouse.click(gp.x, gp.y);
await page.waitForTimeout(80);
await page.click('.bp-tool[data-kind="door"]');
let gd = await toClient(748, 560);
await page.mouse.click(gd.x, gd.y);
await page.waitForTimeout(80);
await page.click('.bp-tool[data-tool="link"]');
gp = await toClient(710, 610);
gd = await toClient(748, 566);
await page.mouse.click(gp.x, gp.y);
await page.waitForTimeout(60);
await page.mouse.click(gd.x, gd.y);
await page.waitForTimeout(120);
await page.click('#bp-link-graph-btn');
await page.waitForTimeout(120);
const graphOpen = await page.evaluate(() => {
  const panel = document.getElementById('builder-link-graph');
  return {
    open: getComputedStyle(panel).display !== 'none',
    links: panel.querySelectorAll('.blg-link').length,
    text: panel.textContent,
  };
});
check('link graph opens and shows authored trigger links', graphOpen.open && graphOpen.links >= 1 && graphOpen.text.includes('plate') && graphOpen.text.includes('door'), JSON.stringify(graphOpen));
await page.evaluate(() => {
  const target = [...document.querySelectorAll('#builder-link-graph .blg-link button')]
    .find((button) => button.textContent.trim() === 'Target');
  target?.click();
});
await page.waitForTimeout(120);
const graphSelect = await page.evaluate(() => ({
  graphSelected: document.querySelector('#builder-link-graph .blg-link.selected') !== null,
  inspector: document.getElementById('builder-inspector')?.textContent.toLowerCase() ?? '',
}));
check('link graph endpoint buttons select and sync inspector', graphSelect.graphSelected && graphSelect.inspector.includes('door'), JSON.stringify(graphSelect));
await page.fill('#bo-search', 'plate');
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#builder-outliner .bo-row')]
    .find((el) => el.textContent.toLowerCase().includes('plate'));
  row?.querySelector('button[data-row-toggle="hidden"]')?.click();
});
await page.waitForTimeout(120);
const graphHiddenEndpoint = await page.evaluate(() => ({
  text: document.getElementById('builder-link-graph')?.textContent ?? '',
}));
check(
  'link graph reflects hidden endpoint warnings after outliner document command',
  graphHiddenEndpoint.text.includes('hidden endpoint makes this authored link dead at compile time'),
  JSON.stringify(graphHiddenEndpoint),
);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('#builder-outliner .bo-row')]
    .find((el) => el.textContent.toLowerCase().includes('plate'));
  row?.querySelector('button[data-row-toggle="hidden"]')?.click();
});
await page.waitForTimeout(120);
await page.locator('#builder-link-graph .blg-link').first().click({ button: 'right' });
await page.waitForTimeout(80);
const graphMenu = await page.evaluate(() => {
  const menu = document.getElementById('editor-menu-host');
  return {
    open: menu?.classList.contains('open') && getComputedStyle(menu).display !== 'none',
    text: menu?.textContent ?? '',
  };
});
check('link graph row context menu exposes unlink command', graphMenu.open && graphMenu.text.includes('Unlink'), JSON.stringify(graphMenu));
await page.evaluate(() => {
  [...document.querySelectorAll('#editor-menu-host button')]
    .find((button) => button.textContent.trim() === 'Unlink')
    ?.click();
});
await page.waitForTimeout(120);
const graphUnlink = await page.evaluate(() => ({
  links: document.querySelectorAll('#builder-link-graph .blg-link').length,
  text: document.getElementById('builder-link-graph')?.textContent ?? '',
}));
check('link graph unlink command removes the authored link', graphUnlink.text.includes('No matching links') || graphUnlink.links === 0, JSON.stringify(graphUnlink));
await page.click('#blg-close');
await page.click('#bo-close');
await page.waitForTimeout(120);

/* ---------- smooth tool ---------- */
console.log('-- smooth');
await page.evaluate(() => {
  const w = window.__game.ctx.world;
  // a lone spur in open air
  const i = w.idx(500, 500);
  w.types[i] = 3; w.colors[i] = 0x555555;
});
await page.click('.bp-tool[data-tool="smooth"]');
const sp = await toClient(500, 500);
await page.mouse.move(sp.x, sp.y);
await page.mouse.down();
await page.mouse.move(sp.x + 4, sp.y, { steps: 2 });
await page.mouse.up();
await page.waitForTimeout(120);
const spur = await page.evaluate(() => window.__game.ctx.world.types[window.__game.ctx.world.idx(500, 500)]);
check('smooth erodes the lone spur', spur === 0, `got ${spur}`);

/* ---------- polygon + magic regions ---------- */
console.log('-- regions');
await page.click('.bp-tool[data-tool="polyRegion"]');
for (const [wx, wy] of [[480, 420], [560, 420], [520, 480]]) {
  const q = await toClient(wx, wy);
  await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(60);
}
await page.keyboard.press('Enter');
await page.waitForTimeout(120);
let target = await page.evaluate(() => document.getElementById('bp-target').textContent);
check('polygon region closes and arms the pass target', target.includes('region'), target);
await page.keyboard.press('Escape'); // clear region
await page.click('.bp-tool[data-tool="regionMagic"]');
const mg = await toClient(600, 500);
await page.mouse.click(mg.x, mg.y);
await page.waitForTimeout(150);
target = await page.evaluate(() => document.getElementById('bp-target').textContent);
check('magic region selects the cavern', target.includes('region'), target);
await page.keyboard.press('Escape'); // tool back
await page.keyboard.press('Escape'); // clear region

/* ---------- author the playtest doc: patrol + emitter + mood + spawn ---------- */
console.log('-- patrol, emitter, mood (one playtest)');
await page.click('#b-new');
await page.locator('.app-dialog-root .app-dialog-btn.primary').click({ timeout: 1000 }).catch(() => {});
await page.waitForTimeout(150);
const placeAt = async (kind, wx, wy) => {
  await page.click(`.bp-tool[data-kind="${kind}"]`);
  const q = await toClient(wx, wy);
  await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(80);
};
await placeAt('spawn', 460, 616);
await placeAt('enemy', 700, 616);
await page.keyboard.press('Escape'); // enemy tool is sticky
// make it a golem with a 2-point patrol
p = await toClient(700, 616);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(100);
await page.evaluate(() => {
  const k = document.querySelector('#builder-inspector select[data-p="kind"]');
  k.value = 'golem';
  k.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(100);
await page.click('#bi-patrol');
for (const [wx, wy] of [[650, 616], [740, 616]]) {
  const q = await toClient(wx, wy);
  await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(60);
}
await page.keyboard.press('Escape');
await placeAt('hazardEmitter', 600, 500);
// mood: deselect, set ambient through the document panel
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const amb = document.querySelector('#bi-mood-ambient');
  amb.value = '0.5';
  amb.dispatchEvent(new Event('change'));
});
let moodDoc = await page.evaluate(() => {
  const amb = document.querySelector('#bi-mood-ambient');
  return {
    ambient: window.__game.builder?.doc?.mood?.ambient ?? window.__game.ctx.builder?.doc?.mood?.ambient ?? null,
    value: amb?.value ?? '',
    command: amb?.getAttribute('data-command-id') ?? '',
    owner: amb?.getAttribute('data-command-owner') ?? '',
  };
});
check(
  'document mood field is schema-backed and command-owned',
  moodDoc.value === '0.5' &&
    moodDoc.command === 'builder.inspector.document.mood.ambient' &&
    moodDoc.owner === 'document-metadata-command',
  JSON.stringify(moodDoc),
);
await page.keyboard.press('Control+z');
await page.waitForTimeout(120);
moodDoc = await page.evaluate(() => {
  const amb = document.querySelector('#bi-mood-ambient');
  return {
    ambient: window.__game.builder?.doc?.mood?.ambient ?? window.__game.ctx.builder?.doc?.mood?.ambient ?? null,
    value: amb?.value ?? '',
  };
});
check('document mood ambient undoes through Builder command stack', moodDoc.value === '', JSON.stringify(moodDoc));
await page.keyboard.press('Control+y');
await page.waitForTimeout(120);
moodDoc = await page.evaluate(() => {
  const amb = document.querySelector('#bi-mood-ambient');
  return {
    ambient: window.__game.builder?.doc?.mood?.ambient ?? window.__game.ctx.builder?.doc?.mood?.ambient ?? null,
    value: amb?.value ?? '',
  };
});
check('document mood ambient redoes through Builder command stack', moodDoc.value === '0.5', JSON.stringify(moodDoc));
const preAmbient = await page.evaluate(() => window.__game.ctx.params.global.ambient);
await page.click('[data-menu="edit"]');
await page.click('#b-capture');
await page.waitForTimeout(300);
await page.click('#b-playtest');
await page.waitForFunction(
  () => window.__game.ctx.levels.current && !window.__game.ctx.levels.transitioning,
  { timeout: 10000 },
);
await page.waitForFunction(
  () => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    let water = 0;
    for (let y = 495; y < 625; y++) for (let x = 580; x < 620; x++) if (w.types[w.idx(x, y)] === 2) water++;
    return (ctx.levels.current?.emitters?.length ?? 0) === 1 && water >= 2;
  },
  { timeout: 8000 },
).catch(() => {});
const pt = await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const w = ctx.world;
  let water = 0;
  for (let y = 495; y < 625; y++) for (let x = 580; x < 620; x++) if (w.types[w.idx(x, y)] === 2) water++;
  const golem = ctx.enemies.find((e) => e.kind === 'golem');
  return {
    ambient: ctx.params.global.ambient,
    water,
    patrol: golem?.patrol?.length ?? 0,
    emitters: ctx.levels.current.emitters?.length ?? 0,
  };
});
check('mood ambient applies in the playtest', pt.ambient === 0.5, `got ${pt.ambient}`);
check('hazard emitter compiled and drips real water', pt.emitters === 1 && pt.water >= 2, JSON.stringify(pt));
check('patrol route compiled onto the golem', pt.patrol === 2, `got ${pt.patrol}`);

/* de-alert: a patroller that loses you beyond notice range calms in ~5s */
await page.evaluate(() => {
  const ctx = window.__game.ctx;
  const golem = ctx.enemies.find((e) => e.kind === 'golem');
  golem.alerted = true;
  golem.calmT = 0;
  golem.vx = 0;
  golem.x = 500;
  golem.y = 616;
  ctx.player.x = 850;
  ctx.player.y = 616;
  ctx.player.vx = 0;
  ctx.player.vy = 0;
  ctx.camera.snapTo(675, 616);
  ctx.camera.updateSimBounds(ctx.world);
  for (let i = 0; i < 320; i++) {
    golem.x = 500;
    golem.y = 616;
    golem.vx = 0;
    ctx.player.x = 850;
    ctx.player.y = 616;
    ctx.enemyCtl.update(ctx);
  }
});
const calm = await page.evaluate(() => {
  const golem = window.__game.ctx.enemies.find((e) => e.kind === 'golem');
  return { alerted: golem.alerted, dist: Math.abs(golem.x - window.__game.ctx.player.x) };
});
check('patroller de-alerts after ~5s beyond notice range', calm.alerted === false, JSON.stringify(calm));

/* scar the world, return, bake the scar region */
await page.evaluate(() => {
  const w = window.__game.ctx.world;
  for (let y = 590; y < 600; y++)
    for (let x = 470; x < 480; x++) {
      const i = w.idx(x, y);
      w.types[i] = 13; w.colors[i] = 0x7a8a99; // a metal patch "scar" (static)
    }
});
await page.click('#mode-builder-btn');
await page.waitForTimeout(400);
// the de-alert teleport parked the camera right of center - re-center so
// the later region drags and placements land on the canvas, not the panels
await page.evaluate(() => window.__game.ctx.camera.snapTo(600, 500));
await page.waitForTimeout(120);
const ambBack = await page.evaluate(() => window.__game.ctx.params.global.ambient);
check('ambient restored on return from playtest', ambBack === preAmbient, `got ${ambBack} want ${preAmbient}`);
let scarGold = await page.evaluate(() => {
  const w = window.__game.ctx.world;
  let n = 0;
  for (let y = 590; y < 600; y++) for (let x = 470; x < 480; x++) if (w.types[w.idx(x, y)] === 13) n++;
  return n;
});
check('playtest scars discarded by default', scarGold === 0, `got ${scarGold}`);
// region over the scar, bake via the command palette
await page.click('.bp-tool[data-tool="region"]');
a = await toClient(465, 585);
b = await toClient(485, 605);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(100);
await page.keyboard.press('Control+k');
await page.fill('#bp-cmdk-input', 'bake');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
scarGold = await page.evaluate(() => {
  const w = window.__game.ctx.world;
  let n = 0;
  for (let y = 590; y < 600; y++) for (let x = 470; x < 480; x++) if (w.types[w.idx(x, y)] === 13) n++;
  return n;
});
check('region bake re-applies the playtest scar', scarGold === 100, `got ${scarGold}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(120);
scarGold = await page.evaluate(() => {
  const w = window.__game.ctx.world;
  let n = 0;
  for (let y = 590; y < 600; y++) for (let x = 470; x < 480; x++) if (w.types[w.idx(x, y)] === 13) n++;
  return n;
});
check('region bake undoes as one command', scarGold === 0, `got ${scarGold}`);

/* ---------- rotate + note + solo ---------- */
console.log('-- rotate, note, solo');
await placeAt('door', 600, 560);
await page.click('#bi-rotate');
await page.waitForTimeout(120);
const rot = await page.evaluate(() => ({
  w: Number(document.querySelector('#builder-inspector input[data-p="w"]').value),
  h: Number(document.querySelector('#builder-inspector input[data-p="h"]').value),
}));
check('door rotate swaps width/height', rot.w === 13 && rot.h === 3, JSON.stringify(rot));
await page.evaluate(() => {
  const w = document.querySelector('#builder-inspector input[data-p="w"]');
  w.value = '';
  w.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(120);
const blankDoorNumber = await page.evaluate(() => ({
  w: document.querySelector('#builder-inspector input[data-p="w"]')?.value ?? '',
  status: document.getElementById('builder-status')?.textContent ?? '',
}));
check(
  'object numeric inspector resets blank values to schema fallback',
  blankDoorNumber.w === '3',
  JSON.stringify(blankDoorNumber),
);
await placeAt('decor', 520, 480);
await page.evaluate(() => {
  const t = document.querySelector('#builder-inspector input[data-p="text"]');
  t.value = 'boss arena goes here';
  t.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(100);
const noteTitle = await page.evaluate(() => document.querySelector('.b-marker.k-decor')?.title ?? '');
check('note text rides the marker tooltip', noteTitle === 'boss arena goes here', noteTitle);

await page.click('.bp-tool[data-tool="light"]');
p = await toClient(560, 520);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(80);
p = await toClient(640, 520);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(80);
await page.keyboard.press('Escape');
const radiusBefore = await page.evaluate(() => {
  const radius = document.querySelector('#builder-inspector input[data-lf="radius"]');
  const before = radius?.value ?? '';
  if (radius) {
    radius.value = '-1';
    radius.dispatchEvent(new Event('change'));
  }
  return before;
});
await page.waitForTimeout(120);
const invalidLightNumber = await page.evaluate(() => ({
  radius: document.querySelector('#builder-inspector input[data-lf="radius"]')?.value ?? '',
  status: document.getElementById('builder-status')?.textContent ?? '',
}));
check(
  'light numeric inspector enforces schema min/max before command commit',
  invalidLightNumber.radius === radiusBefore && invalidLightNumber.status.includes('RADIUS MUST BE >= 4'),
  JSON.stringify({ ...invalidLightNumber, before: radiusBefore }),
);
await page.click('#bi-solo');
await page.waitForTimeout(200);
const solo = await page.evaluate(() => window.__game.ctx.state.editorLights?.length ?? 0);
check('solo narrows the light preview to one', solo === 1, `got ${solo}`);

check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);

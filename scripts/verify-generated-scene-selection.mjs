// Focused Builder probe for generated virtual pixel-scene selection.
// Usage: node scripts/verify-generated-scene-selection.mjs [url]
// Requires a running Vite dev server.
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/';
let pass = 0;
let fail = 0;

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
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('dialog', (dialog) => dialog.accept());

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__game?.ctx?.levels, { timeout: 20000 });

  const launched = await page.evaluate(async () => {
    const defaults = await import('/src/world/virtual/defaults.ts');
    const chunks = await import('/src/world/virtual/ChunkGenerator.ts');
    const def = defaults.createDefaultVirtualWorldDef(518921213);
    const windowChunks = chunks.generateVirtualWindow(def, -4, 0, 4, 3);
    const placements = windowChunks.flatMap((chunk) => chunk.meta.scenePlacements ?? []);
    const scene = placements.find((placement) => placement.id.includes('scene-crystal-cluster')) ?? placements[0];
    if (!scene) return null;
    window.__generatedSceneProbeId = scene.id;
    window.__game.ctx.levels.playVirtualWindow(
      window.__game.ctx,
      def,
      { x: Math.floor(scene.x + scene.w / 2), y: Math.floor(scene.y + scene.h / 2) },
      1,
    );
    return { id: scene.id };
  });
  check('probe launched a deterministic virtual scene window', launched !== null, JSON.stringify(launched));

  await page.waitForFunction(() => window.__game.ctx.levels.current?.generatedScenes?.length > 0, { timeout: 10000 });
  await page.click('#mode-builder-btn');
  await page.waitForSelector('.app-dialog-root [data-intent="current-scene"]', { timeout: 5000 });
  await page.click('.app-dialog-root [data-intent="current-scene"]');
  await page.waitForFunction(() => document.body.classList.contains('builder-open'), { timeout: 10000 });

  const retained = await page.evaluate(() => {
    const builder = window.__game.ctx.builder;
    const scenes = builder?.adoptedGeneratedScenes ?? [];
    return {
      count: scenes.length,
      selectedRuntime: window.__game.ctx.levels.current?.generatedScenes?.length ?? 0,
      hasProbe: scenes.some((scene) => scene.id === window.__generatedSceneProbeId),
    };
  });
  check('Builder retains generated scene metadata after disposable runtime cleanup', retained.count > 0 && retained.hasProbe, JSON.stringify(retained));

  const clickPoint = await page.evaluate(() => {
    const builder = window.__game.ctx.builder;
    const scenes = builder?.adoptedGeneratedScenes ?? [];
    const scene = scenes.find((item) => item.id === window.__generatedSceneProbeId) ?? scenes[0];
    if (!builder || !scene) return null;
    const cx = (scene.x0 + scene.x1) / 2;
    const cy = (scene.y0 + scene.y1) / 2;
    window.__game.ctx.camera.snapTo(cx, cy);
    const overlay = document.getElementById('builder-overlay');
    const rect = overlay.getBoundingClientRect();
    const point = builder.worldToScreen(cx, cy, rect);
    return { x: rect.left + point.x, y: rect.top + point.y };
  });
  check('probe projected generated scene center onto Builder canvas', clickPoint !== null, JSON.stringify(clickPoint));
  if (clickPoint) {
    await page.mouse.click(clickPoint.x, clickPoint.y);
    await page.waitForTimeout(200);
  }

  const selection = await page.evaluate(async () => {
    const captureModule = await import('/src/builder/generatedSceneCapture.ts');
    const builder = window.__game.ctx.builder;
    const scene = builder?.selectedGeneratedScene?.();
    const capture = scene ? captureModule.generatedSceneCaptureDocument(scene, builder?.doc?.biome ?? 'earthen') : null;
    const inspectorRoot = document.querySelector('#builder-inspector .bi-generated-scene');
    const rowText = (field) =>
      document.querySelector(`#builder-inspector [data-gen-field="${field}"] b`)?.textContent?.trim() ?? '';
    const buttonState = (id) => {
      const button = document.getElementById(id);
      return button instanceof HTMLButtonElement ? { exists: true, disabled: button.disabled } : { exists: false, disabled: true };
    };
    return {
      selected: scene?.id ?? '',
      expected: window.__generatedSceneProbeId ?? '',
      selectedId: builder?.selectedId ?? null,
      selectedIds: builder?.selectedIds?.size ?? -1,
      inspectorText: document.getElementById('builder-inspector')?.textContent ?? '',
      inspectorRoot: inspectorRoot instanceof HTMLElement,
      inspectorKind: inspectorRoot instanceof HTMLElement ? inspectorRoot.dataset.inspectorKind ?? '' : '',
      inspectorGeneratedSceneId: inspectorRoot instanceof HTMLElement ? inspectorRoot.dataset.generatedSceneId ?? '' : '',
      inspectorSceneId: inspectorRoot instanceof HTMLElement ? inspectorRoot.dataset.sceneId ?? '' : '',
      inspectorSlotId: inspectorRoot instanceof HTMLElement ? inspectorRoot.dataset.slotId ?? '' : '',
      boundsRow: rowText('bounds'),
      sizeRow: rowText('size'),
      contentRow: rowText('content'),
      sourceChunkRow: rowText('source-chunk'),
      regionArmed: builder?.region !== null,
      captureObjects: capture?.doc.objects.length ?? 0,
      captureLights: capture?.doc.lights.length ?? 0,
      captureButton: buttonState('bi-gen-capture'),
      frameButton: buttonState('bi-gen-frame'),
      worldButton: buttonState('bi-gen-world'),
      copyButton: buttonState('bi-gen-copy'),
    };
  });
  check('clicking a generated scene selects the probed runtime scene', selection.selected !== '' && selection.selected === selection.expected, JSON.stringify(selection));
  check('generated-scene inspector exposes stable scene metadata hooks', selection.inspectorRoot && selection.inspectorKind === 'generated-scene' && selection.inspectorGeneratedSceneId === selection.selected && selection.inspectorSceneId !== '' && selection.inspectorSlotId !== '', JSON.stringify(selection));
  check('generated-scene inspector exposes stable field rows', selection.inspectorText.includes('GENERATED PIXEL SCENE') && selection.boundsRow !== '' && selection.sizeRow !== '' && selection.contentRow.includes('obj') && selection.sourceChunkRow !== '', JSON.stringify(selection));
  check('generated-scene selection clears normal object, multi-select, and region state', selection.selectedId === null && selection.selectedIds === 0 && selection.regionArmed === false, JSON.stringify(selection));
  check('generated-scene capture model includes scene objects or lights', selection.captureObjects + selection.captureLights > 0, JSON.stringify(selection));
  check('generated-scene inspector exposes enabled frame/world/copy/capture actions', [selection.frameButton, selection.worldButton, selection.copyButton, selection.captureButton].every((button) => button.exists && !button.disabled), JSON.stringify(selection));

  await page.click('#bi-gen-frame');
  await page.waitForTimeout(80);
  const framed = await page.evaluate(async () => {
    const constants = await import('/src/config/constants.ts');
    const builder = window.__game.ctx.builder;
    const scene = builder?.selectedGeneratedScene?.();
    if (!scene) return null;
    const expectedX = (scene.x0 + scene.x1) / 2;
    const expectedY = (scene.y0 + scene.y1) / 2;
    const actualX = window.__game.ctx.camera.x + constants.VIEW_W / 2;
    const actualY = window.__game.ctx.camera.y + constants.VIEW_H / 2;
    return {
      expectedX,
      expectedY,
      actualX,
      actualY,
      dx: Math.abs(actualX - expectedX),
      dy: Math.abs(actualY - expectedY),
    };
  });
  check('generated-scene Frame action recenters the camera near the scene center', framed !== null && framed.dx <= 1 && framed.dy <= 1, JSON.stringify(framed));

  await page.click('#bi-gen-world');
  await page.waitForSelector('#builder-virtual-world', { state: 'visible', timeout: 5000 });
  const worldPanelOpen = await page.evaluate(() => {
    const panel = document.getElementById('builder-virtual-world');
    return panel instanceof HTMLElement && getComputedStyle(panel).display !== 'none' && panel.offsetParent !== null;
  });
  check('generated-scene World Map action opens the virtual world panel', worldPanelOpen, String(worldPanelOpen));
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
}

process.exit(fail > 0 ? 1 : 0);

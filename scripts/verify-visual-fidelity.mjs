// Real render captures, material edits, darkness, HUD layout and same-session
// detail cost. Usage: node scripts/verify-visual-fidelity.mjs [dev URL]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, startConsoleTestRun } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5182/';
const dir = 'verify-out/fidelity';
mkdirSync(dir, { recursive: true });
const checker = makeChecker(), errors = [], captures = [];
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${url}?link=off`, { waitUntil: 'networkidle', timeout: 60000 });
  await leaveTitleIfShown(page);
  await page.addStyleTag({ content: '#wave-banner, #toast-stack, .hint-teach-overlay { visibility: hidden !important; }' });
  const assets = await page.evaluate(async () => {
    const rows = [];
    for (const name of ['refinery-waterworks', 'rot-gardens-rich', 'kiln-heart-rich', 'refinery-machinery-rich']) {
      const response = await fetch(`/assets/living-descent/${name}.webp`);
      if (!response.ok) throw new Error(`${name}: ${response.status}`);
      const blob = await response.blob(), image = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(image.width, image.height), g = canvas.getContext('2d');
      g.drawImage(image, 0, 0);
      const data = g.getImageData(0, 0, image.width, image.height).data;
      let opaque = 0, transparent = 0, sum = 0, squares = 0, peak = 0, hot = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 8) { transparent++; continue; }
        opaque++;
        const l = data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722;
        sum += l; squares += l * l; peak = Math.max(peak, l); if (l > 220) hot++;
      }
      const mean = sum / opaque;
      rows.push({ name, width: image.width, height: image.height, bytes: blob.size,
        coverage: opaque / (opaque + transparent), mean, std: Math.sqrt(squares / opaque - mean * mean), peak, hot: hot / opaque });
      image.close();
    }
    return rows;
  });
  for (const a of assets) {
    checker.check(`${a.name}: decodes with a broad value range and limited clipping`, a.peak > 200 && a.std > 25 && a.hot < .12);
    checker.check(`${a.name}: intended opacity`, a.name.includes('machinery') ? a.coverage > .1 && a.coverage < .65 : a.coverage > .999);
  }
  checker.check('four new plates stay below 2.5 MB combined', assets.reduce((n, a) => n + a.bytes, 0) < 2500000);

  async function render() {
    return page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
      window.__game.composer.compose(window.__game.ctx, 1);
      window.__game.renderer.render(window.__game.ctx);
      resolve();
    })));
  }
  for (const level of ['d1', 'd2', 'd3', 'd4', 'd2b', 'd3b']) {
    await startConsoleTestRun(page, { level, world: 'campaign-level', seed: 1337, settleMs: 1800, timeout: 60000 });
    await page.waitForFunction(() => window.__game.composer.layers.ready, null, { timeout: 60000 });
    const state = await page.evaluate(async () => {
      const ctx = window.__game.ctx;
      const { VIEW_W, VIEW_H } = await import('/src/config/constants.ts');
      const { PLAYER_H, PLAYER_HALF_W } = await import('/src/core/types.ts');
      ctx.state.paused = true; ctx.player.godMode = true;
      document.querySelectorAll('#card-offer-overlay.visible').forEach(e => e.classList.remove('visible'));
      document.getElementById('wave-banner')?.classList.remove('show');
      document.getElementById('toast-stack').replaceChildren();
      ctx.events.emit('levelCurtain', { visible: false });
      if (ctx.levels.current.def.id === 'd1') {
        // A real standing cell on the sluice's right bank, with the original camera.
        for (let y = 325; y < 390; y++) if (ctx.physics.entityFree(805, y, PLAYER_HALF_W, PLAYER_H) && ctx.physics.cellBlocks(805, y + 1)) {
          Object.assign(ctx.player, { x: 805, y, vx: 0, vy: 0 }); break;
        }
        Object.assign(ctx.camera, { x: 483, y: 157, renderX: 483, renderY: 157 });
      } else {
        // Review the actual generated route: choose a standing surface with
        // room around it, rather than painting a decorative screenshot arena.
        let best = null;
        for (let y = 240; y < 850; y += 4) for (let x = 360; x < 1200; x += 12) {
          if (!ctx.physics.cellBlocks(x, y + 1) || !ctx.physics.entityFree(x, y, PLAYER_HALF_W, PLAYER_H)) continue;
          let open = 0;
          for (let dy = -100; dy <= 35; dy += 12) for (let dx = -170; dx <= 170; dx += 16) if (!ctx.physics.cellBlocks(x + dx, y + dy)) open++;
          if (!best || open > best.open) best = { x, y, open };
        }
        if (best) Object.assign(ctx.player, { x: best.x, y: best.y, vx: 0, vy: 0 });
        const x = Math.max(0, Math.min(ctx.world.width - VIEW_W, ctx.player.x - VIEW_W / 2));
        const y = Math.max(0, Math.min(ctx.world.height - VIEW_H, ctx.player.y - VIEW_H * .58));
        Object.assign(ctx.camera, { x, y, renderX: Math.floor(x), renderY: Math.floor(y) });
      }
      ctx.state.frameCount = 420;
      ctx.input.mouse.x = ctx.player.x + 60; ctx.input.mouse.y = ctx.player.y - 9;
      return { level: ctx.levels.current.def.id, seed: ctx.state.worldSeed, player: { x: ctx.player.x, y: ctx.player.y },
        camera: { x: ctx.camera.renderX, y: ctx.camera.renderY }, post: { ...ctx.state.postFx }, backend: window.__game.renderer.backendStatus?.() ?? ctx.state.render };
    });
    await render();
    await page.screenshot({ path: `${dir}/final-${level}.png` });
    captures.push(state);
    checker.check(`${level}: complete depth kit loaded`, await page.evaluate(() => window.__game.composer.layers.ready));
    if (level === 'd1') {
      await page.evaluate(() => { window.__game.ctx.state.postFx.enabled = false; });
      await render(); await page.screenshot({ path: `${dir}/final-d1-no-post.png` });
      await page.evaluate(() => { window.__game.ctx.state.postFx.enabled = true; });
    }
  }

  await startConsoleTestRun(page, { level: 'd1', world: 'campaign-level', seed: 90210, settleMs: 1600, timeout: 60000 });
  const materials = await page.evaluate(async () => {
    const { World } = await import('/src/sim/World.ts');
    const { Cell } = await import('/src/sim/CellType.ts');
    const { drawSceneFidelity, VISUAL_FIDELITY: settings } = await import('/src/render/SceneFidelity.ts');
    const world = new World(), ctx = window.__game.ctx;
    for (let x = 192; x < 250; x++) {
      for (let y = 180; y < 220; y++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0);
      for (let y = 220; y < 235; y++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0);
    }
    const fixtureCtx = { ...ctx, world, camera: { renderX: 0, renderY: 0 },
      levels: { current: { ...ctx.levels.current, authoredLights: [] } }, state: { ...ctx.state, mode: 'play', frameCount: 420 } };
    const bytes = world.types.slice(), revision = world.mutationVersion;
    const points = new Map();
    const mark = (x, y, r, g, b) => { if (r + g + b > 0) points.set(`${x},${y}`, [r, g, b]); };
    const out = { pixelStep: .5, setPx: mark, addPx: mark, setFinePx: mark, addFinePx: mark };
    const light = { sample: () => ({ r: .6, g: .8, b: .8, open: 1 }) };
    const dark = { sample: () => ({ r: 0, g: 0, b: 0, open: 0 }) };
    drawSceneFidelity(out, light, fixtureCtx);
    const lit = points.size, finite = [...points.values()].every(p => p.every(Number.isFinite));
    const immutable = bytes.every((v, i) => v === world.types[i]) && revision === world.mutationVersion;
    points.clear(); drawSceneFidelity(out, dark, fixtureCtx); const darkPixels = points.size;
    settings.enabled = false; points.clear(); drawSceneFidelity(out, light, fixtureCtx); const disabledPixels = points.size;
    settings.enabled = true;
    for (let x = 192; x < 250; x++) for (let y = 180; y < 235; y++) world.clearCellAt(world.idx(x, y));
    points.clear(); drawSceneFidelity(out, light, fixtureCtx);
    return { lit, finite, immutable, darkPixels, disabledPixels, removedPixels: points.size };
  });
  checker.check('presentation produces finite detailed pixels without changing cells or mutation counters', materials.lit > 100 && materials.finite && materials.immutable);
  checker.check('deep darkness suppresses unlit detail', materials.darkPixels === 0);
  checker.check('detail isolation switch works', materials.disabledPixels === 0);
  checker.check('draining water and removing roots removes their cached dressing immediately', materials.removedPixels === 0);

  // Exercise the reference's real pool at normal speed, then benchmark that
  // same floor. The last gallery capture may be a dry puzzle room.
  await startConsoleTestRun(page, { level: 'd1', world: 'campaign-level', seed: 1337, settleMs: 1500, timeout: 60000 });
  await page.waitForFunction(() => window.__game.composer.layers.ready, null, { timeout: 60000 });
  const motionStart = await page.evaluate(() => {
    const ctx = window.__game.ctx; ctx.player.godMode = true;
    Object.assign(ctx.player, { x: 805, y: 327, vx: 0, vy: 0 });
    ctx.state.paused = false;
    return { frame: ctx.state.frameCount, x: ctx.player.x };
  });
  await page.keyboard.down('KeyD'); await page.keyboard.down('Space');
  await page.waitForTimeout(1000); await page.keyboard.up('Space');
  await page.waitForTimeout(1000); await page.keyboard.up('KeyD');
  await page.waitForTimeout(4000);
  const motionEnd = await page.evaluate(() => {
    const ctx = window.__game.ctx; ctx.state.paused = true;
    return { frame: ctx.state.frameCount, x: ctx.player.x, mode: ctx.state.mode, dead: ctx.player.dead };
  });
  checker.check('normal-speed sluice play responds to movement and keeps its simulation advancing',
    motionEnd.frame - motionStart.frame >= 250 && Math.abs(motionEnd.x - motionStart.x) > 30 && motionEnd.mode === 'play' && !motionEnd.dead,
    JSON.stringify({ motionStart, motionEnd }));
  await page.screenshot({ path: `${dir}/live-sluice.png` });
  const timing = await page.evaluate(async () => {
    const ctx = window.__game.ctx, composer = window.__game.composer;
    const { VISUAL_FIDELITY: settings } = await import('/src/render/SceneFidelity.ts');
    ctx.state.paused = true; ctx.camera.snapTo(805, 370);
    const before = [], after = [];
    for (let i = 0; i < 80; i++) {
      const on = i % 2 === 0; settings.enabled = on; ctx.state.frameCount += 2;
      const start = performance.now(); composer.compose(ctx, 1); const ms = performance.now() - start;
      if (i >= 20) (on ? after : before).push(ms);
      if (i % 8 === 0) await new Promise(requestAnimationFrame);
    }
    settings.enabled = true;
    const stats = a => { a.sort((x, y) => x - y); return { median: a[Math.floor(a.length / 2)], p95: a[Math.floor(a.length * .95)] }; };
    return { off: stats(before), on: stats(after), gpuComposeAvailable: composer.target.gpuComposeAvailable };
  });
  checker.check('detail adds less than 3 ms to median frame composition', timing.on.median - timing.off.median < 3, JSON.stringify(timing));

  const layouts = [];
  for (const [width, height, scale] of [[1672, 941, 1], [1280, 720, 1.5], [900, 600, 1.25]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(scale => document.documentElement.style.setProperty('--text-scale', String(scale)), scale);
    await page.waitForTimeout(120);
    const layout = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
      const vitals = rect('.vitals'), objective = rect('.wave-readout'), treasure = rect('#treasure-row'), pause = rect('#expedition-pause');
      const within = r => r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      return { vitals, objective, treasure, pause, within: [vitals, objective, treasure].every(within),
        topSeparated: vitals.right + 8 < objective.x, bottomSeparated: treasure.bottom + 5 < pause.y,
        trackWidth: document.querySelector('.vital-track').getBoundingClientRect().width };
    });
    layouts.push({ width, height, scale, ...layout });
    checker.check(`${width}x${height}, text ${scale}: HUD stays inside screen with readable separated bars`, layout.within && layout.topSeparated && layout.bottomSeparated && layout.trackWidth > 35, JSON.stringify(layout));
    await page.screenshot({ path: `${dir}/hud-${width}-${scale}.png` });
  }
  const touchContext = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const touchPage = await touchContext.newPage();
  touchPage.on('pageerror', e => errors.push(String(e)));
  await touchPage.goto(`${url}?link=off`, { waitUntil: 'networkidle', timeout: 60000 });
  await startConsoleTestRun(touchPage, { level: 'd1', world: 'campaign-level', seed: 1337, settleMs: 1500, timeout: 60000 });
  await touchPage.addStyleTag({ content: '#wave-banner, #toast-stack, .hint-teach-overlay { visibility: hidden !important; }' });
  for (const [width, height] of [[844, 390], [390, 844]]) {
    await touchPage.setViewportSize({ width, height }); await touchPage.waitForTimeout(200);
    const layout = await touchPage.evaluate(() => {
      const rectangles = ['.vitals', '.wave-readout', '#treasure-row'].map(selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { selector, x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      });
      const overlap = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
      return { touch: document.body.classList.contains('touch-enabled'), rectangles,
        within: rectangles.every(r => r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight),
        separated: rectangles.every((r, i) => rectangles.slice(i + 1).every(s => !overlap(r, s))) };
    });
    layouts.push({ width, height, ...layout });
    checker.check(`${width}x${height}: touch HUD stays visible without panel overlap`, layout.touch && layout.within && layout.separated, JSON.stringify(layout));
    await touchPage.screenshot({ path: `${dir}/hud-touch-${width}.png` });
  }
  await touchContext.close();
  checker.check('no browser exceptions', errors.length === 0, errors.join('\n'));
  writeFileSync(`${dir}/verification.json`, JSON.stringify({ assets, captures, materials, motionStart, motionEnd, timing, layouts, errors, passed: checker.pass, failed: checker.fail }, null, 2));
  console.log(`Visual fidelity: ${checker.pass} passed, ${checker.fail} failed`);
  if (checker.fail) process.exitCode = 1;
} finally { await browser.close(); }

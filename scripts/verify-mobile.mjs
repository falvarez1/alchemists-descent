// Real multi-touch via Chromium CDP. Usage: node scripts/verify-mobile.mjs [dev URL]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { startConsoleTestRun } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = 'verify-out/mobile';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, passed: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${condition || !detail ? '' : ` ${detail}`}`);
  assert.ok(condition, name);
};

try {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await context.addInitScript(() => {
    window.__wakeRequests = 0;
    window.__wakeReleases = 0;
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
      request: async () => {
        window.__wakeRequests++;
        const sentinel = new EventTarget();
        sentinel.release = async () => { window.__wakeReleases++; sentinel.dispatchEvent(new Event('release')); };
        return sentinel;
      },
    } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.ctx);
  check('coarse pointer enables touch with a desktop user agent', await page.locator('body').evaluate(el => el.classList.contains('touch-enabled')));
  check('title screen keeps gameplay controls hidden', await page.locator('#mobile-controls').isHidden());
  await page.screenshot({ path: `${out}/landscape-title.png` });
  await startConsoleTestRun(page, { level: 'd1', world: 'campaign-level' });
  await page.waitForFunction(() => !document.getElementById('mobile-controls').hidden);
  check('active mobile play requests a screen wake lock', await page.evaluate(() => window.__wakeRequests > 0));
  await page.evaluate(() => { window.__game.ctx.player.godMode = true; });
  await page.screenshot({ path: `${out}/landscape-play.png` });

  const cdp = await context.newCDPSession(page);
  const center = async selector => {
    const rect = await page.locator(selector).boundingBox();
    assert.ok(rect, selector);
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const point = (id, xy) => ({ id, ...xy, radiusX: 5, radiusY: 5, force: 1 });
  const dispatch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const state = () => page.evaluate(() => {
    const ctx = window.__game.ctx;
    return { keys: { ...ctx.input.keys }, fire: ctx.player.firing, x: ctx.player.x, y: ctx.player.y, aim: { ...ctx.input.mouse }, paused: ctx.state.paused, wand: ctx.wands.active, flask: ctx.flask.activeIndex };
  });
  let move = await center('[data-touch-stick="move"]');
  let aim = await center('[data-touch-stick="aim"]');
  const before = await state();
  await dispatch('touchStart', [point(1, move)]);
  await dispatch('touchMove', [point(1, { x: move.x + 34, y: move.y })]);
  await dispatch('touchStart', [point(1, { x: move.x + 34, y: move.y }), point(2, aim)]);
  await dispatch('touchMove', [point(1, { x: move.x + 34, y: move.y }), point(2, { x: aim.x + 32, y: aim.y - 10 })]);
  await page.waitForFunction(() => window.__game.ctx.input.keys.right && window.__game.ctx.player.firing);
  const combined = await state();
  check('two thumbs move and cast simultaneously', combined.keys.right && combined.fire, JSON.stringify(combined));
  await page.waitForFunction(x => window.__game.ctx.player.x > x + 2, before.x, { timeout: 5000 });
  check('touch movement moves the real player', (await state()).x > before.x + 2);
  await dispatch('touchEnd', [point(1, { x: move.x + 34, y: move.y })]);
  await page.waitForFunction(() => !window.__game.ctx.input.keys.right);
  const single = await state();
  check('lifting the movement thumb preserves independent casting', !single.keys.right && single.fire, JSON.stringify(single));
  await dispatch('touchCancel', []);
  await page.waitForFunction(() => !window.__game.ctx.player.firing);
  const cancelled = await state();
  check('pointer cancellation clears held movement and casting', !cancelled.fire && !Object.values(cancelled.keys).some(Boolean));

  const wand = (await state()).wand;
  await page.locator('[data-touch-action="wand"]').tap();
  check('one tap changes wand exactly once', (await state()).wand !== wand);
  await page.locator('[data-touch-menu="tools"]').tap();
  const flask = (await state()).flask;
  await page.locator('[data-touch-action="flask"]').tap();
  check('flasks are selectable without a keyboard', (await state()).flask !== flask);
  const pour = await center('[data-touch-key="KeyQ"]');
  await dispatch('touchStart', [point(9, pour)]);
  await page.waitForFunction(() => window.__game.ctx.input.pourHeld);
  await dispatch('touchCancel', []);
  await page.waitForFunction(() => !window.__game.ctx.input.pourHeld);
  check('pour releases on touch cancellation', await page.evaluate(() => !window.__game.ctx.input.pourHeld));
  await page.locator('[data-touch-menu="aim"]').tap();
  await page.locator('[data-touch-menu="tools"]').tap();
  await dispatch('touchStart', [point(3, aim)]);
  await dispatch('touchMove', [point(3, { x: aim.x - 28, y: aim.y })]);
  await page.waitForFunction(() => window.__game.ctx.input.mouse.x < window.__game.ctx.player.x);
  const aimOnly = await state();
  check('aim-only mode targets without firing', !aimOnly.fire && aimOnly.aim.x < aimOnly.x);
  await dispatch('touchEnd', []);

  const jump = await center('[data-touch-key="Space"]');
  await dispatch('touchStart', [point(4, jump)]);
  await page.waitForFunction(() => window.__game.ctx.input.keys.jump);
  check('Jump holds levitation and wall-jump input', (await state()).keys.jump && (await state()).keys.wallJump);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await dispatch('touchCancel', []);
  await page.waitForFunction(() => window.__game.ctx.state.paused);
  check('app interruption pauses and releases every held key', !Object.values((await state()).keys).some(Boolean));
  check('pause menu suppresses touch controls', await page.locator('#mobile-controls').isHidden());
  check('pause releases the screen wake lock', await page.evaluate(() => window.__wakeReleases > 0));
  await page.locator('#pause-resume').tap();
  await page.waitForFunction(() => !document.getElementById('mobile-controls').hidden);
  check('resume requires a fresh touch', !Object.values((await state()).keys).some(Boolean));
  check('resume reacquires the screen wake lock', await page.evaluate(() => window.__wakeRequests > 1));

  await page.evaluate(() => { document.getElementById('canvas-holder').requestFullscreen = () => Promise.reject(new DOMException('blocked', 'NotAllowedError')); });
  await page.locator('[data-touch-menu="fullscreen"]').tap();
  check('fullscreen denial leaves the game playable', !(await state()).paused && await page.locator('#mobile-controls').isVisible());

  await page.locator('[data-touch-menu="pause"]').tap();
  await page.locator('#pause-settings').tap();
  await page.locator('#player-settings [data-tab="controls"]').tap(); // the touch switch lives on the Controls tab
  await page.locator('[name="touchControls"]').selectOption('off');
  check('touch controls can be disabled', !await page.locator('body').evaluate(el => el.classList.contains('touch-enabled')));
  await page.locator('[name="touchControls"]').selectOption('on');
  await page.locator('#player-settings .menu-close').tap();
  if (await page.locator('#pause-overlay.visible').count()) await page.locator('#pause-resume').tap();
  await page.waitForFunction(() => !document.getElementById('mobile-controls').hidden);

  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 768, height: 1024 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(200);
    const layout = await page.evaluate(() => {
      const visible = [...document.querySelectorAll('#mobile-controls button, #mobile-controls .touch-stick')].filter(el => el.checkVisibility());
      return {
        width: window.innerWidth, scroll: document.documentElement.scrollWidth,
        controls: visible.map(el => {
          const r = el.getBoundingClientRect();
          return { label: el.textContent.trim(), x: r.x, y: r.y, width: r.width, height: r.height };
        }),
        canvas: (() => { const r = document.querySelector('canvas[data-input-attached]').getBoundingClientRect(); return { width: r.width, height: r.height }; })(),
      };
    });
    check(`${viewport.width}x${viewport.height}: controls fit and retain 44px targets`, layout.scroll <= viewport.width && layout.controls.every(r => r.x >= 0 && r.y >= 0 && r.x + r.width <= viewport.width + 1 && r.y + r.height <= viewport.height + 1 && r.width >= 44 && r.height >= 44), JSON.stringify(layout));
    check(`${viewport.width}x${viewport.height}: canvas keeps its aspect ratio`, Math.abs(layout.canvas.width / layout.canvas.height - 16 / 9) < 0.01);
    const hint = await page.locator('#interaction-hint').boundingBox();
    check(`${viewport.width}x${viewport.height}: contextual hint stays compact`, !hint || hint.height < 150);
    await page.screenshot({ path: `${out}/play-${viewport.width}x${viewport.height}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-touch-menu="pause"]').tap();
  await page.locator('[data-pause-open="KeyB"]').tap();
  await page.waitForSelector('#wand-bench.visible');
  check('touch pause menu opens the wand bench', await page.locator('#mobile-controls').isHidden());
  await page.screenshot({ path: `${out}/portrait-wand-bench.png` });
  await page.locator('#wand-bench .menu-close').tap();
  await page.locator('[data-touch-menu="pause"]').tap();
  await page.locator('[data-pause-open="KeyM"]').tap();
  await page.waitForSelector('#minimap-overlay.visible');
  check('touch pause menu opens the map', await page.locator('#mobile-controls').isHidden());
  await page.locator('#minimap-overlay .menu-close').tap();
  check('mobile runtime has no JavaScript errors', errors.length === 0, errors.join('\n'));

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await desktop.goto(url, { waitUntil: 'networkidle' });
  await desktop.waitForFunction(() => window.__game?.ctx);
  check('desktop retains its default interface', !await desktop.locator('body').evaluate(el => el.classList.contains('touch-enabled')));
  await startConsoleTestRun(desktop, { level: 'd1', world: 'campaign-level' });
  await desktop.keyboard.down('d');
  check('keyboard movement still works', await desktop.evaluate(() => window.__game.ctx.input.keys.right));
  await desktop.keyboard.up('d');
  check('keyboard release still works', !await desktop.evaluate(() => window.__game.ctx.input.keys.right));

  const freshContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const fresh = await freshContext.newPage();
  await fresh.goto(process.argv[3] ?? url, { waitUntil: 'networkidle' });
  await fresh.locator('[data-entry="begin"]').tap();
  await fresh.waitForSelector('#story-cinema.show');
  await fresh.waitForTimeout(400); // The intentional opening skip guard.
  await fresh.locator('#story-cinema').tap();
  await fresh.locator('#mobile-controls').waitFor({ state: 'visible' });
  check('a fresh player can begin a descent using touch only', await fresh.locator('#mobile-controls').isVisible());
  await fresh.screenshot({ path: `${out}/fresh-mobile-start.png` });
} finally {
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(`${results.length} mobile checks passed.`);

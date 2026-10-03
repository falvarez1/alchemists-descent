import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5217/';
const out = 'docs/arena/platform-fighter/evidence';
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url + '?link=off', { waitUntil: 'networkidle' });
  await leaveTitleIfShown(page); await waitForConsoleApi(page);
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    await c.console.exec('run test --level fighter-duel --world campaign-level');
    c.fighters.equip('ilyra-voss'); await c.fighters.whenReady();
  });
  await page.getByRole('combobox', { name: 'Match rules', exact: true }).selectOption('stocks');
  await page.getByRole('button', { name: 'Add rival', exact: true }).click();
  await page.evaluate(async () => { await window.__game.ctx.console.exec('arena bot 1 off'); document.getElementById('fighter-arena').classList.add('collapsed'); });
  await page.waitForTimeout(4500);
  await page.locator('.stock-portrait').evaluateAll(images => Promise.all(images.map(i => i.decode())));
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
    await page.waitForTimeout(250);
    const bounds = await page.evaluate(() => {
      const pause = document.getElementById('expedition-pause').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.stock-fighter')].map(el => el.getBoundingClientRect());
      const stage = document.querySelector('#canvas-holder > canvas').getBoundingClientRect();
      return {
        inView: cards.every(r => r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight),
        belowStage: cards.every(r => r.top >= stage.bottom),
        pauseOverlaps: cards.some(r => pause.left < r.right && pause.right > r.left && pause.top < r.bottom && pause.bottom > r.top),
      };
    });
    assert.ok(bounds.inView, `${width}px: cards stay on screen`);
    if (width === 390) assert.ok(bounds.belowStage, 'Portrait HUD leaves the small game view unobstructed');
    assert.equal(bounds.pauseOverlaps, false, `${width}px: pause must not obscure stocks or fuel`);
    await page.mouse.move(width / 2, 300);
    await page.waitForTimeout(450);
    await page.locator('#sound-quick .sound-caret').focus();
    if (await page.locator('#sound-quick .sound-caret').getAttribute('aria-expanded') !== 'true') await page.keyboard.press('Enter');
    await page.locator('#sound-panel').waitFor({ state: 'visible' });
    await page.screenshot({ path: `${out}/stock-sound-${width}.png` });
    const sound = await page.locator('#sound-panel').boundingBox();
    assert.ok(sound && sound.x >= 0 && sound.y >= 0 && sound.x + sound.width <= width, `${width}px: sound settings open inside view`);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `${out}/stock-hud-${width}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(async () => {
    const c = window.__game.ctx; c.arena.reset();
    await c.console.exec('arena bot 0 basic 3'); await c.console.exec('arena bot 1 basic 3');
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.__perfSamples = []; window.__perfRecord = true; });
  await page.waitForFunction(() => window.__perfSamples.length >= 300, null, { timeout: 30000 });
  const perf = await page.evaluate(() => {
    window.__perfRecord = false;
    const samples = window.__perfSamples.slice(0, 300);
    const metrics = {};
    for (const key of ['sim', 'entities', 'render', 'compose', 'gl', 'frame', 'interval']) {
      const sorted = samples.map(s => s[key]).sort((a, b) => a - b);
      metrics[key] = { median: sorted[150], p95: sorted[285], max: sorted[299] };
    }
    return { frames: 300, metrics, gpuCompose: window.__game.ctx.state.postFx.gpuCompose };
  });
  writeFileSync(`${out}/stock-performance.json`, JSON.stringify(perf, null, 2));
  console.log('Local 300-frame bot sample:', JSON.stringify(perf));
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/stock-presentation.json`, JSON.stringify({ widths: [1280, 390], imagesLoaded: true, errors }, null, 2));
  console.log('Stock HUD: images, layout, pause, and sound controls passed at 1280px and 390px.');
} finally { await browser.close(); }

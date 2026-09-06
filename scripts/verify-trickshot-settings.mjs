import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser(), page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { errors: [], views: [] }; page.on('pageerror', e => report.errors.push(String(e)));
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/', { waitUntil: 'networkidle' });
  await page.locator('[data-entry="settings"]').click();
  await page.locator('[name="trickshotEnabled"]').check();
  await page.locator('[name="textScale"]').selectOption('1.3');
  for (const [name, width, height] of [['desktop', 1440, 900], ['compact', 720, 480], ['narrow', 540, 480]]) {
    await page.setViewportSize({ width, height });
    await page.locator('[name="assistDegrees"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/trickshot-larger-${name}.png` });
    const data = await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
      sizes: [...document.querySelectorAll('#trickshot-tuning label, #trickshot-tuning output')].map(e => parseFloat(getComputedStyle(e).fontSize)),
      lastControl: document.querySelector('[name="assistDegrees"]').getBoundingClientRect().toJSON(),
      panel: document.querySelector('#player-settings').getBoundingClientRect().toJSON() }));
    assert.equal(data.overflow, false); assert.equal(data.sizes.length, 8); assert.ok(data.sizes.every(size => size >= 16.8));
    assert.ok(data.lastControl.top >= data.panel.top && data.lastControl.bottom <= data.panel.bottom);
    report.views.push({ name, ...data });
  }
  assert.deepEqual(report.errors, []);
} finally { writeFileSync(`${output}/trickshot-settings.json`, JSON.stringify(report, null, 2)); await browser.close(); }

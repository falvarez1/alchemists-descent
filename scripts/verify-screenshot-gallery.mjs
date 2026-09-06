import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { launchBrowser } from './browser-launch.mjs';
import { refreshScreenshotGallery } from './screenshot-archive.mjs';

const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
refreshScreenshotGallery();
const browser = await launchBrowser(), report = { errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => report.errors.push(String(e)));
  const base = process.argv[2] ?? 'http://127.0.0.1:5182/';
  await page.goto(new URL('screenshots/index.html', base).href);
  await page.locator('#search').waitFor();
  await page.screenshot({ path: `${output}/gallery-index-latest.png` });
  await page.locator('[data-view="creatures"]').click();
  assert.equal(await page.locator('.capture').count(), 16);
  report.creatures = await page.locator('#library-data').evaluate(e => JSON.parse(e.textContent).creatures);
  assert.ok(report.creatures.every(c => c.frames > 20 && c.loop === 0 && c.poses.length >= 2));
  for (const creature of report.creatures) {
    const response = await page.request.head(new URL(`screenshots/living-descent/${creature.gif}`, base).href);
    assert.equal(response.status(), 200, `${creature.name} has a downloadable GIF`);
  }
  await page.screenshot({ path: `${output}/gallery-index-creatures.png` });
  await page.locator('#search').fill('weaver');
  assert.equal(await page.locator('.capture').count(), 1);
  await page.getByRole('button', { name: 'Play poses for Weaver', exact: true }).click();
  await page.locator('#media img').evaluate(img => img.decode());
  assert.match(await page.locator('#media img').getAttribute('src'), /weaver\.gif$/);
  await page.screenshot({ path: `${output}/gallery-index-player.png` });
  await page.keyboard.press('Escape');
  // Native dialog close events are queued after the key's default action.
  await page.locator('#media img').waitFor({ state: 'detached', timeout: 2000 });
  assert.equal(await page.locator('#media img').count(), 0, 'Closing releases the playing GIF');
  await page.locator('#search').fill('nothing-matches-this');
  assert.match(await page.locator('.empty').innerText(), /No matches/);
  await page.locator('#clear').click();
  await page.setViewportSize({ width: 720, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/gallery-index-compact.png` });
  await page.locator('[data-view="runs"]').click();
  await page.locator('#category').selectOption('failure');
  assert.ok(await page.locator('.run').count() > 0, 'Historical failures remain navigable');
  await page.locator('#clear').click();
  await page.locator('.run').first().locator('summary').first().click();
  await page.locator('.run[open] .thumbnail').first().click();
  const first = await page.locator('#media img').getAttribute('src');
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await page.locator('#media img').getAttribute('src'), first, 'Arrow navigation advances even when historical filenames repeat');
  await page.keyboard.press('Escape');
  await page.locator('[data-view="clips"]').click();
  report.clips = await page.locator('#library-data').evaluate(e => JSON.parse(e.textContent).clips);
  assert.ok(report.clips.length > 0);
  await page.locator('.thumbnail').first().click();
  await page.locator('video').evaluate(video => new Promise((resolve, reject) => {
    if (video.readyState >= 1) return resolve();
    video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Clip did not load'));
  }));
  assert.ok(await page.locator('video').evaluate(video => video.duration > 3 && video.videoWidth > 0));
  await page.keyboard.press('Escape');
  await page.goto(pathToFileURL(resolve('screenshots/living-descent/index.html')).href + '#view=creatures');
  assert.equal(await page.locator('.capture').count(), 16, 'Library works offline without fetch');
  report.offline = true;
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${output}/screenshot-gallery.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

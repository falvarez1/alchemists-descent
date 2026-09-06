import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser-launch.mjs';

const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], report = { errors };
page.on('pageerror', e => errors.push(String(e)));
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5183/', { waitUntil: 'networkidle' });
  await page.locator('#expedition-entry:not([hidden])').waitFor();
  await page.screenshot({ path: `${output}/production-entry.png` });
  await page.locator('[data-entry="begin"]').click();
  await page.locator('#expedition-entry').waitFor({ state: 'hidden' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${output}/production-intake.png` });
  await page.keyboard.down('KeyD'); await page.waitForTimeout(400);
  await page.keyboard.press('Space', { delay: 180 }); await page.waitForTimeout(900); await page.keyboard.up('KeyD');
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => document.querySelector('#field-note')?.textContent.includes('2 left'));
  assert.match(await page.locator('#field-note').innerText(), /2 left/);
  await page.locator('#expedition-pause').click();
  await page.screenshot({ path: `${output}/production-pause.png` });
  await page.locator('#pause-settings').click();
  await page.locator('[name="textScale"]').selectOption('1.3');
  assert.equal(await page.locator('[name="trickshotEnabled"]').isChecked(), false);
  await page.locator('[name="trickshotEnabled"]').check();
  await page.locator('[name="timeScale"]').focus(); await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: `${output}/production-settings.png` });
  await page.setViewportSize({ width: 720, height: 480 });
  await page.screenshot({ path: `${output}/production-settings-compact.png` });
  await page.locator('#player-settings button[value="close"]').click(); await page.keyboard.press('Escape');
  await page.screenshot({ path: `${output}/production-compact.png` });
  report.coldNetwork = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(r => ({ name: new URL(r.name).pathname, bytes: r.transferSize, decodedBytes: r.decodedBodySize })));
  // This shipping build intentionally exposes no debug game handle. Exercise
  // its real autosave and Continue UI, with read-only IndexedDB verification.
  await page.waitForTimeout(31000);
  report.saved = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('alchemists-descent-expeditions', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const save = await new Promise((resolve, reject) => { const r = db.transaction('checkpoints').objectStore('checkpoints').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close(); return { revision: save.revision, player: save.data.player, living: save.data.levels.find(l => l.id === 'd1').living };
  });
  assert.ok(report.saved.revision >= 2); assert.equal(report.saved.living.glowseeds, 2);
  assert.ok(report.saved.player.x > 210);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-entry="continue"]').click();
  await page.locator('#expedition-entry').waitFor({ state: 'hidden' });
  await page.waitForTimeout(4500);
  assert.match(await page.locator('#field-note').innerText(), /2 left/);
  report.resumed = true;
  await page.locator('#expedition-pause').click(); await page.locator('#pause-settings').click();
  assert.equal(await page.locator('[name="trickshotEnabled"]').isChecked(), true);
  assert.equal(await page.locator('[name="timeScale"]').inputValue(), '0.4');
  report.trickshotPreferencesResumed = true;
  await page.locator('[name="trickshotEnabled"]').uncheck();
  await page.locator('#player-settings button[value="close"]').click(); await page.keyboard.press('Escape');
  report.network = await page.evaluate(() => ({ debugHandle: Boolean(window.__game),
    resources: performance.getEntriesByType('resource').map(r => ({ name: new URL(r.name).pathname, bytes: r.transferSize })) }));
  assert.equal(report.network.debugHandle, false);
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(`${output}/production-flow.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

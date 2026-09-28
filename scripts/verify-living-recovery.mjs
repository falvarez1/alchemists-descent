import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';
const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage();
const errors = [], report = { errors };
page.on('pageerror', e => errors.push(String(e)));
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/', { waitUntil: 'networkidle' });
  await waitForConsoleApi(page); await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run new --seed 777'); await waitForRunReady(page); await page.waitForTimeout(4500);
  await page.keyboard.press('KeyV'); await page.waitForTimeout(250);
  for (let i = 0; i < 2; i++) { await execConsoleCommand(page, 'run save'); await page.evaluate(() => window.__game.ctx.levels.flushSaves()); }
  const appUrl = page.url();
  await page.route('**/__checkpoint_fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Checkpoint fault fixture</title>' }));
  // Let the page-exit checkpoint finish before injecting damage. Otherwise
  // its legitimate final save can replace the test corruption during reload.
  await page.goto(new URL('/__checkpoint_fixture', appUrl).href);
  await page.waitForTimeout(300);
  // Fault injection affects only this disposable browser context's database.
  report.previous = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('alchemists-descent-expeditions', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const previous = await new Promise((resolve, reject) => {
      const tx = db.transaction('checkpoints', 'readwrite'), store = tx.objectStore('checkpoints'); let previous;
      const head = store.get('current'); head.onsuccess = () => { const value = head.result; value.checksum ^= 1; store.put(value, 'current'); };
      const backup = store.get('previous'); backup.onsuccess = () => { previous = backup.result; };
      tx.oncomplete = () => resolve(previous); tx.onabort = () => reject(tx.error);
    });
    db.close(); const level = previous.data.levels.find(l => l.id === 'd1');
    return { revision: previous.revision, fauna: level.fauna.map(c => c.id).sort(), ticks: level.living.ticks, glowseeds: level.living.glowseeds };
  });
  await page.goto(appUrl, { waitUntil: 'networkidle' }); await waitForConsoleApi(page);
  await page.evaluate(() => window.__game.ctx.levels.ready);
  report.recoveryStatus = await page.evaluate(() => window.__game.ctx.levels.persistenceStatus());
  assert.equal(report.recoveryStatus.recovered, true);
  assert.ok(report.recoveryStatus.revision >= report.previous.revision);
  await execConsoleCommand(page, 'run continue'); await waitForRunReady(page);
  report.resumed = await page.evaluate(() => ({ fauna: window.__game.ctx.critters.list.map(c => c.id).sort(), living: window.__game.ctx.levels.current.living }));
  assert.deepEqual(report.resumed.fauna, report.previous.fauna);
  assert.equal(report.resumed.living.glowseeds, report.previous.glowseeds);
  assert.ok(report.resumed.living.ticks >= report.previous.ticks);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${output}/checkpoint-recovered.png` });
} finally { writeFileSync(`${output}/checkpoint-recovery.json`, JSON.stringify(report, null, 2)); await browser.close(); }

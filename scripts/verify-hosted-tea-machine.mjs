import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';

// Production proof: only public UI and real keyboard input, no debug handle.
const output = 'verify-out/hosted-tea-machine'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { url: process.argv[2] ?? 'https://alchemists-descent.pages.dev', errors: [] };
page.on('pageerror', error => report.errors.push(String(error)));
try {
  await page.goto(report.url, { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => !!window.__game), false);
  await page.locator('[data-entry="begin"]').click();
  await page.locator('#expedition-entry').waitFor({ state: 'hidden' });
  await page.keyboard.down('KeyD');
  await page.locator('#tea-view:not([hidden])').waitFor({ timeout: 12000 });
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('KeyE'); await page.waitForTimeout(80);
    if (await page.locator('#tea-view.watching').count()) break;
  }
  await page.keyboard.up('KeyD');
  await page.locator('#tea-view.watching').waitFor();
  await page.screenshot({ path: `${output}/ignition.png` });
  await page.waitForFunction(() => document.querySelector('#tea-view strong')?.textContent.includes('Tea is served'), null, { timeout: 100000 });
  await page.screenshot({ path: `${output}/complete.png` });
  await page.locator('#tea-view.watching').waitFor({ state: 'hidden', timeout: 10000 });
  assert.match(await page.locator('#objective').innerText(), /Collect the brass bell/);
  assert.deepEqual(report.errors, []);
  report.completed = true;
  console.log('PASS: public build completed the engine through real controls and returned to the bell objective.');
} finally {
  await page.screenshot({ path: `${output}/last.png` }).catch(() => {});
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

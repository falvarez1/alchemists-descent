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
  await page.locator('[data-entry="descend"]').click();
  await page.locator('#expedition-entry').waitFor({ state: 'hidden' });
  // The Intake's oil-soaked barricade stands between the spawn and the crank.
  // Walk up to it, then Spark Bolt it just ahead of the alchemist (the camera
  // follows him, so "just right of centre" is the timber) until it collapses
  // and the engine's crank card appears.
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(2600);
  await page.keyboard.up('KeyD');
  const canvas = await page.locator('#canvas-holder > canvas').boundingBox();
  for (let i = 0; i < 6; i++) {
    await page.mouse.click(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.47);
    await page.waitForTimeout(1500);
    await page.keyboard.down('KeyD'); await page.waitForTimeout(700); await page.keyboard.up('KeyD');
    if (await page.locator('#tea-view:not([hidden])').count()) break;
  }
  await page.keyboard.down('KeyD');
  await page.locator('#tea-view:not([hidden])').waitFor({ timeout: 12000 });
  const running = () => page.evaluate(() => /First, a little powder|coupling/.test(document.querySelector('#tea-view strong')?.textContent ?? ''));
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('KeyE'); await page.waitForTimeout(80);
    if (await running()) break;
  }
  await page.keyboard.up('KeyD');
  assert.ok(await running(), 'the crank started the engine');
  await page.screenshot({ path: `${output}/ignition.png` });
  // Left alone, the engine's three slow backups finish it (~47 s).
  await page.waitForFunction(() => document.querySelector('#tea-view strong')?.textContent.includes('Tea is served'), null, { timeout: 100000 });
  await page.screenshot({ path: `${output}/complete.png` });
  assert.match(await page.locator('#objective').innerText(), /Collect the brass bell/);
  assert.deepEqual(report.errors, []);
  report.completed = true;
  console.log('PASS: public build completed the engine through real controls and set the bell objective.');
} finally {
  await page.screenshot({ path: `${output}/last.png` }).catch(() => {});
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

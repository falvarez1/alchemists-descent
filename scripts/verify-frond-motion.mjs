import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';
import { archiveGameplayClip, startGameplayCapture, finishGameplayCapture } from './clip-archive.mjs';

const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser(), report = { errors: [], setup: 'Canonical disposable D1 seed 777; console setup near the intake fern, followed by actual left/right movement.' };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); page.on('pageerror', e => report.errors.push(String(e)));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh'); await waitForRunReady(page);
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  await execConsoleCommand(page, 'tp 210 314'); await page.waitForTimeout(1500); await startGameplayCapture(page);
  await page.evaluate(async () => {
    const { habitatBend } = await import('/src/game/HabitatMotion.ts'); window.__fernValues = [];
    window.__fernTimer = setInterval(() => {
      const ctx = window.__game.ctx; window.__fernValues.push({ x: ctx.player.x, angle: habitatBend(ctx.world, 2) });
    }, 16);
  });
  for (const [key, name] of [['KeyD', 'right'], ['KeyA', 'left']]) {
    await page.keyboard.down(key); await page.waitForTimeout(300); await page.keyboard.up(key); await page.waitForTimeout(600);
    await page.screenshot({ path: `${output}/fern-brush-${name}.png` });
  }
  await page.keyboard.down('KeyA'); await page.waitForTimeout(450); await page.keyboard.up('KeyA'); await page.waitForTimeout(2200);
  report.samples = await page.evaluate(() => { clearInterval(window.__fernTimer); return window.__fernValues; });
  report.maxAngleStep = Math.max(...report.samples.slice(1).map((s, i) => Math.abs(s.angle - report.samples[i].angle)));
  assert.ok(report.maxAngleStep < .09, 'Passing through the root does not snap the crown');
  await finishGameplayCapture(page, `${output}/frond-motion.webm`);
  archiveGameplayClip('frond-motion', 'Fronds · brush past and recover', `${output}/frond-motion.webm`, `${output}/fern-brush-left.png`, report.setup);
  assert.deepEqual(report.errors, []);
} finally { writeFileSync(`${output}/frond-motion.json`, JSON.stringify(report, null, 2)); await browser.close(); }

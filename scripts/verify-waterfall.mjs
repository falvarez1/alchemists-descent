import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';
import { archiveGameplayClip, startGameplayCapture, finishGameplayCapture } from './clip-archive.mjs';

const output = 'verify-out/living-descent', label = process.argv[3] ?? 'after';
assert.match(label, /^[a-z0-9-]+$/); mkdirSync(output, { recursive: true });
const report = { label, errors: [], samples: [], setup: 'Canonical D1 seed 777, actual E opens the sluice. Console positioning/god mode keeps the observation fixed; no water or terrain is injected. Capture follows the native gallery spill into the pipe chamber.' };
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh'); await waitForRunReady(page);
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  await execConsoleCommand(page, 'god on'); await execConsoleCommand(page, 'tp 524 374'); await page.waitForTimeout(1600);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__game.ctx.levels.current.mechanisms.some(m => m.kind === 'valve' && m.state === 1));
  await execConsoleCommand(page, 'tp 1330 447'); await page.mouse.move(720, 700);
  await page.waitForTimeout(6000);
  await startGameplayCapture(page);
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(3000);
    report.samples.push(await page.evaluate(async () => {
      const { Cell } = await import('/src/sim/CellType.ts'), ctx = window.__game.ctx, w = ctx.world;
      let fallingWater = 0, lowWater = 0;
      for (let y = 451; y < 645; y++) for (let x = 1360; x < 1525; x++) if (w.type(x, y) === Cell.Water) { fallingWater++; if (y > 510) lowWater++; }
      return { tick: ctx.state.frameCount, fallingWater, lowWater, flights: w.flow.falling?.size ?? 0, camera: { x: ctx.camera.renderX, y: ctx.camera.renderY } };
    }));
    if (i === 0 || i === 3 || i === 5) await page.screenshot({ path: `${output}/waterfall-${label}-${i}.png` });
  }
  await finishGameplayCapture(page, `${output}/waterfall-${label}.webm`);
  archiveGameplayClip(`waterfall-${label}`, `Gallery spill · ${label}`, `${output}/waterfall-${label}.webm`, `${output}/waterfall-${label}-3.png`, report.setup);
  await page.setViewportSize({ width: 720, height: 480 }); await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/waterfall-${label}-compact.png` });
  assert.ok(report.samples.some(s => s.lowWater > 0), 'Native sluice water reaches the lower pipe chamber');
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${output}/waterfall-${label}.json`, JSON.stringify(report, null, 2)); await browser.close();
}

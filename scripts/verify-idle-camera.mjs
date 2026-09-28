import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';

const label = process.argv[3] ?? 'after', output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser(), report = { errors: [], label, scenes: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => report.errors.push(String(e)));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh'); await waitForRunReady(page);
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  for (const [name, x, y] of [['intake-stone', 185, 310], ['page-timber', 265, 258]]) {
    await execConsoleCommand(page, `tp ${x} ${y}`);
    await page.mouse.move(12, 710); await page.waitForTimeout(4000);
    const offer = page.locator('#card-offer-overlay.visible .card-offer-card').first();
    if (await offer.isVisible()) await offer.click();
    // Tome offers pause the simulation. Let the post-modal camera ease finish
    // before measuring rest; a monotonic arrival is not idle oscillation.
    await page.waitForTimeout(3000);
    const scene = await page.evaluate(async name => {
      const game = window.__game, ctx = game.ctx, samples = [];
      const end = performance.now() + 4000;
      while (performance.now() < end) {
        await new Promise(requestAnimationFrame);
        const c = ctx.camera, p = ctx.player, quad = game.renderer.backend.quadMesh;
        samples.push({ x: p.x, y: p.y, vy: p.vy, grounded: p.grounded, cameraY: c.y, targetY: c.ty,
          renderY: c.renderY, presentationY: c.presentationY, quadY: quad?.position.y, shake: ctx.fx.screenShake });
      }
      const range = key => Math.max(...samples.map(s => s[key])) - Math.min(...samples.map(s => s[key]));
      return { name, samples, playerDrift: range('y'), velocityRange: range('vy'), cameraDrift: range('cameraY'), targetDrift: range('targetY'), textureRows: [...new Set(samples.map(s => s.renderY))] };
    }, name);
    report.scenes.push(scene);
    await page.screenshot({ path: `${output}/idle-camera-${label}-${name}.png` });
    assert.equal(scene.playerDrift, 0, 'Fixture stands still on solid support');
    if (label !== 'before') {
      assert.ok(scene.cameraDrift < .001, `${name}: resting camera is stable`);
      assert.equal(scene.textureRows.length, 1, 'Stationary world keeps the same texture origin');
    }
  }
  assert.deepEqual(report.errors, []);
} finally { writeFileSync(`${output}/idle-camera-${label}.json`, JSON.stringify(report, null, 2)); await browser.close(); }

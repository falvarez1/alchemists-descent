// Verifies the D1 Undertow mood beat: failed lamps and resident cave roaches
// that flee the alchemist's forward wand-light cone.
// Usage: node scripts/verify-undertow-life.mjs [url]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';

const output = 'verify-out/living-descent';
mkdirSync(output, { recursive: true });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { errors: [] };
page.on('pageerror', error => report.errors.push(String(error)));

const beetles = () => page.evaluate(() => window.__game.ctx.critters.list
  .filter(critter => critter.kind === 'beetle')
  .map(critter => ({ id: critter.id, x: critter.x, y: critter.y, vx: critter.vx, vy: critter.vy,
    startle: critter.startle ?? 0 })));

try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/', { waitUntil: 'networkidle' });
  await waitForConsoleApi(page);
  await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page);
  report.fixtures = await page.evaluate(() => {
    const ctx = window.__game.ctx, lights = ctx.levels.current.authoredLights ?? [];
    return {
      failedLights: lights.filter(light => (light.flicker ?? 0) >= .7)
        .map(light => ({ x: light.x, y: light.y, radius: light.radius, flicker: light.flicker })),
      beetles: ctx.critters.list.filter(critter => critter.kind === 'beetle').length,
      flies: ctx.critters.list.filter(critter => critter.kind === 'fly').length,
    };
  });
  assert.equal(report.fixtures.failedLights.length, 3);
  assert.equal(report.fixtures.beetles, 9);
  assert.ok(report.fixtures.flies >= 3);

  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.camera.zoomLock = 1.45;
    ctx.camera.setInspectionFocus(650, 970, { snap: true });
  });
  await page.waitForTimeout(300);
  report.before = await beetles();
  await page.screenshot({ path: `${output}/undertow-before-light.png` });

  await execConsoleCommand(page, 'tp 510 1008');
  await execConsoleCommand(page, 'god off');
  await page.mouse.move(1180, 450);
  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.player.aimAngle = 0;
    ctx.camera.zoomLock = 1.45;
    ctx.camera.setInspectionFocus(650, 970, { snap: true });
  });
  let maxStartled = 0;
  for (let sample = 0; sample < 10; sample++) {
    await page.waitForTimeout(80);
    const current = await beetles();
    maxStartled = Math.max(maxStartled, current.filter(critter => critter.startle > 0).length);
    if (maxStartled >= 2) break;
  }
  report.after = await beetles();
  report.maxStartled = maxStartled;
  assert.ok(maxStartled >= 2, `Expected a colony response, saw ${maxStartled}`);
  const beforeById = new Map(report.before.map(critter => [critter.id, critter]));
  assert.ok(report.after.some(critter => {
    const before = beforeById.get(critter.id);
    return before && critter.x > 510 && Math.abs(critter.x - before.x) > 2;
  }), 'Expected at least one lit beetle to scramble more than two cells');
  await page.screenshot({ path: `${output}/undertow-wand-scatter.png` });
  assert.deepEqual(report.errors, []);
  report.completed = true;
  console.log(JSON.stringify({ failedLights: report.fixtures.failedLights.length,
    beetles: report.fixtures.beetles, startled: maxStartled }));
} finally {
  writeFileSync(`${output}/undertow-life.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

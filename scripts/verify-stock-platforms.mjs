import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';
const browser = await launchBrowser(), errors = [];
const out = 'docs/arena/platform-fighter/evidence';
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    window.testPads = [];
    Object.defineProperty(navigator, 'getGamepads', { value: () => window.testPads });
  });
  await page.goto((process.argv[2] ?? 'http://127.0.0.1:5217/') + '?link=off', { waitUntil: 'networkidle' });
  await leaveTitleIfShown(page); await waitForConsoleApi(page);
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    await c.console.exec('run test --level fighter-duel --world campaign-level');
    c.fighters.equip('ilyra-voss'); await c.fighters.whenReady();
  });
  await page.getByRole('combobox', { name: 'Match rules', exact: true }).selectOption('stocks');
  await page.getByRole('button', { name: 'Add rival', exact: true }).click();
  await page.waitForFunction(() => window.__game.ctx.arena.stockMatch?.state === 'fighting');
  // The controller recommendation lives in the Duel lobby (ui/VersusLobby): nothing pops over a match.
  assert.equal(await page.locator('.controller-notice').isVisible(), false, 'no controller notice covers the match');
  assert.equal(await page.locator('.gpu-notice').count(), 0);
  await page.evaluate(() => {
    window.testPads = [{ connected: true, mapping: 'standard', index: 0, axes: [0,0,0,0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })) }];
    window.dispatchEvent(new Event('gamepadconnected'));
  });
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
    c.state.paused = true; document.activeElement?.blur();
  });
  const results = await page.evaluate(async () => {
    const { STOCK_STAGE } = await import('/src/config/stockStage.ts');
    const g = window.__game, c = g.ctx, rows = [];
    const step = () => g.tick(false, { forcePaused: true });
    for (const slot of [0, 1]) {
      c.arena.reset(); for (let i = 0; i < 125; i++) step();
      const b = c.arena.bundle(slot), p = b.player, platform = STOCK_STAGE.platforms[slot];
      // Bodies live on whole cells: the centre of an even-width platform is a half cell.
      Object.assign(p, { x: Math.round((platform.x0 + platform.x1) / 2), y: STOCK_STAGE.main.y - 1, vy: 0, vx: 0, fx: 0, fy: 0, grounded: true });
      b.input.keys.jump = true;
      const trace = [];
      for (let i = 0; i < 150; i++) {
        if (p.y < platform.y - 18 || i >= 95) b.input.keys.jump = false;
        step(); trace.push({ y: p.y, vy: p.vy, grounded: p.grounded });
      }
      rows.push({ slot, top: platform.y, trace, material: c.world.type(p.x, platform.y), stocks: c.arena.stockMatch.fighters[slot].stocks });
    }
    return rows;
  });
  console.log(JSON.stringify(results.map(row => ({ slot: row.slot, minY: Math.min(...row.trace.map(p => p.y)), landing: row.trace.find(p => p.y === row.top - 1 && p.grounded) })), null, 2));
  for (const row of results) {
    assert.ok(row.trace.some(p => p.y < row.top - 1), `slot ${row.slot} must rise through the platform`);
    assert.ok(row.trace.some(p => p.y === row.top - 1 && p.grounded), `slot ${row.slot} must land on the platform`);
    assert.equal(row.material, 13); assert.equal(row.stocks, 3);
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/stock-platforms.json`, JSON.stringify({ results, controllerNotice: 'none over the match (it lives in the Duel lobby); GPU tip absent', errors }, null, 2));
  console.log('Both fighters rise through and land on platforms; material preserved; no notice covers the match.');
} finally { await browser.close(); }

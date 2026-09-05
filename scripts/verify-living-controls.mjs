import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';
const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser({ headless: true }); const page = await browser.newPage();
const errors = [], report = { errors }; page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => {
  window.__controlFixture = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })) };
  Object.defineProperty(navigator, 'getGamepads', { value: () => window.__controlFixture.connected ? [window.__controlFixture] : [] });
});
const press = async index => {
  await page.evaluate(index => { window.__controlFixture.buttons[index].pressed = true; }, index);
  await page.waitForTimeout(80);
  await page.evaluate(index => { window.__controlFixture.buttons[index].pressed = false; }, index);
  await page.waitForTimeout(50);
};
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/', { waitUntil: 'networkidle' });
  await waitForConsoleApi(page); await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run new --seed 777'); await waitForRunReady(page); await page.waitForTimeout(4500);
  const startX = await page.evaluate(() => window.__game.ctx.player.x);
  await page.evaluate(() => { window.__controlFixture.axes[0] = 1; }); await page.waitForTimeout(300);
  await page.evaluate(() => { window.__controlFixture.axes[0] = 0; });
  report.controllerMoved = await page.evaluate(() => window.__game.ctx.player.x);
  report.movementState = await page.evaluate(() => { const c = window.__game.ctx, p = c.player;
    return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: p.grounded, paused: c.state.paused, tick: c.state.frameCount,
      keys: c.input.keys, front: Array.from({length: 18}, (_,i) => c.world.type(Math.floor(p.x + 7), Math.floor(p.y - i))),
      crates: c.rigidBodies?.bodies?.map(b => ({x:b.x,y:b.y})) };
  });
  assert.ok(report.controllerMoved > startX + 15);
  await press(9); assert.equal(await page.evaluate(() => window.__game.ctx.state.paused), true);
  const pausedTick = await page.evaluate(() => window.__game.ctx.state.frameCount);
  await page.waitForTimeout(400); assert.equal(await page.evaluate(() => window.__game.ctx.state.frameCount), pausedTick);
  await press(9); assert.equal(await page.evaluate(() => window.__game.ctx.state.paused), false);
  await page.evaluate(() => { window.__controlFixture.buttons[6].pressed = true; window.__controlFixture.buttons[2].pressed = true; });
  await page.waitForTimeout(60);
  await page.evaluate(() => { window.__controlFixture.connected = false; }); await page.waitForTimeout(60);
  report.disconnect = await page.evaluate(() => ({ pour: window.__game.ctx.input.pourHeld, siphon: window.__game.ctx.input.siphonHeld, firing: window.__game.ctx.player.firing }));
  assert.deepEqual(report.disconnect, { pour: false, siphon: false, firing: false });
  await page.locator('#expedition-pause').click(); await page.locator('#pause-settings').click();
  await page.locator('button[aria-label^="Change left:"]').click(); await page.keyboard.press('KeyZ');
  await page.locator('#player-settings button[value="close"]').click(); await page.keyboard.press('Escape');
  const beforeRemap = await page.evaluate(() => window.__game.ctx.player.x);
  await page.keyboard.down('KeyZ'); await page.waitForTimeout(300);
  report.remapState = await page.evaluate(() => ({ paused: window.__game.ctx.state.paused, keys: window.__game.ctx.input.keys,
    bindings: localStorage.getItem('ad-controls-v1'), pull: window.__game.ctx.player.pullT,
    dialogs: [...document.querySelectorAll('.visible, dialog[open]')].map(e => e.id) }));
  await page.keyboard.up('KeyZ');
  report.remapMoved = await page.evaluate(() => window.__game.ctx.player.x);
  assert.ok(report.remapMoved < beforeRemap - 10);
  const beforeJump = await page.evaluate(() => window.__game.ctx.player.y);
  await page.keyboard.press('Space'); await page.waitForTimeout(45);
  report.shortTapJump = await page.evaluate(() => window.__game.ctx.player.y);
  assert.ok(report.shortTapJump < beforeJump);
  assert.deepEqual(errors, []);
} finally { writeFileSync(`${output}/controls.json`, JSON.stringify(report, null, 2)); await browser.close(); }

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { chooseBoonAndDoor, execConsoleCommand, waitForRunReady } from './run-helpers.mjs';

const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { errors: [], setup: 'Canonical disposable D1 run. Console positioning isolates real bell pickup, portal trigger, boon choice and descent; this does not establish unaided traversal.' };
page.on('pageerror', error => report.errors.push(String(error)));
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/', { waitUntil: 'networkidle' });
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page); await page.waitForTimeout(4500);
  // The bell is uncollectible until the Tea Engine has run (game/Pickups). This probe isolates
  // the pickup, the gate, the boon and the descent, so the engine is marked done; the engine
  // itself is played, with real input, by verify-tea-machine.mjs.
  // (16 = TEA_STAGE.DONE: the engine's completion is only honoured at that stage.)
  await page.evaluate(() => { const tea = window.__game.ctx.levels.current.living.tea; tea.stage = 16; tea.completed = true; });
  const bell = await page.evaluate(() => {
    const p = window.__game.ctx.levels.current.pickups.find(pickup => pickup.kind === 'key');
    return { x: p.x, y: p.y };
  });
  await execConsoleCommand(page, `tp ${bell.x} ${bell.y}`); await execConsoleCommand(page, 'god off');
  // `tp` stands the alchemist 8 cells above the point, on the ledge over the receiver, while the bell
  // rests in the receiver's cup below (17 cells away, outside the 9-cell pickup radius). Bring the bell
  // to him instead; the real pickup rule (radius, clear line, engine done) still decides.
  await page.evaluate(() => { const c = window.__game.ctx, k = c.levels.current.pickups.find(p => p.kind === 'key'); k.x = c.player.x; k.y = c.player.y - 8; });
  await page.waitForFunction(() => window.__game.ctx.levels.current.keyTaken);
  report.bellTaken = true;
  await execConsoleCommand(page, 'tp 1400 1008'); await execConsoleCommand(page, 'god off');
  await page.locator('#perk-row .perk-card').first().waitFor({ state: 'visible' });
  report.portalOpen = await page.evaluate(() => window.__game.ctx.levels.current.portal.open);
  await chooseBoonAndDoor(page, 'd2'); // below floor 1 the stair forks: a boon AND a door
  await page.locator('#descend-btn').click();
  await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'd2' && !window.__game.ctx.levels.transitioning);
  report.arrival = await page.evaluate(() => ({ level: window.__game.ctx.levels.current.def.id,
    alive: !window.__game.ctx.player.dead, paused: window.__game.ctx.state.paused,
    enemies: window.__game.ctx.enemies.length, fauna: window.__game.ctx.critters.list.length }));
  assert.equal(report.portalOpen, true); assert.equal(report.arrival.level, 'd2');
  assert.equal(report.arrival.alive, true); assert.equal(report.arrival.paused, false);
  assert.ok(report.arrival.enemies > 0); assert.ok(report.arrival.fauna > 0);
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${output}/progression.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

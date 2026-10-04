import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { cycleTo } from './versus-helpers.mjs';
const browser = await launchBrowser(), out = 'verify-out/stock-learning';
mkdirSync(out, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto((process.argv[2] ?? 'http://127.0.0.1:5221/') + '?link=off', { waitUntil: 'networkidle' });
  await page.locator('[data-entry="duel"]').click();
  const difficulty = page.getByRole('group', { name: 'Player 2 CPU difficulty', exact: true });
  await cycleTo(page, 'Player 2 CPU difficulty', '5');
  assert.equal(await page.getByRole('group', { name: 'Player 1 CPU difficulty', exact: true }).count(), 0);
  await page.screenshot({ path: `${out}/difficulty-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await difficulty.isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${out}/difficulty-mobile.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Ready player 1', exact: true }).click();
  await page.locator('#versus-start').click();
  await page.waitForFunction(() => window.__game.ctx.arena.stockMatch?.state === 'fighting');
  const result = await page.evaluate(async () => {
    const g = window.__game, c = g.ctx, a = c.arena;
    c.state.paused = true;
    const getBot = async () => (await c.console.exec('arena status')).data.bots[1];
    const initial = structuredClone(await getBot()), hits = [];
    const off = c.events.on('fighterHit', hit => { if (hit.by === 1 && hit.victim === 0) hits.push({ ...hit }); });
    const positions = () => {
      for (const slot of [0, 1]) {
        const b = a.bundle(slot);
        Object.assign(b.player, { x: slot ? 800 : 818, y: 639, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, stunT: 0, invuln: 0 });
        b.input.mouse.x = slot ? 818 : 800; b.input.mouse.y = 630;
      }
    };
    c.state.arrivalGraceUntil = 0;
    // Repeated close engagements use the same brain, normal hit detection and attack timing.
    for (let round = 0; round < 12; round++) {
      positions();
      for (let tick = 0; tick < 65; tick++) g.tick(false, { forcePaused: true });
    }
    off();
    const learned = structuredClone(await getBot());
    // A stock loss must retain match experience; a new match must clear it.
    a.bundle(1).player.x = 1500; a.bundle(1).player.y = 950;
    a.bundle(0).player.invuln = 999;
    for (let tick = 0; tick < 120; tick++) g.tick(false, { forcePaused: true });
    const respawned = structuredClone(await getBot());
    c.versus.rematch();
    const reset = structuredClone(await getBot());
    return { initial, learned, respawned, reset, hits };
  });
  writeFileSync(`${out}/results.json`, JSON.stringify({ result, errors }, null, 2));
  console.log(JSON.stringify({ initialLevel: result.initial.level, hits: result.hits.length, learned: result.learned.stats,
    retained: result.respawned.stats.learnedHits, reset: result.reset.stats.learnedHits }));
  assert.deepEqual(errors, []);
  assert.equal(result.initial.level, 5, 'lobby difficulty configures the actual CPU');
  assert.ok(result.hits.some(hit => hit.attack.startsWith('melee.')), 'real attacks connect');
  assert.ok(result.learned.stats.learnedHits > 0, 'confirmed hits update match experience');
  assert.ok(result.respawned.stats.learnedHits >= result.learned.stats.learnedHits, 'experience survives losing a stock');
  assert.equal(result.reset.stats.learnedHits, 0, 'rematch starts fresh');
  assert.equal(result.reset.level, 5, 'rematch retains difficulty');
} finally { await browser.close(); }

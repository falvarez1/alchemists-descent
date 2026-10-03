import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5217/';
const browser = await launchBrowser();
const errors = [], results = [];
mkdirSync('verify-out/stock-stationary', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(url + '?link=off', { waitUntil: 'networkidle' });
  await waitForConsoleApi(page);
  await page.locator('[data-entry="duel"]').click();
  await page.getByRole('button', { name: 'Ready player 1', exact: true }).click();
  await page.locator('#versus-start').click();
  await page.waitForFunction(() => window.__game.ctx.arena.stockMatch?.state === 'fighting');
  await page.evaluate(() => { window.__game.ctx.state.paused = true; });
  const cases = [11, 29, 43].flatMap(seed => [1, 3, 5].flatMap(level => [false, true].map(mirror => ({ seed, level, mirror }))));
  for (const scenario of cases) {
    const { seed, level, mirror } = scenario;
    const result = await page.evaluate(async ({ seed, level, mirror }) => {
      const g = window.__game, c = g.ctx, a = c.arena;
      await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
      c.state.worldSeed = seed; a.reset();
      for (let i = 0; i < 125; i++) g.tick(false, { forcePaused: true });
      for (const slot of [0, 1]) {
        const b = a.bundle(slot), x = (slot === 0) !== mirror ? 600 : 1000;
        Object.assign(b.player, { x, y: 559, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, invuln: 0, stunT: 0 });
        for (const key of Object.keys(b.input.keys)) b.input.keys[key] = false;
        b.input.mouse.down = false;
        c.state.arrivalGraceUntil = 0;
      }
      await c.console.exec(`arena bot 1 basic ${level}`);
      const hits = [], trace = [];
      let elapsed = 0, closest = Infinity, crossedGap = false;
      const off = c.events.on('fighterHit', hit => { if (hit.by === 1 && hit.victim === 0 && hit.attack.startsWith('melee.')) hits.push({ ...hit, elapsed }); });
      for (; elapsed < 1200 && hits.length === 0 && a.bout.downs.length === 0; elapsed++) {
        g.tick(false, { forcePaused: true });
        const p = a.bundle(1).player, rival = a.bundle(0).player;
        closest = Math.min(closest, Math.hypot(p.x - rival.x, p.y - rival.y));
        if (mirror ? p.x > 800 : p.x < 800) crossedGap = true;
        if (elapsed % 30 === 0) {
          const status = await c.console.exec('arena status');
          trace.push({ tick: elapsed, x: p.x, y: p.y, grounded: p.grounded, keys: { ...a.bundle(1).input.keys }, bot: status.data.bots[1] });
        }
      }
      off();
      return { seed, level, mirror, elapsed, closest, crossedGap, hits, downs: a.bout.downs, trace };
    }, scenario);
    results.push(result);
    console.log(JSON.stringify({ seed, level, mirror, elapsed: result.elapsed, closest: result.closest, crossedGap: result.crossedGap, hits: result.hits, downs: result.downs }));
    if (seed === 43 && level === 3) await page.screenshot({ path: `verify-out/stock-stationary/${mirror ? 'right' : 'left'}.png` });
  }
  writeFileSync('verify-out/stock-stationary/results.json', JSON.stringify({ results, errors }, null, 2));
  assert.deepEqual(errors, []);
  for (const result of results) {
    assert.equal(result.downs.filter(down => down.slot === 1).length, 0, 'CPU reaches the opponent without falling out');
    assert.ok(result.crossedGap, 'CPU traverses the gap instead of pacing on its starting platform');
    // A projectile can knock an idle human out during the approach. That ends
    // this fixture: a respawn would no longer test the stationary upper-platform target.
    const knockedOutTarget = result.downs.some(down => down.slot === 0 && down.by === 1);
    assert.ok(knockedOutTarget || (result.closest < 30 && result.hits.length > 0), 'CPU lands melee or knocks out the stationary opponent');
  }
} finally { await browser.close(); }

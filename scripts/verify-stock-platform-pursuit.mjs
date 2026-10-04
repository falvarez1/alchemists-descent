import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';

const browser = await launchBrowser();
const out = 'verify-out/stock-platform-pursuit';
mkdirSync(out, { recursive: true });
const results = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto((process.argv[2] ?? 'http://127.0.0.1:5217/') + '?link=off', { waitUntil: 'networkidle' });
  await waitForConsoleApi(page);
  await page.locator('[data-entry="duel"]').click();
  await page.getByRole('button', { name: 'Ready player 1', exact: true }).click();
  await page.locator('#versus-start').click();
  await page.waitForFunction(() => window.__game.ctx.arena.stockMatch?.state === 'fighting');
  await page.evaluate(() => { window.__game.ctx.state.paused = true; });
  const cases = [640, 700, 712].flatMap(startX => [0, 30, 100].flatMap(fuel => [false, true].map(mirror => ({ startX, fuel, mirror }))));
  cases.push({ startX: 640, fuel: 100, mirror: false, obstructed: true });
  for (const scenario of cases) {
    const result = await page.evaluate(async ({ startX, fuel, mirror, obstructed = false }) => {
      const g = window.__game, c = g.ctx, a = c.arena;
      await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
      c.state.worldSeed = 43; a.reset();
      for (let i = 0; i < 125; i++) g.tick(false, { forcePaused: true });
      // The stage's own heights (the raised platforms were lowered in the arcade pass: never hard-code them).
      const deckY = a.stockStage.main.y - 1, platY = a.stockStage.platforms[0].y - 1;
      for (const slot of [0, 1]) {
        const b = a.bundle(slot), baseX = slot ? startX : 630, x = mirror ? 1600 - baseX : baseX;
        Object.assign(b.player, { x, y: slot ? deckY : platY, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, invuln: 0, stunT: 0 });
        if (slot === 1) b.player.levit = fuel;
        for (const key of Object.keys(b.input.keys)) b.input.keys[key] = false;
        b.input.mouse.down = false;
      }
      c.state.arrivalGraceUntil = 0;
      await c.console.exec('arena bot 1 basic 3');
      const trace = []; let landed = -1, planted = false;
      for (let tick = 0; tick < (obstructed ? 800 : 420); tick++) {
        // Keep the navigation target stationary despite projectile knockback.
        // CPU movement, fuel, decisions, and collisions run normally.
        a.bundle(0).player.invuln = 2;
        g.tick(false, { forcePaused: true });
        const p = a.bundle(1).player, rival = a.bundle(0).player;
        if (obstructed && !planted && !p.grounded && p.vy < 0) {
          const { Cell } = await import('/src/sim/CellType.ts');
          for (let x = p.x - 18; x <= p.x + 18; x++) for (let y = 600; y <= 604; y++) c.world.replaceCellAt(c.world.idx(x, y), Cell.Metal, 0x887755);
          planted = true;
        }
        if (tick % 10 === 0) {
          const status = await c.console.exec('arena status');
          trace.push({ tick, x: p.x, y: p.y, vx: p.vx, vy: p.vy, fuel: p.levit, maxFuel: p.maxLevit, grounded: p.grounded,
            target: { x: rival.x, y: rival.y }, keys: { ...a.bundle(1).input.keys }, bot: structuredClone(status.data.bots[1]) });
        }
        if (p.grounded && p.y === platY && Math.abs(p.x - rival.x) < 30) { landed = tick; break; }
      }
      return { startX, fuel, mirror, obstructed, landed, downs: a.bout.downs, trace };
    }, scenario);
    results.push(result);
    console.log(JSON.stringify({ ...scenario, landed: result.landed, downs: result.downs }));
    if (result.landed < 0) await page.screenshot({ path: `${out}/${scenario.startX}-${scenario.fuel}-${scenario.mirror}.png` });
  }
  writeFileSync(`${out}/results.json`, JSON.stringify({ results, errors }, null, 2));
  assert.deepEqual(errors, []);
  for (const result of results) {
    assert.equal(result.downs.length, 0);
    assert.ok(result.landed >= 0, `CPU below platform must land beside idle target: ${JSON.stringify({ fuel: result.fuel, mirror: result.mirror })}`);
    if (result.obstructed) {
      const actions = new Set(result.trace.map(t => t.bot.navigation?.action).filter(Boolean));
      assert.ok(actions.size > 1, 'a failed ascent leads to a different approach');
    }
  }
} finally { await browser.close(); }

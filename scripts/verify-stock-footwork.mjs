import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';
const browser = await launchBrowser(), out = 'verify-out/stock-footwork';
mkdirSync(out, { recursive: true });
const results = [], errors = [];
const platforms = process.argv.includes('--platforms');
const scenarios = platforms
  ? [11, 29, 43].flatMap(seed => [540, 600, 699].flatMap(x => [false, true].map(mirror =>
    ({ seed, targetX: mirror ? 1600 - x : x, cpuX: mirror ? 550 : 1050 }))))
  : [11, 29, 43].map(seed => ({ seed }));
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto((process.argv[2] ?? 'http://127.0.0.1:5221/') + '?link=off', { waitUntil: 'networkidle' });
  await waitForConsoleApi(page);
  await page.locator('[data-entry="duel"]').click();
  await page.getByRole('button', { name: 'Ready player 1', exact: true }).click();
  await page.locator('#versus-start').click();
  await page.waitForFunction(() => window.__game.ctx.arena.stockMatch?.state === 'fighting');
  await page.evaluate(() => { window.__game.ctx.state.paused = true; });
  for (const scenario of scenarios) {
    const result = await page.evaluate(async ({ seed, platforms, targetX, cpuX }) => {
      const g = window.__game, c = g.ctx, a = c.arena;
      await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
      c.state.worldSeed = seed; a.reset();
      for (let i = 0; i < 125; i++) g.tick(false, { forcePaused: true });
      if (platforms) {
        for (const slot of [0, 1]) {
          const b = a.bundle(slot);
          Object.assign(b.player, { x: slot ? cpuX : targetX, y: 559, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, invuln: 0, stunT: 0 });
        }
      } else await c.console.exec('arena bot 0 basic 5');
      await c.console.exec('arena bot 1 basic 5');
      let bots;
      const trace = [[], []], reversals = [[], []], lastDir = [0, 0], lastTick = [0, 0];
      let hits = 0, reached = false;
      const allHits = [];
      const off = c.events.on('fighterHit', hit => { allHits.push({ ...hit, at: trace[1].length }); if (hit.attack?.startsWith('melee.')) hits++; });
      for (let tick = 0; tick < (platforms ? 1200 : 3600) && a.stockMatch.state !== 'finished'; tick++) {
        if (platforms) a.bundle(0).player.invuln = 2;
        g.tick(false, { forcePaused: true });
        bots = (await c.console.exec('arena status')).data.bots;
        for (const slot of [0, 1]) {
          const b = a.bundle(slot), p = b.player, target = a.bundle(1 - slot).player, bot = bots[slot];
          if (!bot) continue;
          const dir = Number(b.input.keys.right) - Number(b.input.keys.left);
          const row = { tick, x: p.x, y: p.y, vx: +p.vx.toFixed(2), dir, tx: target.x, ty: target.y,
            grounded: p.grounded, locked: a.isActionLocked(slot), stun: p.stunT, intent: bot.intent, goal: bot.goalX,
            rule: bot.rule, nav: bot.navigation?.action, threatened: bot.threat,
            hazard: bot.stats.hazardRepositions ?? 0, stuck: bot.stats.stuck, hops: bot.stats.hops };
          trace[slot].push(row);
          if (!p.grounded || p.dead || row.locked || p.stunT > 0) { lastDir[slot] = 0; continue; }
          if (dir && lastDir[slot] && dir !== lastDir[slot] && tick - lastTick[slot] <= 20) {
            reversals[slot].push({ ...row, since: tick - lastTick[slot], before: trace[slot].slice(-10) });
          }
          if (dir) { lastDir[slot] = dir; lastTick[slot] = tick; }
        }
        if (platforms) {
          const cpu = a.bundle(1).player, target = a.bundle(0).player;
          reached = cpu.grounded && Math.abs(cpu.y - target.y) < 5 && Math.abs(cpu.x - target.x) < 25;
          if (reached || a.bout.downs.some(down => down.slot === 1)) break;
        }
      }
      off();
      return { seed, targetX, cpuX, hits, allHits, reached, trace, reversals, stats: bots.map(bot => bot && structuredClone(bot.stats)), downs: a.bout.downs };
    }, { ...scenario, platforms });
    results.push(result);
    console.log(JSON.stringify({ ...scenario, hits: result.hits, reached: result.reached, ticks: result.trace[1].length, reversals: result.reversals.map(r => r.length), stats: result.stats }));
  }
  writeFileSync(`${out}/${platforms ? 'platforms' : 'fights'}.json`, JSON.stringify({ results, errors }, null, 2));
  assert.deepEqual(errors, []);
  if (platforms) for (const result of results) {
    assert.ok(result.reached, `CPU must reach opposite platform: ${result.seed}/${result.targetX}`);
    assert.ok(result.reversals[1].length <= 3, `CPU must not repeatedly reverse before reaching ${result.targetX}`);
    assert.ok((result.stats[1].hazardRepositions ?? 0) <= 1, 'CPU must not repeat the same approach/retreat loop');
  }
  if (!platforms) assert.ok(results.every(result => result.hits > 0), 'CPUs still engage in melee during sustained fights');
  if (!platforms) for (const result of results) for (const trace of result.trace) {
    const retreats = trace.filter((row, i) => i > 0 && row.hazard > trace[i - 1].hazard);
    for (let i = 2; i < retreats.length; i++) {
      const attempts = retreats.slice(i - 2, i + 1);
      const samePatch = attempts.every(row => Math.abs(row.x - attempts[0].x) < 16 && Math.abs(row.y - attempts[0].y) < 8);
      assert.ok(!samePatch || attempts[2].tick - attempts[0].tick > 180,
        `CPU must not retreat from the same patch three times: seed ${result.seed}, tick ${attempts[2].tick}`);
    }
  }
} finally { await browser.close(); }

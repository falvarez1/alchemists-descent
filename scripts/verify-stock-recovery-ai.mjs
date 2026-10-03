import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5217/';
const out = 'docs/arena/platform-fighter/evidence';
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url + '?link=off', { waitUntil: 'networkidle' });
  await leaveTitleIfShown(page); await waitForConsoleApi(page);
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    await c.console.exec('run test --level fighter-duel --world campaign-level');
    c.fighters.equip('ilyra-voss'); await c.fighters.whenReady();
  });
  await page.getByRole('combobox', { name: 'Match rules', exact: true }).selectOption('stocks');
  await page.getByRole('button', { name: 'Add rival', exact: true }).click();
  await page.waitForFunction(() => window.__game.ctx.arena.stockMatch?.state === 'fighting');
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
    c.state.paused = true; document.activeElement?.blur();
  });
  const matrix = [];
  const fighters = ['ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'];
  for (const fighter of fighters) for (const side of [-1, 1]) for (const scenario of fighter === 'brann-rook' ? ['baseline', 'late-hitstun'] : ['baseline']) {
    const result = await page.evaluate(async ({ fighter, side, scenario }) => {
      const g = window.__game, c = g.ctx, a = c.arena, p = c.player;
      const { STOCK_STAGE: S } = await import('/src/config/stockStage.ts');
      await c.console.exec('arena bot 0 off'); c.fighters.equip(fighter); await c.fighters.whenReady();
      a.reset(); for (let i = 0; i < 125; i++) g.tick(false, { forcePaused: true });
      Object.assign(p, { x: side < 0 ? S.main.x0 - 21 : S.main.x1 + 21, y: S.main.y + 40, vx: 0, vy: 1, fx: 0, fy: 0, grounded: false, invuln: 0 });
      if (scenario === 'late-hitstun') {
        // Reproduce the last live-bout stun tick. The launch lock still runs for this body tick.
        a.takeStockDamage(8, side * 3, 0);
        while (p.stunT > 1) g.tick(false, { forcePaused: true });
        Object.assign(p, { x: side < 0 ? S.main.x0 - 53 : S.main.x1 + 53, y: S.main.y - 4, vx: side * 7.84, vy: 3.5, fx: 0, fy: 0, levit: 60.7 });
      }
      await c.console.exec('arena bot 0 basic 3');
      const trace = []; let landed = false;
      for (let i = 0; i < 300; i++) {
        g.tick(false, { forcePaused: true });
        if (i % 6 === 0) trace.push({ tick: i, x: p.x, y: p.y, vx: p.vx, vy: p.vy, fuel: p.levit, burst: a.canRecover(0), up: c.input.keys.up, jump: c.input.keys.jump });
        if (p.dead || a.stockMatch.fighters[0].stocks < 3) break;
        if (p.grounded && p.x >= S.main.x0 && p.x <= S.main.x1 && p.y <= S.main.y) { landed = true; break; }
      }
      return { fighter, side, scenario, landed, stocks: a.stockMatch.fighters[0].stocks, x: p.x, y: p.y, trace };
    }, { fighter, side, scenario });
    matrix.push(result); console.log(JSON.stringify({ ...result, trace: result.landed ? undefined : result.trace }));
  }
  writeFileSync(`${out}/stock-recovery-ai.json`, JSON.stringify({ matrix, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(matrix.every(r => r.landed && r.stocks === 3), 'Every selected fighter recovers from both baseline positions using the real CPU inputs');
  assert.ok(matrix.filter(r => r.scenario === 'late-hitstun').every(r => r.trace.some(t => !t.burst)), 'CPU retries the recovery edge after hitstun instead of losing the unused burst');
} finally { await browser.close(); }

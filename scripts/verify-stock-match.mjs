import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5217/';
const out = 'docs/arena/platform-fighter/evidence';
mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url + '?link=off', { waitUntil: 'networkidle' });
  await leaveTitleIfShown(page); await waitForConsoleApi(page);
  await page.evaluate(async () => { await window.__game.ctx.console.exec('run test --level fighter-duel --world campaign-level'); });
  await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'fighter-duel');
  await page.evaluate(async () => { const c = window.__game.ctx; c.fighters.equip('ilyra-voss'); await c.fighters.whenReady(); });
  await page.getByRole('combobox', { name: 'Match rules', exact: true }).selectOption('stocks');
  await page.getByRole('button', { name: 'Add rival', exact: true }).click();
  await page.waitForFunction(() => window.__game.ctx.arena.stockMatch?.state === 'fighting');
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    await c.console.exec('arena bot 1 off');
    c.arena.reset();
    document.getElementById('fighter-arena')?.classList.add('collapsed');
  });
  await page.waitForTimeout(6500);
  await page.screenshot({ path: `${out}/foundry-first-pass.png` });
  const results = await page.evaluate(async () => {
    const { STOCK_STAGE: S } = await import('/src/config/stockStage.ts');
    const g = window.__game, c = g.ctx, a = c.arena;
    c.state.paused = true;
    const step = n => { for (let i = 0; i < n; i++) g.tick(false, { forcePaused: true }); };
    a.reset(); step(125);
    const A = a.bundle(0).player, B = a.bundle(1).player;
    const before = B.hp;
    B.invuln = 0;
    a.with(1, () => c.playerCtl.damage(20, 4, -2, 'fighter'));
    const low = { speed: Math.hypot(B.vx, B.vy), hp: B.hp, percent: a.stockMatch.fighters[1].volatility };
    B.invuln = 0;
    a.with(1, () => { a.takeStockDamage(150, 0, 0); c.playerCtl.damage(20, 4, -2, 'fighter'); });
    const high = Math.hypot(B.vx, B.vy);
    const start = B.x;
    step(3);
    const moved = B.x - start;
    B.x = a.stockMatch.zone.right + 1; step(1);
    const lost = a.stockMatch.fighters[1].stocks;
    step(62);
    const respawn = { dead: B.dead, percent: a.stockMatch.fighters[1].volatility, protected: a.stockMatch.fighters[1].protection > 0 };
    a.reset(); step(125);
    const x = A.x;
    a.bundle(0).input.keys.right = true; step(15); a.bundle(0).input.keys.right = false;
    const moveInput = A.x - x;
    // A high damage fall still consumes exactly one life; health healing never reduces volatility.
    a.with(0, () => a.takeStockDamage(50, 0, 0));
    A.hp = A.maxHp;
    const healing = a.stockMatch.fighters[0].volatility;
    // Recover with ordinary directional/jump input, then land on real platform cells.
    a.reset(); step(125);
    Object.assign(A, { x: S.main.x0 - 21, y: S.main.y + 40, vx: 0, vy: 1, grounded: false, fx: 0, fy: 0 });
    a.bundle(0).input.keys.up = true; a.bundle(0).input.keys.jump = true;
    let minimumY = A.y;
    for (let i = 0; i < 100; i++) {
      a.bundle(0).input.keys.right = A.y < S.main.y - 17 && A.x < S.main.x0 + 60;
      if (A.x > S.main.x0 + 30) { a.bundle(0).input.keys.jump = false; a.bundle(0).input.keys.up = false; }
      step(1); minimumY = Math.min(minimumY, A.y);
    }
    const recovery = { minimumY, x: A.x, y: A.y, stocks: a.stockMatch.fighters[0].stocks, grounded: A.grounded };
    a.reset(); step(125);
    for (let i = 0; i < 3; i++) { B.x = a.stockMatch.zone.right + 1; step(1); if (i < 2) step(62); }
    const winner = a.stockMatch.winner;
    const finished = a.stockMatch.state;
    a.reset(); step(125);
    c.state.paused = false;
    return { before, low, high, moved, lost, respawn, moveInput, healing, recovery, winner, finished, stage: c.world.type(S.center.x, S.main.y), open: c.world.type(S.main.x0 - 70, S.main.y), main: S.main };
  });
  console.log(JSON.stringify(results, null, 2));
  assert.equal(results.low.hp, results.before, 'Stock damage must not lower health');
  assert.ok(results.low.percent > 0, 'Real damage increases volatility');
  assert.ok(results.high > results.low.speed, 'High volatility launches faster');
  assert.ok(results.moved > 12, 'Launch momentum survives actual body updates');
  assert.equal(results.lost, 2); assert.equal(results.respawn.dead, false);
  assert.equal(results.respawn.percent, 0); assert.ok(results.respawn.protected);
  assert.ok(results.moveInput > 10, 'Ordinary movement inputs work');
  assert.equal(results.healing, 50); assert.equal(results.winner, 0); assert.equal(results.finished, 'finished');
  assert.equal(results.recovery.stocks, 3, 'Recovery returns without losing a stock');
  assert.ok(results.recovery.minimumY < results.main.y && results.recovery.x > results.main.x0 + 5 && results.recovery.grounded, 'Input-driven recovery lands on the platform');
  assert.equal(results.stage, 13); assert.equal(results.open, 0);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/foundry-verified.png` });
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/stock-match-results.json`, JSON.stringify({ results, errors }, null, 2));
  const recoveries = [];
  for (const fighter of ['ilyra-voss', 'brann-rook', 'mara-quell']) for (const side of [-1, 1]) {
    const recovery = await page.evaluate(async ({ fighter, side }) => {
      const { STOCK_STAGE: S } = await import('/src/config/stockStage.ts');
      const g = window.__game, c = g.ctx, a = c.arena;
      c.state.paused = true;
      c.fighters.equip(fighter); await c.fighters.whenReady();
      const step = n => { for (let i = 0; i < n; i++) g.tick(false, { forcePaused: true }); };
      a.reset(); step(125);
      const p = a.bundle(0).player, keys = a.bundle(0).input.keys;
      Object.assign(p, { x: side < 0 ? S.main.x0 - 21 : S.main.x1 + 21, y: S.main.y + 40, vx: 0, vy: 1, grounded: false, fx: 0, fy: 0 });
      keys.up = true; keys.jump = true;
      let minimumY = p.y;
      for (let i = 0; i < 120; i++) {
        keys.right = side < 0 && p.y < S.main.y - 17 && p.x < S.main.x0 + 60;
        keys.left = side > 0 && p.y < S.main.y - 17 && p.x > S.main.x1 - 60;
        if (side < 0 ? p.x > S.main.x0 + 30 : p.x < S.main.x1 - 30) { keys.up = false; keys.jump = false; }
        step(1); minimumY = Math.min(minimumY, p.y);
      }
      keys.left = false; keys.right = false; keys.up = false; keys.jump = false;
      return { fighter, side, x: p.x, y: p.y, minimumY, stocks: a.stockMatch.fighters[0].stocks, grounded: p.grounded };
    }, { fighter, side });
    recoveries.push(recovery);
  }
  writeFileSync(`${out}/stock-recovery-matrix.json`, JSON.stringify(recoveries, null, 2));
  console.log('Recovery matrix:', JSON.stringify(recoveries));
  for (const recovery of recoveries) {
    assert.equal(recovery.stocks, 3, `${recovery.fighter} side ${recovery.side} must recover without a stock loss`);
    assert.ok(recovery.grounded && recovery.x > results.main.x0 + 5 && recovery.x < results.main.x1 - 5 && recovery.minimumY < results.main.y, 'Recover onto real stage');
  }
  // Both readouts must report a simultaneous final-stock draw.
  await page.evaluate(() => {
    const g = window.__game, c = g.ctx, a = c.arena;
    a.reset(); for (let i = 0; i < 125; i++) g.tick(false, { forcePaused: true });
    for (let slot = 0; slot < 2; slot++) { a.stockMatch.fighters[slot].stocks = 1; a.bundle(slot).player.x = a.stockMatch.zone.right + 1; }
    g.tick(false, { forcePaused: true });
    c.state.paused = false;
  });
  await page.waitForTimeout(350);
  assert.match(await page.locator('.fa-bout').innerText(), /draw/i, 'Training panel must agree with stock HUD about a draw');
  await page.evaluate(async () => { const c = window.__game.ctx; c.fighters.equip('ilyra-voss'); await c.fighters.whenReady(); c.arena.reset(); });
  // Let normal clocks, AI, sim, and rendering run together for a visible bout.
  await page.evaluate(async () => { const c = window.__game.ctx; await c.console.exec('arena bot 0 basic 3'); await c.console.exec('arena bot 1 basic 3'); });
  await page.waitForTimeout(20000);
  await page.screenshot({ path: `${out}/foundry-bot-dogfood.png` });
  const dogfood = await page.evaluate(() => {
    const c = window.__game.ctx;
    return { state: c.arena.stockMatch.state, fighters: c.arena.stockMatch.fighters, downs: c.arena.bout.downs, remaining: c.arena.stockMatch.remainingTicks };
  });
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/stock-dogfood.json`, JSON.stringify(dogfood, null, 2));
  console.log('Bot dogfood:', JSON.stringify(dogfood));
  assert.ok(await page.evaluate(() => { const z = window.__game.ctx.camera.zoom; return z >= .4 && z <= 1.65; }), 'Stock framing stays within its authored range');
  await page.evaluate(async () => { await window.__game.ctx.console.exec('run test --level fighter-test --world campaign-level'); });
  await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'fighter-test');
  assert.equal(await page.evaluate(() => document.body.classList.contains('stock-match')), false, 'Leaving stocks restores the normal HUD');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }

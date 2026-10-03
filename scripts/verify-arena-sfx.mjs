import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
const browser = await launchBrowser(), rows = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto((process.argv[2] ?? 'http://127.0.0.1:5217/') + '?link=off', { waitUntil: 'networkidle' });
  await page.locator('[data-entry="duel"]').click();
  await page.getByRole('button', { name: 'Ready player 1', exact: true }).click();
  await page.locator('#versus-start').click();
  await page.waitForFunction(() => window.__game?.ctx.arena.stockMatch?.state === 'fighting');
  await page.waitForFunction(() => window.__game.ctx.audio.debugSamples().packs.arena === 'ready', null, { timeout: 30000 });
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    await c.console.exec('arena bot 0 off'); await c.console.exec('arena bot 1 off');
    c.state.paused = true;
    const { STOCK_STAGE: S } = await import('/src/config/stockStage.ts');
    window.audioFixture = { c, S, step(n) { for (let i = 0; i < n; i++) window.__game.tick(false, { forcePaused: true }); }, fresh(slot = 0) {
      c.arena.reset(); c.fx.hitstop = 0; this.step(125); c.state.arrivalGraceUntil = 0;
      for (const n of [0, 1]) {
        const b = c.arena.bundle(n);
        for (const key of Object.keys(b.input.keys)) b.input.keys[key] = false;
        b.input.shieldHeld = false;
        Object.assign(b.player, { x: S.center.x + (n === slot ? 0 : 18), y: S.main.y - 1, grounded: true, vx: 0, vy: 0, fx: 0, fy: 0, invuln: 0, facing: n === slot ? 1 : -1 });
      }
      c.audio.recent.length = 0;
    } };
  });
  for (const [kind, expected] of [['opener', 'arena.hit.light'], ['finisher', 'arena.hit.heavy']]) {
    await page.waitForTimeout(180);
    const row = await page.evaluate(kind => { const f = window.audioFixture, c = f.c; f.fresh(); c.arena.with(0, () => c.arena.requestStockAttack(kind)); f.step(22); return { kind, volatility: c.arena.stockMatch.fighters[1].volatility, played: c.audio.debugSamples().lastPlayed }; }, kind);
    assert.ok(row.volatility > 0); assert.ok(row.played.includes(expected)); assert.ok(row.played.includes('arena.hurt.armored'));
    assert.equal(row.played.includes('player.hurt'), false); assert.equal(row.played.includes('player.kick'), false); rows.push(row);
  }
  const idle = await page.evaluate(() => { const f = window.audioFixture; f.fresh(); f.step(300); return f.c.audio.debugSamples().lastPlayed; });
  assert.equal(idle.some(id => id.startsWith('arena.hurt') || id.startsWith('arena.hit')), false, 'idle standing contact makes no hurt or hit sounds');
  rows.push({ idle });
  for (const slot of [0, 1]) {
    await page.waitForTimeout(180);
    const row = await page.evaluate(slot => { const f = window.audioFixture, c = f.c; f.fresh(); c.arena.with(slot, () => c.playerCtl.damage(10, 1, 0, 'fighter')); return { slot, played: c.audio.debugSamples().lastPlayed }; }, slot);
    assert.ok(row.played.includes(slot ? 'arena.hurt.armored' : 'arena.hurt.agile')); assert.ok(row.played.includes('arena.hit.light')); assert.equal(row.played.includes('player.hurt'), false); rows.push(row);
  }
  for (const amount of [8, 250]) {
    await page.waitForTimeout(180);
    const row = await page.evaluate(amount => { const f = window.audioFixture, c = f.c; f.fresh(); c.arena.bundle(1).input.shieldHeld = true; f.step(1); c.arena.blow = { by: 0, tag: 'melee.opener' }; const absorbed = c.arena.with(1, () => c.arena.blockStockHit(amount)); c.arena.blow = null; return { amount, absorbed, phase: c.arena.stockShield(1).phase, played: c.audio.debugSamples().lastPlayed }; }, amount);
    assert.ok(row.absorbed); assert.ok(row.played.includes(amount > 10 ? 'arena.shield.break' : 'arena.shield.block')); assert.equal(row.played.some(id => id.startsWith('arena.hurt')), false); rows.push(row);
  }
  await page.waitForTimeout(200);
  const grab = await page.evaluate(() => { const f = window.audioFixture, c = f.c; f.fresh(); c.arena.with(0, () => c.arena.requestStockGrab()); f.step(6); c.arena.bundle(0).input.keys.up = true; f.step(9); return { played: c.audio.debugSamples().lastPlayed, volatility: c.arena.stockMatch.fighters[1].volatility }; });
  assert.ok(grab.played.includes('arena.grab')); assert.ok(grab.played.includes('arena.throw')); assert.ok(grab.played.includes('arena.hurt.armored')); assert.equal(grab.played.includes('arena.hit.light'), false); rows.push({ grab });
  const mixed = await page.evaluate(async () => {
    const c = window.__game.ctx, ids = ['arena.hit.light', 'arena.hit.heavy', 'arena.shield.block', 'arena.shield.break', 'arena.grab', 'arena.throw', 'arena.hurt.agile', 'arena.hurt.armored', 'arena.hurt.duelist'];
    const singles = [];
    for (const id of ids) singles.push({ id, ...await c.audio.debugRenderOffline(1, () => c.audio.sfx(id)) });
    const crowded = await c.audio.debugRenderOffline(1, () => { for (let i = 0; i < 20; i++) for (const id of ids) c.audio.sfx(id); });
    return { singles, crowded, samples: c.audio.debugSamples() };
  });
  for (const cue of mixed.singles) { assert.ok(cue.rms > 0.0005, cue.id + ' audible'); assert.ok(cue.peak < 1, cue.id + ' no clipping'); }
  assert.ok(mixed.crowded.peak < 1); assert.ok(mixed.samples.activeVoices <= 40); assert.equal(mixed.samples.filesFailed, 0);
  assert.deepEqual(errors, []);
  writeFileSync('docs/arena/platform-fighter/evidence/arena-sfx.json', JSON.stringify({ rows, mixed, errors }, null, 2));
  console.log(JSON.stringify({ rows, singles: mixed.singles, crowded: mixed.crowded, errors }, null, 2));
} finally { await browser.close(); }

// Regressions for manual respawn, slot-scoped kit respawn, retained stuns and health equality.
// Usage: node scripts/verify-arena-lifecycle.mjs [url]
import assert from 'node:assert/strict';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5194/';
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`${url}?link=off`, { waitUntil: 'networkidle' });
  await leaveTitleIfShown(page);
  await waitForConsoleApi(page);
  await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    const result = await ctx.console.exec('run test --level fighter-duel --world campaign-level --loadout fresh');
    if (!result.ok) throw new Error(result.text);
    ctx.state.paused = true;
    ctx.state.arrivalGraceUntil = 0;
    ctx.state.debugGodMode = false;
    ctx.fighters.equip('rusk-emberjaw');
    await ctx.fighters.whenReady();
    ctx.fighters.update(ctx);
    const spawn = ctx.levels.respawnPoint();
    await ctx.arena.addRival('rusk-emberjaw', spawn.x + 80, spawn.y);
    ctx.arena.setSpawns([spawn, { x: spawn.x + 80, y: spawn.y }]);
    ctx.arena.with(1, () => ctx.fighters.update(ctx));
    if (ctx.fighters.armor !== 40) throw new Error('Rival arrival reset the base fighter armor');
    ctx.playerCtl.kill('fighter');
    if (ctx.arena.bout.state !== 'won' || !ctx.player.dead) throw new Error('Expected a lost bout');
  });

  // Exercise the real R key path after a loss, with the rival inside campaign cleanup range.
  await page.keyboard.press('r');
  const respawn = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    return { state: ctx.arena.bout.state, dead: ctx.player.dead, stands: ctx.enemies.filter(e => e.fighter !== undefined).length };
  });
  assert.deepEqual(respawn, { state: 'fighting', dead: false, stands: 1 });
  console.log('PASS R after losing starts a bout and preserves the stand-in');

  await page.evaluate(() => {
    const ctx = window.__game.ctx;
    for (let slot = 0; slot < 2; slot++) ctx.arena.with(slot, () => {
      ctx.fighters.update(ctx);
      ctx.fighters.stunEnemy(ctx.enemies.find(e => e.fighter !== undefined), 120);
    });
    ctx.arena.endTick();
    if ([0, 1].some(slot => ctx.arena.bundle(slot).player.stunT !== 2)) throw new Error('Expected both fighters stunned');
  });
  await page.locator('#fighter-arena .fa-duel button').filter({ hasText: /^Rematch$/ }).click();
  const rematch = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    ctx.arena.endTick();
    return [0, 1].map(slot => ctx.arena.with(slot, () => {
      ctx.fighters.update(ctx);
      return { armor: ctx.fighters.armor, stun: ctx.player.stunT, ready: ctx.fighters.view.ultimate.ready };
    }));
  });
  assert.deepEqual(rematch, [{ armor: 40, stun: 0, ready: true }, { armor: 40, stun: 0, ready: true }]);
  console.log('PASS Rematch restores both Rusk armor pools and ability resources without old stuns');
  const landed = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const rival = ctx.arena.bundle(1);
    const armor = rival.fighters.armor;
    rival.player.invuln = 0;
    ctx.enemyCtl.damage(ctx.enemies.find(e => e.fighter !== undefined), 10, 0, 0, 'direct');
    return rival.fighters.armor < armor;
  });
  assert.ok(landed, 'An attack after R and Rematch must reach the original rival');
  console.log('PASS attacks still reach the original rival after R and Rematch');

  const damage = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    const { ARENA_RULES } = await import('/src/config/arenaRules.ts');
    const was = ARENA_RULES.healthEquality;
    try {
      ARENA_RULES.healthEquality = 1;
      ctx.fighters.equip('brann-rook');
      await ctx.fighters.whenReady();
      await ctx.arena.addRival('sable-fen', 850, 639);
      ctx.arena.reset();
      const fractions = [];
      for (let attacker = 0; attacker < 2; attacker++) ctx.arena.with(attacker, () => {
        const victim = ctx.arena.bundle(1 - attacker);
        victim.player.invuln = 0;
        // Equalize attack power; isolate body health from other combat tuning.
        const hp = victim.player.hp;
        ctx.enemyCtl.damage(ctx.enemies.find(e => e.fighter !== undefined), 10 / ctx.fighters.body.dealt, 0, 0, 'direct');
        fractions.push((hp - victim.player.hp) / victim.player.maxHp);
      });
      return fractions;
    } finally { ARENA_RULES.healthEquality = was; }
  });
  assert.ok(damage.every(fraction => fraction > 0), `Attacks must land after rematch: ${damage}`);
  assert.ok(Math.abs(damage[0] - damage[1]) < 0.001, `Equal health fractions: ${damage}`);
  console.log('PASS attacks land after rematch and health equality offsets heavy and light body health');
  assert.deepEqual(errors, []);
  console.log('PASS no browser errors');
} finally {
  await browser.close();
}

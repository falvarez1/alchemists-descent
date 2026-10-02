// Regression probe for PR #13's fighter reset, ownership, loading and interception findings.
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5194/';
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${url}?link=off`, { waitUntil: 'networkidle' });
  await leaveTitleIfShown(page);
  await waitForConsoleApi(page);
  const checks = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    const checks = [];
    const check = (name, ok) => checks.push({ name, ok });
    const start = async () => {
      const result = await ctx.console.exec('run test --level fighter-duel --world campaign-level --loadout fresh');
      if (!result.ok) throw new Error(result.text);
      ctx.state.paused = true;
      ctx.state.arrivalGraceUntil = 0;
    };
    await start();
    const defaults = { hp: ctx.player.maxHp, fuel: ctx.player.maxLevit };
    for (const id of ['brann-rook', 'sable-fen']) {
      ctx.fighters.equip(id);
      await ctx.fighters.whenReady();
      const scaled = { hp: ctx.player.maxHp, fuel: ctx.player.maxLevit };
      await start();
      check(`${id}: a new run restores Alchemist stats`, ctx.fighters.id === null && ctx.player.maxHp === defaults.hp && ctx.player.maxLevit === defaults.fuel);
      ctx.fighters.equip(id);
      await ctx.fighters.whenReady();
      check(`${id}: equipping again applies body scales once`, ctx.player.maxHp === scaled.hp && Math.abs(ctx.player.maxLevit - scaled.fuel) < 0.001);
    }
    const arena = ctx.arena;
    const cancelled = arena.addRival('nox-calder', 850, 639);
    arena.removeRival(1);
    check('removal during loading leaves no fighter proxy', await cancelled === -1 && !arena.active && !ctx.enemies.some(e => e.fighter !== undefined));
    ctx.fighters.equip('nox-calder');
    await ctx.fighters.whenReady();
    await arena.addRival('nox-calder', 850, 639);
    const place = () => {
      ctx.projectiles.length = 0;
      for (let slot = 0; slot < 2; slot++) {
        const p = arena.bundle(slot).player;
        Object.assign(p, { x: 730 + slot * 120, y: 639, vx: 0, vy: 0, hp: p.maxHp, dead: false, invuln: 0, grounded: true });
        p.status.frozen = 0;
      }
      arena.with(1, () => undefined);
    };
    for (const owner of [0, 1]) {
      place();
      const caster = arena.bundle(owner).player, victim = arena.bundle(1 - owner).player;
      const before = [caster.hp, victim.hp];
      for (const p of [caster, victim]) ctx.projectiles.push({ x: p.x - 2, y: p.y, vx: 0, vy: 0, type: 'blackhole', vortexRad: 8, life: 30, age: 0, charging: false, hostile: false, owner });
      ctx.projectileCtl.update(ctx);
      check(`slot ${owner}: black hole hurts the opponent, not the caster`, caster.hp === before[0] && victim.hp < before[1] && arena.bound === 0);
    }
    arena.removeRival(1);
    await arena.addRival('brann-rook', 850, 639);
    for (const guarding of [true, false]) {
      arena.reset();
      place();
      arena.with(1, () => {
        ctx.player.aimAngle = Math.PI;
        ctx.player.facing = -1;
        if (guarding) { ctx.fighters.press('tactical'); ctx.fighters.update(ctx); }
      });
      const target = arena.bundle(1).player;
      const hp = target.hp;
      const lance = { x: target.x - 20, y: target.y - 9, vx: 16, vy: 0, type: 'icelance', life: 30, age: 2, charging: false, hostile: false };
      ctx.projectiles.push(lance);
      ctx.projectileCtl.update(ctx);
      check(`ice lance ${guarding ? 'is consumed by Boiler Guard' : 'damages and freezes an unguarded fighter'}`, guarding
        ? target.hp === hp && target.status.frozen === 0 && !ctx.projectiles.includes(lance)
        : target.hp < hp && target.status.frozen > 0 && ctx.projectiles.includes(lance));
    }
    return checks;
  });
  for (const row of checks) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}`);
  if (errors.length || checks.some(row => !row.ok)) throw new Error(JSON.stringify({ errors, failed: checks.filter(row => !row.ok) }));
  console.log(`${checks.length} checks passed`);
} finally {
  await browser.close();
}

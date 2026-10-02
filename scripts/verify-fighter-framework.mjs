// The fighter framework against the REAL engine: the seams the kits stand on (docs/FIGHTERS.md).
// A stub kit is injected in the page (no kit module needed), then: a real Z press runs the tactical
// inside the tick, a body-owning dash moves the player past the movement code, armor / damage reduction
// sit in the player's damage path, stagger resistance holds, a speed modifier changes how far a held key
// carries, a raised plate eats a hostile shot, and the classic Alchemist is untouched.
// Usage: node scripts/verify-fighter-framework.mjs [url]
import { boot, hold, makeChecker, me, press, tick, view } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const tally = makeChecker();
const check = tally.check;
const { page, finish } = await boot(url, { fighter: null });

// The stub kit: Z dashes forward 40 cells over 8 ticks; T gives 120 ticks of half damage and no stagger;
// it also eats any hostile projectile while the "plate" flag is up.
await page.evaluate(() => {
  const sys = window.__fp.ctx.fighters;
  const stub = {
    id: 'brann-rook', tacticalCooldown: 120, ultimateDuration: 90,
    create(s) {
      const k = { plate: false, ticks: 0, ended: 0, hurts: 0, enemyHurts: 0 };
      window.__stub = k;
      return {
        tick: () => { k.ticks++; },
        tactical: () => {
          s.startMove({ ticks: 8, step: () => ({ dx: 5 * (Math.cos(s.ctx.player.aimAngle) >= 0 ? 1 : -1), dy: 0 }), face: true, invuln: 10, exitVx: 1.5 });
          return true;
        },
        ultimate: () => { s.setMod('stub', 90, { damageTaken: 0.5, staggerResist: true }); k.plate = true; return true; },
        ultimateEnd: () => { k.plate = false; k.ended++; },
        intercept: () => k.plate,
        onPlayerHurt: () => { k.hurts++; },
        onEnemyHurt: () => { k.enemyHurts++; },
      };
    },
  };
  sys.kits = () => stub;
  sys.equip('brann-rook');
});

let v = await view(page);
check('equipped: the view names the fighter and its abilities', v.id === 'brann-rook' && v.tactical.name === 'Boiler Guard' && v.ultimate.name === 'Redline', JSON.stringify(v.tactical.name));
await tick(page, 3);
check('the kit ticks every game tick', (await page.evaluate(() => window.__stub.ticks)) >= 3);

// --- a real Z press: latched, consumed in the tick, the body carried by the system
await page.evaluate(() => { window.__fp.aimAt(window.__fp.ctx.player.x + 100, window.__fp.ctx.player.y - 9); });
await tick(page, 1);
const x0 = (await me(page)).x;
await page.keyboard.down('KeyZ');
await tick(page, 1);
await page.keyboard.up('KeyZ');
const owns = await page.evaluate(() => window.__fp.ctx.fighters.ownsMovement);
// Run the dash out, and read the hand-back the tick it ends (the ground's own friction takes it after).
let m1 = await me(page);
for (let i = 0; i < 14 && (await page.evaluate(() => window.__fp.ctx.fighters.ownsMovement)); i++) { await tick(page, 1); m1 = await me(page); }
check('Z runs the tactical (cooldown spent, chip state updates)', (await view(page)).tactical.ready === false);
check('the dash carried the body ~40 cells forward', m1.x - x0 >= 36 && m1.x - x0 <= 44, `moved ${m1.x - x0}`);
check('the player\'s own movement stood aside while it ran', owns === true);
check('ownsMovement is released afterwards', (await page.evaluate(() => window.__fp.ctx.fighters.ownsMovement)) === false);
check('the dash handed back its exit speed', m1.vx > 0.5, `vx ${m1.vx}`);
await tick(page, 130);
check('the cooldown ran out (120 ticks)', (await view(page)).tactical.ready === true);

// --- armor and damage reduction are in the one shared damage path
await page.evaluate(() => { const s = window.__fp.ctx.fighters; s.setArmorMax(30, true); window.__fp.ctx.player.invuln = 0; });
let hp0 = (await me(page)).hp;
await page.evaluate(() => window.__fp.ctx.playerCtl.damage(20, 0, 0, 'probe'));
check('armor absorbs a blow before health (20 of 30 armor spent, hp untouched)', Math.abs((await me(page)).hp - hp0) < 0.01 && (await view(page)).armor <= 10.5, JSON.stringify((await view(page)).armor));
await tick(page, 40);
await page.evaluate(() => { window.__fp.ctx.player.invuln = 0; });
hp0 = (await me(page)).hp; // (the fighter's body scales the health the arena gave it: compare against what it has)
await page.evaluate(() => { window.__fp.ctx.playerCtl.damage(20, 0, 0, 'probe'); });
check('past the armor, health takes the remainder (10 of 20)', Math.abs(hp0 - (await me(page)).hp - 10) < 0.6, `${hp0} -> ${(await me(page)).hp}`);
await tick(page, 1);
check('the kit hears the health that was lost', (await page.evaluate(() => window.__stub.hurts)) >= 1);

// --- the ultimate: half damage, no stagger, no shove, and it eats a hostile shot
await page.evaluate(() => { const p = window.__fp.ctx.player; p.hp = 100; p.invuln = 0; p.staggerT = 0; p.vx = 0; window.__fp.ctx.fighters.setArmorMax(0, true); });
await page.evaluate(() => window.__fp.ctx.fighters.refill());
await press(page, 'KeyT', 1);
await tick(page, 2);
check('T runs the ultimate once the bar is full', (await view(page)).ultimate.active > 0.9);
await page.evaluate(() => { const p = window.__fp.ctx.player; p.invuln = 0; window.__fp.ctx.playerCtl.damage(20, 3, -1, 'probe'); });
const after = await page.evaluate(() => { const p = window.__fp.ctx.player; return { hp: p.hp, staggerT: p.staggerT, vx: p.vx }; });
check('damage taken is halved by the modifier', Math.abs(after.hp - 90) < 0.6, String(after.hp));
check('no stagger and no shove while resistant', after.staggerT === 0 && Math.abs(after.vx) < 0.2, JSON.stringify(after));
const eaten = await page.evaluate(async () => {
  const c = window.__fp.ctx, p = c.player;
  p.invuln = 0; const hp = p.hp;
  c.projectiles.push({ x: p.x - 6, y: p.y - 9, vx: 2, vy: 0, type: 'fireball', life: 200, age: 0, charging: false, hostile: true });
  window.__fp.tick(6);
  return { hp, now: p.hp, left: c.projectiles.filter((q) => q.hostile).length };
});
check('a raised plate / prism eats a hostile shot before it reaches the body', eaten.left === 0 && eaten.now >= eaten.hp - 0.01, JSON.stringify(eaten));
await tick(page, 100);
check('the ultimate ended on its own clock and the modifier lapsed', (await page.evaluate(() => window.__stub.ended)) === 1 && (await page.evaluate(() => window.__fp.ctx.fighters.staggerResist)) === false);

// --- a speed modifier changes how far a held key carries the body
const run = async (scale) => {
  await page.evaluate((k) => { const c = window.__fp.ctx, p = c.player; c.fighters.clearMod('speed'); if (k !== 1) c.fighters.setMod('speed', 600, { moveScale: k }); Object.assign(p, { x: window.__fp.ARENA.spawnX, vx: 0, vy: 0, facing: 1 }); }, scale);
  await tick(page, 2);
  const a = (await me(page)).x;
  await hold(page, 'KeyD', 45);
  const after = await me(page);
  if (process.env.DEBUG_PROBE) console.log('run', scale, a, JSON.stringify(after), JSON.stringify(await page.evaluate(() => ({ keys: window.__fp.ctx.input.keys, dead: window.__fp.ctx.player.dead, own: window.__fp.ctx.fighters.ownsMovement, recharge: window.__fp.ctx.player.recharge, pull: window.__fp.ctx.player.pullT, shell: window.__fp.ctx.player.chill?.shell }))));
  return after.x - a;
};
const base = await run(1);
const fast = await run(1.6);
check('moveScale 1.6 carries the body further in the same time', fast > base * 1.1, `base ${base}, fast ${fast}`);

// --- a foe hurt through the real damage path reaches the system (charge + the kit's hook)
const charged = await page.evaluate(() => {
  const c = window.__fp.ctx, f = c.fighters;
  const e = window.__fp.spawn('slime', 30);
  const before = f.view.ultimate.charge;
  c.enemyCtl.damage(e, 10, 0, 0, 'direct');
  window.__fp.tick(1);
  return { before, after: f.view.ultimate.charge, hooked: window.__stub.enemyHurts };
});
check('Enemies.damage tells the fighter (charge rises, the kit hears it)', charged.after > charged.before && charged.hooked >= 1, JSON.stringify(charged));

// --- an enemy slow reaches the enemy loop
const slow = await page.evaluate(() => {
  const c = window.__fp.ctx, f = c.fighters;
  const e = window.__fp.spawn('slime', 60);
  f.slowEnemy(e, 0.5, 200);
  return f.enemySlow(e);
});
check('enemySlow answers the enemy loop', slow === 0.5);

// --- a slow is TIME: a slowed foe takes its whole update on the matching fraction of ticks. Each foe counts its own
// updates in `timer`, so the ratio is exact and does not depend on what the AI chooses to do.
const updates = async (factor, kind) => page.evaluate(async ({ factor, kind }) => {
  const c = window.__fp.ctx, p = c.player, f = c.fighters;
  c.enemies.length = 0;
  Object.assign(p, { x: window.__fp.ARENA.spawnX, y: window.__fp.ARENA.floorY - 1, vx: 0, vy: 0, hp: 100, invuln: 9999 });
  const e = window.__fp.spawn(kind, 140);
  const t0 = e.timer ?? 0;
  if (factor < 1) f.slowEnemy(e, factor, 600);
  window.__fp.tick(100);
  return (e.timer ?? 0) - t0;
}, { factor, kind });
for (const kind of ['slime', 'golem', 'bat']) {
  const free = await updates(1, kind);
  const slowed = await updates(0.45, kind);
  check('a free ' + kind + ' takes every update (the control)', free >= 95, String(free));
  check('a x0.45 slow gives a ' + kind + ' ~45% of its updates (time, not a compounding stop)', slowed >= 40 && slowed <= 50, 'free ' + free + ' slowed ' + slowed);
}

// --- the classic Alchemist is untouched (the foes spawned above would otherwise bite while we measure)
await page.evaluate(() => { window.__fp.ctx.enemies.length = 0; window.__fp.ctx.fighters.equip(null); });
await tick(page, 3);
await press(page, 'KeyZ', 2);
v = await view(page);
check('with no fighter, Z and T do nothing and nothing changes', v.id === null && v.tactical.ready === false && (await page.evaluate(() => window.__fp.ctx.fighters.ownsMovement)) === false);
const hpClassic = (await me(page)).hp;
await page.evaluate(() => { const p = window.__fp.ctx.player; p.invuln = 0; window.__fp.ctx.playerCtl.damage(10, 0, 0, 'probe'); });
check('the classic Alchemist takes full damage', Math.abs(hpClassic - (await me(page)).hp - 10) < 0.6);

const pageErrors = await finish();
check('no page errors', pageErrors === 0);
console.log(`\nfighter framework probe: ${tally.pass} passed, ${tally.fail} failed`);
process.exit(tally.fail ? 1 : 0);

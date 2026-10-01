// Rusk Emberjaw, the Furnace Hound, against the REAL engine (docs/fighters/rusk-emberjaw.md).
//   - Scrap Recovery: the armor pool; a kick kill restores 14, a spell kill does not, a kill that is not recent
//     melee does not, the pool clamps; armor absorbs before health.
//   - Shoulder Ram (Z): real key press; 44 cells with i-frames; foes hurt 16, flung, then stunned 20; a ram kill
//     restores armor; Wood in the path is broken (Ember + cleared) and a Wood plug barricade fires and OPENS its
//     gate (the fail-open rule); a Metal wall stops it with a thump and no hole; a lever by the wall is struck.
//     Refused when cooling down / flush against a wall; allowed flush against breakable wood.
//   - Kiln Heart (T): refused while the bar is not full; armor ceiling 80 and filled, damage x0.8, a furnace
//     light; a close-range blow (even one the armor swallows) vents real Ember cells and scorches foes;
//     the ceiling returns to 40 (armor clamped) when it ends.
// Every ability is also photographed (verify-out/fighters/rusk-*.png) so it can be LOOKED at.
// Usage: node scripts/verify-fighter-rusk.mjs [url]
import { boot, makeChecker, me, press, shot, tick, view } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://localhost:5195/';
const tally = makeChecker();
const check = tally.check;
const { page, finish } = await boot(url, { fighter: 'rusk-emberjaw' });
await page.bringToFront();
await page.addStyleTag({ content: '#wave-banner, #toast-stack, .toast { display: none !important; }' });

// A UI panel that owns the keyboard (a dialog, the console, a hint card) swallows every key press: if one is up
// when the run starts, the abilities look dead. Name it and put it away rather than fail mysteriously.
const blocker = await page.evaluate(async () => {
  const { KEYBOARD_UI_BLOCK_SELECTOR } = await import('/src/input/InputManager.ts');
  const el = document.querySelector(KEYBOARD_UI_BLOCK_SELECTOR);
  if (!el) return null;
  const what = (el.id ? '#' + el.id : '') + '.' + String(el.className).split(' ').join('.');
  el.remove();
  return what;
});
if (blocker) console.log('  note: a keyboard-owning panel was up after boot (' + blocker + '): removed');

// ---- page-side helpers --------------------------------------------------------------------------------
await page.evaluate(async () => {
  const fac = await import('/src/core/mechanismFactories.ts');
  const ctx = window.__fp.ctx, w = ctx.world, p = ctx.player, A = window.__fp.ARENA;
  const sfx = [];
  const orig = ctx.audio.sfx.bind(ctx.audio);
  ctx.audio.sfx = (id, ...rest) => { sfx.push(id); return orig(id, ...rest); };
  const callouts = [];
  ctx.events.on('combatCallout', (e) => callouts.push(e.text));
  const rk = {
    sfx, callouts, mechs: [],
    /** A clean arena, a fresh Rusk (equip again: the cached kit adopts synchronously, the system zeroes the pool, she primes on her first tick). */
    reset({ x = A.spawnX, facing = 1, hp = 100 } = {}) {
      ctx.enemies.length = 0;
      ctx.levels.current.pickups.length = 0; // a heart dropped by a kill roots her in a communion (player.recharge) and her abilities refuse
      ctx.projectiles.length = 0; // a Spark Bolt still in flight from the last test shocks the next one's foe
      const list = ctx.levels.current.mechanisms;
      for (const m of rk.mechs) { const at = list.indexOf(m); if (at >= 0) list.splice(at, 1); }
      rk.mechs.length = 0;
      ctx.levels.current.mechanismTriggers = undefined; // the trigger index is cached: rebuild it
      for (let y = 542; y < A.floorY; y++) for (let X = A.x0; X <= A.x1; X++) { const i = w.idx(X, y); if (w.types[i] !== 0) w.clearCellAt(i); else if (w.charge[i] > 0) w.clearChargeAt(i); /* a Spark Bolt leaves charge in empty air too */ }
      // A Spark Bolt leaves charge in the stone it hits; a charged floor electrifies (and hurts) whatever stands on it.
      for (let y = A.floorY; y <= A.floorY + 6; y++) for (let X = A.x0; X <= A.x1; X++) w.clearChargeAt(w.idx(X, y));
      // Burning wood throws Fire/Smoke cell-particles that land as cells a few ticks later: drop them (clear() pools them but leaves them listed).
      ctx.particles.clear?.();
      ctx.particles.list.length = 0;
      ctx.sparks?.clear();
      if (ctx.corpses?.list) ctx.corpses.list.length = 0; // a slime killed beside a fire keeps burning, and sheds Fire cells
      ctx.fx.hitstop = 0; ctx.fx.screenShake = 0;
      ctx.fighters.equip('rusk-emberjaw');
      Object.assign(p, { dead: false, hp, maxHp: hp, invuln: 0, crawling: false, climbing: false, swinging: false, x, y: A.floorY - 1, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, facing, staggerT: 0, recharge: 0, pullT: 0 });
      for (const k of Object.keys(p.status)) if (['wet', 'oiled', 'burning', 'frozen', 'electrified', 'stoneskin', 'swift', 'levity', 'regen', 'torch'].includes(k)) p.status[k] = 0; // (the run opens with a stoneskin that halves every blow: the armor sums would be wrong)
      for (const k of Object.keys(ctx.input.keys)) ctx.input.keys[k] = false;
      sfx.length = 0; callouts.length = 0;
      ctx.state.arrivalGraceUntil = 0;
      window.__fp.aimAt(x + (facing > 0 ? 100 : -100), A.floorY - 10);
      window.__fp.tick(2); // the facing follows the aim; she primes her pool on the first tick
    },
    /** Ticks with the world un-paused, so the mechanisms (which stand still while paused) update. */
    live(n) {
      ctx.state.paused = false;
      try { for (let i = 0; i < n; i++) window.__game.tick(false, { forcePaused: true }); } finally { ctx.state.paused = true; }
    },
    wall: (x0, y0, x1, y1, type) => { for (let y = y0; y <= y1; y++) for (let X = x0; X <= x1; X++) if (w.inBounds(X, y)) { const fn = window.__fp.colorOf?.(type); w.replaceCellAt(w.idx(X, y), type, fn ? fn() : 0x808080); } },
    count: (type, x0, y0, x1, y1) => window.__fp.count(type, x0, y0, x1, y1),
    armor: () => +ctx.fighters.armor.toFixed(2),
    foe: (i = 0) => { const e = ctx.enemies[i]; return e ? { x: e.x, y: e.y, hp: e.hp, burning: e.status.burning, knockT: e.knockT ?? 0, kvx: e.knockVx ?? 0 } : null; },
    stunUntil: (e) => ctx.fighters.enemyFx.get(e)?.stunUntil ?? 0,
    lights: () => (ctx.levels.current.authoredLights ?? []).length,
    fac,
  };
  window.__rk = rk;
  // The test level hangs vines and ropes through the arena and drops crates and barrels into it; the first
  // Ember a broken barricade throws sets them alight, and a burning crate sheds Fire cells long after the
  // test that lit it. Clear the whole volume (cells, bodies, strands) and close it with stone, so fire and
  // embers stay inside the box that reset() wipes.
  ctx.rigidBodies.clear();
  ctx.vineStrands.strands.length = 0;
  window.__fp.carve(A.x0, 542, A.x1, A.floorY - 1);
  window.__fp.wall(A.x0 - 6, 536, A.x0 - 1, A.floorY + 4);
  window.__fp.wall(A.x1 + 1, 536, A.x1 + 6, A.floorY + 4);
  window.__fp.wall(A.x0 - 6, 536, A.x1 + 6, 541);
  // colour makers for painted walls (the foundation module is safe to load a second time)
  const colors = await import('/src/sim/colors.ts');
  window.__fp.colorOf = (type) => colors.COLOR_FN[type];
});

const rk = (fn, arg) => page.evaluate(fn, arg);
const reset = (o) => page.evaluate((o) => window.__rk.reset(o), o ?? {});
const live = (n) => page.evaluate((n) => window.__rk.live(n), n);
const armor = () => page.evaluate(() => window.__rk.armor());
const frame = async (x, y, zoom = 3) => {
  await page.evaluate(({ x, y, zoom }) => { const c = window.__fp.ctx.camera; c.zoomLock = zoom; c.zoom = zoom; c.snapTo(x, y); }, { x, y, zoom });
  await page.waitForTimeout(260);
};
const sfxHas = (id) => page.evaluate((id) => window.__rk.sfx.includes(id), id);

// =======================================================================================================
console.log('\n-- Scrap Recovery (passive)');
await reset();
let v = await view(page);
check('equipped: the view names her abilities', v.id === 'rusk-emberjaw' && v.tactical.name === 'Shoulder Ram' && v.ultimate.name === 'Kiln Heart');
check('she starts with a full 40-point armor pool', v.armor === 40 && v.armorMax === 40, `${v.armor}/${v.armorMax}`);

// a kick kill (real F key) restores 14
await rk(() => { window.__fp.ctx.fighters.armor = 10; });
await tick(page, 1);
await rk(() => { window.__fp.spawn('slime', 12, { hp: 1 }); window.__fp.aimAt(452, 684); });
await tick(page, 1);
await press(page, 'KeyF', 3);
await tick(page, 2);
check('a KICK kill restores 14 armor (10 -> 24), at once', (await armor()) === 24 && (await rk(() => window.__fp.ctx.enemies.length)) === 0, `armor ${await armor()}`);
await tick(page, 6);
await frame(446, 681, 4);
await shot(page, 'rusk-scrap-recovery'); // the scrap in flight to her chest
await tick(page, 14);
check('...and the scrap lands with a clink and says so (+14 ARMOR)', (await rk(() => window.__rk.callouts.join('|'))).includes('+14 ARMOR') && (await sfxHas('body.impact.metal')));

// a kick kill is clamped to the ceiling
await rk(() => { window.__fp.ctx.enemies.length = 0; window.__fp.ctx.fighters.armor = 35; window.__fp.ctx.player.invuln = 0; });
await tick(page, 20);
await rk(() => { window.__fp.spawn('slime', 12, { hp: 1 }); window.__fp.aimAt(452, 684); });
await tick(page, 1);
await press(page, 'KeyF', 3);
await tick(page, 2);
check('the pool is clamped at 40 (35 + 14 -> 40)', (await armor()) === 40, `armor ${await armor()}`);

// a spell kill does NOT (the real wand, real fire)
await reset();
await rk(() => { window.__fp.ctx.fighters.armor = 10; window.__fp.spawn('slime', 22, { hp: 1 }); window.__fp.aimAt(462, 684); });
await tick(page, 2);
for (let i = 0; i < 40 && (await rk(() => window.__fp.ctx.enemies.length)) > 0; i++) {
  await rk(() => { const p = window.__fp.ctx.player; p.firing = true; p.firePressed = true; });
  await tick(page, 1);
}
await rk(() => { window.__fp.ctx.player.firing = false; });
check('a SPELL kill (Spark Bolt) restores nothing', (await rk(() => window.__fp.ctx.enemies.length)) === 0 && (await armor()) === 10, `armor ${await armor()}`);

// a blow that is melee but not the kill, with the kill landing later, does not count
await reset();
await rk(() => { window.__fp.ctx.fighters.armor = 10; window.__fp.spawn('slime', 12, { hp: 60 }); window.__fp.aimAt(452, 684); });
await tick(page, 1);
await press(page, 'KeyF', 3);
await tick(page, 6);
await rk(() => { const c = window.__fp.ctx; c.enemyCtl.damage(c.enemies[0], 999, 1, 0, 'direct'); });
await tick(page, 2);
check('a kill that is not the melee blow (6 ticks later) restores nothing', (await rk(() => window.__fp.ctx.enemies.length)) === 0 && (await armor()) === 10, `armor ${await armor()}`);

// the pool is the system's: armor absorbs before health
await reset();
await rk(() => { window.__fp.ctx.player.invuln = 0; window.__fp.ctx.playerCtl.damage(10, 0, 0, 'bat-bite'); });
let m = await me(page);
check('armor absorbs a blow before health (10 of 40 spent, hp untouched)', (await armor()) === 30 && m.hp === 100, `armor ${await armor()} hp ${m.hp}`);

// =======================================================================================================
console.log('\n-- Shoulder Ram (Z)');
// ---- the charge, a foe, i-frames, the cooldown
await reset();
const foe0 = await rk(() => { const e = window.__fp.spawn('slime', 25, { hp: 100 }); return { x: e.x, hp: e.hp }; });
await frame(462, 681, 4);
await shot(page, 'rusk-ram-0-ready');
const x0 = (await me(page)).x;
await press(page, 'KeyZ', 1);
check('Z runs the ram: the body is carried by the system', await rk(() => window.__fp.ctx.fighters.ownsMovement), 'ownsMovement');
check('her i-frames are up while she charges', (await me(page)).invuln > 0);
await rk(() => { window.__fp.ctx.playerCtl.damage(50, 0, 0, 'bat-bite'); });
check('a blow during the charge does nothing (invulnerable)', (await me(page)).hp === 100 && (await armor()) === 40);
// sample every tick from here: the charge, the foe flung, the stun
const samples = [];
const sample = () => rk(() => { const c = window.__fp.ctx, e = c.enemies[0], f = c.state.frameCount; return { f, own: c.fighters.ownsMovement, px: c.player.x, foe: e ? { x: e.x, hp: e.hp, kvx: e.knockVx ?? 0, kt: e.knockT ?? 0, u: window.__rk.stunUntil(e) } : null }; });
samples.push(await sample());
for (let i = 0; i < 80; i++) {
  await tick(page, 1);
  samples.push(await sample());
  if (i === 1) { await frame(462, 681, 4); await shot(page, 'rusk-ram-1-hit'); }
}
const ramEnd = samples.findIndex((q) => !q.own);
const px1 = samples[ramEnd].px;
check('the charge covers ~44 cells (8 ticks of 5.5)', px1 - x0 >= 42 && px1 - x0 <= 46, `moved ${px1 - x0}`);
check('...and ends on its own after 8 ticks', ramEnd >= 7 && ramEnd <= 9, `ticks ${ramEnd}`);
const last = samples[samples.length - 1].foe;
check('the foe took 16 damage', last && Math.abs((foe0.hp - last.hp) - 16) < 0.5, JSON.stringify(last));
const flungTo = samples.reduce((mx, q) => Math.max(mx, q.foe?.x ?? 0), 0);
check('the foe was flung ahead of her (shoved by gustShove)', flungTo > foe0.x + 12, `x ${foe0.x} -> ${flungTo}`);
const stunTicks = samples.filter((q) => q.foe && q.foe.u > q.f);
const stillX = stunTicks.every((q) => q.foe.x === stunTicks[0].foe.x);
const pinned = stillX && stunTicks.slice(1).every((q) => q.foe.kvx === 0); // (from the tick after it begins: the first pin lands next tick)
const stunAt = samples.findIndex((q) => q.foe && q.foe.u > q.f);
const hitAt = samples.findIndex((q) => q.foe && q.foe.hp < foe0.hp);
check('then stunned for 20 ticks, once the shove has carried: it does not move', stunTicks.length >= 19 && stunTicks.length <= 21 && pinned && stunAt >= hitAt + 3, `stunned ${stunTicks.length} ticks, pinned ${pinned}, hit at tick ${hitAt}, stun from tick ${stunAt}`);
v = await view(page);
check('the cooldown is spent (9 s) and the chip says so', v.tactical.ready === false && v.tactical.cooldownSeconds >= 8, JSON.stringify(v.tactical));
check('the ram sounded (launch, impact)', (await sfxHas('player.dive')) && (await sfxHas('body.bash')));
await tick(page, 540);
check('the cooldown runs out after 540 ticks', (await view(page)).tactical.ready === true);

// ---- a ram kill is a melee kill
await reset();
await rk(() => { window.__fp.ctx.fighters.armor = 10; window.__fp.spawn('slime', 20, { hp: 10 }); });
await tick(page, 1);
await press(page, 'KeyZ', 1);
await tick(page, 8);
check('a ram KILL restores 14 armor (10 -> 24)', (await rk(() => window.__fp.ctx.enemies.length)) === 0 && (await armor()) === 24, `armor ${await armor()}`);

// ---- a small foe the ram flings into a wall dies of the slam, and that is her kill too
await reset();
await rk(() => { window.__fp.ctx.fighters.armor = 10; window.__rk.wall(490, 640, 496, 689, window.__fp.Cell.Stone); window.__fp.spawn('bat', 25, { hp: 60 }); });
await tick(page, 1);
await press(page, 'KeyZ', 1);
await tick(page, 8);
check('a bat flung by the ram into a wall is slammed dead, and she recovers 14 armor (10 -> 24)', (await rk(() => window.__fp.ctx.enemies.length)) === 0 && (await armor()) === 24, `armor ${await armor()}`);

// ---- refusals
await reset();
await press(page, 'KeyZ', 1);
await tick(page, 12);
const used = (await view(page)).tactical.usedAt;
await press(page, 'KeyZ', 1);
await tick(page, 2);
v = await view(page);
check('pressed again while cooling down: refused, no second charge', v.tactical.usedAt === used && v.tactical.refusedAt > used && !(await rk(() => window.__fp.ctx.fighters.ownsMovement)));
// no room: flush against a stone wall
await reset();
await rk(() => { const x = window.__fp.ctx.player.x; window.__rk.wall(Math.round(x) + 5, 640, Math.round(x) + 12, 689, window.__fp.Cell.Stone); });
const flushBefore = (await view(page)).tactical;
await press(page, 'KeyZ', 1);
await tick(page, 2);
v = await view(page);
check('flush against a stone wall: refused, no cooldown spent', v.tactical.ready === true && v.tactical.refusedAt > flushBefore.refusedAt && v.tactical.usedAt === flushBefore.usedAt && !(await rk(() => window.__fp.ctx.fighters.ownsMovement)), JSON.stringify(v.tactical));
// ...but flush against breakable wood she may charge
await reset();
await rk(() => { const x = window.__fp.ctx.player.x; window.__rk.wall(Math.round(x) + 5, 640, Math.round(x) + 12, 689, window.__fp.Cell.Wood); });
const woodFlushBefore = (await view(page)).tactical;
await press(page, 'KeyZ', 1);
await tick(page, 2);
check('flush against a WOOD wall she may charge (it breaks)', (await view(page)).tactical.usedAt > woodFlushBefore.usedAt);

// ---- Wood in the path is broken
await reset();
await rk(() => window.__rk.wall(470, 660, 479, 689, window.__fp.Cell.Wood));
const woodBefore = await rk(() => window.__rk.count(window.__fp.Cell.Wood, 470, 660, 479, 689));
await frame(470, 678, 3);
await shot(page, 'rusk-wood-0-before');
await press(page, 'KeyZ', 1);
await tick(page, 3);
await frame(472, 678, 3);
await shot(page, 'rusk-wood-1-breaking');
await tick(page, 6);
await frame(478, 678, 3);
await shot(page, 'rusk-wood-2-after');
const body = await rk(() => ({ wood: window.__rk.count(window.__fp.Cell.Wood, 470, 672, 479, 689), woodAbove: window.__rk.count(window.__fp.Cell.Wood, 470, 660, 479, 671), ember: window.__rk.count(window.__fp.Cell.Ember, 462, 640, 500, 695), x: window.__fp.ctx.player.x }));
check('every Wood cell in her path is gone (rows she fills, 10 thick)', woodBefore === 300 && body.wood === 0, JSON.stringify(body));
check('...part of it became real Ember cells', body.ember >= 20, `ember ${body.ember}`);
check('...what is above her head is left standing', body.woodAbove > 0, `above ${body.woodAbove}`);
check('she passed through to the far side', body.x > 480, `x ${body.x}`);
check('the wood sounded as it broke', await sfxHas('body.smash.wood'));

// ---- a Wood barricade (a plug) fires and opens its gate: fail-open
await reset();
const chain = await rk(() => {
  const { fac } = window.__rk, c = window.__fp.ctx, list = c.levels.current.mechanisms, Cell = window.__fp.Cell;
  const door = fac.makeDoor(c, list, 530, 660, 4, 30);
  const plug = fac.makePlug(c.world, list, 470, 660, 10, 30, Cell.Wood, door, 0.5);
  window.__rk.mechs.push(door, plug);
  c.levels.current.mechanismTriggers = undefined;
  return { door: door.id, plug: plug.id, metal: window.__fp.count(Cell.Metal, 530, 660, 533, 689) };
});
await press(page, 'KeyZ', 1);
await tick(page, 8);
await live(60);
const gate = await rk(() => {
  const list = window.__fp.ctx.levels.current.mechanisms, Cell = window.__fp.Cell;
  const door = list.find((m) => m.kind === 'door'), plug = list.find((m) => m.kind === 'plug');
  return { plug: plug.state, door: door.state, metal: window.__fp.count(Cell.Metal, 530, 660, 533, 689), wood: window.__fp.count(Cell.Wood, 470, 660, 479, 689) };
});
check('the closed door is solid before (4x30 Metal)', chain.metal === 120, JSON.stringify(chain));
check('the ram broke the barricade: its plug FIRED', gate.plug === 1, JSON.stringify(gate));
check('...and the gate it holds OPENED (door state 1, every Metal cell gone)', gate.door === 1 && gate.metal === 0, JSON.stringify(gate));

// ---- Metal is a wall: a thump, no hole, a rebound
await reset();
await rk(() => window.__rk.wall(470, 660, 475, 689, window.__fp.Cell.Metal));
const metalBefore = await rk(() => window.__rk.count(window.__fp.Cell.Metal, 470, 660, 475, 689));
await press(page, 'KeyZ', 1);
await tick(page, 5);
await frame(462, 681, 4);
await shot(page, 'rusk-metal-thump');
await tick(page, 6);
m = await me(page);
const metalAfter = await rk(() => window.__rk.count(window.__fp.Cell.Metal, 470, 660, 475, 689));
check('a Metal wall stops the ram: no hole (180 cells before and after)', metalBefore === 180 && metalAfter === 180, `${metalBefore} -> ${metalAfter}`);
check('she stopped at the wall (x <= 466) and the charge ended early', m.x <= 466 && m.x >= 462 && !(await rk(() => window.__fp.ctx.fighters.ownsMovement)), `x ${m.x}`);
check('...with a metal thump, a screen shake and a hard landing', (await sfxHas('body.impact.metal')) && (await sfxHas('player.land.hard')) && (await rk(() => window.__fp.ctx.fx.screenShake)) > 0);
check('...and she rebounds off it (vx <= 0)', m.vx <= 0.01, `vx ${m.vx}`);
// stone sounds like stone
await reset();
await rk(() => window.__rk.wall(470, 660, 475, 689, window.__fp.Cell.Stone));
await press(page, 'KeyZ', 1);
await tick(page, 10);
check('a stone wall thumps as stone and is not broken', (await sfxHas('body.impact.stone')) && (await rk(() => window.__rk.count(window.__fp.Cell.Stone, 470, 660, 475, 689))) === 180);

// ---- the concussion: a lever by the wall is struck (once), one she merely runs past is not
await reset();
const lever = await rk(() => {
  const { fac } = window.__rk, c = window.__fp.ctx, list = c.levels.current.mechanisms, Cell = window.__fp.Cell;
  const door = fac.makeDoor(c, list, 560, 660, 4, 30);
  window.__rk.wall(470, 660, 475, 689, Cell.Metal);
  const near = fac.makeLever(list, 464, 689, door);   // beside the wall she will hit
  const past = fac.makeLever(list, 452, 689, door);   // on her way: she runs by it
  const far = fac.makeLever(list, 520, 689, door);    // 45 cells beyond the wall: out of reach
  window.__rk.mechs.push(door, near, past, far);
  c.levels.current.mechanismTriggers = undefined;
  return { near: near.id, past: past.id, far: far.id };
});
await press(page, 'KeyZ', 1);
await tick(page, 12);
const levers = await rk((ids) => { const list = window.__fp.ctx.levels.current.mechanisms; const by = (id) => list.find((m) => m.id === id).state; return { near: by(ids.near), past: by(ids.past), far: by(ids.far) }; }, lever);
check('the thump flips the lever bolted beside the wall (struck once)', levers.near === 1, JSON.stringify(levers));
check('a lever she only runs past is left alone, as is one out of reach', levers.past === 0 && levers.far === 0, JSON.stringify(levers));

// ---- a ledge she can step up (<= 5 cells) is climbed; the shoulder does not reach through rock
await reset();
await rk(() => window.__rk.wall(470, 687, 479, 689, window.__fp.Cell.Stone));
await press(page, 'KeyZ', 1);
await tick(page, 10);
m = await me(page);
check('a 3-cell ledge is stepped up, not a wall: she ends on top of it, past it', m.x > 479 - 4 && m.y <= 687, `x ${m.x} y ${m.y}`);
await reset();
const sheltered = await rk(() => { window.__rk.wall(446, 660, 446, 689, window.__fp.Cell.Stone); const e = window.__fp.spawn('slime', 12, { hp: 100 }); return e.hp; });
await tick(page, 1);
await press(page, 'KeyZ', 1);
await tick(page, 10);
check('a foe on the far side of a wall is spared (the shoulder does not reach through rock)', (await rk(() => window.__rk.foe()?.hp)) === sheltered);

// ---- leftward, and in the air
await reset({ x: 560, facing: -1 });
await rk(() => { window.__fp.aimAt(400, 680); window.__fp.spawn('slime', -25, { hp: 100 }); });
await tick(page, 1);
await press(page, 'KeyZ', 1);
await tick(page, 9);
m = await me(page);
const foeL = await rk(() => window.__rk.foe());
check('she charges to the LEFT when facing left, and hurts the foe there', m.x < 560 - 42 && foeL && foeL.hp < 100, `x ${m.x} foe ${JSON.stringify(foeL)}`);

// =======================================================================================================
console.log('\n-- Kiln Heart (T)');
await reset();
const notFullBefore = (await view(page)).ultimate;
await press(page, 'KeyT', 1);
await tick(page, 2);
v = await view(page);
check('bar not full: T is refused, nothing starts', v.ultimate.refusedAt > notFullBefore.refusedAt && v.ultimate.active === 0 && v.armorMax === 40, JSON.stringify(v.ultimate));
await rk(() => window.__fp.ctx.fighters.refill());
const lightsBefore = await rk(() => window.__rk.lights());
await frame(440, 681, 4);
await shot(page, 'rusk-kiln-0-before');
await press(page, 'KeyT', 1);
await tick(page, 3);
await frame(440, 681, 4);
await shot(page, 'rusk-kiln-1-ignite');
await tick(page, 20);
await frame(440, 681, 4);
await shot(page, 'rusk-kiln-2-burning');
v = await view(page);
check('T runs the ultimate once the bar is full', v.ultimate.active > 0.9, JSON.stringify(v.ultimate));
check('armor ceiling raised to 80 and FILLED', v.armorMax === 80 && v.armor === 80, `${v.armor}/${v.armorMax}`);
check('her furnace core blazes: lights were added to the level', (await rk(() => window.__rk.lights())) >= lightsBefore + 1, `${lightsBefore} -> ${await rk(() => window.__rk.lights())}`);
check('Kiln Heart sounded', await sfxHas('spell.emberstorm'));
const againBefore = (await view(page)).ultimate;
await press(page, 'KeyT', 1);
await tick(page, 1);
check('T again while it burns: refused', (await view(page)).ultimate.refusedAt > againBefore.refusedAt);

// damage taken x0.8
await rk(() => { const c = window.__fp.ctx; c.fighters.armor = 0; c.player.invuln = 0; c.playerCtl.damage(10, 0, 0, 'bat-bite'); });
check('damage taken is x0.8 (10 -> 8)', Math.abs((await me(page)).hp - 92) < 0.01, `hp ${(await me(page)).hp}`);
await rk(() => { window.__fp.ctx.fighters.armor = 80; });
await tick(page, 1);

// ---- the ember burst: a close foe, a blow the ARMOR swallows
await rk(() => { const c = window.__fp.ctx; c.player.invuln = 0; window.__fp.spawn('slime', 12, { hp: 100 }); c.player.hp = 100; });
await tick(page, 25);
const emberBefore = await rk(() => window.__fp.count(window.__fp.Cell.Ember, 400, 640, 480, 695));
const foeBefore = await rk(() => window.__rk.foe());
await rk(() => { const c = window.__fp.ctx; c.player.invuln = 0; c.playerCtl.damage(5, 0, 0, 'slime-bite'); });
await tick(page, 2);
await frame(446, 681, 4);
await shot(page, 'rusk-kiln-3-burst');
const emberAfter = await rk(() => window.__fp.count(window.__fp.Cell.Ember, 400, 640, 480, 695));
const foeAfter = await rk(() => window.__rk.foe());
const hpNow = (await me(page)).hp;
check('the blow was swallowed by the armor (hp untouched)', hpNow === 100, `hp ${hpNow}`);
check('...and the furnace vented REAL Ember cells around her', emberAfter - emberBefore >= 4, `ember ${emberBefore} -> ${emberAfter}`);
check('...the foe within 16 took 6 (and a little burn)', foeAfter && foeBefore.hp - foeAfter.hp >= 5.99 && foeBefore.hp - foeAfter.hp <= 7.5, `${foeBefore?.hp} -> ${foeAfter?.hp}`);
check('...and caught fire', foeAfter && foeAfter.burning > 100, `burning ${foeAfter?.burning}`);
// (the 20-tick guard on a second vent is exercised in tests/fighters-rusk.test.ts: a blow's own i-frames last 30)
// a hazard does not vent
await rk(() => { const c = window.__fp.ctx; c.enemies.length = 0; window.__fp.spawn('slime', 10, { hp: 100 }); c.player.invuln = 0; });
await tick(page, 40);
const quietBefore = await rk(() => ({ e: window.__fp.count(window.__fp.Cell.Ember, 400, 640, 480, 695), hp: window.__rk.foe().hp }));
await rk(() => { const c = window.__fp.ctx; c.player.invuln = 0; c.playerCtl.damage(5, 0, 0, 'fire'); });
await tick(page, 2);
const quietAfter = await rk(() => ({ e: window.__fp.count(window.__fp.Cell.Ember, 400, 640, 480, 695), hp: window.__rk.foe().hp }));
check('a hazard (fire) near a foe does not vent the furnace', quietAfter.hp === quietBefore.hp && quietAfter.e <= quietBefore.e, JSON.stringify({ quietBefore, quietAfter }));
// out of range: a foe 60 cells away
await rk(() => { const c = window.__fp.ctx; c.enemies.length = 0; window.__fp.spawn('slime', 60, { hp: 100 }).sleeping = true; c.player.invuln = 0; }); // asleep: a slime awake would wander in to see the glow
await tick(page, 40);
const farBefore = await rk(() => ({ e: window.__fp.count(window.__fp.Cell.Ember, 400, 640, 500, 695), hp: window.__rk.foe().hp }));
await rk(() => { const c = window.__fp.ctx; c.player.invuln = 0; c.playerCtl.damage(5, 0, 0, 'slime-bite'); });
await tick(page, 2);
const farAfter = await rk(() => ({ e: window.__fp.count(window.__fp.Cell.Ember, 400, 640, 500, 695), hp: window.__rk.foe().hp }));
check('a blow with no foe within 20 cells does not vent', farAfter.hp === farBefore.hp && farAfter.e <= farBefore.e, JSON.stringify({ farBefore, farAfter }));
// a fireproof foe takes the burst's blow but does not catch fire
await rk(() => { window.__fp.ctx.enemies.length = 0; });
await tick(page, 25); // (let the previous vent's 20-tick guard lapse before the imp, which flies off if left alone, is spawned)
await rk(() => { const c = window.__fp.ctx; window.__fp.spawn('imp', 12, { hp: 60 }); c.player.invuln = 0; c.player.hp = 100; });
await tick(page, 1);
await rk(() => { const c = window.__fp.ctx; c.player.invuln = 0; c.playerCtl.damage(5, 0, 0, 'imp-bolt'); });
await tick(page, 2);
const imp = await rk(() => window.__rk.foe());
check('a fireproof foe (imp) takes the 6 but does not burn', imp && imp.hp <= 54.01 && imp.burning === 0, JSON.stringify(imp));

// ---- the end: the ceiling returns to 40 and the pool is clamped
await rk(() => { const c = window.__fp.ctx; c.enemies.length = 0; c.fighters.armor = 63; });
for (let i = 0; i < 80 && (await view(page)).ultimate.active > 0.07; i++) await live(10);
v = await view(page);
await frame(440, 681, 4);
await shot(page, 'rusk-kiln-4-cooling');
check('still burning near the end (<= 40 ticks left)', v.ultimate.active > 0 && v.ultimate.active < 0.1 && v.armorMax === 80, JSON.stringify(v.ultimate));
await live(60);
v = await view(page);
check('it ends on its own clock; the ceiling is back to 40', v.ultimate.active === 0 && v.armorMax === 40, `armorMax ${v.armorMax}`);
check('...and the 63 she carried is clamped to 40', v.armor === 40, `armor ${v.armor}`);
await rk(() => { const c = window.__fp.ctx; c.player.invuln = 0; c.fighters.armor = 0; c.player.hp = 100; c.playerCtl.damage(10, 0, 0, 'bat-bite'); });
check('damage taken is back to x1 (10 -> 10)', Math.abs((await me(page)).hp - 90) < 0.01, `hp ${(await me(page)).hp}`);
check('the furnace light is gone again', (await rk(() => window.__rk.lights())) === lightsBefore, `${await rk(() => window.__rk.lights())} vs ${lightsBefore}`);
check('it cooled with a hiss', (await rk(() => window.__rk.callouts.join('|'))).includes('HEART COOLS'));

// ---- a fresh start gives a full pool; the pool is saved and restored
await rk(() => { window.__fp.ctx.fighters.armor = 12; });
const snap = await rk(() => JSON.parse(JSON.stringify(window.__fp.ctx.fighters.snapshot())));
await rk(() => { const f = window.__fp.ctx.fighters; f.equip(null); });
await tick(page, 2);
await rk((s) => { window.__fp.ctx.fighters.restore(s); }, snap);
await tick(page, 2);
v = await view(page);
check('a saved run restores the pool (12/40), it is not refilled', v.id === 'rusk-emberjaw' && v.armor === 12 && v.armorMax === 40, `${v.armor}/${v.armorMax}`);
await rk(() => { window.__fp.ctx.events.emit('playerRespawned'); });
await tick(page, 2);
check('a respawn is a fresh start: the pool is full again', (await view(page)).armor === 40, `armor ${(await view(page)).armor}`);

const errors = await finish();
check('no page errors', errors === 0);
console.log(`\nrusk emberjaw probe: ${tally.pass} passed, ${tally.fail} failed`);
process.exit(tally.fail ? 1 : 0);

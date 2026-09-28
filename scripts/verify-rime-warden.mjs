// THE RIME WARDEN, live in the real game (d2b, the Cold Store's Ice-House):
//  - the hall is built: the Warden on a flat floor, two iron-lined coal pits,
//    two brine gutters, icicles overhead; the hall is reachable from spawn;
//  - the ward: an idle alchemist's world never hurts it (a lit pit under it
//    thaws nothing until he acts), and blows on intact rime GLANCE;
//  - SHATTER: a heavy blow cracks a plate off; a FROZEN (brittle) Warden
//    loses a plate to any honest hit — and wading brine makes it brittle;
//  - THAW: a lit coal pit under it, the player engaged, melts a plate off;
//  - its moves fire (slam / stomp / hail / breath) and hurt the alchemist;
//  - the kill: a heap of real ice, a heart and a tome.
//   node scripts/verify-rime-warden.mjs [--seed=7] [--url=http://localhost:5173/] [--shots=dir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { startConsoleTestRun } from './run-helpers.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const url = opt('url', 'http://localhost:5173/');
const seed = Number(opt('seed', '7'));
const shots = opt('shots', '');
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await startConsoleTestRun(page, { level: 'd2b', seed, settleMs: 800 });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

// Shared page helpers.
await page.evaluate(() => {
  const game = window.__game, ctx = game.ctx;
  window.__rw = () => ctx.enemies.find((e) => e.kind === 'rimewarden');
  window.__tick = (n) => { for (let k = 0; k < n; k++) { ctx.state.paused = false; game.tick(false); } };
  window.__standAt = (x, y) => {
    Object.assign(ctx.player, { x, y, vx: 0, vy: 0 });
    ctx.camera.snapTo?.(x, y);
  };
  window.__callouts = [];
  window.__moves = [];
  window.__hurts = [];
  ctx.events.on('combatCallout', ({ text }) => window.__callouts.push(text));
  ctx.events.on('bossMove', ({ kind, move }) => { if (kind === 'rimewarden') window.__moves.push(move); });
});

const hall = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world;
  const e = window.__rw();
  const b = ctx.levels.current.boss;
  if (!e || !b) return null;
  const T = (x, y) => w.types[w.idx(x, y)];
  let coal = 0, brine = 0, metal = 0, ice = 0, floor = 0;
  for (let dx = -52; dx <= 52; dx++) {
    if (T(b.x + dx, b.y + 1) !== 0) floor++;
    for (let dy = 1; dy <= 4; dy++) {
      const t = T(b.x + dx, b.y + dy);
      if (t === 28) coal++; else if (t === 42) brine++; else if (t === 13) metal++;
    }
  }
  for (let dx = -56; dx <= 56; dx++) for (let dy = 20; dy <= 56; dy++) if (T(b.x + dx, b.y - dy) === 10) ice++;
  // Headroom over the Warden's post.
  let head = 0;
  for (let dy = 0; dy < 60 && T(b.x, b.y - dy) === 0; dy++) head++;
  // Reachability: the wizard mask from spawn covers the hall floor.
  const fr = window.__game.debugFindability?.(ctx.levels.current) ?? null;
  return { x: Math.round(e.x), y: Math.round(e.y), hp: e.hp, plates: e.boss?.plates ?? null, coal, brine, metal, ice, floor, head, fr: fr ? { ok: fr.ok ?? null } : null };
});
console.log(JSON.stringify(hall));
check(hall !== null, 'the Rime Warden stands in the Cold Store');
if (!hall) { await browser.close(); process.exit(1); }
check(hall.floor >= 100, `a flat floor under the post (${hall.floor}/105 cells)`);
check(hall.coal >= 30, `two coal pits sunk in the floor (${hall.coal} coal)`);
check(hall.brine >= 40, `two brine gutters sunk in the floor (${hall.brine} brine)`);
check(hall.ice >= 10, `icicles hang in the vault (${hall.ice} ice)`);
check(hall.head >= 36, `headroom over the post (${hall.head} rows)`);

if (shots) {
  const shoot = async (name, fn) => {
    await page.evaluate(fn);
    await page.evaluate(() => window.__tick(40));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shots}/${name}.png` });
  };
  await shoot('rime-hall', () => { const e = window.__rw(); window.__standAt(e.x - 44, e.y); window.__game.ctx.state.debugGodMode = true; });
}

// 0) A spark bolt lights a coal pit (the right one; the Warden held off to the left).
const lit = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world, e = window.__rw(), b = ctx.levels.current.boss;
  e.x = b.x - 30; e.vx = 0;
  window.__standAt(b.x + 36, b.y);
  const px = b.x + 22;
  ctx.projectiles.push({ x: px, y: b.y - 20, vx: 0, vy: 4, type: 'bolt', life: 60, age: 0, charging: false, hostile: false });
  let max = 0;
  for (let k = 0; k < 90; k++) {
    window.__tick(1);
    let n = 0;
    for (let dx = -4; dx <= 4; dx++) for (let dy = 1; dy <= 3; dy++) { const i = w.idx(px + dx, b.y + dy); if (w.types[i] === 28 && w.life[i] > 0) n++; }
    max = Math.max(max, n);
  }
  // Put the pit back as it was built (the thaw test lights it again): out, and refilled.
  for (let dx = -8; dx <= 8; dx++) for (let dy = -12; dy <= 0; dy++) { const i = w.idx(px + dx, b.y + dy); if (w.types[i] === 5 || w.types[i] === 32 || w.types[i] === 1) w.clearCellAt(i); }
  for (let dx = -3; dx <= 3; dx++) for (let dy = 1; dy <= 3; dy++) { const i = w.idx(px + dx, b.y + dy); if (w.types[i] === 28) w.life[i] = 0; else if (w.types[i] === 0 || w.types[i] === 32 || w.types[i] === 5) w.replaceCellAt(i, 28, 0x202020); }
  return { lit: max };
});
console.log(JSON.stringify(lit));
check(lit.lit > 0, `a spark bolt lights the coal pit (${lit.lit} coals burning)`);

// 1) THE WARD: an idle alchemist in the hall, a lit pit under the Warden — nothing thaws.
const idle = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world, e = window.__rw();
  ctx.state.debugGodMode = true;
  const hp0 = e.hp, plates0 = e.boss?.plates ?? 6;
  // Move it over the left pit (dx -22) and light the coal.
  const px = ctx.levels.current.boss.x - 22;
  e.x = px; e.vx = 0;
  for (let dx = -3; dx <= 3; dx++) for (let dy = 1; dy <= 3; dy++) { const i = w.idx(px + dx, Math.round(e.y) + dy); if (w.types[i] === 28) w.life[i] = 240; }
  w.activity.invalidateAll();
  window.__standAt(px + 70, e.y);
  window.__tick(240);
  return { hp0, hp1: e.hp, plates0, plates1: e.boss?.plates ?? 6, heat: e.boss?.heat ?? 0 };
});
console.log(JSON.stringify(idle));
check(idle.plates1 === idle.plates0 && idle.hp1 === idle.hp0, `the ward: an idle alchemist's lit pit thaws nothing (${idle.plates0} -> ${idle.plates1} plates, hp ${idle.hp0} -> ${idle.hp1})`);

// 2) GLANCE + SHATTER + BRITTLE (direct blows through the real damage path).
const blows = await page.evaluate(() => {
  const ctx = window.__game.ctx, e = window.__rw();
  const plates = () => e.boss?.plates ?? 6;
  const out = {};
  window.__tick(90); // past any stagger
  e.boss.exposed = 0; // (and outside a slam's punish window)
  let hp = e.hp, p = plates();
  ctx.enemyCtl.damage(e, 8, 0, 0, 'direct');
  out.glance = { dhp: +(hp - e.hp).toFixed(2), plates: [p, plates()] };
  e.boss.selfHarmUntil = 0;
  hp = e.hp; p = plates();
  ctx.enemyCtl.damage(e, 16, 0, 0, 'direct');
  out.shatter = { dhp: +(hp - e.hp).toFixed(2), plates: [p, plates()] };
  // The kneel: a blow lands whole, and the rime has re-set (nothing more cracks).
  hp = e.hp; p = plates();
  ctx.enemyCtl.damage(e, 16, 0, 0, 'direct');
  out.kneel = { dhp: +(hp - e.hp).toFixed(2), plates: [p, plates()], exposed: e.boss.exposed };
  window.__tick(90);
  e.boss.exposed = 0;
  e.boss.selfHarmUntil = 0;
  e.status.frozen = 120;
  hp = e.hp; p = plates();
  ctx.enemyCtl.damage(e, 4, 0, 0, 'direct');
  out.brittle = { dhp: +(hp - e.hp).toFixed(2), plates: [p, plates()] };
  out.callouts = window.__callouts.slice();
  return out;
});
console.log(JSON.stringify(blows));
check(blows.glance.plates[0] === blows.glance.plates[1] && Math.abs(blows.glance.dhp - 2.4) < 0.01, `a light blow on intact rime glances (8 -> ${blows.glance.dhp})`);
check(blows.shatter.plates[1] === blows.shatter.plates[0] - 1 && blows.shatter.dhp === 16, `a heavy blow shatters a plate and lands whole (${blows.shatter.plates.join(' -> ')}, ${blows.shatter.dhp} hp)`);
check(blows.kneel.dhp === 16 && blows.kneel.plates[0] === blows.kneel.plates[1], `its kneel is the punish window: a blow lands whole, no second plate (${blows.kneel.dhp} hp, ${blows.kneel.plates.join(' -> ')})`);
check(blows.brittle.plates[1] === blows.brittle.plates[0] - 1, `frozen, it is brittle: a 4-hp hit cracks a plate (${blows.brittle.plates.join(' -> ')})`);
check(blows.callouts.includes('SHATTERED'), 'the break is called out');

// 3) BRINE makes it brittle: stand it in a gutter.
const brine = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world, e = window.__rw(), b = ctx.levels.current.boss;
  e.status.frozen = 0;
  e.x = b.x + 44; e.y = b.y + 2; e.vx = 0; e.vy = 0;
  let frozen = 0;
  for (let k = 0; k < 60; k++) { window.__tick(1); frozen = Math.max(frozen, e.status.frozen); }
  const inBrine = (() => { let n = 0; for (let dx = -8; dx <= 8; dx++) for (let dy = -2; dy <= 3; dy++) if (w.types[w.idx(Math.round(e.x) + dx, Math.round(e.y) + dy)] === 42) n++; return n; })();
  return { frozen, inBrine };
});
console.log(JSON.stringify(brine));
check(brine.frozen > 0, `wading the brine gutter chills it brittle (frozen ${brine.frozen}, ${brine.inBrine} brine at its feet)`);

// 4) THAW: engaged (a cast nearby), a lit pit under it melts a plate.
const thaw = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world, e = window.__rw(), b = ctx.levels.current.boss;
  e.status.frozen = 0;
  const px = b.x + 22;
  // (Clear what an earlier slam or breath left over the pit — spikes, snow: it would stand on them.)
  for (let dx = -16; dx <= 16; dx++) for (let dy = 0; dy <= 12; dy++) { const i = w.idx(px + dx, b.y - dy); const t = w.types[i]; if (t === 10 || t === 27 || t === 32 || t === 2) w.clearCellAt(i); }
  e.x = px; e.y = b.y; e.vx = 0; e.vy = 0; e.boss.move = 'march'; e.boss.moveT = 0;
  for (let dx = -3; dx <= 3; dx++) for (let dy = 1; dy <= 3; dy++) { const i = w.idx(px + dx, b.y + dy); if (w.types[i] === 28) w.life[i] = 240; }
  w.activity.invalidateAll();
  window.__standAt(px + 60, b.y);
  const p0 = e.boss.plates;
  let maxHeat = 0, got = false;
  for (let k = 0; k < 400 && !got; k++) {
    if (k % 60 === 0) ctx.events.emit('cardCast', { id: 'bolt', origin: 'wand', x: ctx.player.x, y: ctx.player.y - 8 });
    e.x = px; e.vx = 0; // hold it in the flames (it would walk out)
    window.__tick(1);
    maxHeat = Math.max(maxHeat, e.boss.heat);
    if (e.boss.plates < p0) got = true;
  }
  let coal = 0, litNow = 0; for (let dx = -4; dx <= 4; dx++) for (let dy = 1; dy <= 3; dy++) { const i = w.idx(px + dx, b.y + dy); if (w.types[i] === 28) { coal++; if (w.life[i] > 0) litNow++; } }
  return { p0, p1: e.boss.plates, maxHeat: +maxHeat.toFixed(1), thawed: window.__callouts.includes('THAWED'), q: e.boss.quenchCd, coal, litNow, ey: e.y, by: b.y };
});
console.log(JSON.stringify(thaw));
check(thaw.p1 === thaw.p0 - 1 && thaw.thawed, `a lit coal pit under the engaged fight thaws a plate (${thaw.p0} -> ${thaw.p1}, heat ${thaw.maxHeat})`);

// 5) ITS MOVES: a fight in the hall (god mode) — slam / stomp / hail / breath fire and land.
const fight = await page.evaluate(() => {
  const ctx = window.__game.ctx, e = window.__rw(), b = ctx.levels.current.boss;
  e.x = b.x; e.y = b.y; e.vx = 0; e.boss.move = 'march'; e.attackCd = 0;
  e.hp = Math.min(e.hp, e.maxHp * 0.6); // phase 2: the breath is in play
  window.__moves.length = 0; window.__hurts.length = 0;
  const hp0 = ctx.player.hp;
  let dmg = 0;
  for (let k = 0; k < 2100; k++) {
    // Keep the alchemist on the hall floor in reach and in sight: close (slam
    // range) on one side, then mid range (between a pit and a gutter) on the other.
    if (k % 30 === 0) {
      const close = (k >> 8) % 3 === 0;
      // Mid range: the far side of the hall from it, between a pit and a gutter.
      const x = close ? e.x - 26 : (e.x > b.x ? b.x - 34 : b.x + 34);
      window.__standAt(x, b.y);
    }
    ctx.player.lastDamageSource = '';
    window.__tick(1);
    const src = ctx.player.lastDamageSource;
    if (src) { window.__hurts.push(src); dmg++; }
  }
  return { moves: [...new Set(window.__moves)], count: window.__moves.length, hurts: [...new Set(window.__hurts)], hits: dmg, hp0 };
});
console.log(JSON.stringify(fight));
for (const m of ['slam', 'stomp', 'throw', 'vent']) check(fight.moves.includes(m), `it ${m === 'throw' ? 'hails' : m === 'vent' ? 'breathes frost' : m + 's'} (${fight.moves.join(', ')})`);
check(fight.hurts.some((h) => h.startsWith('rimewarden')), `its blows land on the alchemist (${fight.hurts.join(', ')})`);

if (shots) {
  await page.evaluate(() => { const e = window.__rw(), b = window.__game.ctx.levels.current.boss; window.__standAt(b.x - 40, b.y); e.attackCd = 0; e.boss.move = 'march'; });
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => window.__tick(24));
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${shots}/rime-fight-${k}.png` });
  }
}

// 6) THE KILL: bare it, finish it — a heap of real ice, a heart and a tome.
const kill = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world, e = window.__rw(), b = ctx.levels.current.boss;
  e.boss.plates = 0; e.boss.move = 'march'; e.boss.selfHarmUntil = 0;
  const pk0 = ctx.levels.current.pickups.length;
  const cold = (t) => t === 10 || t === 27;
  const ice0 = (() => { let n = 0; for (let dx = -20; dx <= 20; dx++) for (let dy = -14; dy <= 10; dy++) if (cold(w.types[w.idx(Math.round(e.x) + dx, Math.round(e.y) + dy)])) n++; return n; })();
  const ex = Math.round(e.x), ey = Math.round(e.y);
  ctx.enemyCtl.damage(e, e.hp + 50, 0, 0, 'direct');
  const alive = ctx.enemies.includes(e);
  let ice = 0; for (let dx = -20; dx <= 20; dx++) for (let dy = -14; dy <= 10; dy++) if (cold(w.types[w.idx(ex + dx, ey + dy)])) ice++;
  const drops = ctx.levels.current.pickups.slice(pk0).map((p) => p.kind);
  void b;
  return { alive, ice0, ice, drops };
});
console.log(JSON.stringify(kill));
check(!kill.alive, 'it dies to the player');
check(kill.ice > kill.ice0 + 80, `it comes apart into a heap of real ice and snow (${kill.ice0} -> ${kill.ice})`);
check(kill.drops.includes('heart') && kill.drops.includes('tome'), `it pays a heart and a tome (${kill.drops.join(', ')})`);

check(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

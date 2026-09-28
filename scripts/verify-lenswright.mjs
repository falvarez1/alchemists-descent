// THE LENSWRIGHT, live in the real game (d3b, the Glass Galleries' Lens Room):
//  - the gallery is built: the lens hangs over a flat floor, two stone cover
//    pillars, silvered panels in the vault walls, reachable from spawn;
//  - the ward: an idle alchemist's world never hurts it; the shut housing
//    GLANCES blows;
//  - the LANCE: told (iris, aim line, lock) at least 54 ticks before it
//    fires, traced through the real grid, and it lands on a standing target;
//  - DAZZLE: the REAL wand beam (the renderer's own light field) held in its
//    open iris drops it out of the air; blows land double while it lies there;
//  - the kill: real glass and crystal, a heart and a tome.
//   node scripts/verify-lenswright.mjs [--seed=7] [--url=http://localhost:5173/] [--shots=dir]
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
await startConsoleTestRun(page, { level: 'd3b', seed, settleMs: 800 });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

await page.evaluate(() => {
  const game = window.__game, ctx = game.ctx;
  ctx.state.debugGodMode = true;
  ctx.state.lanternHooded = false;
  window.__lw = () => ctx.enemies.find((e) => e.kind === 'lenswright');
  window.__callouts = [];
  window.__moves = [];
  ctx.events.on('combatCallout', ({ text }) => window.__callouts.push(text));
  ctx.events.on('bossMove', ({ kind, move }) => { if (kind === 'lenswright') window.__moves.push([ctx.state.frameCount, move]); });
  // A tick with the real light field rebuilt around the alchemist first (aim optional).
  window.__tick = (n, aimAt) => {
    const p = ctx.player, light = game.composer.light;
    for (let k = 0; k < n; k++) {
      if (aimAt) {
        // The aim is the mouse's (the player's own update re-reads it every tick).
        const t = aimAt();
        ctx.input.mouse.x = t[0]; ctx.input.mouse.y = t[1];
        p.aimAngle = Math.atan2(t[1] - (p.y - 9), t[0] - p.x);
      }
      ctx.camera.renderX = Math.round(p.x - 320);
      ctx.camera.renderY = Math.round(p.y - 180);
      light.build(ctx);
      ctx.state.paused = false;
      game.tick(false);
    }
  };
  window.__stand = (x, y) => { Object.assign(ctx.player, { x, y, vx: 0, vy: 0 }); ctx.camera.snapTo?.(x, y); };
});

const hall = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world, e = window.__lw(), b = ctx.levels.current.boss;
  if (!e || !b) return null;
  const FY = b.y + 41;
  let floor = 0, cover = 0, mirror = 0;
  for (let dx = -56; dx <= 56; dx++) if (w.types[w.idx(b.x + dx, FY)] !== 0) floor++;
  for (const s of [-1, 1]) for (let dx = 22; dx <= 29; dx++) for (let k = 1; k <= 16; k++) if (w.types[w.idx(b.x + s * dx, FY - k)] === 12) cover++;
  for (let dx = -70; dx <= 70; dx++) for (let dy = -60; dy <= 0; dy++) if (w.types[w.idx(b.x + dx, FY + dy)] === 43) mirror++;
  let clearBelow = 0; for (let dy = 1; dy <= 30; dy++) if (w.types[w.idx(Math.round(e.x), Math.round(e.y) + dy)] === 0) clearBelow++;
  return { x: Math.round(e.x), y: Math.round(e.y), FY, floor, cover, mirror, clearBelow, hp: e.hp };
});
console.log(JSON.stringify(hall));
check(hall !== null, 'the Lenswright hangs in the Glass Galleries');
if (!hall) { await browser.close(); process.exit(1); }
check(hall.floor >= 108, `a flat gallery floor (${hall.floor}/113)`);
check(hall.cover >= 200, `two stone cover pillars (${hall.cover} stone)`);
check(hall.mirror >= 30, `silvered panels in the vault (${hall.mirror} mirror cells)`);
check(hall.clearBelow >= 25, `it hangs in the air over the floor (${hall.clearBelow} clear rows beneath)`);

// 1) THE WARD + GLANCE.
const ward = await page.evaluate(() => {
  const ctx = window.__game.ctx, e = window.__lw(), b = ctx.levels.current.boss;
  window.__stand(b.x + 40, b.y + 40);
  const hp0 = e.hp;
  if (e.boss) e.boss.move = 'march';
  window.__tick(60);
  const hp1 = e.hp;
  e.boss.move = 'march'; e.boss.moveT = 0;
  ctx.enemyCtl.damage(e, 10, 0, 0, 'direct');
  return { hp0, hp1, glance: +(hp1 - e.hp).toFixed(2) };
});
console.log(JSON.stringify(ward));
check(ward.hp1 === ward.hp0, `the ward: idle, nothing hurts it (${ward.hp0} -> ${ward.hp1})`);
check(Math.abs(ward.glance - 3.5) < 0.01, `the shut housing glances a blow (10 -> ${ward.glance})`);

// 2) THE LANCE: told, then it lands on a standing target.
const lance = await page.evaluate(() => {
  const ctx = window.__game.ctx, e = window.__lw(), b = ctx.levels.current.boss;
  window.__moves.length = 0;
  window.__stand(b.x - 44, b.y + 40);
  e.attackCd = 0; e.boss.move = 'march';
  let hitAt = -1, startAt = -1;
  for (let k = 0; k < 600 && hitAt < 0; k++) {
    ctx.player.lastDamageSource = '';
    window.__tick(1);
    const lanceMove = window.__moves.find(([, m]) => m === 'lance' || m === 'sweep');
    if (lanceMove && startAt < 0) startAt = lanceMove[0];
    if (ctx.player.lastDamageSource === 'lenswright-lance') hitAt = ctx.state.frameCount;
    if (k % 60 === 0) window.__stand(b.x - 44, b.y + 40);
  }
  return { startAt, hitAt, warn: hitAt - startAt, moves: window.__moves.map((m) => m[1]) };
});
console.log(JSON.stringify(lance));
check(lance.hitAt > 0, `the lance lands on a standing target (${lance.moves.join(', ')})`);
check(lance.warn >= 54, `it was told ${lance.warn} ticks before it burned`);

if (shots) {
  await page.evaluate(() => { const e = window.__lw(); e.attackCd = 0; e.boss.move = 'march'; });
  for (let k = 0; k < 8; k++) {
    await page.evaluate(() => window.__tick(9));
    await page.waitForTimeout(80);
    await page.screenshot({ path: `${shots}/lens-fight-${k}.png` });
  }
}

// 3) DAZZLE. A straight stare it meets: the beam held in its eye from the
//    open floor never dazzles it. Banked off a silvered panel into its open
//    iris (a bank shot found with the game's own tracer, sim/beam), the real
//    wand beam does — it drops out of the air and blows land double.
const dazzle = await page.evaluate(async () => {
  const { traceBeam, distanceToSegment } = await import('/src/sim/beam.ts');
  const ctx = window.__game.ctx, w = ctx.world, e = window.__lw(), b = ctx.levels.current.boss;
  const def = ctx.enemyCtl.defs.lenswright;
  const FY = b.y + 41;
  const eye = () => [e.x, e.y - def.h * 0.55];
  const hold = () => { e.x = b.x; e.y = b.y; e.vx = 0; e.vy = 0; };
  // The stare: the beam straight into its eye through a whole tell.
  window.__stand(b.x - 50, FY - 1);
  window.__tick(100);
  hold(); e.attackCd = 0; e.boss.move = 'march';
  let stared = false;
  for (let k = 0; k < 160; k++) { hold(); window.__tick(1, eye); if (e.boss.move === 'dazzled') stared = true; }
  // Find a bank shot: a floor spot and an aim whose traced beam reaches the
  // eye only after a bounce.
  hold();
  const [ex, ey] = eye();
  let shot = null;
  for (let X = b.x - 54; X <= b.x + 54 && !shot; X += 2) {
    if (Math.abs(X - b.x) >= 20 && Math.abs(X - b.x) <= 31) continue; // not on a pillar
    const oy0 = FY - 10;
    for (let a = -Math.PI; a <= 0 && !shot; a += 0.004) {
      const ox = X + Math.cos(a) * 4, oy = oy0 + Math.sin(a) * 4;
      const segs = traceBeam(w, ox, oy, a, 420, [], { maxSegments: 12, step: 0.7 });
      if (segs.length < 2 || distanceToSegment(ex, ey, segs[0]) < 12) continue;
      if (segs.some((sg) => sg.depth >= 1 && distanceToSegment(ex, ey, sg) < 2.5)) shot = { X, a };
    }
  }
  if (!shot) return { stared, shot: null };
  window.__stand(shot.X, FY - 1);
  window.__tick(60);
  hold(); e.attackCd = 0; e.boss.move = 'march';
  window.__callouts.length = 0;
  let dazzledAt = -1;
  for (let k = 0; k < 300 && dazzledAt < 0; k++) {
    hold();
    window.__tick(1, () => [shot.X + Math.cos(shot.a) * 100, FY - 10 + Math.sin(shot.a) * 100]);
    if (e.boss.move === 'dazzled') dazzledAt = k;
  }
  window.__tick(50);
  const grounded = (() => { for (let dy = 1; dy <= 3; dy++) if (w.types[w.idx(Math.round(e.x), Math.round(e.y) + dy)] !== 0) return true; return false; })();
  const hp = e.hp;
  e.boss.selfHarmUntil = 0;
  ctx.enemyCtl.damage(e, 10, 0, 0, 'direct');
  return { stared, shot, dazzledAt, called: window.__callouts.includes('DAZZLED'), grounded, dealt: +(hp - e.hp).toFixed(2), move: e.boss.move };
});
console.log(JSON.stringify(dazzle));
check(!dazzle.stared, 'a straight stare never dazzles it');
check(dazzle.shot !== null, `a bank shot off a silvered panel exists (${JSON.stringify(dazzle.shot)})`);
check(dazzle.dazzledAt >= 0 && dazzle.called, `the wand's beam banked into its open iris dazzles it (tick ${dazzle.dazzledAt})`);
check(dazzle.grounded, 'dazzled, it drops out of the air');
check(Math.abs(dazzle.dealt - 20) < 0.01, `blows land double while it lies there (10 -> ${dazzle.dealt})`);

// 4) THE KILL.
const kill = await page.evaluate(() => {
  const ctx = window.__game.ctx, w = ctx.world, e = window.__lw();
  const pk0 = ctx.levels.current.pickups.length;
  const glass0 = (() => { let n = 0; for (let i = 0; i < w.types.length; i++) if (w.types[i] === 31) n++; return n; })();
  e.boss.move = 'dazzled'; e.boss.selfHarmUntil = 0;
  ctx.enemyCtl.damage(e, e.hp + 50, 0, 0, 'direct');
  window.__tick(200);
  const glass = (() => { let n = 0; for (let i = 0; i < w.types.length; i++) if (w.types[i] === 31) n++; return n; })();
  return { alive: ctx.enemies.includes(e), glass0, glass, drops: ctx.levels.current.pickups.slice(pk0).map((p) => p.kind) };
});
console.log(JSON.stringify(kill));
check(!kill.alive, 'it dies to the player');
check(kill.glass > kill.glass0 + 20, `it bursts into real glass (${kill.glass0} -> ${kill.glass})`);
check(kill.drops.includes('heart') && kill.drops.includes('tome'), `it pays a heart and a tome (${kill.drops.join(', ')})`);

check(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

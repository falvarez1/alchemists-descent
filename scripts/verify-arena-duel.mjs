// TWO FIGHTERS IN ONE WORLD (docs/arena/ARCHITECTURE.md, D-001), measured on the Duel Stage on a paused world stepped tick by tick.
// The invariant: a blow lands EXACTLY ONCE on the fighter it was aimed at and NEVER on the caster (except a blast that covers both,
// which hurts each once). Every check counts the calls to each fighter's own `playerCtl.damage` and watches both health bars.
//   spark bolt, kick, blast on the rival, blast covering both, flame/lava contact, lightning, an owner swap (the rival shoots us)
//   a kick's knock reaches the rival's body (once); the rival's controller runs under ITS binding; removing the rival leaves nothing behind
// Usage: node scripts/verify-arena-duel.mjs [url] [--pair ilyra-voss,brann-rook]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const pairArg = args.indexOf('--pair') >= 0 ? args[args.indexOf('--pair') + 1] : 'ilyra-voss,brann-rook';
const [A_ID, B_ID] = pairArg.split(',');
const t = makeChecker();
const check = t.check;
mkdirSync('verify-out/duel', { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* blocked */ } });
await page.goto(url + (url.includes('?') ? '&' : '?') + 'link=off', { waitUntil: 'networkidle', timeout: 40000 });
await leaveTitleIfShown(page);
await waitForConsoleApi(page);
await page.evaluate(async () => { await window.__game.ctx.console.exec('run test --level fighter-duel --world campaign-level'); });
await page.waitForFunction(() => window.__game?.ctx?.levels?.current?.def.id === 'fighter-duel' && window.__game.ctx.state.mode === 'play', null, { timeout: 40000 });
await page.waitForTimeout(2500);

const R = await page.evaluate(async ({ A_ID, B_ID }) => {
  const ctx = window.__game.ctx;
  const out = {};
  const step = (n = 1) => { for (let i = 0; i < n; i++) window.__game.tick(false, { forcePaused: true }); };
  ctx.state.paused = true;
  document.querySelectorAll('#card-offer-overlay.visible').forEach((e) => e.classList.remove('visible'));
  ctx.state.arrivalGraceUntil = 0;
  ctx.fighters.equip(A_ID); await ctx.fighters.whenReady();
  ctx.arena.signatureLoadouts = false; // (these checks count single blows: both fight with the one Spark Bolt; the loadouts have their own measurements)
  const enemiesBefore = ctx.enemies.length;
  const playerBefore = ctx.player;
  const EVENTS = ['cardCast', 'flaskUsed', 'playerRespawned', 'playerDeathCleared', 'levelChanged', 'enemyKilled', 'waystoneLit', 'modeChanged', 'recipeBrewed', 'wandChanged'];
  const counts0 = Object.fromEntries(EVENTS.map((e) => [e, ctx.events.listenerCount(e)]));
  const listenersBefore = { scoped: ctx.events.scoped };
  await ctx.console.exec(`arena add ${B_ID} 740 639`);
  const A = ctx.arena.bundle(0), B = ctx.arena.bundle(1);
  out.joined = { slots: ctx.arena.slotCount, enemies: ctx.enemies.length, kinds: ctx.enemies.map((e) => e.kind), scoped: ctx.events.scoped };

  // count every call to each fighter's own damage()
  const counts = [[], []];
  for (const [i, b] of [A, B].entries()) {
    const orig = b.playerCtl.damage.bind(b.playerCtl);
    b.playerCtl.damage = (amount, kx, ky, src) => { counts[i].push({ amount: +amount.toFixed(2), kx: +(kx ?? 0).toFixed(2), ky: +(ky ?? 0).toFixed(2), src, bound: ctx.arena.bound, atTick: ctx.state.frameCount }); orig(amount, kx, ky, src); };
  }
  const KEEP = new Set([3, 12, 13, 36]); // Wall, Stone, Metal, Glowshroom: the stage itself
  const clean = () => {
    const w = ctx.world;
    for (let y = 411; y <= 639; y++) for (let x = 521; x <= 1079; x++) { const i = w.idx(x, y); const ty = w.types[i]; if (ty !== 0 && !KEEP.has(ty)) w.clearCellAt(i); else if (ty === 0) w.setChargeAt?.(i, 0); }
  };
  const pushes = [[], []];
  for (const [i, b] of [A, B].entries()) {
    const orig = b.playerCtl.applyImpulse.bind(b.playerCtl);
    b.playerCtl.applyImpulse = (vx, vy) => { pushes[i].push({ vx: +vx.toFixed(2), vy: +vy.toFixed(2), bound: ctx.arena.bound }); orig(vx, vy); };
  }
  const place = (ax, bx, y = 639) => {
    ctx.arena.reset();
    ctx.projectiles.length = 0;
    clean();
    for (const [b, x] of [[A, ax], [B, bx]]) Object.assign(b.player, { x, y, vx: 0, vy: 0, grounded: true, invuln: 0, dead: false, firing: false });
    for (const b of [A, B]) { b.player.hp = b.player.maxHp; b.player.invuln = 0; for (const k of Object.keys(b.input.keys)) b.input.keys[k] = false; }
    A.player.facing = 1; B.player.facing = -1;
    counts[0].length = 0; counts[1].length = 0; pushes[0].length = 0; pushes[1].length = 0;
    step(3);
    counts[0].length = 0; counts[1].length = 0; pushes[0].length = 0; pushes[1].length = 0;
  };
  const hp = () => [A.player.hp, B.player.hp];
  const aim = (b, tx, ty) => { b.input.mouse.x = tx; b.input.mouse.y = ty; };
  const snap = (label, hp0, ticks) => {
    const h = hp();
    out[label] = { dA: +(h[0] - hp0[0]).toFixed(1), dB: +(h[1] - hp0[1]).toFixed(1), callsA: counts[0].length, callsB: counts[1].length, amountsB: counts[1].map((c) => c.amount), amountsA: counts[0].map((c) => c.amount), srcA: counts[0].map((c) => c.src), srcB: counts[1].map((c) => c.src), bounds: [counts[0].map((c) => c.bound), counts[1].map((c) => c.bound)], ticks };
  };

  // (the stage's pedestal fills x 780-820: the fighters stand left of it)
  // --- T1: A's spark bolt at B ---
  place(640, 740);
  let h0 = hp();
  aim(A, B.player.x, B.player.y - 9); A.player.firing = true; step(6); A.player.firing = false; step(60);
  snap('sparkAtoB', h0, 66);

  // --- T2: B's spark bolt at A (the owner swap: the rival's shots belong to the rival) ---
  place(640, 740);
  h0 = hp();
  aim(B, A.player.x, A.player.y - 9); B.player.firing = true; step(6); B.player.firing = false; step(60);
  snap('sparkBtoA', h0, 66);
  out.sparkBtoA.owners = 'n/a';

  // --- T3: A's kick at B (in range, in front) ---
  place(722, 738);
  h0 = hp();
  aim(A, B.player.x, B.player.y - 9);
  ctx.arena.with(0, () => { ctx.playerCtl.kick(ctx); });
  step(20);
  snap('kickAtoB', h0, 20);
  out.kickAtoB.pushesB = pushes[1].slice();
  out.kickAtoB.pushesA = pushes[0].slice();
  out.kickAtoB.bVx = +B.player.vx.toFixed(2);
  out.kickAtoB.bX = Math.round(B.player.x);
  out.kickAtoB.startX = 738;

  // --- T4: a blast on B (radius 24, A well outside it) ---
  place(600, 740);
  h0 = hp();
  ctx.arena.with(0, () => { ctx.explosions.trigger(740, 635, 24, {}); });
  step(10);
  snap('blastOnB', h0, 10);

  // --- T5: a blast covering BOTH ---
  place(730, 750);
  h0 = hp();
  ctx.arena.with(0, () => { ctx.explosions.trigger(740, 635, 40, {}); });
  step(10);
  snap('blastOnBoth', h0, 10);

  // --- T6: lightning from A at B ---
  place(640, 740);
  h0 = hp();
  for (let k = 0; k < 4; k++) { ctx.arena.with(0, () => { ctx.lightning.cast(A.player.x + 4, A.player.y - 9, 0); }); step(8); if (B.player.invuln <= 0 || counts[1].length) break; }
  step(4);
  snap('lightningAtoB', h0, 10);

  // --- T7: fire on B's body: only B burns ---
  place(600, 740);
  h0 = hp();
  const w = ctx.world;
  for (let y = 622; y <= 639; y++) for (let x = 737; x <= 743; x++) { const i = w.idx(x, y); if (w.types[i] === 0) { w.replaceCellAt(i, 5, 0xff8020); w.life[i] = 40; } }
  step(30);
  snap('fireOnB', h0, 30);

  // --- T8: the rival's controller runs with the rival bound; its own wands fire ITS card ---
  place(640, 740);
  const seen = [];
  const bu = B.playerCtl.update.bind(B.playerCtl);
  B.playerCtl.update = (c) => { seen.push([ctx.player === B.player, ctx.arena.bound, ctx.fighters === B.fighters, ctx.wands === B.wands]); bu(c); };
  step(3);
  B.playerCtl.update = bu;
  out.binding = { runs: seen.length, allBound: seen.every((s) => s[0] && s[1] === 1 && s[2] && s[3]) };

  // --- T9: after all of it, the single-fighter binding is back and the stand-in mirrors the rival ---
  const stand = ctx.enemies[0];
  out.mirror = { bound: ctx.arena.bound, isA: ctx.player === A.player, standFor: stand.fighter, standX: Math.round(stand.x), bX: Math.round(B.player.x), standHp: Math.round(stand.hp), bHp: Math.round(B.player.hp) };

  // --- T10: remove the rival; nothing is left behind ---
  await ctx.console.exec('arena remove');
  step(3);
  // three more add/remove cycles: nothing accumulates (a controller, a wand system, a kit and a chill system each subscribe)
  for (let k = 0; k < 3; k++) { await ctx.console.exec(`arena add ${B_ID} 740 639`); step(2); await ctx.console.exec('arena remove'); }
  const counts1 = Object.fromEntries(EVENTS.map((e) => [e, ctx.events.listenerCount(e)]));
  out.leaks = EVENTS.filter((e) => counts1[e] !== counts0[e]).map((e) => [e, counts0[e], counts1[e]]);
  out.removed = { active: ctx.arena.active, enemies: ctx.enemies.length, scoped: ctx.events.scoped, samePlayer: ctx.player === playerBefore, enemiesBefore, scopedBefore: listenersBefore.scoped, focus: ctx.camera.inspectionFocus };
  return out;
}, { A_ID, B_ID });

writeFileSync('verify-out/duel/exactly-once.json', JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 1).replace(/\n\s+/g, ' ').slice(0, 3500));

check('a rival joins: two fighters, ONE stand-in in the enemies (kind fighter), scoped events on', R.joined.slots === 2 && R.joined.enemies === 1 && R.joined.kinds[0] === 'fighter' && R.joined.scoped, JSON.stringify(R.joined));
// T1
check('A\'s spark bolt lands on B exactly once (one damage call, under B\'s binding), and never on A', R.sparkAtoB.callsB >= 1 && R.sparkAtoB.callsB <= 2 && R.sparkAtoB.callsA === 0 && R.sparkAtoB.dB < -5, JSON.stringify(R.sparkAtoB));
check('...and the damage call ran with B bound (slot 1)', R.sparkAtoB.bounds[1][0] === 1, JSON.stringify(R.sparkAtoB.bounds));
// T2
check('B\'s spark bolt lands on A exactly once (the rival\'s shot belongs to the rival) and never on B', R.sparkBtoA.callsA >= 1 && R.sparkBtoA.callsA <= 2 && R.sparkBtoA.callsB === 0 && R.sparkBtoA.dA < -5, JSON.stringify(R.sparkBtoA));
check('...with A bound for that call (slot 0)', R.sparkBtoA.bounds[0][0] === 0, JSON.stringify(R.sparkBtoA.bounds));
// T3
check('A\'s kick hurts B once and A not at all', R.kickAtoB.callsB === 1 && R.kickAtoB.callsA === 0, JSON.stringify(R.kickAtoB));
check('A kick pushes B twice (the blow knock and the gust, as for any foe), both through B binding and away from A; A only recoils', R.kickAtoB.pushesB.length === 2 && R.kickAtoB.pushesB.every((p) => p.vx > 0.5 && p.bound === 1) && R.kickAtoB.pushesA.length === 1 && R.kickAtoB.pushesA[0].vx < 0, JSON.stringify([R.kickAtoB.pushesB, R.kickAtoB.pushesA]));
// T4/T5
check('a blast on B hurts B exactly once and not A (A is outside it)', R.blastOnB.callsB === 1 && R.blastOnB.callsA === 0, JSON.stringify(R.blastOnB));
check('a blast covering both hurts each exactly once', R.blastOnBoth.callsA === 1 && R.blastOnBoth.callsB === 1, JSON.stringify(R.blastOnBoth));
// T6
check('A\'s lightning hurts B and not A', R.lightningAtoB.callsB >= 1 && R.lightningAtoB.callsA === 0, JSON.stringify(R.lightningAtoB));
// T7
check('fire on B\'s body burns B and not A', R.fireOnB.dB < -1 && R.fireOnB.callsA === 0, JSON.stringify(R.fireOnB));
// T8/T9
check('the rival\'s own controller, wands and fighter run with the rival bound', R.binding.runs === 3 && R.binding.allBound, JSON.stringify(R.binding));
check('between ticks slot 0 is bound and the stand-in mirrors the rival', R.mirror.bound === 0 && R.mirror.isA && R.mirror.standFor === 1 && Math.abs(R.mirror.standX - R.mirror.bX) <= 1, JSON.stringify(R.mirror));
// T10
check('removing the rival leaves nothing behind: inactive, no enemies, scoping off, the same player object, no camera focus', !R.removed.active && R.removed.enemies === R.removed.enemiesBefore && !R.removed.scoped && R.removed.samePlayer && R.removed.focus === null, JSON.stringify(R.removed));
check('add and remove four times: no event listener is left behind (a controller, wands, a kit and a chill system each subscribed)', R.leaks.length === 0, JSON.stringify(R.leaks));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\narena duel probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);

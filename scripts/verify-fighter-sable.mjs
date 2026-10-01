// SABLE FEN, the Mire Stalker, against the REAL engine (docs/fighters/sable-fen.md).
//   Wounded Spoor  - a foe the fighter hurts is marked 6 s and leaves a trail of fading motes (sampled every 4
//                    ticks, 14 deep); a marked foe out of her sight pulses through the reveal ring.
//   Bogline (Z)    - a hooked tether: on rock she is hauled to 8 cells short of it, keeping her momentum; on a
//                    light foe it is yanked to her and stunned; a heavy foe hauls HER; no hook = refused for free.
//   Bloodsense (T) - every wounded foe within 320 cells is revealed through rock and darkness, renewed each
//                    tick; a heartbeat ring pulses out from her; she is 10% faster.
// REAL key presses (Z, T), paused deterministic ticks, observable effects (positions, hp, marks, reveals, the
// view's cooldown and charge), and screenshots of each ability going off in verify-out/fighters/sable-*.png.
// Usage: node scripts/verify-fighter-sable.mjs [url]
import { mkdirSync } from 'node:fs';
import { boot, makeChecker, press, shot, tick, view } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://localhost:5191/';
const tally = makeChecker();
const check = tally.check;
// A big window, so a screenshot of a 220-cell slice of the world has the detail to judge by; and none of the
// level's title card or the callouts over the action.
const { page, finish } = await boot(url, { fighter: 'sable-fen', viewport: { width: 2560, height: 1440 } });
mkdirSync('verify-out/fighters', { recursive: true });
await page.addStyleTag({ content: '#wave-banner, #toast-stack, .toast, .callout-anchor, .callout { display: none !important; }' });

const ev = (fn, arg) => page.evaluate(fn, arg);
const me = () => ev(() => { const p = window.__fp.ctx.player; return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, hp: p.hp, grounded: p.grounded }; });
const own = () => ev(() => window.__fp.ctx.fighters.ownsMovement);
const aim = (wx, wy) => ev(({ wx, wy }) => window.__fp.aimAt(wx, wy), { wx, wy });
const kitOf = (expr) => ev((e) => { const k = window.__fp.ctx.fighters.kit; return new Function('k', 'ctx', 'return ' + e)(k, window.__fp.ctx); }, expr);

/** Screenshot a window of the world around (wx, wy). */
async function snap(name, wx, wy, halfW = 120, halfH = 68) {
  await page.waitForTimeout(160);
  const b = await ev(() => {
    const c = document.querySelector('#canvas-holder > canvas');
    const r = c.getBoundingClientRect();
    const cam = window.__fp.ctx.camera;
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: cam.x, cy: cam.y };
  });
  const k = b.w / 640;
  const x = Math.max(b.x, b.x + (wx - b.cx - halfW) * k), y = Math.max(b.y, b.y + (wy - b.cy - halfH) * k);
  const width = Math.min(2 * halfW * k, b.x + b.w - x), height = Math.min(2 * halfH * k, b.y + b.h - y);
  const path = `verify-out/fighters/sable-${name}.png`;
  await page.screenshot({ path, clip: { x, y, width, height } });
  return path;
}

/** Fresh ground: no foes, no walls inside the arena, cooldowns and marks cleared, her at the left end. */
async function resetScene() {
  await ev(() => {
    const fp = window.__fp, c = fp.ctx, A = fp.ARENA;
    c.enemies.length = 0;
    fp.carve(A.x0, A.top, A.x1, A.floorY - 1);
    fp.carve(740, 600, 840, 689); // the far pocket (beyond Bloodsense's range from the start)
    fp.wall(740, A.floorY, 840, A.floorY + 6);
    c.fighters.reset();
    c.fighters.refill();
    const p = c.player;
    // (a heart picked up in an earlier scene would hold her still for 110 ticks and refuse every ability: clear the roots too)
    Object.assign(p, { x: A.spawnX, y: A.floorY - 1, vx: 0, vy: 0, fx: 0, fy: 0, hp: 100, invuln: 0, dead: false, grounded: true, recharge: 0, pullT: 0 });
    if (p.chill) p.chill.shell = 0;
    fp.tick(3);
  });
}

const slime = (dx, hp = 48) => ev(({ dx, hp }) => { const e = window.__fp.spawn('slime', dx, { hp }); return { x: e.x, y: e.y }; }, { dx, hp });
const hurt = (i, n = 5) => ev(({ i, n }) => { const c = window.__fp.ctx; c.enemyCtl.damage(c.enemies[i], n, 0, 0, 'direct'); }, { i, n });
const foe = (i) => ev((i) => { const c = window.__fp.ctx, e = c.enemies[i], f = c.fighters; return e ? { x: e.x, y: e.y, hp: e.hp, knockT: e.knockT ?? 0, knockVx: e.knockVx ?? 0, marked: f.isMarked(e), revealed: f.isRevealed(e), alerted: e.alerted } : null; }, i);

/** Over the next `n` ticks, on how many of them is foe `i` held in the knock state (a stun pins it every tick). */
async function heldTicks(i, n) {
  let held = 0;
  for (let t = 0; t < n; t++) { await tick(page, 1); if ((await foe(i)).knockT >= 1) held++; }
  return held;
}

// ====================================================================== Wounded Spoor
console.log('\nWounded Spoor');
await resetScene();
await slime(60);
check('a foe nobody has hurt is not marked and leaves no trail', (await foe(0)).marked === false && (await kitOf('k.trails.size')) === 0);
await hurt(0, 6);
await tick(page, 1);
check('hurting a foe marks it (the system sees it)', (await foe(0)).marked === true);
check('the first mote is down at once', (await kitOf('k.trails.size')) === 1);
check('the HUD reads one marked foe', (await view(page)).meter?.value === 1, JSON.stringify((await view(page)).meter));

// The foe walks right 1 cell per tick; the spoor samples it every 4 ticks and holds 14 samples.
await ev(() => { window.__fp.ctx.enemies[0].alerted = false; });
const walk = async (n) => ev((n) => {
  const fp = window.__fp, e = fp.ctx.enemies[0];
  for (let i = 0; i < n; i++) { e.x += 1; e.vx = 0; fp.tick(1); }
}, n);
await walk(40);
const mid = await kitOf('(() => { const t = k.trails.get(ctx.enemies[0]); return { n: t.n, ts: Array.from(t.ts).slice(0, t.n), xs: Array.from(t.xs).slice(0, t.n) }; })()');
check('a trail of motes follows it (about one per 4 ticks of walking)', mid.n >= 8 && mid.n <= 12, JSON.stringify(mid.n));
const sorted = [...mid.ts].sort((a, b) => a - b);
let gapsOk = true;
for (let i = 2; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] !== 4) gapsOk = false;
check('the motes were sampled 4 ticks apart', gapsOk, JSON.stringify(sorted));
await walk(60);
const deep = await kitOf('k.trails.get(ctx.enemies[0]).n');
check('the trail is held to 14 deep', deep === 14, String(deep));
await snap('spoor-lit', (await foe(0)).x - 30, (await foe(0)).y - 20, 90, 52);

// Stop (held still by hand: a slime would otherwise hop about): the trail burns out behind it, and the mark expires after 6 s.
await ev(() => { const fp = window.__fp, e = fp.ctx.enemies[0], x = e.x, y = e.y; for (let i = 0; i < 40; i++) { e.x = x; e.y = y; e.vx = 0; e.vy = 0; e.knockT = 0; fp.tick(1); } });
const under = await kitOf('(() => { const e = ctx.enemies[0], t = k.trails.get(e); let n = 0; for (let i = 0; i < t.n; i++) if (Math.hypot(t.xs[i] - e.x, t.ys[i] - e.y) < 1.5) n++; return n; })()');
check('a foe that stands still leaves one steady mote under it, not a clump', under === 1, String(under));
await tick(page, 330);
check('the mark runs out after 6 seconds', (await foe(0)).marked === false);
await tick(page, 70);
check('the burnt-out trail is dropped', (await kitOf('k.trails.size')) === 0);

// Out of her sight: a faint pulse through the reveal ring (rock between, or too dark to see).
await resetScene();
await ev(() => { const fp = window.__fp; fp.wall(500, 640, 512, 689); });
await slime(40);          // x 480: in plain sight, in front of the wall (x 500-512)
await slime(110);         // x 550: behind it
await hurt(0); await hurt(1);
await tick(page, 8);
const seen = await foe(0), hidden = await foe(1);
check('a marked foe in plain sight is not pulsed', seen.marked && !seen.revealed, JSON.stringify(seen));
check('a marked foe behind rock pulses through it (the reveal ring)', hidden.marked && hidden.revealed, JSON.stringify(hidden));
await snap('spoor-pulse', 520, 665, 100, 56);
await shot(page, 'sable-hud');

// ====================================================================== Bogline
console.log('\nBogline');
await resetScene();
let v0 = await view(page);
check('Bogline is ready and named', v0.tactical.ready === true && v0.tactical.name === 'Bogline', JSON.stringify(v0.tactical));

// -- no hook: open ground to the right (the arena's wall is 180 cells away, past the 150 range)
await aim(600, 680);
const refused0 = v0.tactical.refusedAt;
await press(page, 'KeyZ', 2);
let v = await view(page);
check('no hook within 150 cells: refused', v.tactical.refusedAt > refused0 && (await own()) === false);
check('...and it costs nothing (still ready, no cooldown)', v.tactical.ready === true && v.tactical.cooldown === 0);
check('...and says why', (await kitOf('k.lastRefusal')) === 'NOTHING TO HOOK');

// -- a hook too close to be worth it
await ev(() => window.__fp.wall(447, 640, 452, 689));
await aim(449, 680);
await press(page, 'KeyZ', 2);
v = await view(page);
check('a hook closer than 10 cells is refused for free', v.tactical.ready === true && (await own()) === false && (await kitOf('k.lastRefusal')) === 'TOO CLOSE TO HOOK');
await ev(() => window.__fp.carve(447, 640, 452, 689));

// -- rock: a pillar across the arena
await ev(() => window.__fp.wall(560, 640, 580, 689));
await aim(570, 680);
const x0 = (await me()).x;
await page.keyboard.down('KeyZ');
await tick(page, 1);
await page.keyboard.up('KeyZ');
v = await view(page);
check('Z fired: the cooldown is spent (8 s)', v.tactical.ready === false && v.tactical.cooldown > 0.95 && v.tactical.cooldownSeconds === 8, JSON.stringify(v.tactical));
check('the body is owned by the haul', (await own()) === true);
const trace = [];
await snap('bogline-cast', x0 + 60, 650, 110, 62);
for (let i = 0; i < 40 && (await own()); i++) {
  await tick(page, 1);
  trace.push(await me());
  if (i === 3) await snap('bogline-haul', x0 + 60, 650, 110, 62);
}
const end = await me();
const stepSizes = trace.slice(1).map((t, i) => t.x - trace[i].x);
check('she is hauled ~6 cells a tick', stepSizes.slice(0, 5).every((d) => d >= 5 && d <= 6.01), JSON.stringify(stepSizes.slice(0, 6)));
check('and stops 8 cells short of the hook (the pillar face is x 560)', Math.abs((560 - end.x) - 8) <= 6, `stopped at x ${end.x}`);
check('it took no more than 28 ticks', trace.length <= 28, String(trace.length));
console.log(`    measured: hook at x 560 from x ${x0}: ${trace.length} ticks, stopped at x ${end.x} (${560 - end.x} short), exit vx ${trace[trace.length - 1].vx.toFixed(2)}`);
check('she keeps her momentum on exit (still moving toward the hook)', trace[trace.length - 1].vx > 1.5, JSON.stringify(trace[trace.length - 1]));
await snap('bogline-arrive', end.x + 30, 650, 110, 62);
await tick(page, 8);
await snap('bogline-coil', end.x + 30, 650, 110, 62);
check('the tether is gone a few ticks after (the line coiled back)', (await kitOf('k.tether')) === null);

// -- cooling down: a second Z is refused
const refusedAt1 = (await view(page)).tactical.refusedAt;
await press(page, 'KeyZ', 2);
check('pressed while cooling: refused, no second haul', (await view(page)).tactical.refusedAt > refusedAt1 && (await own()) === false);
await tick(page, 480);
check('Bogline is ready again after 8 seconds', (await view(page)).tactical.ready === true);

// -- straight up: the ceiling is the hook, and she is hauled up to it
console.log('  (up to the ceiling)');
await resetScene();
await ev(() => window.__fp.wall(400, 596, 480, 603)); // a slab overhead (the level above the arena is open)
await aim(440, 300);
const y0 = (await me()).y;
await press(page, 'KeyZ', 1);
for (let i = 0; i < 40 && (await own()); i++) await tick(page, 1);
const yEnd = await me();
check('aimed up she is hauled up to 8 cells short of the slab (its underside is y 603)', y0 - yEnd.y >= 55 && yEnd.y - 9 - 603 >= 4 && yEnd.y - 9 - 603 <= 16, `from ${y0} to ${yEnd.y}`);
check('she leaves it rising', yEnd.vy < -1);
await snap('bogline-up', 440, 640, 80, 46);
await tick(page, 60);

// -- a light foe: yanked to her and stunned
console.log('  (a light foe)');
await resetScene();
await slime(100);
const f0 = await foe(0);
await ev(() => { const e = window.__fp.ctx.enemies[0]; window.__fp.aimAt(e.x, e.y - 4); });
const px0 = (await me()).x;
await page.keyboard.down('KeyZ');
await tick(page, 1);
await page.keyboard.up('KeyZ');
await snap('bogline-yank-0', f0.x - 50, 660, 110, 62);
const ys = [];
for (let i = 0; i < 12; i++) { await tick(page, 1); ys.push(await foe(0)); }
await snap('bogline-yank-1', f0.x - 50, 660, 110, 62);
const f1 = ys[ys.length - 1];
check('the foe is marked by the hook', ys[0].marked === true);
check('it was dragged toward her (about 40 cells)', f0.x - f1.x >= 32 && f0.x - f1.x <= 48, `moved ${f0.x - f1.x}`);
console.log(`    measured: foe dragged ${f0.x - f1.x} cells in 10 ticks, now ${(await me()).x ? f1.x - (await me()).x : 0} cells from her`);
check('...at about 4 cells a tick', ys.slice(1, 8).every((s, i) => { const d = ys[i].x - s.x; return d >= 3 && d <= 5; }), JSON.stringify(ys.slice(0, 9).map((s) => s.x)));
check('she did not move', Math.abs((await me()).x - px0) < 1.5);
check('once it arrives it has no velocity of its own (the stun holds it)', ys.slice(-2).every((s) => s.knockVx === 0), JSON.stringify(ys.slice(-2)));
check('...and dazed stars circle it', (await kitOf('k.stuns.length')) === 1);
await snap('bogline-stun', f1.x, 660, 70, 40);
const xs0 = (await foe(0)).x;
const heldA = await heldTicks(0, 14);
check('it is held in the knock state through the 20-tick stun', heldA >= 9, `held ${heldA} of 14`);
check('...and stays where it is', Math.abs((await foe(0)).x - xs0) <= 2);
await tick(page, 4);
const heldB = await heldTicks(0, 10);
check('...and is let go when the stun ends', heldB === 0, `held ${heldB} of 10`);
check('the stars are gone with it', (await kitOf('k.stuns.length')) === 0);
check('the foe is alerted (it knows she did it)', (await foe(0)).alerted === true);

// -- a flying foe is yanked the same way
console.log('  (a flying foe)');
await resetScene();
await ev(() => { const fp = window.__fp; fp.spawn('bat', 100, { hp: 16, y: 662 }); });
const b0 = await foe(0);
await ev(() => { const e = window.__fp.ctx.enemies[0]; window.__fp.aimAt(e.x, e.y - 2); });
await press(page, 'KeyZ', 1);
let bLast = await foe(0);
for (let i = 0; i < 12; i++) { await tick(page, 1); bLast = await foe(0); }
check('a bat is marked and dragged toward her too', bLast.marked && b0.x - bLast.x >= 25, `from ${b0.x} to ${bLast.x}`);
await resetScene();

// -- a foe in front of a wall is hooked, not the wall; a foe behind a wall is not hooked at all
console.log('  (foe against rock)');
await resetScene();
await ev(() => window.__fp.wall(560, 640, 580, 689));
await slime(90);
await ev(() => { const e = window.__fp.ctx.enemies[0]; window.__fp.aimAt(e.x, e.y - 4); });
await press(page, 'KeyZ', 2);
check('the foe in front of the wall is the one hooked (she stays put, it is marked)', (await own()) === false && (await foe(0)).marked === true);
await resetScene();
await ev(() => window.__fp.wall(480, 640, 490, 689));
await slime(120);
await aim(560, 680);
await press(page, 'KeyZ', 2);
check('a foe behind a wall is not hooked: the line bites the wall and hauls her to it', (await foe(0)).marked === false && (await own()) === true);
await tick(page, 30);

// -- a heavy foe: she is hauled to it, and it is stunned on arrival
console.log('  (a heavy foe)');
await resetScene();
await ev(() => { const fp = window.__fp, e = (fp.spawn('golem', 130), fp.ctx.enemies[0]); e.hp = e.maxHp = 170; });
const g0 = await foe(0);
await ev(() => { const e = window.__fp.ctx.enemies[0]; window.__fp.aimAt(e.x, e.y - 8); });
const hx0 = (await me()).x;
await press(page, 'KeyZ', 1);
check('Z on a golem hauls HER (it is too heavy to drag)', (await own()) === true && (await foe(0)).marked === true);
for (let i = 0; i < 40 && (await own()); i++) await tick(page, 1);
const hx1 = (await me()).x, g1 = await foe(0);
check('she travelled toward it', hx1 - hx0 > 70, `moved ${hx1 - hx0}`);
console.log(`    measured: hauled ${hx1 - hx0} cells, stopped ${g1.x - hx1} cells from the golem's centre`);
check('the golem was not dragged (it only shuffled toward her, now that it is angry)', Math.abs(g1.x - g0.x) <= 8, `${g0.x} -> ${g1.x}`);
check('she stopped short of it (8 cells + its half width)', g1.x - hx1 >= 8 && g1.x - hx1 <= 26, `gap ${g1.x - hx1}`);
await snap('bogline-heavy-arrive', g1.x - 30, 660, 90, 50);
check('...and stars circle it on her arrival', (await kitOf('k.stuns.length')) === 1);
const heldG = await heldTicks(0, 14);
check('the golem is held in the knock state for the stun', heldG >= 9, `held ${heldG} of 14`);
await tick(page, 6);
check('...and let go after it', (await heldTicks(0, 8)) === 0);

// ====================================================================== Bloodsense
console.log('\nBloodsense');
await resetScene();
// the dark: this floor is lamp-lit by default, so make the arena a deep-dark zone (its own world, the probe's)
const dark = await ev(async () => {
  const fp = window.__fp, c = fp.ctx;
  const mod = await import('/src/config/darkness.ts');
  const rt = c.levels.current;
  mod.FLOOR_DARKNESS[rt.def.id] = { base: 0.9, deep: 1 };
  rt.darkZones = [{ x: 500, y: 650, rx: 420, ry: 260, shape: 'ellipse' }];
  fp.tick(6);
  return { inArena: c.lightQuery.darkness(560, 680), behind: c.lightQuery.darkness(580, 680) };
});
check('the arena is a deep-dark zone for this probe', dark.inArena > 0.8 && dark.behind > 0.8, JSON.stringify(dark));

// the cast: foes A (wounded, in the open), B (healthy), C (wounded, behind 40 cells of stone), D (wounded, far away)
await ev(() => {
  const fp = window.__fp;
  fp.wall(520, 600, 560, 689);                      // a thick stone wall: the arena's right side is sealed off (x 520-560)
  fp.carve(561, 640, 619, 689);                     // a closed chamber behind it
});
await slime(60, 48);   // A  x 500
await slime(30, 48);   // B  x 470
await slime(150, 48);  // C  x 590 (behind the wall)
await ev(() => { const fp = window.__fp, c = fp.ctx; const e = (fp.spawn('slime', 0), c.enemies[3]); e.x = 790; e.y = 689; e.hp = e.maxHp = 48; });
await ev(() => { const c = window.__fp.ctx; c.enemies[0].hp = 20; c.enemies[2].hp = 18; c.enemies[3].hp = 12; });
await ev(() => { const c = window.__fp.ctx; c.enemies[2].x = 590; c.enemies[2].y = 689; });
await tick(page, 2);
check('before it, nothing is revealed (they are in the dark and one is behind a wall)', (await foe(0)).revealed === false && (await foe(2)).revealed === false);
await snap('bloodsense-before', 540, 650, 150, 85);

// the bar: not full => refused
await ev(() => { window.__fp.ctx.fighters.charge = 0; window.__fp.ctx.fighters.syncView(); });
let uv = await view(page);
const uref = uv.ultimate.refusedAt;
await press(page, 'KeyT', 2);
uv = await view(page);
check('T with the bar not full is refused', uv.ultimate.refusedAt > uref && uv.ultimate.active === 0 && uv.ultimate.ready === false);

await ev(() => { window.__fp.ctx.fighters.refill(); });
await tick(page, 1);
check('the bar fills: Bloodsense is ready', (await view(page)).ultimate.ready === true);
await page.keyboard.down('KeyT');
await tick(page, 1);
await page.keyboard.up('KeyT');
uv = await view(page);
const why = await ev(() => { const c = window.__fp.ctx, p = c.player; return { mode: c.state.mode, dead: p.dead, recharge: p.recharge, pullT: p.pullT, shell: p.chill?.shell, hp: p.hp, enemies: c.enemies.length }; });
check('T runs it: active, the bar is spent', uv.ultimate.active > 0.95 && uv.ultimate.charge === 0, JSON.stringify(uv.ultimate) + ' ' + JSON.stringify(why));
check('she is 10% faster', Math.abs((await ev(() => window.__fp.ctx.fighters.moveScale())) - 1.1) < 1e-6);
await tick(page, 6);
const A = await foe(0), B = await foe(1), C = await foe(2), D = await foe(3);
check('a wounded foe in the open is revealed', A.revealed === true, JSON.stringify(A));
check('a healthy foe is not', B.revealed === false, JSON.stringify(B));
check('a wounded foe behind 40 cells of stone, in the dark, IS revealed', C.revealed === true, JSON.stringify(C));
check('...and Bloodsense is showing the wounded ones (the overlay warms them from within)', (await kitOf('k.sensed.length')) === 2, String(await kitOf('k.sensed.length')));
check('a wounded foe beyond 320 cells is not', D.revealed === false, JSON.stringify(D));
check('the heartbeat has begun (the first sweep ring is out)', (await kitOf('k.rings.length')) >= 1);
await snap('bloodsense-sweep', 520, 650, 150, 85);
await tick(page, 16);
check('the ring passed the wounded foes: they flared', (await kitOf('k.pings.length')) >= 1 || (await kitOf('k.rings.length')) >= 1);
await snap('bloodsense-hold', 540, 650, 150, 85);

// a foe wounded mid-ultimate joins in; one that dies drops out
await hurt(1, 9);
await tick(page, 2);
check('a foe wounded mid-ultimate joins in', (await foe(1)).revealed === true);
await ev(() => { const c = window.__fp.ctx; c.enemyCtl.damage(c.enemies[0], 999, 0, 0, 'direct'); });
await tick(page, 8);
check('a foe that dies drops out', (await ev(() => window.__fp.ctx.enemies.length)) === 3);

// the slow heartbeat: a lub at 84 ticks in
await tick(page, 70);
check('the slow heartbeat rings again', (await kitOf('k.rings.length')) >= 1);
await snap('bloodsense-beat', 520, 650, 150, 85);

// the end: it runs its 600 ticks and lets go
await tick(page, 330);
await snap('bloodsense-fading', 540, 650, 150, 85);
await tick(page, 220);
uv = await view(page);
check('after 600 ticks it ends (no longer active)', uv.ultimate.active === 0);
await tick(page, 8);
check('the reveals lapse', (await ev(() => window.__fp.ctx.enemies.every((e) => !window.__fp.ctx.fighters.isRevealed(e)))) === true);
check('her speed is back to normal', (await ev(() => window.__fp.ctx.fighters.moveScale())) === 1);
await tick(page, 70);
check('the heartbeat drawable is gone once its rings have faded', (await kitOf('k.rings.length')) === 0 && (await kitOf('k.pings.length')) === 0);

const pageErrors = await finish();
check('no page errors', pageErrors === 0);
console.log(`\nSable Fen probe: ${tally.pass} passed, ${tally.fail} failed`);
process.exit(tally.fail ? 1 : 0);

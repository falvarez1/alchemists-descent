// Father Thorne, the Briar Heretic, against the REAL engine (docs/fighters/father-thorne.md): Rooted Camouflage (stand
// still near cover and a foe's sight shortens), Ironvine (Z: thorny Vines grown along the surface in the aim: real cells
// the sim burns and the player cuts, slowing and scratching foes, marking the first, withering on their own after ~25 s)
// and Overgrowth (T: a radius-70 zone of roots, moss, leaves and hanging vines; she is hidden in it, foes are slowed,
// the roots are climbable, nothing it grows can seal a route, and it browns and withers when the effect ends).
// Real key presses, paused deterministic ticks, observable effects in the grid, the player and the foes, and the
// negative cases (no surface, no room, cooling down, bar not full, nothing to take root on).
// Usage: node scripts/verify-fighter-thorne.mjs [url]   (dev server running; screenshots to verify-out/fighters/)
import { mkdirSync, readFileSync } from 'node:fs';
import { aimAt, boot, makeChecker, me, press, tick, view } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const tally = makeChecker();
const check = tally.check;
const { page, finish } = await boot(url, { fighter: 'father-thorne', viewport: { width: 2560, height: 1440 } });
mkdirSync('verify-out/fighters', { recursive: true });

const FLOOR = 690; // the arena floor's top row: the body stands at FLOOR - 1
const X0 = 440; // where she starts
const KEYS = ['ShiftLeft', 'KeyD', 'KeyW', 'KeyA', 'KeyS', 'Space', 'KeyZ', 'KeyT'];
const CELL = { Water: 2, Stone: 12, Fire: 5, Smoke: 14, Vines: 15, Ash: 32, Ember: 20, Moss: 34, Leaf: 39, Trunk: 40, Glowshroom: 33, Fungus: 30 };
const AX0 = 364, AX1 = 636, AY0 = 540, AY1 = FLOOR + 8; // the rectangle every census covers

/** A clean arena: a stone floor, side walls, (a 15-thick ceiling 49 cells up), foes, bodies, strands and particles cleared. */
async function arena(fighter, { x = X0, ceiling = true, cover: cov = null } = {}) {
  for (const k of KEYS) await page.keyboard.up(k);
  await page.evaluate(async ({ fighter, x, ceiling, FLOOR, AX0, AX1, AY0, AY1 }) => {
    const f = window.__fp, c = f.ctx, p = c.player;
    f.carve(AX0, AY0, AX1, AY1);
    f.wall(AX0, FLOOR, AX1, FLOOR + 6);
    if (ceiling) f.wall(AX0 + 8, 626, AX1 - 8, 640);
    f.wall(AX0, AY0, AX0 + 7, FLOOR + 6);
    f.wall(AX1 - 7, AY0, AX1, FLOOR + 6);
    c.enemies.length = 0;
    for (const b of [...c.rigidBodies.bodies]) if (b.x > AX0 - 20 && b.x < AX1 + 20 && b.y > AY0 - 40 && b.y < AY1 + 40) c.rigidBodies.remove(b);
    c.particles.clear();
    c.vineStrands?.clear?.();
    // a root the last test burnt may still be a felled tree in flight: it would land (and re-stamp as solid Wood) in this arena
    if (c.flora?.falling) c.flora.falling.length = 0;
    if (c.levels.current?.pickups) c.levels.current.pickups.length = 0;
    document.querySelector('#card-offer-overlay')?.classList.remove('visible');
    document.getElementById('wave-banner')?.style.setProperty('display', 'none');
    for (const k of Object.keys(c.input.keys)) c.input.keys[k] = false;
    c.chill?.reset();
    c.fighters.equip(fighter);
    await c.fighters.whenReady();
    Object.assign(p, {
      x, y: FLOOR - 1, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, climbing: false, crawling: false, swinging: false, invuln: 0,
      hp: 100, maxHp: 100, dead: false, recharge: 0, pullT: 0, aimAngle: 0, facing: 1,
    });
    Object.assign(p.status, { burning: 0, wet: 0, oiled: 0 });
    c.state.arrivalGraceUntil = 0;
    // She looks away (left), so that no foe on her right stands in the lantern's beam: a creature that finds the beam on it sees the
    // lantern whatever her concealment (creatures/lightResponse "being lit is information"), which is a different sense from sight.
    c.input.mouse.x = x - 100;
    c.input.mouse.y = FLOOR - 9;
    p.aimAngle = Math.PI;
    // a log of every sound cue the game was asked for (the probe cannot listen)
    if (!window.__sfxLog) {
      window.__sfxLog = [];
      const orig = c.audio.sfx.bind(c.audio);
      c.audio.sfx = (id, ...rest) => { window.__sfxLog.push(id); return orig(id, ...rest); };
    }
  }, { fighter, x, ceiling, FLOOR, AX0, AX1, AY0, AY1 });
  if (cov) await cover(cov[0], cov[1], cov[2]);
  await tick(page, 3);
}

const count = (types, rect = [AX0, AY0, AX1, AY1]) => page.evaluate(({ types, rect }) => {
  const w = window.__fp.ctx.world;
  const out = {};
  for (const t of types) out[t] = 0;
  for (let y = rect[1]; y <= rect[3]; y++) for (let x = rect[0]; x <= rect[2]; x++) { const t = w.types[w.idx(x, y)]; if (t in out) out[t]++; }
  return out;
}, { types, rect });
const vines = async (rect) => (await count([CELL.Vines], rect))[CELL.Vines];
const conceal = () => page.evaluate(() => window.__fp.ctx.fighters.concealment());
const sfxLog = () => page.evaluate(() => [...window.__sfxLog]);
const sfxClear = () => page.evaluate(() => { window.__sfxLog.length = 0; });
const kitState = () => page.evaluate(() => { const k = window.__fp.ctx.fighters.kit; return { refusal: k?.lastRefusal ?? null }; });
const fighters = (expr) => page.evaluate((e) => new Function('f', 'return ' + e)(window.__fp.ctx.fighters), expr);

/** Every solid and powder a body cannot walk through, counted over the arena: the repo's blocksEntity set. */
const solids = () => page.evaluate(({ AX0, AY0, AX1, AY1 }) => {
  const w = window.__fp.ctx.world;
  // sand, wall, wood, gunpowder, ice, stone, metal, gold, snow, coal, crystal, glass, catalyst, ore, mirror (Vines, Moss, Fungus, Glowshroom, Grass, Leaf, Trunk are soft growth)
  const blocking = new Set([1, 3, 4, 8, 10, 12, 13, 17, 27, 28, 29, 31, 35, 36, 43]);
  const out = {};
  for (let y = AY0; y <= AY1; y++) for (let x = AX0; x <= AX1; x++) { const t = w.types[w.idx(x, y)]; if (blocking.has(t)) out[t] = (out[t] ?? 0) + 1; }
  return JSON.stringify(out);
}, { AX0, AY0, AX1, AY1 });

/** The findability measure: cells reachable from (sx, sy) over `!blocksEntity` cells, 4-connected; the count and whether (tx, ty) is among them. */
const reach = (sx, sy, tx, ty) => page.evaluate(({ sx, sy, tx, ty, AX0, AY0, AX1, AY1 }) => {
  const w = window.__fp.ctx.world;
  const blocking = new Set([1, 3, 4, 8, 10, 12, 13, 17, 27, 28, 29, 31, 35, 36, 43]);
  const seen = new Set([sx + sy * w.width]);
  const q = [sx + sy * w.width];
  while (q.length) {
    const i = q.pop();
    const x = i % w.width, y = (i / w.width) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < AX0 || nx > AX1 || ny < AY0 || ny > AY1) continue;
      const k = nx + ny * w.width;
      if (seen.has(k) || blocking.has(w.types[k])) continue;
      seen.add(k);
      q.push(k);
    }
  }
  return { size: seen.size, hit: seen.has(tx + ty * w.width) };
}, { sx, sy, tx, ty, AX0, AY0, AX1, AY1 });

/** Moss (or another cover cell) in a row on the floor, x from x0, n cells. */
const cover = (type, n, x0, y = FLOOR - 1) => page.evaluate(({ type, n, x0, y }) => {
  const w = window.__fp.ctx.world;
  for (let i = 0; i < n; i++) { const k = w.idx(x0 + i, y); w.replaceCellAt(k, type, 0x3a8a40); w.life[k] = -1; }
}, { type, n, x0, y });

/** A zoomed crop of the canvas around world point (cx, cy), `w` x `h` cells (the viewport is 4 px a cell). */
async function zoom(name, cx, cy, w, h) {
  const clip = await page.evaluate(({ cx, cy, w, h }) => {
    const c = window.__fp.ctx;
    const el = document.querySelector('#canvas-holder > canvas');
    const r = el.getBoundingClientRect();
    const sx = r.width / 640, sy = r.height / 360;
    const camX = c.camera.renderX, camY = c.camera.renderY;
    return { x: Math.max(0, r.left + (cx - w / 2 - camX) * sx), y: Math.max(0, r.top + (cy - h / 2 - camY) * sy), width: Math.min(w * sx, r.width), height: Math.min(h * sy, r.height) };
  }, { cx, cy, w, h });
  await page.screenshot({ path: `verify-out/fighters/${name}.png`, clip });
}
const frame = (name) => page.screenshot({ path: `verify-out/fighters/${name}.png` });

// Every cue the kit asks for must exist (new sound is paid: the kit reuses cues).
const cueSource = readFileSync(new URL('../src/content/audio/sfxCues.ts', import.meta.url), 'utf8');
const cueExists = (id) => cueSource.includes(`'${id}':`);

// ================================================================================ Rooted Camouflage
console.log('\nRooted Camouflage');
{
  await arena('father-thorne');
  let v = await view(page);
  check('the chips name the abilities and the tactical is ready', v.tactical.name === 'Ironvine' && v.ultimate.name === 'Overgrowth' && v.tactical.ready === true);
  check('the kit drew itself into the world as a drawable (the leaf motes)', (await fighters('f.drawables.length')) === 1);

  // ---- no cover: standing still gives nothing
  await tick(page, 300);
  check('standing still with no cover for 300 ticks: concealment 0, no meter', (await conceal()) === 0 && (await view(page)).meter === null);

  // ---- five cells of cover is not enough; the sixth turns it on
  await arena('father-thorne', { cover: [CELL.Moss, 5, X0 - 10] });
  await tick(page, 300);
  check('five cells of cover is not enough', (await conceal()) === 0 && (await view(page)).meter === null);
  await cover(CELL.Leaf, 1, X0 - 5);
  await tick(page, 12);
  check('the sixth cell turns it on (she has been still all along)', (await conceal()) > 0);

  // ---- six cells of cover, to her left (so nothing stands between her and a foe on her right)
  await arena('father-thorne', { cover: [CELL.Moss, 6, X0 - 9] });
  await tick(page, 56);
  check('six cells of cover and still for 59 ticks: nothing yet (the settling second)', (await conceal()) === 0);
  v = await view(page);
  check('the Rooted meter has appeared and is filling (the settling second is a quarter of it)', v.meter !== null && v.meter.label === 'Rooted' && v.meter.value > 20 && v.meter.value < 30, JSON.stringify(v.meter));
  await tick(page, 61);
  const mid = await conceal();
  check('halfway up the ramp: concealment between 0.1 and 0.4', mid > 0.1 && mid < 0.4, `${mid}`);
  await zoom('thorne-camo-1-half', X0, FLOOR - 14, 70, 34);
  await tick(page, 130);
  const full = await conceal();
  check('after the ramp (180 ticks) concealment is 0.6', Math.abs(full - 0.6) < 1e-6, `${full}`);
  await zoom('thorne-camo-2-full', X0, FLOOR - 14, 70, 34);
  await frame('thorne-camo-3-frame');
  v = await view(page);
  check('the meter is full', v.meter !== null && v.meter.value > 99, JSON.stringify(v.meter));

  // ---- a real step: D for one tick and it is gone at once
  await sfxClear();
  await press(page, 'KeyD', 1);
  check('one step (a real D press) and concealment is 0 at once, the meter is gone', (await conceal()) === 0 && (await view(page)).meter === null);
  check('breaking cover scatters leaves and rustles', (await sfxLog()).includes('flora.rustle'));
  await tick(page, 25);
  check('and the wait starts again: 25 ticks after the step there is nothing (she must be still for a second first)', (await conceal()) === 0);
  await tick(page, 150);
  const regrow = await conceal();
  check('150 ticks on she is part of the way back up, not back at 0.6', regrow > 0.05 && regrow < 0.5, `${regrow}`);

  // ---- cover that is not in the box does not count
  await arena('father-thorne', { cover: [CELL.Moss, 8, X0 + 12] }); // 12 cells away: outside the 10-cell box
  await tick(page, 300);
  check('cover 12 cells away is out of the box', (await conceal()) === 0);
  await arena('father-thorne', { cover: [CELL.Trunk, 3, X0 - 5] });
  await cover(CELL.Vines, 3, X0 + 3);
  await tick(page, 300);
  check('Trunk and Vines count as cover (6 cells of the two)', Math.abs((await conceal()) - 0.6) < 1e-6);
  await arena('father-thorne', { cover: [CELL.Glowshroom, 3, X0 - 5] });
  await cover(CELL.Fungus, 3, X0 + 3);
  await tick(page, 300);
  check('Glowshroom and Fungus count as cover too', Math.abs((await conceal()) - 0.6) < 1e-6);
  // ---- airborne: no
  await arena('father-thorne', { ceiling: false, cover: [CELL.Moss, 8, X0 - 12] });
  await page.evaluate(() => { const p = window.__fp.ctx.player; p.y = 640; p.vy = 0; p.grounded = false; p.maxLevit = 140; p.levit = 140; });
  await page.keyboard.down('Space'); // hold the jet: she hangs in the air, not on the ground
  await tick(page, 100);
  await page.keyboard.up('Space');
  const air = await me(page);
  check('in the air she is not still: no concealment', air.grounded === false && (await conceal()) === 0, JSON.stringify(air));
}

console.log('\nRooted Camouflage: what a foe notices');
{
  // The same foe at the same distance from the same body, rooted and not. (A footfall is a sound, a different sense: both runs wait 300 ticks first.)
  const trial = async (dist, rooted) => {
    await arena('father-thorne', { cover: rooted ? [CELL.Moss, 8, X0 - 12] : null });
    await tick(page, 300);
    const c = await conceal();
    await page.evaluate((dist) => { window.__fp.ctx.enemies.length = 0; window.__slime = window.__fp.spawn('slime', dist, { hp: 9999 }); }, dist);
    let seen = 0, conf = 0;
    for (let i = 0; i < 50; i++) {
      await tick(page, 1);
      const s = await page.evaluate(() => { const e = window.__slime; if (e?.mind) e.mind.facing = -1; return { vis: e?.mind?.visible === true, conf: e?.mind?.confidence ?? 0 }; });
      if (s.vis) seen++;
      conf = Math.max(conf, s.conf);
    }
    const e = await page.evaluate(() => { const e = window.__slime; return { alerted: e.alerted === true, intent: e.mind?.intent, ended: Math.round(Math.abs(e.x - window.__fp.ctx.player.x)) }; });
    return { dist, rooted, conceal: c, seen, conf, ...e };
  };
  const rows = [];
  for (const d of [60, 100, 150]) rows.push(await trial(d, false), await trial(d, true));
  for (const r of rows) console.log(`  ${r.dist} cells, ${r.rooted ? 'rooted   ' : 'unhidden '}: seen ${String(r.seen).padStart(2)}/50 ticks, confidence ${r.conf.toFixed(2)}, alerted ${r.alerted}, ${r.intent}`);
  const at = (d, c) => rows.find((r) => r.dist === d && r.rooted === c);
  check('unhidden, a foe 100-150 cells off sees her, is alerted and hunts', [100, 150].every((d) => at(d, false).seen > 20 && at(d, false).alerted && at(d, false).intent === 'hunt'));
  check('rooted, the same foe at the same distance never sees her and goes on foraging', [100, 150].every((d) => at(d, true).seen === 0 && !at(d, true).alerted && at(d, true).conf === 0 && at(d, true).intent === 'forage'));
  check('it is a shorter sight line, not invisibility: a foe 60 cells off still sees her', at(60, true).seen > 20 && at(60, true).alerted);
  check('the trial is honest: the rooted runs had concealment 0.6 and the others 0', rows.every((r) => Math.abs(r.conceal - (r.rooted ? 0.6 : 0)) < 1e-6));
}

// ================================================================================ Ironvine
console.log('\nIronvine');
let carpet; // what the carpet looked like once grown (the later checks read it)
{
  await arena('father-thorne');
  let v = await view(page);
  const before = await solids();
  const reachBefore = await reach(X0, FLOOR - 1, AX1 - 9, FLOOR - 1);
  check('the arena is whole before: a route from her to the far wall', reachBefore.hit === true, JSON.stringify(reachBefore));
  await aimAt(page, X0 + 100, FLOOR - 9);
  await tick(page, 2);
  await frame('thorne-vine-0-before');
  await sfxClear();
  await press(page, 'KeyZ', 1);
  v = await view(page);
  check('Z (a real key press) casts it: the chip is cooling, 12 s', v.tactical.ready === false && v.tactical.cooldownSeconds === 12 && v.tactical.usedAt > 0, JSON.stringify(v.tactical));
  const log = await sfxLog();
  check('the cast has a sound (whoosh, sprout) and every cue it asks for exists', log.includes('flora.whoosh') && log.includes('flora.seed.sprout') && [...new Set(log)].every(cueExists), JSON.stringify([...new Set(log)]));
  await tick(page, 3);
  const early = await vines();
  check('it grows: a few ticks in, the front has only just left her', early > 0 && early < 60, `${early} cells`);
  await zoom('thorne-vine-1-growing', X0 + 22, FLOOR - 12, 70, 28);
  await tick(page, 6);
  await zoom('thorne-vine-2-growing', X0 + 32, FLOOR - 12, 80, 28);
  await tick(page, 30);
  const grown = await vines();
  const xs = await page.evaluate(({ AX0, AY0, AX1, AY1 }) => {
    const w = window.__fp.ctx.world;
    const cols = new Map();
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, thorns = 0, notDormant = 0;
    for (let y = AY0; y <= AY1; y++) for (let x = AX0; x <= AX1; x++) {
      const i = w.idx(x, y);
      if (w.types[i] !== 15) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      cols.set(x, (cols.get(x) ?? 0) + 1);
      if (w.life[i] !== -1) notDormant++;
      const c = w.colors[i];
      if (((c >> 16) & 255) > 140) thorns++;
    }
    const depths = {};
    for (const n of cols.values()) depths[n] = (depths[n] ?? 0) + 1;
    return { minX, maxX, minY, maxY, depths, thorns, notDormant };
  }, { AX0, AY0, AX1, AY1 });
  carpet = { grown, ...xs };
  console.log(`  (${grown} Vines cells, x ${xs.minX}..${xs.maxX}, y ${xs.minY}..${xs.maxY}, columns by depth ${JSON.stringify(xs.depths)}, ${xs.thorns} thorn cells)`);
  check('real Vines cells stand in the grid: more than a hundred', grown > 100 && grown < 200, `${grown}`);
  check('along the ground in the aim, reaching 60 cells from where she stood', xs.maxX - X0 >= 58 && xs.maxX - X0 <= 61, `to x ${xs.maxX}`);
  check('2-3 cells deep, on the surface: every Vines cell is in the three rows above the floor', xs.minY >= FLOOR - 3 && xs.maxY === FLOOR - 1, `y ${xs.minY}..${xs.maxY}`);
  check('both depths occur and no column is thicker than 3', Object.keys(xs.depths).every((d) => +d >= 1 && +d <= 3) && (xs.depths[2] ?? 0) > 5 && (xs.depths[3] ?? 0) > 5, JSON.stringify(xs.depths));
  check('thorns: pale cells stand out on the outermost layer', xs.thorns > 10, `${xs.thorns}`);
  check('every cell is dormant (life -1): the sim never sprouts it past what was written', xs.notDormant === 0, `${xs.notDormant} live`);
  const body = await page.evaluate(({ FLOOR, X0 }) => { const w = window.__fp.ctx.world; let n = 0; for (let y = FLOOR - 17; y <= FLOOR - 1; y++) for (let x = X0 - 4; x <= X0 + 4; x++) if (w.types[w.idx(x, y)] === 15) n++; return n; }, { FLOOR, X0 });
  check('nothing was written over her own body', body === 0, `${body} cells in her box`);
  v = await view(page);
  check('the chip shows the vines are alive (the active ring is up)', v.tactical.active > 0.9, JSON.stringify(v.tactical));
  await frame('thorne-vine-3-grown');
  await zoom('thorne-vine-4-grown-close', X0 + 28, FLOOR - 12, 60, 24);
  await zoom('thorne-vine-4b-grown', X0 + 36, FLOOR - 14, 110, 40);
  check('it wrote no solid and no powder: the route is as it was', (await solids()) === before);
  const reachAfter = await reach(X0, FLOOR - 1, AX1 - 9, FLOOR - 1);
  check('and the findability BFS from her to the far wall reaches it, over the same cells', reachAfter.hit === true && reachAfter.size === reachBefore.size, `${reachBefore.size} -> ${reachAfter.size}`);
  // the sim leaves it alone: no cluster detaches, nothing sprouts, nothing drifts
  await tick(page, 300);
  check('300 ticks on the carpet is exactly as it was (anchored, dormant: the sim leaves it be)', (await vines()) === grown, `${await vines()} vs ${grown}`);
  // cooling down
  const refused0 = (await view(page)).tactical.refusedAt;
  await press(page, 'KeyZ', 1);
  await tick(page, 3);
  v = await view(page);
  check('pressed while cooling: refused, nothing new is written', v.tactical.refusedAt > refused0 && (await vines()) === grown);
}

console.log('\nIronvine: foes in the vines');
{
  // The same foe, the same walk toward her, with and without the carpet. Each foe walks alone (two golems side by side climb over one
  // another, and a hopping golem is in the air and not in the vines); three starting distances are summed so that one foe's dawdling
  // does not decide it. A golem walks steadily, so a distance means something.
  const walk1 = async (kind, withVines, ticks, dist) => {
    await arena('father-thorne');
    if (withVines) {
      await aimAt(page, X0 + 100, FLOOR - 9);
      await tick(page, 2);
      await press(page, 'KeyZ', 1);
      await tick(page, 25);
    } else await tick(page, 28);
    await page.evaluate(({ kind, dist }) => { window.__foe = window.__fp.spawn(kind, dist, { hp: 9999 }); window.__foe.alerted = true; }, { kind, dist });
    await tick(page, 1);
    await page.evaluate(() => { if (window.__foe.mind) window.__foe.mind.facing = -1; }); // it is looking her way (a foe facing off does not notice her until it is irritated)
    const x0 = await page.evaluate(() => window.__foe.x);
    let slowSeen = 0;
    for (let i = 0; i < ticks / 6; i++) { await tick(page, 6); if ((await page.evaluate(() => window.__fp.ctx.fighters.enemySlow(window.__foe))) !== 1) slowSeen++; }
    const e = await page.evaluate(() => ({ x: window.__foe.x, hp: window.__foe.hp }));
    return { moved: x0 - e.x, hpLost: 9999 - e.hp, slowSeen, samples: ticks / 6 };
  };
  const walk = async (kind, withVines, ticks, dists) => {
    const r = [];
    for (const d of dists) r.push(await walk1(kind, withVines, ticks, d));
    return {
      moved: r.reduce((a, x) => a + x.moved, 0),
      hpLost: r.reduce((a, x) => a + x.hpLost, 0) / r.length,
      slowFrac: r.reduce((a, x) => a + x.slowSeen, 0) / r.reduce((a, x) => a + x.samples, 0),
    };
  };
  // (they start 50-58 cells off, at the far end of the 60-cell carpet, and walk 30 ticks. Longer, and a scratched golem's own stone chips
  // settle on the carpet in a pile it then climbs: that is the game's gore, not the vines, but it takes the foe out of them)
  const free = await walk('golem', false, 30, [50, 54, 58]);
  const tangled = await walk('golem', true, 30, [50, 54, 58]);
  console.log(`  (golems walking 30 ticks toward her, three trials each: free ${free.moved} cells in all, in the vines ${tangled.moved} cells, ratio ${(tangled.moved / free.moved).toFixed(2)}; slowed on ${Math.round(tangled.slowFrac * 100)}% of the samples in the vines, ${Math.round(free.slowFrac * 100)}% outside; each lost ${tangled.hpLost} hp in the vines, ${free.hpLost} outside)`);
  check('golems in the vines walk clearly less far (the slow x0.5 acts on their speed every other tick: measured ratio 0.05-0.85)', tangled.moved <= free.moved * 0.85 + 3, `${tangled.moved} vs ${free.moved}`);
  check('the system reports the slow while they stand in them (most of the samples), never outside', tangled.slowFrac >= 0.8 && free.slowFrac === 0, `${tangled.slowFrac}, ${free.slowFrac}`);
  check('scratched: about one hit point per 12 ticks (2-4 each in 30 ticks), none outside the vines', tangled.hpLost >= 2 && tangled.hpLost <= 4 && free.hpLost === 0, `${tangled.hpLost}, ${free.hpLost}`);
  // (a slime waits a random while between hops, so three of them over 130 ticks are summed)
  const slimeFree = await walk('slime', false, 70, [45, 50, 55]);
  const slimeIn = await walk('slime', true, 70, [45, 50, 55]);
  console.log(`  (three slimes, 70 ticks each (inside the carpet): free ${slimeFree.moved} cells in all, in the vines ${slimeIn.moved}; a hopper loses most of its hop to the slow)`);
  check('a hopping slime is held shorter still (its hops bleed away in the vines)', slimeFree.moved > 15 && slimeIn.moved < slimeFree.moved * 0.75, `${slimeIn.moved} vs ${slimeFree.moved}`);

  // ---- the slow ends when the foe leaves, and the damage stops
  await arena('father-thorne');
  await aimAt(page, X0 + 100, FLOOR - 9);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 25);
  await page.evaluate(() => { const f = window.__fp, e = f.spawn('golem', 30, { hp: 9999 }); e.sleeping = true; f.spawn('golem', 50, { hp: 9999 }).sleeping = true; });
  await tick(page, 7);
  const marks = await page.evaluate(() => { const f = window.__fp.ctx.fighters, [a, b] = window.__fp.ctx.enemies; return { a: f.isMarked(a), b: f.isMarked(b), ra: f.isRevealed(a), rb: f.isRevealed(b), slowA: f.enemySlow(a), slowB: f.enemySlow(b) }; });
  check('the first foe the vines catch is marked (and shown through walls), the second is not', marks.a !== marks.b && (marks.a || marks.b) && marks.ra === marks.a && marks.rb === marks.b, JSON.stringify(marks));
  check('both are slowed to half', marks.slowA === 0.5 && marks.slowB === 0.5);
  await zoom('thorne-vine-5-caught', X0 + 40, FLOOR - 14, 90, 36);
  await frame('thorne-vine-5b-caught-frame');
  // never over a body: a sleeping foe stood where the front passed, and no cell was written in its box
  const inBox = await page.evaluate(({ FLOOR }) => {
    const w = window.__fp.ctx.world, out = [];
    for (const e of window.__fp.ctx.enemies) {
      let n = 0;
      for (let y = FLOOR - 21; y <= FLOOR - 1; y++) for (let x = Math.round(e.x) - 7; x <= Math.round(e.x) + 7; x++) if (w.types[w.idx(x, y)] === 15) n++;
      out.push(n);
    }
    return out;
  }, { FLOOR });
  check('a foe standing in them is among Vines cells (it is caught, not pushed aside)', inBox.every((n) => n > 5), JSON.stringify(inBox));
  // a foe that leaves
  await page.evaluate(() => { const e = window.__fp.ctx.enemies[0]; e.x += 75; e.y = 689; e.sleeping = true; });
  await tick(page, 20);
  const left = await page.evaluate(() => { const e = window.__fp.ctx.enemies[0]; return { hp: e.hp, slow: window.__fp.ctx.fighters.enemySlow(e) }; });
  await tick(page, 40);
  const left2 = await page.evaluate(() => { const e = window.__fp.ctx.enemies[0]; return { hp: e.hp, slow: window.__fp.ctx.fighters.enemySlow(e) }; });
  check('a foe that has left the vines stops being scratched and its slow lapses', left.slow === 1 && left2.hp === left.hp, JSON.stringify([left, left2]));
}

console.log('\nIronvine: never over a body');
{
  await arena('father-thorne');
  await page.evaluate(() => { const e = window.__fp.spawn('golem', 28, { hp: 9999 }); e.sleeping = true; });
  await aimAt(page, X0 + 100, FLOOR - 9);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 30);
  const r = await page.evaluate(({ FLOOR }) => {
    const w = window.__fp.ctx.world, e = window.__fp.ctx.enemies[0];
    let inside = 0, beyond = 0, before = 0;
    for (let y = FLOOR - 21; y <= FLOOR - 1; y++) for (let x = Math.round(e.x) - 8; x <= Math.round(e.x) + 8; x++) if (w.types[w.idx(x, y)] === 15) inside++;
    for (let y = FLOOR - 4; y <= FLOOR - 1; y++) for (let x = Math.round(e.x) + 10; x <= Math.round(e.x) + 40; x++) if (w.types[w.idx(x, y)] === 15) beyond++;
    for (let y = FLOOR - 4; y <= FLOOR - 1; y++) for (let x = Math.round(e.x) - 40; x <= Math.round(e.x) - 10; x++) if (w.types[w.idx(x, y)] === 15) before++;
    return { inside, beyond, before };
  }, { FLOOR });
  check('no vine was written in the golem\'s box, and the carpet runs on past it on both sides', r.inside === 0 && r.beyond > 20 && r.before > 20, JSON.stringify(r));
  await zoom('thorne-vine-6-around-foe', X0 + 28, FLOOR - 14, 90, 36);
}

console.log('\nIronvine: real cells, so they burn and can be cut');
{
  // ---- fire
  await arena('father-thorne');
  await aimAt(page, X0 + 100, FLOOR - 9);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 30);
  const g = await vines();
  await page.evaluate(({ FLOOR, X0 }) => {
    const w = window.__fp.ctx.world;
    // flames where the vines stand (as a spark or a fireball would leave them), at three spots along the carpet
    for (const at of [15, 30, 45]) for (let k = 0; k < 3; k++) for (const row of [FLOOR - 2, FLOOR - 3]) { const i = w.idx(X0 + at + k, row); if (w.types[i] === 15) { w.replaceCellAt(i, 5, 0xff7a20); w.life[i] = 80; } }
  }, { FLOOR, X0 });
  await frame('thorne-vine-7-fire-0');
  let left = g;
  for (let i = 0; i < 60 && left > g * 0.4; i++) { await tick(page, 10); left = await vines(); }
  const after = await count([CELL.Fire, CELL.Smoke, CELL.Ash, CELL.Ember]);
  console.log(`  (fire at three spots: ${g} -> ${left} Vines cells after ${await page.evaluate(() => window.__fp.ctx.state.frameCount)} frames; fire/smoke/ash/ember cells left: ${JSON.stringify(after)})`);
  check('real fire burns the vines away: they fall to 40% or less (fire at three spots)', left <= g * 0.4, `${left} of ${g}`);
  await frame('thorne-vine-7-fire-1');

  // ---- cut: a blast, as a bomb or the dig beam would
  await arena('father-thorne');
  await aimAt(page, X0 + 100, FLOOR - 9);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 30);
  const full = await vines();
  const cut = await page.evaluate(({ FLOOR, X0 }) => {
    const w = window.__fp.ctx.world;
    // what the dig beam does: erase the cells in a notch
    let n = 0;
    for (let y = FLOOR - 5; y <= FLOOR - 1; y++) for (let x = X0 + 30; x <= X0 + 36; x++) if (w.types[w.idx(x, y)] === 15) { w.clearCellAt(w.idx(x, y)); n++; }
    return n;
  }, { FLOOR, X0 });
  await tick(page, 120);
  const rest = await vines();
  check('cut a gap in them (as the dig beam would) and the gap stays cut: the rest stands', cut > 10 && rest === full - cut, `${cut} cut, ${rest} of ${full}`);
  await zoom('thorne-vine-8-cut', X0 + 33, FLOOR - 12, 50, 20);
  // and withering later does not fault on cells that are already gone (checked by the wither run below)
}

console.log('\nIronvine: climbing a wall, and where it cannot go');
{
  // a wall 25 cells ahead and an aim up and to the right: the carpet runs along the floor and up the face
  await arena('father-thorne');
  await page.evaluate(({ FLOOR, X0 }) => { window.__fp.wall(X0 + 25, 641, X0 + 40, FLOOR - 1); }, { FLOOR, X0 });
  await aimAt(page, X0 + 60, FLOOR - 9 - 60);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 40);
  const up = await page.evaluate(({ FLOOR, X0 }) => {
    const w = window.__fp.ctx.world;
    let high = 0, onFace = 0, inWall = 0, minY = 1e9;
    for (let y = 640; y < FLOOR; y++) for (let x = X0; x <= X0 + 70; x++) {
      if (w.types[w.idx(x, y)] !== 15) continue;
      if (y < FLOOR - 10) { high++; minY = Math.min(minY, y); }
      if (x === X0 + 24) onFace++;
      if (x >= X0 + 25 && x <= X0 + 40) inWall++;
    }
    return { high, onFace, inWall, minY };
  }, { FLOOR, X0 });
  console.log(`  (${JSON.stringify(up)})`);
  check('aimed up at a wall it climbs the face (cells more than 10 above the floor, against the wall)', up.high > 10 && up.onFace > 8, JSON.stringify(up));
  check('and never goes into the wall', up.inWall === 0);
  await zoom('thorne-vine-9-wall', X0 + 20, FLOOR - 24, 70, 50);

  // aimed along the floor at a wall it stops at the foot
  await arena('father-thorne');
  await page.evaluate(({ FLOOR, X0 }) => { window.__fp.wall(X0 + 25, 641, X0 + 40, FLOOR - 1); }, { FLOOR, X0 });
  await aimAt(page, X0 + 100, FLOOR - 9);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 30);
  const flat = await page.evaluate(({ FLOOR, X0 }) => {
    const w = window.__fp.ctx.world;
    let high = 0, maxX = 0;
    for (let y = 640; y < FLOOR; y++) for (let x = X0; x <= X0 + 70; x++) if (w.types[w.idx(x, y)] === 15) { if (y < FLOOR - 4) high++; maxX = Math.max(maxX, x); }
    return { high, maxX };
  }, { FLOOR, X0 });
  check('aimed along the floor at the same wall it stops at its foot and does not climb', flat.high === 0 && flat.maxX === X0 + 24, JSON.stringify(flat));

  // a ceiling: aimed along the roof from a ledge reaches... (the surface walker rides it when the aim carries along it)
  // ---- refusals
  await arena('father-thorne', { ceiling: false });
  await page.evaluate(({ FLOOR }) => { const p = window.__fp.ctx.player; p.y = FLOOR - 60; p.vy = 0; p.grounded = false; p.maxLevit = 140; p.levit = 140; }, { FLOOR });
  await page.keyboard.down('Space');
  await aimAt(page, X0 + 100, FLOOR - 70);
  await tick(page, 4);
  const r0 = (await view(page)).tactical;
  await sfxClear();
  await press(page, 'KeyZ', 1);
  await tick(page, 2);
  let v = await view(page);
  const none = await vines();
  await page.keyboard.up('Space');
  check('high in the air with nothing to grow on: refused, no cooldown, nothing written, a dry click and a line says why', v.tactical.ready === true && v.tactical.usedAt === r0.usedAt && v.tactical.refusedAt > r0.refusedAt && none === 0 && (await sfxLog()).includes('wand.dry') && (await kitState()).refusal === 'NOTHING TO GROW ON', JSON.stringify([v.tactical, none]));
  await arena('father-thorne', { ceiling: false });
  await aimAt(page, X0, FLOOR - 200);
  await tick(page, 2);
  const r1 = (await view(page)).tactical;
  await press(page, 'KeyZ', 1);
  await tick(page, 2);
  v = await view(page);
  check('aimed straight up from a bare floor: no surface carries on, refused and free', v.tactical.ready === true && v.tactical.refusedAt > r1.refusedAt && (await vines()) === 0 && (await kitState()).refusal === 'NO ROOM TO GROW', JSON.stringify([v.tactical, await kitState()]));
}

console.log('\nIronvine: it withers on its own after about 25 s');
{
  await arena('father-thorne');
  const solidsStart = await solids();
  await aimAt(page, X0 + 100, FLOOR - 9);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 40);
  const g = await vines();
  const start = await page.evaluate(() => window.__fp.ctx.state.frameCount);
  await tick(page, 1300);
  check('at 21.7 s every cell still stands', (await vines()) === g, `${await vines()} of ${g}`);
  await tick(page, 80);
  await zoom('thorne-vine-10-browning', X0 + 28, FLOOR - 12, 80, 24);
  const m1 = await vines();
  check('at 23.7 s it is browning (the cells are still there) ...', m1 === g, `${m1} of ${g}`);
  const brown = await page.evaluate(({ FLOOR, X0 }) => { const w = window.__fp.ctx.world; let n = 0; for (let x = X0 + 6; x <= X0 + 60; x++) { const c = w.colors[w.idx(x, FLOOR - 1)]; if (w.types[w.idx(x, FLOOR - 1)] === 15 && ((c >> 16) & 255) > ((c >> 8) & 255) * 0.75) n++; } return n; }, { FLOOR, X0 });
  check('... turning brown', brown > 5, `${brown} brown cells on the ground row`);
  await tick(page, 100);
  const m2 = await vines();
  const now = await page.evaluate(() => window.__fp.ctx.state.frameCount);
  console.log(`  (frame ${now - start} after the cast: ${m2} of ${g} cells left)`);
  check('at 25.3 s it is crumbling (24 s to 26 s): some cells are gone and some still stand', m2 < g && m2 > 0, `${m2} of ${g}`);
  await zoom('thorne-vine-11-crumbling', X0 + 28, FLOOR - 12, 80, 24);
  await tick(page, 100);
  check('by 27 s every cell has gone', (await vines()) === 0, `${await vines()}`);
  check('the chip shows the vines gone', (await view(page)).tactical.active === 0);
  check('and nothing but the vines was ever written: the census of solids is the arena\'s own', (await solids()) === solidsStart);
  await tick(page, 600);
  check('the cooldown runs out (12 s)', (await view(page)).tactical.ready === true);
  // the cell ledger lets go of cells the sim took (burnt) without touching what is not its own
  await arena('father-thorne');
  await aimAt(page, X0 + 100, FLOOR - 9);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 40);
  await page.evaluate(({ FLOOR, X0 }) => { const w = window.__fp.ctx.world; for (let x = X0 + 10; x < X0 + 30; x++) { const i = w.idx(x, FLOOR - 2); if (w.types[i] === 15) w.replaceCellAt(i, 12, 0x555555); } }, { FLOOR, X0 });
  const stones = (await count([CELL.Stone]))[CELL.Stone];
  await tick(page, 1700);
  check('a rock the player put where a vine stood is not touched by the wither', (await count([CELL.Stone]))[CELL.Stone] === stones && (await vines()) === 0);
}

// ================================================================================ Overgrowth
console.log('\nOvergrowth');
const GROW_RECT = [AX0, AY0, AX1, AY1];
let zoneInfo;
{
  await arena('father-thorne', { x: 430 });
  let v = await view(page);
  check('the bar starts empty and the chip says so', v.ultimate.ready === false && v.ultimate.charge < 0.05);
  await press(page, 'KeyT', 1);
  await tick(page, 2);
  v = await view(page);
  check('bar not full: T is refused (the chip flashes, nothing runs)', v.ultimate.active === 0 && v.ultimate.refusedAt > 0);
  const none = await count([CELL.Trunk, CELL.Moss, CELL.Leaf, CELL.Vines]);
  check('bar not full: no cell was written', Object.values(none).every((n) => n === 0), JSON.stringify(none));

  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  check('a full bar makes it ready', (await view(page)).ultimate.ready === true);
  // a foe sleeping where the zone will cover, and her own body: neither gets a cell
  await page.evaluate(() => { const e = window.__fp.spawn('golem', 30, { hp: 9999 }); e.sleeping = true; });
  const beforeS = await solids();
  const lightsBefore = await page.evaluate(() => (window.__fp.ctx.levels.current.authoredLights ?? []).length);
  const reachBefore = await reach(430, FLOOR - 1, AX1 - 9, FLOOR - 1);
  const cellsBefore = await page.evaluate(({ FLOOR }) => { const w = window.__fp.ctx.world; const k = []; for (let y = FLOOR - 24; y <= FLOOR - 1; y++) for (let x = 420; x <= 470; x++) k.push(w.types[w.idx(x, y)]); return k; }, { FLOOR });
  await frame('thorne-over-0-before');
  await sfxClear();
  await press(page, 'KeyT', 1);
  v = await view(page);
  check('T (a real key press) casts it: the ultimate is running and the bar is spent', v.ultimate.active > 0.99 && v.ultimate.charge < 0.05, JSON.stringify(v.ultimate));
  const log = await sfxLog();
  check('the cast has sound (canopy, crack, whoosh, bloom) and every cue exists', ['flora.canopy', 'flora.crack', 'flora.whoosh', 'flora.ladder.bloom'].every((c) => log.includes(c)) && [...new Set(log)].every(cueExists), JSON.stringify([...new Set(log)]));
  check('she is hidden at once: concealment 0.7 from the first tick', Math.abs((await conceal()) - 0.7) < 1e-6, `${await conceal()}`);
  const flash = await page.evaluate(() => ({ flares: window.__fp.ctx.fighters.kit.view.flares.length, lights: (window.__fp.ctx.levels.current.authoredLights ?? []).length }));
  check('a flash of green is drawn where she cast it, and no authored light is added (a lit alchemist is a seen one)', flash.flares === 1 && flash.lights === lightsBefore, JSON.stringify([flash, lightsBefore]));
  await tick(page, 8);
  await frame('thorne-over-1-sweep-8');
  const c8 = await count([CELL.Trunk, CELL.Moss, CELL.Leaf, CELL.Vines]);
  await tick(page, 14);
  await frame('thorne-over-2-sweep-22');
  const c22 = await count([CELL.Trunk, CELL.Moss, CELL.Leaf, CELL.Vines]);
  await tick(page, 110);
  await frame('thorne-over-3-grown');
  const c = await count([CELL.Trunk, CELL.Moss, CELL.Leaf, CELL.Vines]);
  const tot = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  console.log(`  (cells after 8 / 22 / 132 ticks: ${tot(c8)} / ${tot(c22)} / ${tot(c)}; at 132: ${JSON.stringify(c)}; vine strands lifted: ${await page.evaluate(() => window.__fp.ctx.vineStrands?.strands?.length ?? -1)})`);
  zoneInfo = c;
  check('it sweeps out: more cells at 22 ticks than at 8, and more still when the wave has crossed', tot(c8) < tot(c22) && tot(c22) < tot(c), `${tot(c8)} ${tot(c22)} ${tot(c)}`);
  check('roots: hundreds of Trunk cells (climbable roots hung from the ceiling and up the walls)', c[CELL.Trunk] > 150, `${c[CELL.Trunk]}`);
  check('Moss and Leaf ground cover', c[CELL.Moss] > 40 && c[CELL.Leaf] > 15, `${c[CELL.Moss]} moss, ${c[CELL.Leaf]} leaf`);
  // (wall roots may stand on any wall in the zone, the level's own below the floor included, so count every Trunk cell with rock at its side)
  const wallRoots = await page.evaluate(({ AX0, AX1 }) => {
    const w = window.__fp.ctx.world, rock = new Set([3, 4, 10, 12, 13, 29, 31, 36, 43]);
    let n = 0;
    for (let y = 560; y < 780; y++) for (let x = AX0; x <= AX1; x++) {
      if (w.types[w.idx(x, y)] !== 40) continue;
      if (rock.has(w.types[w.idx(x - 1, y)]) || rock.has(w.types[w.idx(x + 1, y)])) n++;
    }
    return n;
  }, { AX0, AX1 });
  const ceilRoots = (await count([CELL.Trunk], [380, 641, 620, 650]))[CELL.Trunk];
  check('roots cling up the walls (Trunk against a wall face) and hang from the roof', wallRoots > 15 && ceilRoots > 40, `${wallRoots} against the wall, ${ceilRoots} under the roof`);
  const strands = await page.evaluate(() => window.__fp.ctx.vineStrands?.strands?.length ?? 0);
  check('hanging Vines (cells, or swaying strands the sim has lifted from them)', c[CELL.Vines] + strands > 3, `${c[CELL.Vines]} cells, ${strands} strands`);
  // the zone: radius 70 about her, nothing outside it
  const far = await page.evaluate(({ AX0, AY0, AX1, AY1 }) => {
    const w = window.__fp.ctx.world, p = window.__fp.ctx.player;
    const cy = p.y - 8, cx = 430;
    let out = 0, farthest = 0;
    for (let y = AY0; y <= AY1; y++) for (let x = AX0; x <= AX1; x++) {
      const t = w.types[w.idx(x, y)];
      if (t !== 34 && t !== 39 && t !== 40 && t !== 15) continue;
      const d = Math.hypot(x - cx, y - cy);
      farthest = Math.max(farthest, d);
      if (d > 71) out++;
    }
    return { out, farthest: Math.round(farthest) };
  }, { AX0, AY0, AX1, AY1 });
  check('everything it grew is inside the radius-70 zone', far.out === 0, JSON.stringify(far));
  const cellsAfter = await page.evaluate(({ FLOOR }) => { const w = window.__fp.ctx.world; const k = []; for (let y = FLOOR - 24; y <= FLOOR - 1; y++) for (let x = 420; x <= 470; x++) k.push(w.types[w.idx(x, y)]); return k; }, { FLOOR });
  // her box (x 426..434, y FLOOR-17..FLOOR-1) and the golem's (x ~460, 14 wide, 20 tall) stay clear of every new cell
  const clear = await page.evaluate(({ FLOOR }) => {
    const w = window.__fp.ctx.world, e = window.__fp.ctx.enemies[0];
    let her = 0, foe = 0;
    for (let y = FLOOR - 17; y <= FLOOR - 1; y++) for (let x = 426; x <= 434; x++) { const t = w.types[w.idx(x, y)]; if (t === 34 || t === 39 || t === 40 || t === 15) her++; }
    for (let y = Math.round(e.y) - 20; y <= Math.round(e.y); y++) for (let x = Math.round(e.x) - 7; x <= Math.round(e.x) + 7; x++) { const t = w.types[w.idx(x, y)]; if (t === 34 || t === 39 || t === 40 || t === 15) foe++; }
    return { her, foe };
  }, { FLOOR });
  check('no cell was written in her body or the sleeping golem\'s', clear.her === 0 && clear.foe === 0, JSON.stringify(clear));
  void cellsBefore; void cellsAfter;
  check('it wrote no solid and no powder', (await solids()) === beforeS);
  const reachAfter = await reach(430, FLOOR - 1, AX1 - 9, FLOOR - 1);
  check('FAIL-OPEN: the findability BFS from her to the far wall reaches it, over exactly the same cells as before', reachAfter.hit === true && reachAfter.size === reachBefore.size, `${reachBefore.size} -> ${reachAfter.size}`);
  // and the BFS says so for every corner of the arena as well
  const corners = [[AX0 + 9, FLOOR - 1], [AX1 - 9, FLOOR - 1], [AX0 + 9, 641], [AX1 - 9, 641]];
  const all = [];
  for (const [x, y] of corners) all.push((await reach(430, FLOOR - 1, x, y)).hit);
  check('and to all four corners of the arena', all.every(Boolean), JSON.stringify(all));
  const blocking = await page.evaluate(({ AX0, AY0, AX1, AY1 }) => {
    const c = window.__fp.ctx, w = c.world;
    let n = 0, grown = 0;
    for (let y = AY0; y <= AY1; y++) for (let x = AX0; x <= AX1; x++) {
      const t = w.types[w.idx(x, y)];
      if (t !== 15 && t !== 34 && t !== 39 && t !== 40) continue;
      grown++;
      if (c.physics.cellBlocks(x, y)) n++;
    }
    return { grown, n };
  }, { AX0, AY0, AX1, AY1 });
  check('the engine\'s own collision says no cell it grew blocks a body (Trunk, Moss, Leaf and Vines are walk-through)', blocking.grown > 500 && blocking.n === 0, JSON.stringify(blocking));
  await zoom('thorne-over-4-ceiling', 440, 662, 120, 60);
  await zoom('thorne-over-5-floor', 440, FLOOR - 14, 120, 40);
  await zoom('thorne-over-6-wall', 392, 665, 70, 60);
}

console.log('\nOvergrowth: foes, sight, and the roots');
{
  // ---- the slow: the same golem, in the zone and out of it
  const walkZone1 = async (inside, dist) => {
    await arena('father-thorne', { x: 430 });
    await page.evaluate(() => window.__fp.ctx.fighters.refill());
    await tick(page, 1);
    if (inside) { await press(page, 'KeyT', 1); await tick(page, 70); } else await tick(page, 71);
    // (30-60 cells off: close enough to see her through the 0.7, so what is measured is the slow and not a foe that lost her)
    await page.evaluate((dist) => { window.__foe = window.__fp.spawn('golem', dist, { hp: 9999 }); window.__foe.alerted = true; }, dist);
    await tick(page, 1);
    await page.evaluate(() => { if (window.__foe.mind) window.__foe.mind.facing = -1; });
    const x0 = await page.evaluate(() => window.__foe.x);
    let slowSeen = 0;
    for (let i = 0; i < 7; i++) { await tick(page, 6); if ((await page.evaluate(() => window.__fp.ctx.fighters.enemySlow(window.__foe))) !== 1) slowSeen++; }
    const x1 = await page.evaluate(() => window.__foe.x);
    return { moved: x0 - x1, slowSeen, samples: 7 };
  };
  const walkZone = async (inside) => {
    const r = [];
    for (const d of [30, 44, 58]) r.push(await walkZone1(inside, d));
    const sum = (k) => r.reduce((a, x) => a + x[k], 0);
    return { moved: sum('moved'), slow: sum('slowSeen') / sum('samples') };
  };
  const free = await walkZone(false);
  const zone = await walkZone(true);
  console.log(`  (golems walking 42 ticks toward her, three trials each: free ${free.moved} cells in all, in the zone ${zone.moved}, ratio ${(zone.moved / free.moved).toFixed(2)}; slowed on ${Math.round(zone.slow * 100)}% of the samples in the zone, ${Math.round(free.slow * 100)}% outside)`);
  check('golems in the zone walk clearly less far (the slow x0.6 acts on their speed every other tick: measured ratio 0.05-0.85)', free.moved > 20 && zone.moved < free.moved * 0.85, `${zone.moved} vs ${free.moved}`);
  check('the system reports the slow in the zone (every sample) and never outside it', zone.slow === 1 && free.slow === 0, `${zone.slow}, ${free.slow}`);
  // outside the 70-cell radius nothing is slowed
  await arena('father-thorne', { x: 400 });
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await press(page, 'KeyT', 1);
  await tick(page, 20);
  await page.evaluate(() => { const f = window.__fp; f.spawn('golem', 40, { hp: 9999 }).sleeping = true; f.spawn('golem', 100, { hp: 9999 }).sleeping = true; });
  await tick(page, 14);
  const sl = await page.evaluate(() => window.__fp.ctx.enemies.map((e) => window.__fp.ctx.fighters.enemySlow(e)));
  check('a foe 40 cells off is slowed, one 100 cells off (outside the radius) is not', sl[0] === 0.6 && sl[1] === 1, JSON.stringify(sl));

  // ---- sight: hidden in it, a foe 100 cells off cannot see her; one close by still can (a shorter line, not invisibility)
  const trial = async (dist, grown) => {
    await arena('father-thorne', { x: 430 });
    await page.evaluate(() => window.__fp.ctx.fighters.refill());
    await tick(page, 1);
    if (grown) { await press(page, 'KeyT', 1); await tick(page, 300); } else await tick(page, 301);
    const cz = await conceal();
    // (the foe is the only one in the arena, and it is read by reference: nothing else the level spawns can be mistaken for it)
    await page.evaluate((dist) => { window.__fp.ctx.enemies.length = 0; window.__slime = window.__fp.spawn('slime', dist, { hp: 9999 }); }, dist);
    let seen = 0, conf = 0;
    for (let i = 0; i < 50; i++) {
      await tick(page, 1);
      const s = await page.evaluate(() => { const e = window.__slime; if (e?.mind) e.mind.facing = -1; return { vis: e?.mind?.visible === true, conf: e?.mind?.confidence ?? 0 }; });
      if (s.vis) seen++;
      conf = Math.max(conf, s.conf);
    }
    const e = await page.evaluate(() => { const e = window.__slime; return { alerted: e.alerted === true, intent: e.mind?.intent, ended: Math.round(Math.abs(e.x - window.__fp.ctx.player.x)), kinds: window.__fp.ctx.enemies.map((q) => q.kind).join(',') }; });
    return { dist, grown, cz, seen, conf, ...e };
  };
  const rows = [];
  for (const d of [30, 100, 130, 150]) rows.push(await trial(d, false), await trial(d, true));
  for (const r of rows) console.log(`  ${r.dist} cells, ${r.grown ? 'overgrown' : 'bare     '}: concealment ${r.cz.toFixed(2)}, seen ${String(r.seen).padStart(2)}/50 ticks, confidence ${r.conf.toFixed(2)}, alerted ${r.alerted}, ${r.intent} (ended ${r.ended} off; foes: ${r.kinds})`);
  const at = (d, g) => rows.find((r) => r.dist === d && r.grown === g);
  check('bare, foes 100-150 cells off see her and hunt', [100, 130, 150].every((d) => at(d, false).seen > 20 && at(d, false).intent === 'hunt'));
  check('overgrown, the same foes 130 and 150 cells off never see her and go on foraging (100 is at the edge of the shortened sight: reported above, not asserted)', [130, 150].every((d) => at(d, true).seen === 0 && !at(d, true).alerted && at(d, true).conf === 0 && at(d, true).intent === 'forage'));
  check('overgrown, a foe only 30 cells off still sees her (a shorter sight line, not invisibility)', at(30, true).seen > 20 && at(30, true).alerted);
  check('the concealment read is 0.7 in the zone', rows.filter((r) => r.grown).every((r) => Math.abs(r.cz - 0.7) < 1e-6) && rows.filter((r) => !r.grown).every((r) => r.cz === 0), JSON.stringify(rows.map((r) => r.cz)));
}

console.log('\nOvergrowth: the roots are hand-holds');
{
  // Grow it, find the root that hangs lowest from the roof, stand beside it on the floor and jump for it holding grab: she latches
  // on and climbs it (the roots are Trunk, which is walk-through, so the engine's own rule gives her nothing to hold: the climbHold
  // seam does). The same spot and keys without the Overgrowth: nothing to grab.
  const grow = async () => {
    await arena('father-thorne', { x: 430 });
    await page.evaluate(() => window.__fp.ctx.fighters.refill());
    await tick(page, 1);
    await press(page, 'KeyT', 1);
    await tick(page, 130);
  };
  const hanging = () => page.evaluate(({ FLOOR }) => {
    // every 8-connected run of Trunk that touches the roof: its lowest cell and its size
    const w = window.__fp.ctx.world, seen = new Set(), out = [];
    for (let x = 380; x <= 620; x++) {
      const i0 = w.idx(x, 641);
      if (w.types[i0] !== 40 || seen.has(i0)) continue;
      const q = [[x, 641]];
      seen.add(i0);
      let lowY = 641, lowX = x, n = 0;
      while (q.length) {
        const [cx, cy] = q.pop();
        n++;
        if (cy > lowY) { lowY = cy; lowX = cx; }
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 380 || nx > 620 || ny < 641 || ny >= FLOOR) continue;
          const k = w.idx(nx, ny);
          if (w.types[k] === 40 && !seen.has(k)) { seen.add(k); q.push([nx, ny]); }
        }
      }
      out.push({ x, lowX, lowY, n });
    }
    return out;
  }, { FLOOR });
  const jumpFor = async (standX) => {
    await page.evaluate(({ FLOOR, standX }) => { const p = window.__fp.ctx.player; Object.assign(p, { x: standX, y: FLOOR - 1, vx: 0, vy: 0, grounded: true, climbing: false }); }, { FLOOR, standX });
    await tick(page, 2);
    for (const k of ['ShiftLeft', 'KeyD', 'KeyW']) await page.keyboard.down(k);
    let caught = -1;
    for (let t = 1; t <= 45; t++) {
      await tick(page, 1);
      if (await page.evaluate(() => window.__fp.ctx.player.climbing)) { caught = t; break; }
    }
    return caught;
  };
  await grow();
  const roots = (await hanging()).sort((a, b) => b.lowY - a.lowY);
  console.log(`  (hanging roots, lowest first: ${roots.slice(0, 5).map((r) => `x ${r.lowX} tip ${FLOOR - 1 - r.lowY} above the floor, ${r.n} cells`).join('; ')})`);
  check('the Overgrowth hung roots from the roof, big ones, and the lowest comes within 14 cells of the floor (a jump)', roots.length >= 4 && roots[0].n > 30 && FLOOR - 1 - roots[0].lowY <= 14, JSON.stringify(roots.slice(0, 2)));
  const root = roots[0];
  const standX = Math.max(386, root.lowX - 6);
  const caught = await jumpFor(standX);
  const m0 = await page.evaluate(() => ({ climbing: window.__fp.ctx.player.climbing, y: window.__fp.ctx.player.y, x: window.__fp.ctx.player.x }));
  console.log(`  (jumped from x ${standX} at the root's tip ${FLOOR - 1 - root.lowY} cells up; latched on after ${caught} ticks at y ${m0.y})`);
  check('jumping for a root with grab held (a real Shift + D + W): she takes hold of it', caught > 0 && m0.climbing === true, JSON.stringify(m0));
  await frame('thorne-over-7-climb-0');
  await tick(page, 40);
  let m = await page.evaluate(() => ({ climbing: window.__fp.ctx.player.climbing, y: window.__fp.ctx.player.y, x: window.__fp.ctx.player.x, grounded: window.__fp.ctx.player.grounded }));
  console.log(`  (she grabbed at y ${m0.y}, 40 ticks of W later y ${m.y}, climbing ${m.climbing})`);
  check('and W climbs it: she rises 10+ cells up the root, off the ground', m0.y - m.y >= 10 && m.climbing === true && m.grounded === false, JSON.stringify(m));
  await frame('thorne-over-7-climb');
  await zoom('thorne-over-7b-climb', root.lowX, FLOOR - 24, 70, 50);
  for (const k of ['KeyW', 'KeyD']) await page.keyboard.up(k);
  await page.keyboard.down('KeyS');
  await tick(page, 40);
  await page.keyboard.up('KeyS');
  const down = await page.evaluate(() => ({ climbing: window.__fp.ctx.player.climbing, y: window.__fp.ctx.player.y }));
  check('S brings her back down the root', down.y > m.y + 6, JSON.stringify([m, down]));
  await page.keyboard.up('ShiftLeft');
  await tick(page, 30);

  // the control: the same spot, the same keys, no Overgrowth
  await arena('father-thorne', { x: standX });
  const ctlCaught = await jumpFor(standX);
  const ctl = await page.evaluate(() => ({ climbing: window.__fp.ctx.player.climbing, y: window.__fp.ctx.player.y }));
  for (const k of ['KeyW', 'KeyD', 'ShiftLeft']) await page.keyboard.up(k);
  check('CONTROL: the same jump at the same spot without the Overgrowth: nothing to grab', ctlCaught < 0 && ctl.climbing === false, JSON.stringify([ctlCaught, ctl]));

  // the seam only answers for the fighter's own roots: natural Trunk is not a hold
  await arena('father-thorne', { x: 430 });
  await cover(CELL.Trunk, 6, 500, FLOOR - 2);
  check('a Trunk cell that is not hers is not a hand-hold', (await fighters('f.climbHold(502, ' + (FLOOR - 2) + ')')) === false);
}

console.log('\nOvergrowth: fire still burns it');
{
  await arena('father-thorne', { x: 430 });
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await press(page, 'KeyT', 1);
  await tick(page, 130);
  const g = await count([CELL.Trunk, CELL.Moss, CELL.Leaf, CELL.Vines]);
  // light the floor cover, and a spot under the roof
  const lit = await page.evaluate(({ FLOOR }) => {
    const w = window.__fp.ctx.world;
    let n = 0;
    for (let x = 470; x < 640 && n < 6; x++) {
      for (let y = FLOOR - 1; y >= FLOOR - 6; y--) {
        const t = w.types[w.idx(x, y)];
        if (t === 39 || t === 34) { const k = w.idx(x, y - 1); if (w.types[k] === 0) { w.replaceCellAt(k, 5, 0xff7a20); w.life[k] = 120; n++; } break; }
      }
    }
    // and one under a root
    for (let x = 392; x < 500; x++) for (let y = 641; y < 660; y++) if (w.types[w.idx(x, y)] === 40) { const k = w.idx(x + 1, y); if (w.types[k] === 0) { w.replaceCellAt(k, 5, 0xff7a20); w.life[k] = 200; n++; return n; } }
    return n;
  }, { FLOOR });
  check('a fire was lit against the cover', lit >= 2, `${lit} flames`);
  await frame('thorne-over-8-fire-0');
  let left = g, ticks = 0;
  for (; ticks < 1200 && left[CELL.Leaf] + left[CELL.Moss] + left[CELL.Vines] > (g[CELL.Leaf] + g[CELL.Moss] + g[CELL.Vines]) * 0.7; ticks += 20) { await tick(page, 20); left = await count([CELL.Trunk, CELL.Moss, CELL.Leaf, CELL.Vines]); }
  const burnt = await count([CELL.Fire, CELL.Smoke, CELL.Ash, CELL.Ember]);
  console.log(`  (after ${ticks} ticks of fire: ${JSON.stringify(g)} -> ${JSON.stringify(left)}; burnt cells now ${JSON.stringify(burnt)})`);
  check('the fire eats the leaves, moss and vines: 30% of them are gone', left[CELL.Leaf] + left[CELL.Moss] + left[CELL.Vines] <= (g[CELL.Leaf] + g[CELL.Moss] + g[CELL.Vines]) * 0.7, `${JSON.stringify(left)}`);
  check('and it left fire, smoke or ash behind', burnt[CELL.Fire] + burnt[CELL.Smoke] + burnt[CELL.Ash] + burnt[CELL.Ember] > 20, JSON.stringify(burnt));
  await frame('thorne-over-8-fire-1');
}

console.log('\nOvergrowth: the end');
{
  await arena('father-thorne', { x: 430 });
  const solidsStart = await solids();
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await press(page, 'KeyT', 1);
  await tick(page, 80);
  await page.evaluate(() => { const e = window.__fp.spawn('golem', 40, { hp: 9999 }); e.sleeping = true; });
  await tick(page, 7);
  check('foe slowed while the zone stands', (await page.evaluate(() => window.__fp.ctx.fighters.enemySlow(window.__fp.ctx.enemies[0]))) === 0.6);
  // she keeps still the whole time, so the passive also builds: the zone's 0.7 outranks it
  await tick(page, 500); // 587 ticks since the cast
  const grown587 = await count([CELL.Trunk, CELL.Moss, CELL.Leaf, CELL.Vines]);
  const tot = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  check('at 9.8 s the whole zone still stands (a vine lifted into a swaying strand is not counted)', tot(grown587) > 500, JSON.stringify(grown587));
  const v587 = await view(page);
  check('the chip shows the ultimate running (active ring)', v587.ultimate.active > 0.15 && v587.ultimate.active < 0.3, JSON.stringify(v587.ultimate));
  await tick(page, 55); // 642: browning has begun (the first cells brown 90 ticks before the effect ends)
  await zoom('thorne-over-9-browning', 440, 662, 120, 60);
  await frame('thorne-over-9b-browning');
  await sfxClear();
  await tick(page, 90); // 732: the effect has ended
  v587.ultimate = (await view(page)).ultimate;
  check('at 12 s the effect has ended: the chip is no longer active', v587.ultimate.active === 0);
  await page.evaluate(() => { const p = window.__fp.ctx.player; p.vx = 1.5; }); // (moving, so the passive's own cover does not hide her: only the zone's 0.7 could)
  await tick(page, 1);
  check('the zone\'s concealment is over (she is no longer 0.7 hidden)', (await conceal()) < 0.5, `${await conceal()}`);
  const slowEnd = await page.evaluate(() => window.__fp.ctx.fighters.enemySlow(window.__fp.ctx.enemies[0]));
  await tick(page, 14);
  const slowEnd2 = await page.evaluate(() => window.__fp.ctx.fighters.enemySlow(window.__fp.ctx.enemies[0]));
  check('foes are no longer slowed (the slow lapses within a quarter of a second)', slowEnd2 === 1, `${slowEnd} -> ${slowEnd2}`);
  check('the end has a sound (a creak, a settling)', (await sfxLog()).includes('flora.creak'));
  const mid = await count([CELL.Trunk, CELL.Moss, CELL.Leaf, CELL.Vines]);
  console.log(`  (cells: 587 ticks ${tot(grown587)}, 748 ticks ${tot(mid)})`);
  check('it is crumbling now: fewer cells than at 9.8 s', tot(mid) < tot(grown587));
  await zoom('thorne-over-10-withering', 440, 662, 120, 60);
  await tick(page, 160);
  const gone = await count([CELL.Trunk, CELL.Moss, CELL.Leaf, CELL.Vines]);
  console.log(`  (cells at 908 ticks: ${JSON.stringify(gone)})`);
  check('within 3 s of the end it has all withered: no Trunk, no Moss, and at most a stray vine cell or two (a swaying strand the sim let fall)', gone[CELL.Trunk] === 0 && gone[CELL.Moss] === 0 && gone[CELL.Vines] <= 3, JSON.stringify(gone));
  const strandsLeft = await page.evaluate(() => window.__fp.ctx.vineStrands?.strands?.length ?? -1);
  check('and no swaying strand of hers is left hanging (the level\'s own three ropes, and a fragment or two the sim lets fall, at most)', strandsLeft <= 5, `${strandsLeft} strands`);
  check('and at most a few loose leaves rest on the floor (litter the flora\'s own rules keep)', gone[CELL.Leaf] <= 8, `${gone[CELL.Leaf]}`);
  await frame('thorne-over-11-gone');
  const solidsEnd = await solids();
  check('the arena\'s solids are exactly what they were (no root was felled into a log)', solidsEnd === solidsStart, `${solidsStart} -> ${solidsEnd}`);
}

console.log('\nA reset takes back what she grew');
{
  await arena('father-thorne', { x: 430 });
  await aimAt(page, X0 + 100, FLOOR - 9);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 40);
  await press(page, 'KeyT', 1);
  await tick(page, 70);
  const g = await count([CELL.Trunk, CELL.Moss, CELL.Leaf, CELL.Vines]);
  check('both are standing', g[CELL.Vines] > 50 && g[CELL.Trunk] > 100, JSON.stringify(g));
  await page.evaluate(() => window.__fp.ctx.fighters.reset()); // a respawn
  await tick(page, 2);
  const r = await count([CELL.Trunk, CELL.Moss, CELL.Leaf, CELL.Vines]);
  check('a respawn clears the vines and the whole zone at once (but for a loose leaf or two that had already fluttered off its cell: flora litter)', r[CELL.Vines] === 0 && r[CELL.Trunk] === 0 && r[CELL.Moss] === 0 && r[CELL.Leaf] <= 3, JSON.stringify(r));
  check('and her concealment with it', (await conceal()) === 0);
  check('the drawable is put back after a reset', (await fighters('f.drawables.length')) === 1);
}

console.log('\nThe classic Alchemist is untouched');
{
  await arena(null);
  await aimAt(page, X0 + 100, FLOOR - 9);
  await tick(page, 2);
  await press(page, 'KeyZ', 2);
  await press(page, 'KeyT', 2);
  await tick(page, 30);
  const c = await count([CELL.Trunk, CELL.Moss, CELL.Leaf, CELL.Vines]);
  const v = await view(page);
  check('with no fighter Z and T do nothing: no vines, no growth, no drawables', v.id === null && Object.values(c).every((n) => n === 0) && (await fighters('f.drawables.length')) === 0 && (await conceal()) === 0, JSON.stringify(c));
}

const pageErrors = await finish();
check('no page errors', pageErrors === 0);
console.log(`\nfighter thorne probe: ${tally.pass} passed, ${tally.fail} failed`);
process.exit(tally.fail ? 1 : 0);

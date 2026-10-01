// Kest Rel, the Chimney Jack, against the REAL engine (docs/fighters/kest-rel.md): Rooftop Runner (a permanent
// climb modifier: timed against the classic Alchemist on the same wall, and a mantle only she can reach), Smoke
// Step (Z: a dash with i-frames that leaves real Smoke and changes what an enemy notices) and Updraft (T: a
// furnace whose column of Fire and Steam lifts her, a foe and a crate, and carries her to a ledge the classic
// Alchemist cannot reach). Real key presses, paused deterministic ticks, observable effects in the grid, the
// player and the foes, plus the negative cases (no room, cooling down, bar not full, no floor, a low roof, water).
// Usage: node scripts/verify-fighter-kest.mjs [url]   (dev server running; screenshots to verify-out/fighters/)
import { mkdirSync } from 'node:fs';
import { aimAt, boot, makeChecker, me, press, tick, view } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const tally = makeChecker();
const check = tally.check;
const { page, finish } = await boot(url, { fighter: 'kest-rel', viewport: { width: 1920, height: 1080 } });
mkdirSync('verify-out/fighters', { recursive: true });

const FLOOR = 690; // the arena floor's top row: the body stands at FLOOR - 1
const X0 = 440; // where she starts
const KEYS = ['ShiftLeft', 'KeyD', 'KeyW', 'KeyA', 'KeyS', 'Space', 'KeyZ', 'KeyT'];

/** A clean arena: foes, bodies, particles and every cell above the floor cleared, the fighter equipped fresh. */
async function arena(fighter, { x = X0, jet = false, headroom = true } = {}) {
  for (const k of KEYS) await page.keyboard.up(k);
  await page.evaluate(async ({ fighter, x, jet, headroom, FLOOR }) => {
    const f = window.__fp, c = f.ctx, p = c.player;
    c.enemies.length = 0;
    for (const b of [...c.rigidBodies.bodies]) if (b.x > 380 && b.x < 620 && b.y > 460 && b.y < 700) c.rigidBodies.remove(b);
    c.particles.clear();
    // the level's loot (a chest at 480,612 in this arena): a card she brushes against opens the card-offer overlay, and while
    // it is up the input layer ignores every gameplay key (KEYBOARD_UI_BLOCK_SELECTOR), so the next Z or T press would be eaten
    if (c.levels.current?.pickups) c.levels.current.pickups.length = 0;
    document.querySelector('#card-offer-overlay')?.classList.remove('visible');
    f.carve(380, headroom ? 470 : 600, 620, FLOOR - 1);
    for (const k of Object.keys(c.input.keys)) c.input.keys[k] = false;
    c.chill?.reset(); // (an ice shell would root her: no abilities while it holds)
    c.fighters.equip(fighter);
    await c.fighters.whenReady();
    Object.assign(p, {
      x, y: FLOOR - 1, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, climbing: false, crawling: false, swinging: false, invuln: 0,
      hp: 100, maxHp: 100, dead: false, recharge: 0, pullT: 0, maxLevit: jet ? 140 : 0, levit: jet ? 140 : 0, aimAngle: 0, facing: 1,
    });
    Object.assign(p.status, { burning: 0, wet: 0, oiled: 0 });
    c.state.arrivalGraceUntil = 0;
  }, { fighter, x, jet, headroom, FLOOR });
  await tick(page, 3);
}

/** Every material count the sim could change in a way that matters for a route: the solids and powders. */
const solids = () => page.evaluate(() => {
  const w = window.__fp.ctx.world;
  // the solids and powders a body cannot walk through: sand, wall, wood, gunpowder, ice, stone, metal, vines, gold, snow, coal, crystal, glass, catalyst, ore, trunk, mirror
  const blocking = new Set([1, 3, 4, 8, 10, 12, 13, 15, 17, 27, 28, 29, 31, 35, 36, 40, 43]);
  const out = {};
  for (let y = 470; y <= 700; y++) for (let x = 380; x <= 620; x++) { const t = w.types[w.idx(x, y)]; if (blocking.has(t)) out[t] = (out[t] ?? 0) + 1; }
  return JSON.stringify(out);
});
const count = (type, x0, y0, x1, y1) => page.evaluate(({ type, x0, y0, x1, y1 }) => window.__fp.count(type, x0, y0, x1, y1), { type, x0, y0, x1, y1 });
const CELL = { Fire: 5, Smoke: 14, Steam: 9, Water: 2, Stone: 12 };

/** A zoomed crop of the canvas around world point (cx, cy), `w` x `h` cells (the viewport is 3 px a cell). */
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

// ================================================================================ Rooftop Runner
console.log('\nRooftop Runner');
{
  await arena(null);
  check('the classic Alchemist climbs at x1', (await page.evaluate(() => window.__fp.ctx.fighters.climbScale())) === 1);
  await arena('kest-rel');
  check('Kest\'s climbScale is a standing x1.5', (await page.evaluate(() => window.__fp.ctx.fighters.climbScale())) === 1.5);

  // The same wall, the same keys, ticks to climb 30 cells.
  const climb = async (fighter) => {
    await arena(fighter, { x: 553 });
    await page.evaluate(() => window.__fp.wall(560, 480, 580, 689));
    await tick(page, 2);
    for (const k of ['ShiftLeft', 'KeyD', 'KeyW']) await page.keyboard.down(k);
    const y0 = (await me(page)).y;
    let ticks = -1;
    for (let t = 1; t <= 200; t++) {
      await tick(page, 1);
      if (y0 - (await me(page)).y >= 30) { ticks = t; break; }
    }
    for (const k of ['KeyW', 'KeyD', 'ShiftLeft']) await page.keyboard.up(k);
    return ticks;
  };
  const classic = await climb(null);
  const kest = await climb('kest-rel');
  console.log(`  (30 cells up the same wall: classic ${classic} ticks, Kest ${kest} ticks, ratio ${(classic / kest).toFixed(2)})`);
  check('Kest climbs 30 cells in about two thirds of the classic time', kest > 0 && classic > 0 && kest <= classic * 0.75 && kest >= classic * 0.55, `classic ${classic}, kest ${kest}`);

  // A mantle: a wall topped by a slab `t` thick, with an 11-cell gap between the wall top and the slab. The wall top
  // is not standable (the slab is too close above it), so the body must top out onto the slab: 17 + t cells above
  // where the face runs out. The classic mantle reaches 20 cells, hers 24.
  const mantle = async (fighter, t) => {
    await arena(fighter, { x: 553 });
    const T1 = FLOOR - 40, B = T1 - 12, top = B - t + 1;
    await page.evaluate(({ T1, B, t, FLOOR }) => { const f = window.__fp; f.wall(560, T1, 580, FLOOR - 1); f.wall(540, B - t + 1, 600, B); }, { T1, B, t, FLOOR });
    await tick(page, 2);
    for (const k of ['ShiftLeft', 'KeyD', 'KeyW']) await page.keyboard.down(k);
    let last = null;
    for (let i = 0; i < 160; i++) {
      await tick(page, 1);
      last = await me(page);
      if (last.grounded && last.y < FLOOR - 5) break;
    }
    for (const k of ['KeyW', 'KeyD', 'ShiftLeft']) await page.keyboard.up(k);
    return { onSlab: last.grounded && last.y === top - 1, y: last.y, standY: top - 1, reach: 17 + t };
  };
  const m3c = await mantle(null, 3), m3k = await mantle('kest-rel', 3);
  const m5c = await mantle(null, 5), m5k = await mantle('kest-rel', 5);
  await frame('kest-mantle-top');
  const m7k = await mantle('kest-rel', 7);
  const m8k = await mantle('kest-rel', 8);
  check('a ledge 20 cells up (the classic mantle reach): both top out', m3c.onSlab && m3k.onSlab, JSON.stringify([m3c, m3k]));
  check('a ledge 22 cells up: the classic Alchemist cannot mantle it', !m5c.onSlab, JSON.stringify(m5c));
  check('a ledge 22 cells up: Kest tops out onto it and stands', m5k.onSlab, JSON.stringify(m5k));
  check('a ledge 24 cells up: Kest still reaches it', m7k.onSlab, JSON.stringify(m7k));
  check('a ledge 25 cells up: beyond even her reach (the bonus is bounded)', !m8k.onSlab, JSON.stringify(m8k));

  // The modifier outlives a floor change (every modifier is cleared there; the kit puts the passive back).
  await arena('kest-rel');
  await page.evaluate(() => window.__fp.ctx.events.emit('levelChanged', { depth: 2, name: 'x' }));
  await tick(page, 2);
  check('the passive is back after a floor change', (await page.evaluate(() => window.__fp.ctx.fighters.climbScale())) === 1.5);
}

// ================================================================================ Smoke Step
console.log('\nSmoke Step');
{
  await arena('kest-rel');
  let v = await view(page);
  check('the chip names the ability and is ready', v.tactical.name === 'Smoke Step' && v.tactical.ready === true);
  const before = await solids();
  await aimAt(page, X0 + 100, FLOOR - 1 - 9);
  await tick(page, 2);
  const x0 = (await me(page)).x;
  await frame('kest-dash-0-before');
  await press(page, 'KeyZ', 1);
  // i-frames: a blow in the middle of the dash does nothing
  const hpMid = await page.evaluate(() => { const c = window.__fp.ctx; const hp = c.player.hp; c.playerCtl.damage(20, 0, 0, 'probe'); return { hp, now: c.player.hp, inv: c.player.invuln }; });
  check('i-frames: a blow landing mid-dash does nothing', hpMid.now === hpMid.hp && hpMid.inv > 0, JSON.stringify(hpMid));
  check('the body is carried by the dash (the player\'s own movement stands aside)', (await page.evaluate(() => window.__fp.ctx.fighters.ownsMovement)) === true);
  check('the cover is on at once: concealment 0.6', Math.abs((await page.evaluate(() => window.__fp.ctx.fighters.concealment())) - 0.6) < 1e-6);
  await tick(page, 2);
  await zoom('kest-dash-1-mid', X0 + 18, FLOOR - 14, 110, 50);
  for (let i = 0; i < 12 && (await page.evaluate(() => window.__fp.ctx.fighters.ownsMovement)); i++) await tick(page, 1);
  let m = await me(page);
  check('the dash carried her 36 cells along the aim (6 ticks of 6)', m.x - x0 >= 35 && m.x - x0 <= 37 && m.y === FLOOR - 1, `moved ${m.x - x0}, y ${m.y}`);
  check('she keeps her momentum on exit', m.vx > 1, `vx ${m.vx}`);
  const startPuff = await count(CELL.Smoke, x0 - 9, FLOOR - 20, x0 + 9, FLOOR);
  const endPuff = await count(CELL.Smoke, m.x - 9, FLOOR - 20, m.x + 9, FLOOR);
  check('real Smoke cells stand where she started', startPuff >= 60, `${startPuff} cells`);
  check('real Smoke cells stand where she ended', endPuff >= 60, `${endPuff} cells`);
  await zoom('kest-dash-2-end', X0 + 18, FLOOR - 14, 110, 50);
  // the smoke has a life: it does not vanish at once, it thins and rises, and it is gone by itself
  await tick(page, 14);
  const startLater = await count(CELL.Smoke, x0 - 12, FLOOR - 50, x0 + 12, FLOOR);
  check('the smoke is still there 20 ticks on (it was not written to vanish at once)', startLater >= startPuff * 0.6, `${startLater} of ${startPuff}`);
  await tick(page, 70);
  const allSmoke = await count(CELL.Smoke, 380, 470, 620, 700);
  check('and it has burned off on its own by 90 ticks', allSmoke === 0, `${allSmoke} left`);
  check('it wrote nothing but smoke: no solid, no powder, no liquid changed', (await solids()) === before);
  v = await view(page);
  check('the chip is cooling (8 s)', v.tactical.ready === false && v.tactical.cooldownSeconds >= 7 && v.tactical.cooldownSeconds <= 8, JSON.stringify(v.tactical));
  // the i-frames end with the dash: a blow now lands
  await page.evaluate(() => { window.__fp.ctx.player.invuln = 0; });
  const hp1 = (await me(page)).hp;
  await page.evaluate(() => window.__fp.ctx.playerCtl.damage(10, 0, 0, 'probe'));
  check('the i-frames were only for the dash', (await me(page)).hp < hp1);
  // cooling down: Z again is refused and nothing happens
  const refusedBefore = v.tactical.refusedAt;
  const xc = (await me(page)).x;
  await press(page, 'KeyZ', 1);
  await tick(page, 3);
  v = await view(page);
  check('pressed while cooling: refused, no dash, no new smoke', v.tactical.refusedAt > refusedBefore && (await me(page)).x === xc && (await count(CELL.Smoke, 380, 470, 620, 700)) === 0);
  await tick(page, 460);
  check('the cooldown runs out (480 ticks)', (await view(page)).tactical.ready === true);
}

console.log('\nSmoke Step: where it goes');
{
  // a wall in the way: she stops at it
  await arena('kest-rel');
  await page.evaluate(() => window.__fp.wall(466, 600, 480, 689));
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  for (let i = 0; i < 12 && (await page.evaluate(() => window.__fp.ctx.fighters.ownsMovement)); i++) await tick(page, 1);
  let m = await me(page);
  check('the dash ends at a wall (her edge against the stone)', m.x >= 466 - 4 - 3 && m.x <= 466 - 4 - 1, `x ${m.x}`);
  // no room: a wall at her nose refuses and costs nothing
  await arena('kest-rel');
  await page.evaluate((X0) => window.__fp.wall(X0 + 7, 600, X0 + 20, 689), X0);
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  const t0 = (await view(page)).tactical;
  await press(page, 'KeyZ', 1);
  await tick(page, 2);
  let v = await view(page);
  check('no room: refused, the cooldown is not spent, she has not moved, nothing was written',
    v.tactical.ready === true && v.tactical.usedAt === t0.usedAt && v.tactical.refusedAt > t0.refusedAt && (await me(page)).x === X0 && (await count(CELL.Smoke, 380, 470, 620, 700)) === 0, JSON.stringify(v.tactical));
  // aimed a little into the floor: she skims along it at full speed
  await arena('kest-rel');
  await aimAt(page, X0 + 100, FLOOR + 10);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  for (let i = 0; i < 12 && (await page.evaluate(() => window.__fp.ctx.fighters.ownsMovement)); i++) await tick(page, 1);
  m = await me(page);
  check('aimed into the floor she skims it: 36 cells along the ground', m.x - X0 >= 35 && m.y === FLOOR - 1, `moved ${m.x - X0}, y ${m.y}`);
  // aimed up and back: left and 45 degrees up, she ends higher, facing left, still rising
  await arena('kest-rel', { x: 520 });
  await aimAt(page, 520 - 100, FLOOR - 9 - 100);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  for (let i = 0; i < 12 && (await page.evaluate(() => window.__fp.ctx.fighters.ownsMovement)); i++) await tick(page, 1);
  m = await me(page);
  check('aimed up and left: 25 cells up, 25 cells back, facing left, rising on exit', m.x <= 520 - 24 && m.x >= 520 - 27 && m.y <= FLOOR - 1 - 23 && m.facing === -1 && m.vy < 0, JSON.stringify(m));
  await tick(page, 60);
  check('and she lands again, whole', (await me(page)).grounded === true && (await me(page)).hp === 100);
}

console.log('\nSmoke Step: what an enemy notices');
{
  // The same foe at the same distance from the same body, with and without the cover. Eyes reach as far as
  // sightRangeScale(light) x 265: concealment 0.6 scales the light by 0.4 and the range with it (Enemies.update).
  // (the dash's own footfalls are a SOUND, a different sense: the foe is spawned once those have aged out, 95 ticks on, in both runs)
  const trial = async (dist, covered) => {
    await arena('kest-rel');
    if (covered) {
      await aimAt(page, 380, FLOOR - 10); // dash away from where the foe will stand, then come back
      await tick(page, 2);
      await press(page, 'KeyZ', 1);
      await tick(page, 10);
      await page.evaluate((X0) => { const p = window.__fp.ctx.player; p.x = X0; p.vx = 0; }, X0);
      await tick(page, 2);
    } else await tick(page, 13);
    await tick(page, 80);
    const conceal = await page.evaluate(() => window.__fp.ctx.fighters.concealment());
    await page.evaluate((dist) => { window.__fp.spawn('slime', dist, { hp: 9999 }); }, dist);
    let seen = 0, conf = 0;
    for (let i = 0; i < 50; i++) {
      await tick(page, 1);
      const s = await page.evaluate(() => { const e = window.__fp.ctx.enemies[0]; if (e?.mind) e.mind.facing = -1; return { vis: e?.mind?.visible === true, conf: e?.mind?.confidence ?? 0 }; });
      if (s.vis) seen++;
      conf = Math.max(conf, s.conf);
    }
    const e = await page.evaluate(() => { const e = window.__fp.ctx.enemies[0]; return { alerted: e.alerted === true, intent: e.mind?.intent }; });
    return { dist, covered, conceal, seen, conf, ...e };
  };
  const rows = [];
  for (const d of [60, 100, 150, 170]) { rows.push(await trial(d, false), await trial(d, true)); }
  for (const r of rows) console.log(`  ${r.dist} cells, ${r.covered ? 'covered  ' : 'uncovered'}: seen ${String(r.seen).padStart(2)}/50 ticks, confidence ${r.conf.toFixed(2)}, alerted ${r.alerted}, ${r.intent}`);
  const at = (d, c) => rows.find((r) => r.dist === d && r.covered === c);
  check('uncovered, a foe 100-170 cells off sees her, is alerted and hunts', [100, 150, 170].every((d) => at(d, false).seen > 20 && at(d, false).alerted && at(d, false).intent === 'hunt'));
  check('covered, the same foe at the same distance never sees her, is not alerted, and goes on foraging', [100, 150, 170].every((d) => at(d, true).seen === 0 && !at(d, true).alerted && at(d, true).conf === 0 && at(d, true).intent === 'forage'));
  check('the cover is a shorter sight line, not invisibility: a foe 60 cells off still sees her', at(60, true).seen > 20 && at(60, true).alerted);
  check('the trial is honest: the covered runs had concealment 0.6 and the uncovered 0', rows.every((r) => Math.abs(r.conceal - (r.covered ? 0.6 : 0)) < 1e-6));
  // and when the 150 ticks run out, the same foe at the same distance sees her again
  await arena('kest-rel');
  await aimAt(page, 380, FLOOR - 10);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 170);
  await page.evaluate((X0) => { const p = window.__fp.ctx.player; p.x = X0; p.vx = 0; }, X0);
  await tick(page, 2);
  const concealLater = await page.evaluate(() => window.__fp.ctx.fighters.concealment());
  await page.evaluate(() => { window.__fp.spawn('slime', 150, { hp: 9999 }); });
  let seen = 0;
  for (let i = 0; i < 40; i++) { await tick(page, 1); seen += (await page.evaluate(() => { const e = window.__fp.ctx.enemies[0]; if (e?.mind) e.mind.facing = -1; return e?.mind?.visible ? 1 : 0; })); }
  check('after 150 ticks the cover has lapsed and the foe at 150 sees her again', concealLater === 0 && seen > 10, `concealment ${concealLater}, seen ${seen}`);
}

// ================================================================================ Updraft
console.log('\nUpdraft');
{
  const MOUTH = FLOOR - 1 - 8;
  let m;
  await arena('kest-rel');
  let v = await view(page);
  check('the chip names the ability; the bar starts empty', v.ultimate.name === 'Updraft' && v.ultimate.ready === false);
  await press(page, 'KeyT', 1);
  await tick(page, 2);
  v = await view(page);
  check('bar not full: T is refused, no furnace', v.ultimate.active === 0 && v.ultimate.refusedAt > 0 && (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 0);

  // ---- alone: light it and ride ----
  await arena('kest-rel');
  const before = await solids();
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  check('a full bar makes it ready', (await view(page)).ultimate.ready === true);
  await press(page, 'KeyT', 1);
  v = await view(page);
  check('T lights it: the ultimate is running and the bar is spent', v.ultimate.active > 0.9 && v.ultimate.charge < 0.05, JSON.stringify(v.ultimate));
  check('the furnace is a drawable in the world', (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 1);
  await zoom('kest-updraft-0-light', X0, FLOOR - 25, 90, 60);
  await tick(page, 3);
  const fire3 = await count(CELL.Fire, X0 - 6, MOUTH - 10, X0 + 6, MOUTH + 1);
  check('real Fire burns in the furnace\'s mouth', fire3 >= 6, `${fire3} cells`);
  const burn = [];
  await tick(page, 30);
  burn.push((await me(page)).status.burning);
  await zoom('kest-updraft-1-flame', X0, FLOOR - 30, 90, 90);
  const steamAbove = await count(CELL.Steam, X0 - 12, MOUTH - 70, X0 + 12, MOUTH - 14);
  const fireAbove = await count(CELL.Fire, X0 - 12, MOUTH - 70, X0 + 12, MOUTH - 14);
  const fireAll = await count(CELL.Fire, X0 - 20, MOUTH - 70, X0 + 20, MOUTH + 4);
  console.log(`  (33 ticks in: ${fire3} fire cells in the mouth, ${fireAll} in all, ${steamAbove} steam and ${fireAbove} fire more than 14 cells above it)`);
  check('Steam rises up the column from it (cells more than 14 above the mouth)', steamAbove >= 4, `${steamAbove} steam, ${fireAbove} fire`);
  check('the Fire stays in the mouth: it is not a wall of flame up the draft', fireAbove <= 25, `${fireAbove} fire cells high up`);
  m = await me(page);
  console.log(`  (she is ${FLOOR - 1 - m.y} cells above the floor, vy ${m.vy}, 33 ticks in)`);
  check('she is lifted clear of the floor by the draft', m.y < FLOOR - 1 - 40 && m.grounded === false, JSON.stringify(m));
  await tick(page, 40);
  const hover = [];
  for (let i = 0; i < 8; i++) { await tick(page, 10); const q = await me(page); hover.push(q.y); burn.push(q.status.burning); }
  const settled = hover.slice(3); // the first samples are still settling out of the overshoot
  const hMin = Math.min(...settled), hMax = Math.max(...settled);
  console.log(`  (hovering ${FLOOR - 1 - hMax}..${FLOOR - 1 - hMin} cells above the floor; the whole run ${hover.map((y) => FLOOR - 1 - y).join(' ')})`);
  check('she settles at a hover 55-80 cells above the floor, steady (no bobbing)', FLOOR - 1 - hMax >= 55 && FLOOR - 1 - hMin <= 80 && hMax - hMin <= 3, `${hover.join(',')}`);
  check('her own furnace does not hurt her (no burning, no damage the whole ride)', burn.every((b) => b === 0) && (await me(page)).hp === 100);
  await frame('kest-updraft-2-ride');
  // ---- it ends: the flame goes out, she glides down, the iron cools and leaves ----
  await tick(page, 150);
  await zoom('kest-updraft-3-fade', X0, FLOOR - 40, 110, 110);
  await tick(page, 30);
  m = await me(page);
  check('the flame is dying: she is coming down', m.y > hMax + 3, `y ${m.y} (hover was ${hMax})`);
  await tick(page, 50);
  m = await me(page);
  check('she has landed, unhurt', m.grounded === true && m.hp === 100, JSON.stringify(m));
  check('the iron is still there, cooling, a moment after the flame', (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 1);
  await zoom('kest-updraft-5-cooling', X0, FLOOR - 20, 90, 60);
  await tick(page, 70);
  const fireLeft = await count(CELL.Fire, 380, 470, 620, 700);
  check('the Fire is out', fireLeft === 0, `${fireLeft} cells`);
  check('the furnace has left the world (the drawable is gone)', (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 0);
  await tick(page, 100);
  check('it wrote no solid or powder that stays (every route is as it was)', (await solids()) === before, `${await count(CELL.Steam, 380, 470, 620, 700)} steam left`);
  v = await view(page);
  check('the ultimate is spent: the bar is back at its trickle and the chip is no longer active', v.ultimate.active === 0 && v.ultimate.charge < 0.05, JSON.stringify(v.ultimate));
}

console.log('\nUpdraft: what it carries');
{
  await arena('kest-rel');
  const before = await solids();
  // two stone crates settle on the floor: one in the draft, one well outside it
  await page.evaluate(({ FLOOR }) => {
    const c = window.__fp.ctx;
    c.rigidBodies.spawn({ kind: 'box', halfW: 4, halfH: 4 }, 440 - 8, FLOOR - 6, { material: 'stone' });
    c.rigidBodies.spawn({ kind: 'box', halfW: 4, halfH: 4 }, 440 + 70, FLOOR - 6, { material: 'stone' });
  }, { FLOOR });
  await tick(page, 40);
  const bodies = () => page.evaluate(() => window.__fp.ctx.rigidBodies.bodies.filter((b) => b.x > 380 && b.x < 620 && b.y > 300 && b.y < 700).map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) })));
  const crates0 = await bodies();
  // foes go into the draft as it is lit: one beside the axis (outside the flame), one out in the open
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await page.evaluate(() => { const f = window.__fp; f.spawn('slime', 9, { hp: 400 }); f.spawn('slime', 100, { hp: 400 }); });
  const slimeY = () => page.evaluate(() => { const [a, b] = window.__fp.ctx.enemies; return { a: a ? { x: a.x, y: a.y, hp: a.hp, knockT: a.knockT ?? 0 } : null, b: b ? { x: b.x, y: b.y } : null }; });
  const f0 = await slimeY();
  await press(page, 'KeyT', 1);
  const trace = [];
  for (let i = 0; i < 12; i++) { await tick(page, 5); const s = await slimeY(); trace.push(f0.a.y - (s.a?.y ?? f0.a.y)); }
  const f1 = await slimeY();
  console.log(`  (the foe's height gained every 5 ticks: ${trace.join(' ')}; crates ${JSON.stringify(crates0)} -> ${JSON.stringify(await bodies())})`);
  check('a foe beside the axis is carried up: more than 40 cells in 30 ticks', Math.max(...trace.slice(0, 6)) > 40, trace.join(','));
  check('and it is carried by its velocity, not teleported: it rises smoothly (no step over 8 cells a tick)', trace.every((h, i) => i === 0 || h - trace[i - 1] <= 8 * 5));
  check('a foe out in the open is not carried (nothing like the 100 cells the one in the draft gained)', f1.b !== null && f1.b.y >= f0.b.y - 30, JSON.stringify([f0.b, f1.b])); // (a slime hops about 17 cells; the draft would have carried it 100)
  const crates1 = await bodies();
  const inDraft = crates1.find((b) => b.x < 470), outside = crates1.find((b) => b.x > 480);
  const inDraft0 = crates0.find((b) => b.x < 470), outside0 = crates0.find((b) => b.x > 480);
  check('the crate in the draft floats up (stone, 20+ cells), the one outside stays put',
    inDraft !== undefined && inDraft.y < inDraft0.y - 20 && outside !== undefined && Math.abs(outside.y - outside0.y) < 3, JSON.stringify([inDraft0, inDraft, outside0, outside]));
  // out of the top of the draft it is thrown clear of the axis, lands outside the column, and is not caught again at once
  const away = [], lows = [];
  for (let i = 0; i < 18; i++) { await tick(page, 5); const q = await slimeY(); away.push(Math.abs(q.a.x - 440)); lows.push(q.a.y); }
  const f2 = await slimeY();
  console.log(`  (after the top: its distance from the axis every 5 ticks ${away.join(' ')})`);
  check('out of the top of the draft the foe is thrown clear of the axis (20+ cells), lands on the floor and lives', Math.max(...away) >= 20 && lows.includes(FLOOR - 1) && f2.a.hp > 100, JSON.stringify(f2.a));
  await tick(page, 400);
  check('it wrote no solid or powder that stays', (await solids()) === before);
}

console.log('\nUpdraft: a ledge she could not otherwise reach');
{
  // A ledge whose top is 56 cells above the floor, beside the draft (the column is 9 cells either side of her axis).
  const LEDGE_TOP = FLOOR - 56;
  const build = () => page.evaluate(({ LEDGE_TOP }) => window.__fp.wall(456, LEDGE_TOP, 560, LEDGE_TOP + 3), { LEDGE_TOP });
  const onLedge = (m) => m.grounded && m.y === LEDGE_TOP - 1 && m.x > 452;

  // the classic Alchemist, jet drained: a jump and the walk toward it
  await arena(null);
  await build();
  let best = FLOOR;
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 120; i++) { await tick(page, 1); best = Math.min(best, (await me(page)).y); }
  await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW');
  let m = await me(page);
  console.log(`  (the classic Alchemist, jet empty, jumping toward it: highest ${FLOOR - 1 - best} cells above the floor; the ledge is ${FLOOR - LEDGE_TOP})`);
  check('the classic Alchemist (jet empty) cannot reach it by jumping', !onLedge(m) && FLOOR - 1 - best < FLOOR - LEDGE_TOP - 15, JSON.stringify(m));

  // and with the jet full: informational (the jet is a separate resource; the ledge is out of reach of a jump)
  await arena(null, { jet: true });
  await build();
  best = FLOOR;
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 120; i++) { await tick(page, 1); best = Math.min(best, (await me(page)).y); }
  await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW');
  console.log(`  (for the record: with the jet full the classic Alchemist rises ${FLOOR - 1 - best} cells)`);

  // Kest: light the furnace, rise, and walk off the draft onto the ledge
  await arena('kest-rel');
  await build();
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await press(page, 'KeyT', 1);
  let top = FLOOR;
  for (let i = 0; i < 70; i++) { await tick(page, 1); top = Math.min(top, (await me(page)).y); }
  m = await me(page);
  console.log(`  (riding: ${FLOOR - 1 - m.y} cells up after 70 ticks, peak ${FLOOR - 1 - top})`);
  check('riding the draft she gets above the ledge\'s top', m.y < LEDGE_TOP - 1, JSON.stringify(m));
  await page.keyboard.down('KeyD');
  for (let i = 0; i < 90 && !onLedge(await me(page)); i++) await tick(page, 1);
  await page.keyboard.up('KeyD');
  m = await me(page);
  await frame('kest-updraft-4-ledge');
  check('she steps off the draft and stands on the ledge', onLedge(m), JSON.stringify(m));
  // the draft goes on without her: she stays on the ledge (nothing carries her off) and the flame dies as it should
  await tick(page, 400);
  m = await me(page);
  check('and after the flame dies she is still on the ledge, safe', onLedge(m) && m.hp === 100, JSON.stringify(m));
}

console.log('\nUpdraft: where it cannot be lit');
{
  const cases = [
    ['a roof 15 cells over her (no room to ride)', async () => { await page.evaluate(({ FLOOR }) => window.__fp.wall(380, FLOOR - 40, 620, FLOOR - 16), { FLOOR }); }],
    ['in water', async () => { await page.evaluate(({ FLOOR }) => { const w = window.__fp.ctx.world; for (let y = FLOOR - 20; y < FLOOR; y++) for (let x = 400; x <= 480; x++) w.replaceCellAt(w.idx(x, y), 2, 0x2060f0); }, { FLOOR }); }],
    ['over a pit with no floor under her', async () => {
      await page.evaluate(({ FLOOR }) => { const f = window.__fp, p = f.ctx.player; f.carve(400, FLOOR - 1, 480, FLOOR + 6); p.y = FLOOR - 30; p.grounded = false; }, { FLOOR });
    }],
  ];
  for (const [name, setup] of cases) {
    await arena('kest-rel');
    await setup();
    await page.evaluate(() => window.__fp.ctx.fighters.refill());
    await tick(page, 1);
    const charge0 = (await view(page)).ultimate.charge;
    await press(page, 'KeyT', 1);
    await tick(page, 2);
    const v = await view(page);
    check(`${name}: refused, the bar is kept, no furnace`, v.ultimate.active === 0 && v.ultimate.charge >= charge0 && v.ultimate.refusedAt > 0 && (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 0, JSON.stringify(v.ultimate));
  }
  // Fail-open: lit on a floor, with a slime in the draft, over a wooden bridge: smoke and fire only, nothing sealed (checked above by the census).
}

console.log('\nThe classic Alchemist is untouched');
{
  await arena(null);
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  await press(page, 'KeyZ', 2);
  await press(page, 'KeyT', 2);
  const v = await view(page);
  check('with no fighter Z and T do nothing: no dash, no furnace, no smoke', v.id === null && (await me(page)).x === X0 && (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 0 && (await count(CELL.Smoke, 380, 470, 620, 700)) === 0);
}

const pageErrors = await finish();
check('no page errors', pageErrors === 0);
console.log(`\nfighter kest probe: ${tally.pass} passed, ${tally.fail} failed`);
process.exit(tally.fail ? 1 : 0);

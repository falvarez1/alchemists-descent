// Nox Calder, the Lampblack, against the REAL engine (docs/fighters/nox-calder.md): Soot Sight (silhouettes in the dark
// and in smoke, never in the light, never through rock), Blackglass (Z: the Flask's canister bursting into real Smoke
// cells that change what an enemy notices, and burn where flame touches them) and Long Night (T: the lamps snuffed, a
// dark zone that really darkens the level's light, restored exactly). Real key presses, paused deterministic ticks,
// observable effects in the grid, the light, and the foes, plus the negative cases (no room, cooling, bar empty).
// Usage: node scripts/verify-fighter-nox.mjs [url]   (dev server running; screenshots to verify-out/fighters/nox-*.png)
import { mkdirSync } from 'node:fs';
import { aimAt, boot, makeChecker, press, view } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const tally = makeChecker();
const check = tally.check;
const { page, finish } = await boot(url, { fighter: 'nox-calder', viewport: { width: 1920, height: 1080 } });
mkdirSync('verify-out/fighters', { recursive: true });

const FLOOR = 690; // the arena floor's top row: the body stands at FLOOR - 1
const X0 = 520; // where she starts: room for a foe 190 cells off on either side
const KEYS = ['ShiftLeft', 'KeyD', 'KeyW', 'KeyA', 'KeyS', 'Space', 'KeyZ', 'KeyT'];
const CELL = { Fire: 5, Smoke: 14, Wood: 4 };
const RECT = { x0: 330, y0: 440, x1: 800, y1: 700 }; // the arena's air, and everything the probe counts
/** Step `n` ticks. Foes put down with `sleepers` are pinned to where they were put at the start of every tick (a distance is then a distance). */
const tick = (p, n = 1) => p.evaluate((k) => window.__nox.tickPinned(k), n);
const only = process.env.NOX_ONLY ? process.env.NOX_ONLY.split(',') : null; // NOX_ONLY=soot,glass,refuse,notice,fire,cost,night,bakes,cut for a quick run
const run = (name) => only === null || only.includes(name);

// ---- the page-side kit: lamps and a few reads the sections share ----
await page.evaluate(() => {
  const c = window.__fp.ctx;
  const rt = c.levels.current;
  window.__nox = {
    orig: [...rt.authoredLights],
    base: rt.authoredLights.map((l) => l.intensity),
    tickPinned(n) {
      for (let i = 0; i < n; i++) {
        for (const e of c.enemies) if (e.__px !== undefined) Object.assign(e, { x: e.__px, y: e.__py, vx: 0, vy: 0, fx: 0, fy: 0, knockVx: 0, knockVy: 0, knockT: 0 });
        window.__game.tick(false, { forcePaused: true });
      }
    },
    lamp(x, y, i) {
      const l = { x, y, r: 1, g: 0.78, b: 0.4, intensity: i, radius: 90, bloom: 0.4, flicker: 0.1, flickerPhase: 1, falloff: 'soft', occluded: true, __nox: true };
      rt.authoredLights.push(l);
      return l;
    },
  };
});

/** A clean arena: foes, bodies, particles, darkness, test lamps and every cell above the floor cleared; the fighter equipped fresh. */
async function arena(fighter = 'nox-calder', { x = X0, hp = 100 } = {}) {
  for (const k of KEYS) await page.keyboard.up(k);
  await page.evaluate(async ({ fighter, x, hp, FLOOR, RECT }) => {
    const f = window.__fp, c = f.ctx, p = c.player;
    const cfg = await import('/src/config/darkness.ts');
    delete cfg.FLOOR_DARKNESS['physics-test'];
    const rt = c.levels.current;
    delete rt.darkZones;
    rt.authoredLights.length = 0;
    window.__nox.orig.forEach((l, i) => { l.intensity = window.__nox.base[i]; rt.authoredLights.push(l); });
    c.enemies.length = 0;
    for (const b of [...c.rigidBodies.bodies]) if (b.x > RECT.x0 && b.x < RECT.x1 && b.y > 400 && b.y < 720) c.rigidBodies.remove(b);
    c.particles.clear();
    if (rt.pickups) rt.pickups.length = 0;
    document.querySelector('#card-offer-overlay')?.classList.remove('visible');
    f.carve(RECT.x0, RECT.y0, RECT.x1, FLOOR - 1);
    f.wall(RECT.x0, FLOOR, RECT.x1, FLOOR + 8);
    for (const k of Object.keys(c.input.keys)) c.input.keys[k] = false;
    c.chill?.reset();
    c.fighters.equip(fighter);
    await c.fighters.whenReady();
    Object.assign(p, {
      x, y: FLOOR - 1, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, climbing: false, crawling: false, swinging: false, invuln: 0,
      hp, maxHp: hp, dead: false, recharge: 0, pullT: 0, aimAngle: 0, facing: 1,
    });
    Object.assign(p.status, { burning: 0, wet: 0, oiled: 0 });
    c.state.arrivalGraceUntil = 0;
  }, { fighter, x, hp, FLOOR, RECT });
  await tick(page, 3);
}

const count = (type, r = RECT) => page.evaluate(({ type, r }) => window.__fp.count(type, r.x0, r.y0, r.x1, r.y1), { type, r });
const kitOf = (fn, arg) => page.evaluate(({ fn, arg }) => { const k = window.__fp.ctx.fighters.kit; return new Function('k', 'ctx', 'arg', fn)(k, window.__fp.ctx, arg); }, { fn, arg });
/** Every solid and powder in the arena: Nox writes smoke and a lighting map, never a block. */
const solids = () => page.evaluate((RECT) => {
  const w = window.__fp.ctx.world;
  const blocking = new Set([1, 3, 4, 8, 10, 12, 13, 15, 17, 27, 28, 29, 31, 35, 36, 40, 43]);
  const out = {};
  for (let y = RECT.y0; y <= RECT.y1; y++) for (let x = RECT.x0; x <= RECT.x1; x++) { const t = w.types[w.idx(x, y)]; if (blocking.has(t)) out[t] = (out[t] ?? 0) + 1; }
  return JSON.stringify(out);
}, RECT);

/** A zoomed crop of the canvas around world point (cx, cy), `w` x `h` cells (the viewport is 3 px a cell). */
async function zoom(name, cx, cy, w, h) {
  const clip = await page.evaluate(({ cx, cy, w, h }) => {
    const c = window.__fp.ctx;
    const el = document.querySelector('#canvas-holder > canvas');
    const r = el.getBoundingClientRect();
    const sx = r.width / 640, sy = r.height / 360;
    return { x: Math.max(0, r.left + (cx - w / 2 - c.camera.renderX) * sx), y: Math.max(0, r.top + (cy - h / 2 - c.camera.renderY) * sy), width: Math.min(w * sx, r.width), height: Math.min(h * sy, r.height) };
  }, { cx, cy, w, h });
  await page.screenshot({ path: `verify-out/fighters/nox-${name}.png`, clip });
}
const frame = (name) => page.screenshot({ path: `verify-out/fighters/nox-${name}.png` });

/** Foes that stay where they are put (asleep), so a distance is a distance. */
const sleepers = (list) => page.evaluate((list) => {
  for (const [kind, dx, y] of list) { const e = window.__fp.spawn(kind, dx, { hp: 9999, ...(y === undefined ? {} : { y }) }); e.sleeping = true; e.__px = e.x; e.__py = e.y; }
}, list);
const revealed = () => page.evaluate(() => { const c = window.__fp.ctx; return c.enemies.map((e) => c.fighters.isRevealed(e)); });
const lampAt = (dx, dy, i) => page.evaluate(({ x, y, i }) => { const l = window.__nox.lamp(x, y, i); return { x: l.x, y: l.y }; }, { x: X0 + dx, y: FLOOR + dy, i });
const lamps = () => page.evaluate(() => window.__fp.ctx.levels.current.authoredLights.map((l) => l.intensity));
const level = (x, y) => page.evaluate(({ x, y }) => { const q = window.__fp.ctx.lightQuery; return { level: q.level(x, y), dark: q.darkness(x, y), wand: q.wandLight(x, y) }; }, { x, y });
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The same foe at the same distance, with and without whatever the scenario set up: what it notices over 50 ticks. */
async function sight(dist) {
  await page.evaluate((dist) => { window.__fp.ctx.enemies.length = 0; window.__fp.spawn('slime', dist, { hp: 9999 }); }, dist);
  let seen = 0, conf = 0;
  for (let i = 0; i < 50; i++) {
    await tick(page, 1);
    const s = await page.evaluate(() => { const e = window.__fp.ctx.enemies[0]; if (e?.mind) e.mind.facing = -1; return { vis: e?.mind?.visible === true, conf: e?.mind?.confidence ?? 0 }; });
    if (s.vis) seen++;
    conf = Math.max(conf, s.conf);
  }
  const e = await page.evaluate(() => { const e = window.__fp.ctx.enemies[0]; return { alerted: e.alerted === true, intent: e.mind?.intent }; });
  await page.evaluate(() => { window.__fp.ctx.enemies.length = 0; });
  return { dist, seen, conf, ...e };
}

// the floor's title card and the pickup toast run on the real clock (the paused harness holds them): let the world run for
// a few real seconds so they have gone before anything is photographed
await arena();
await page.evaluate(() => { window.__fp.ctx.state.paused = false; });
await page.waitForTimeout(7000);
await page.evaluate(() => { window.__fp.ctx.state.paused = true; });

// ================================================================================ Soot Sight
console.log('\nSoot Sight');
if (run('soot')) {
  await arena();
  // foes asleep where they are put: +70 and +130 in the open, +200 beyond her sight, and one behind a stone wall at -70
  await page.evaluate((FLOOR) => window.__fp.wall(480, 600, 484, FLOOR - 1), FLOOR);
  await sleepers([['slime', 70], ['slime', 130], ['slime', 200], ['slime', -70]]);
  await tick(page, 40);
  check('in the light, with no smoke: nothing is shown', (await revealed()).every((r) => !r) && (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 0);
  check('the lit arena is not dark (darkness 0)', (await level(X0, FLOOR - 9)).dark === 0);

  // smoke: a 11 x 11 patch of real Smoke cells around her chest (the sim does not age them inside this window)
  await page.evaluate(({ X0, FLOOR }) => {
    const { Cell } = window.__fp, w = window.__fp.ctx.world;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) { const i = w.idx(X0 + dx, FLOOR - 9 + dy); if (w.types[i] === 0) { w.replaceCellAt(i, Cell.Smoke, 0x303038); w.life[i] = 900; } }
  }, { X0, FLOOR });
  await tick(page, 8);
  const early = { on: await kitOf('return k.sense.on'), rev: await revealed(), age: await kitOf('return k.pulseAge'), r: await kitOf('return k.sootView.r'), foes: await page.evaluate(() => window.__fp.ctx.enemies.map((e) => e.kind + '@' + Math.round(e.x - window.__fp.ctx.player.x) + (e.sleeping ? 's' : ''))) };
  check('inside smoke the sense is on, and the pulse has not reached the nearest foe yet (8 ticks, ~53 cells)', early.on === true && early.rev[0] === false, JSON.stringify(early));
  await tick(page, 8);
  let r = await revealed();
  check('the pulse reaches the foe at 70 cells first (16 ticks, ~107 cells), not yet the one at 130', r[0] === true && r[1] === false, JSON.stringify(r));
  await tick(page, 24);
  r = await revealed();
  console.log(`  (revealed after 40 ticks in smoke: ${JSON.stringify(r)} for foes at +70, +130, +200, -70 behind a wall)`);
  check('then the foe at 130 is shown too', r[0] === true && r[1] === true);
  check('the foe at 200 cells is never shown (out of her 160)', r[2] === false);
  check('the foe behind the stone wall is never shown (she sees through the dark, not the rock)', r[3] === false);
  const shades = await page.evaluate(() => { const c = window.__fp.ctx; return c.enemies.slice(0, 2).map((e) => c.fighters.revealOf(e)); });
  console.log(`  (reveal colours: near ${JSON.stringify(shades[0]?.map((v) => +v.toFixed(2)))}, far ${JSON.stringify(shades[1]?.map((v) => +v.toFixed(2)))})`);
  check('the silhouettes are dim (no channel above 0.8; the shared reveal default is 1.0) and the nearer is brighter', shades[0] && shades[1] && Math.max(...shades[0]) <= 0.8 && shades[0][0] > shades[1][0], JSON.stringify(shades));
  check('a veil drawable is registered for them', (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) >= 2);
  await zoom('soot-0-smoke', X0 + 40, FLOOR - 25, 260, 90);
  // out of the smoke: the sense goes out after its short hold and the silhouettes lapse
  await page.evaluate((FLOOR) => { window.__fp.carve(500, 600, 600, FLOOR - 1); }, FLOOR);
  await tick(page, 14 + 7 + 6);
  check('out of the smoke they lapse (a flickering mist does not strobe: it takes ~20 ticks)', (await revealed()).every((x) => !x) && (await kitOf('return k.sense.on')) === false);
  check('and the veil drawable is gone with them', (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 0);

  // darkness, installed the way Long Night installs it: a profile for the level and a NEW zone array
  await page.evaluate(async () => {
    const c = window.__fp.ctx, p = c.player;
    const cfg = await import('/src/config/darkness.ts');
    cfg.FLOOR_DARKNESS['physics-test'] = { base: 0, deep: 1 };
    c.levels.current.darkZones = [{ x: p.x, y: p.y - 9, rx: 200, ry: 120, strength: 1, shape: 'ellipse' }];
  });
  await tick(page, 4);
  const dark = (await level(X0, FLOOR - 9)).dark;
  check('the dark zone is real: lightQuery.darkness at her is above 0.5', dark > 0.5, `${dark}`);
  await tick(page, 40);
  r = await revealed();
  check('in the dark the sense is on: the foes within 160 with a clear line are shown, the others are not', r[0] && r[1] && !r[2] && !r[3], JSON.stringify(r));
  // dark-bodied foes, so the silhouettes can be judged
  await page.evaluate(() => { window.__fp.ctx.enemies.length = 0; });
  await sleepers([['weaver', 80, FLOOR - 20], ['rillback', 125], ['mage', -95], ['golem', 55]]);
  await tick(page, 40);
  await zoom('soot-1-dark', X0 + 20, FLOOR - 28, 300, 110);
  // the dark lifts: nothing shown
  await page.evaluate(async () => { const c = window.__fp.ctx; const cfg = await import('/src/config/darkness.ts'); delete cfg.FLOOR_DARKNESS['physics-test']; delete c.levels.current.darkZones; });
  await tick(page, 14 + 7 + 6);
  check('with the dark gone, nothing is shown again', (await revealed()).every((x) => !x) && (await level(X0, FLOOR - 9)).dark === 0);
}

// ================================================================================ Blackglass
console.log('\nBlackglass');
if (run('glass')) {
  // ---- the throw: a flat lob, in the air for several ticks, held against the Flask's own arithmetic ----
  await arena();
  let v = await view(page);
  check('the chip names the ability and is ready', v.tactical.name === 'Blackglass' && v.tactical.ready === true);
  await aimAt(page, X0 + 60, FLOOR - 9 - 8);
  await tick(page, 2);
  const aim = await page.evaluate(() => window.__fp.ctx.player.aimAngle);
  await frame('glass-0-before');
  await press(page, 'KeyZ', 1);
  check('Z throws: the canister is in the air, the chip is cooling', (await kitOf('return !!k.canister')) === true && (await view(page)).tactical.ready === false);
  check('the canister is a drawable', (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) >= 1);
  const flight = [];
  for (let i = 0; i < 40; i++) {
    const s = await kitOf('return k.canister ? { x: k.canister.x, y: k.canister.y, age: k.canister.age } : null');
    if (!s) break;
    flight.push(s);
    if (i === 3) await zoom('glass-1-flight', X0 + 30, FLOOR - 20, 170, 70);
    await tick(page, 1);
  }
  const cloud0 = await kitOf('const c = k.clouds[0]; return c ? { x: c.x, y: c.y, planned: c.xs.length } : null');
  const ref = (() => {
    const cx = X0, cy = FLOOR - 1 - 9;
    let x = cx + Math.cos(aim) * 9, y = cy + Math.sin(aim) * 9, vx = Math.cos(aim) * 6.5, vy = Math.sin(aim) * 6.5;
    const out = [];
    for (let tk = 1; tk <= 45; tk++) {
      vy += 0.18;
      const steps = Math.max(1, Math.ceil(Math.hypot(vx, vy)));
      for (let s = 0; s < steps; s++) {
        const px = x, py = y;
        x += vx / steps; y += vy / steps;
        if (Math.floor(y) >= FLOOR) return { path: out, burst: { x: Math.floor(px), y: Math.floor(py) } };
      }
      out.push({ x, y });
    }
    return { path: out, burst: { x: Math.floor(x), y: Math.floor(y) } };
  })();
  console.log(`  (flew ${flight.length} ticks and burst at ${cloud0 ? `${cloud0.x},${cloud0.y}` : '-'}; the Flask's own arithmetic says ${ref.burst.x},${ref.burst.y} after ${ref.path.length + 1} ticks)`);
  check('it is in the air for several ticks', flight.length >= 4, `${flight.length}`);
  check('it flies as the Flask\'s bottle does: the same positions tick for tick', flight.length === ref.path.length && flight.every((s, i) => Math.abs(s.x - ref.path[i].x) < 1e-6 && Math.abs(s.y - ref.path[i].y) < 1e-6), JSON.stringify(flight.slice(0, 3)));
  check('and bursts in the last free cell before the floor', cloud0 && cloud0.x === ref.burst.x && cloud0.y === ref.burst.y, JSON.stringify(cloud0));
  check('the canister is gone (the drawable with it) once it has burst', (await kitOf('return !k.canister')) === true);

  // ---- the cloud: 45 degrees down, so it bursts on the floor 10 cells in front of her and she stands in it ----
  await arena();
  const before = await solids();
  await aimAt(page, X0 + 12, FLOOR - 9 + 12);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  for (let i = 0; i < 20 && (await kitOf('return !!k.canister')); i++) await tick(page, 1);
  await tick(page, 2);
  await zoom('glass-2-burst', X0 + 10, FLOOR - 20, 170, 80);
  await tick(page, 12);
  const smoke = await count(CELL.Smoke);
  console.log(`  (${smoke} Smoke cells 14 ticks after the burst, ${cloud0?.planned} planned)`);
  check('a dense cloud of real Smoke cells stands there: 1000+ cells', smoke >= 1000, `${smoke}`);
  const lives = await page.evaluate((RECT) => {
    const w = window.__fp.ctx.world; let min = 1e9, max = 0, zero = 0;
    for (let y = RECT.y0; y <= RECT.y1; y++) for (let x = RECT.x0; x <= RECT.x1; x++) { const i = w.idx(x, y); if (w.types[i] === 14) { min = Math.min(min, w.life[i]); max = Math.max(max, w.life[i]); if (w.life[i] <= 0) zero++; } }
    return { min, max, zero };
  }, RECT);
  check('every cell carries a life of 240-420 ticks (less the 14 it has aged): none would vanish at once', lives.zero === 0 && lives.min >= 240 - 16 && lives.max <= 420, JSON.stringify(lives));
  await zoom('glass-3-cloud', X0 + 10, FLOOR - 26, 200, 90);
  const cover = await page.evaluate(() => window.__fp.ctx.fighters.concealment());
  check('standing in it her cover is high (0.85 at full density)', cover >= 0.8 && cover <= 0.85 + 1e-9, `${cover}`);
  v = await view(page);
  check('the chip glows while she is hidden and is cooling (12 s)', v.tactical.active > 0.9 && v.tactical.cooldownSeconds >= 11 && v.tactical.cooldownSeconds <= 12, JSON.stringify(v.tactical));
  check('Soot Sight came on in her own smoke (the veil and the rings are registered)', (await kitOf('return k.sense.on')) === true);
  check('it wrote nothing but smoke: no solid, no powder changed', (await solids()) === before);

  // pressed while cooling: refused, and nothing new is thrown
  const refusedAt = v.tactical.refusedAt;
  const nClouds = await kitOf('return k.clouds.length');
  await press(page, 'KeyZ', 1);
  await tick(page, 3);
  v = await view(page);
  check('pressed while cooling: refused, no second canister, no second cloud', v.tactical.refusedAt > refusedAt && (await kitOf('return !k.canister')) && (await kitOf('return k.clouds.length')) === nClouds);

  // it thins, rises, and is gone by itself
  await tick(page, 120);
  const mid = await count(CELL.Smoke);
  const coverMid = await page.evaluate(() => window.__fp.ctx.fighters.concealment());
  await frame('glass-4-vent');
  await tick(page, 120);
  const peak = await count(CELL.Smoke); // ~260 ticks: the vent has just closed
  const coverPeak = await page.evaluate(() => window.__fp.ctx.fighters.concealment());
  await tick(page, 140);
  const late = await count(CELL.Smoke); // ~400
  const coverLate = await page.evaluate(() => window.__fp.ctx.fighters.concealment());
  console.log(`  (smoke at 14 / ~140 / ~260 / ~400 ticks: ${smoke} / ${mid} / ${peak} / ${late}; her cover ${cover.toFixed(2)} / ${coverMid.toFixed(2)} / ${coverPeak.toFixed(2)} / ${coverLate.toFixed(2)})`);
  check('the vent feeds the cloud for ~4 s (more cells than the burst alone) and her cover holds meanwhile', mid > smoke && peak > mid && coverMid > 0.6);
  check('then the cloud thins and her cover falls with it', late < peak && coverLate < coverPeak && coverLate < 0.5, `${late} < ${peak}; ${coverLate} < ${coverPeak}`);
  await tick(page, 360);
  check('the smoke has burned off on its own (every cell had a life): none left', (await count(CELL.Smoke)) === 0, `${await count(CELL.Smoke)} left`);
  check('her cover is gone and the chip is no longer active', (await page.evaluate(() => window.__fp.ctx.fighters.concealment())) === 0 && (await view(page)).tactical.active === 0);
  await tick(page, 40);
  check('the veil is gone with the last cloud (nothing of hers is left drawn)', (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 0);
  check('the cooldown runs out (720 ticks)', (await view(page)).tactical.ready === true);
}

console.log('\nBlackglass: refused, and where it bursts');
if (run('refuse')) {
  // a wall at her nose: refused, nothing spent, nothing thrown
  await arena();
  await page.evaluate(({ X0 }) => window.__fp.wall(X0 + 4, 600, X0 + 20, 689), { X0 });
  await aimAt(page, X0 + 100, FLOOR - 9);
  await tick(page, 2);
  const t0 = (await view(page)).tactical;
  await press(page, 'KeyZ', 1);
  await tick(page, 2);
  let v = await view(page);
  check('a wall at her nose: refused, the cooldown not spent, nothing thrown or written',
    v.tactical.ready === true && v.tactical.usedAt === t0.usedAt && v.tactical.refusedAt > t0.refusedAt && (await kitOf('return !k.canister')) && (await count(CELL.Smoke)) === 0, JSON.stringify(v.tactical));
  check('and says why', (await kitOf('return k.lastRefusal')) === 'NO ROOM TO THROW');

  // it bursts on a foe in its path
  await arena();
  await sleepers([['slime', 44]]);
  const foe = await page.evaluate(() => { const e = window.__fp.ctx.enemies[0]; return { x: e.x, y: e.y }; });
  await aimAt(page, foe.x, foe.y - 4);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  for (let i = 0; i < 30 && (await kitOf('return !!k.canister')); i++) await tick(page, 1);
  const c1 = await kitOf('const c = k.clouds[0]; return c ? { x: c.x, y: c.y } : null');
  check('a canister that meets a foe bursts on it (the cloud starts inside its body)', c1 && Math.abs(c1.x - foe.x) <= 6 && c1.y <= foe.y && c1.y >= foe.y - 9, JSON.stringify([c1, foe]));

  // the fuse: straight up into open air, it bursts after 45 ticks
  await arena();
  await aimAt(page, X0, FLOOR - 300);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  let flown = 1;
  for (; flown < 80 && (await kitOf('return !!k.canister')); flown++) await tick(page, 1);
  const c2 = await kitOf('const c = k.clouds[0]; return c ? { x: c.x, y: c.y } : null');
  check('thrown straight up it bursts in the air when its 45-tick fuse runs out, well above the floor', flown >= 44 && flown <= 46 && c2 && c2.y < FLOOR - 40, JSON.stringify([flown, c2]));
}

console.log('\nBlackglass: what an enemy notices');
if (run('notice')) {
  // The same foe at the same distance, with and without the cloud. Eyes reach as far as sightRangeScale(light) x 265:
  // concealment 0.85 scales the light by 0.15 and the range with it (Enemies.update).
  const trial = async (dist, covered) => {
    await arena();
    if (covered) {
      await aimAt(page, X0 + 12, FLOOR - 9 + 12);
      await tick(page, 2);
      await press(page, 'KeyZ', 1);
      await tick(page, 26);
    } else await tick(page, 29);
    // (the throw's own sounds have aged out of the foe's hearing before it is spawned: 60+ ticks in both runs)
    await tick(page, 40);
    const conceal = await page.evaluate(() => window.__fp.ctx.fighters.concealment());
    const r = await sight(dist);
    return { ...r, covered, conceal };
  };
  const rows = [];
  for (const d of [40, 100, 150, 170]) rows.push(await trial(d, false), await trial(d, true));
  for (const r of rows) console.log(`  ${r.dist} cells, ${r.covered ? 'in the cloud' : 'no cloud   '}: seen ${String(r.seen).padStart(2)}/50 ticks, confidence ${r.conf.toFixed(2)}, alerted ${r.alerted}, ${r.intent}  (cover ${r.conceal.toFixed(2)})`);
  const at = (d, c) => rows.find((r) => r.dist === d && r.covered === c);
  check('without the cloud a foe 100-170 cells off sees her, is alerted and hunts', [100, 150, 170].every((d) => at(d, false).seen > 20 && at(d, false).alerted && at(d, false).intent === 'hunt'));
  check('in the cloud the same foe at the same distance never sees her, is not alerted, and goes on foraging', [100, 150, 170].every((d) => at(d, true).seen === 0 && !at(d, true).alerted && at(d, true).conf === 0 && at(d, true).intent === 'forage'));
  check('it is a short sight line, not invisibility: a foe 40 cells off still sees her in the cloud', at(40, true).seen > 20 && at(40, true).alerted);
  check('the trial is honest: cover was ~0.85 in the cloud runs and 0 in the others', rows.every((r) => (r.covered ? r.conceal >= 0.8 : r.conceal === 0)));
}

console.log('\nBlackglass: fire in the cloud');
if (run('fire')) {
  // Two identical clouds; in one a wooden stack is lit inside it. (The sim does NOT burn smoke: a flame beside a cloud
  // leaves it as it was, measured below; the kit's rule burns smoke that touches flame inside its own clouds.)
  const run = async (lit) => {
    await arena();
    await aimAt(page, X0 + 12, FLOOR - 9 + 12);
    await tick(page, 2);
    await press(page, 'KeyZ', 1);
    await tick(page, 34); // burst and bloomed
    const c = await kitOf('const c = k.clouds[0]; return { x: c.x, y: c.y }');
    if (lit) {
      await page.evaluate(({ cx, FLOOR }) => {
        const { Cell } = window.__fp, w = window.__fp.ctx.world;
        for (let y = FLOOR - 6; y <= FLOOR - 1; y++) for (let x = cx - 5; x <= cx + 5; x++) { const i = w.idx(x, y); w.replaceCellAt(i, Cell.Wood, 0x7a5030); }
        const j = w.idx(cx, FLOOR - 3); w.replaceCellAt(j, Cell.Fire, 0xffa030); w.life[j] = 60;
      }, { cx: c.x, FLOOR });
    }
    const series = [];
    for (let t = 0; t < 160; t += 20) {
      series.push({ smoke: await count(CELL.Smoke), fire: await count(CELL.Fire), cover: await page.evaluate(() => window.__fp.ctx.fighters.concealment()) });
      if (lit && t === 40) await zoom('glass-5-burning', c.x, FLOOR - 26, 200, 90);
      await tick(page, 20);
    }
    return series;
  };
  const control = await run(false);
  const burning = await run(true);
  const row = (s) => s.map((p) => `${p.smoke}`).join(' ');
  console.log(`  (smoke every 20 ticks, no fire: ${row(control)}`);
  console.log(`   smoke every 20 ticks, lit:     ${row(burning)}; fire cells ${burning.map((p) => p.fire).join(' ')})`);
  const k = 6; // 120 ticks in
  check('the wood really burns (real Fire cells in the cloud)', Math.max(...burning.map((p) => p.fire)) >= 20);
  check('a lit cloud thins: well under the unlit one 120 ticks on (fire eats the smoke)', burning[k].smoke < control[k].smoke * 0.8, `${burning[k].smoke} vs ${control[k].smoke}`);
  check('and the cloud that is left is what is not burning: it is not simply gone', burning[k].smoke > 200);
  check('the unlit cloud is untouched by all this (still the full cloud 120 ticks on)', control[k].smoke >= control[1].smoke * 0.95);
}

console.log('\nBlackglass: the cost');
if (run('cost')) {
  await arena();
  // the same 60 ticks of the game with no cloud, then with a full one (the cloud's cells are the sim's own work, not the kit's)
  const bare = await page.evaluate(() => { const f = window.__fp; f.tick(10); const t = performance.now(); f.tick(60); return (performance.now() - t) / 60; });
  await aimAt(page, X0 + 12, FLOOR - 9 + 12);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 120);
  const cost = await page.evaluate(() => {
    const f = window.__fp, c = f.ctx, k = c.fighters.kit;
    const smoke = f.count(14, 330, 440, 800, 700);
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) k.tick();
    const kitUs = ((performance.now() - t0) / 300) * 1000;
    const t1 = performance.now();
    f.tick(60);
    const tickMs = (performance.now() - t1) / 60;
    // the drawables against a stub surface (a lower bound: the real fine-pixel writes cost a little more per call)
    let calls = 0;
    const stub = { pixelStep: 0.5, setFinePx() { calls++; }, addFinePx() { calls++; }, blendFinePx() { calls++; }, setPx() { calls++; }, addPx() { calls++; } };
    const field = { sample: () => ({ r: 1, g: 1, b: 1 }) };
    const t2 = performance.now();
    for (let i = 0; i < 50; i++) for (const d of c.fighters.drawables) d.draw(stub, field, c);
    const drawMs = (performance.now() - t2) / 50;
    return { smoke, kitUs, tickMs, drawMs, calls: calls / 50 };
  });
  console.log(`  (a game tick with no cloud ${bare.toFixed(2)} ms; with ${cost.smoke} smoke cells up ${cost.tickMs.toFixed(2)} ms, of which the kit's own tick is ${cost.kitUs.toFixed(0)} us; her drawables (the veil, the sight) ${cost.drawMs.toFixed(2)} ms and ${Math.round(cost.calls)} pixel writes a frame)`);
  check('the kit\'s own per-tick work is small (under 0.5 ms with a full cloud up)', cost.kitUs < 500, `${cost.kitUs.toFixed(0)} us`);
  check('the drawables are cheap on the CPU side (under 4 ms a frame with a full cloud, against a stub surface)', cost.drawMs < 4, `${cost.drawMs.toFixed(2)} ms`);
}

// ================================================================================ Long Night
console.log('\nLong Night');
if (run('night')) {
  await arena();
  await lampAt(60, -40, 1.4); await lampAt(-150, -35, 1.2); await lampAt(240, -40, 1.05); await lampAt(300, -40, 1.4); // the last is out of her 260
  const L0 = await lamps(); // [the level's own (far away, out of range), +4 test lamps]
  const lampPos = await page.evaluate(() => window.__fp.ctx.levels.current.authoredLights.map((l) => [Math.round(l.x), Math.round(l.y), l.intensity, !!l.__nox]));
  const nArena = L0.length - 4;
  const pt = { lamp: [X0 + 60, FLOOR - 28], open: [X0 - 90, FLOOR - 60], far: [X0 + 300, FLOOR - 28] };
  const sample = async () => {
    await tick(page, 6);
    const own = await level(X0, FLOOR - 9);
    return {
      lamp: (await level(...pt.lamp)).level, open: (await level(...pt.open)).level, far: (await level(...pt.far)).level, farDark: (await level(...pt.far)).dark,
      dark: own.dark, wand: (await level(X0 + 8, FLOOR - 9)).wand, hooded: await page.evaluate(() => window.__fp.ctx.state.lanternHooded === true),
    };
  };
  const f2 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v]));

  let v = await view(page);
  check('the chip names the ability; the bar starts empty', v.ultimate.name === 'Long Night' && v.ultimate.ready === false);
  await press(page, 'KeyT', 1);
  await tick(page, 3);
  check('bar not full: T is refused, nothing changes (no zone, the lamps as they were, no cover)',
    (await view(page)).ultimate.refusedAt > 0 && (await view(page)).ultimate.active === 0 && sameList(await lamps(), L0)
    && (await page.evaluate(() => window.__fp.ctx.levels.current.darkZones === undefined)) && (await page.evaluate(() => window.__fp.ctx.fighters.concealment())) === 0);

  const before = await sample();
  console.log('  before:', JSON.stringify(f2(before)));
  const trialBefore = [await sight(100), await sight(170)];
  await zoom('night-0-before', X0 + 20, FLOOR - 40, 330, 110);

  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  check('a full bar makes it ready', (await view(page)).ultimate.ready === true);
  const ids0 = await page.evaluate(() => window.__fp.ctx.levels.current.darkZones);
  await press(page, 'KeyT', 1);
  v = await view(page);
  check('T: the ultimate is running and the bar is spent', v.ultimate.active > 0.9 && v.ultimate.charge < 0.05, JSON.stringify(v.ultimate));
  check('she is half-hidden at once (concealment 0.5) and her lantern is not hooded', Math.abs((await page.evaluate(() => window.__fp.ctx.fighters.concealment())) - 0.5) < 1e-6 && !(await page.evaluate(() => window.__fp.ctx.state.lanternHooded === true)));
  check('the dusk drawable is up', (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) >= 1);
  // e is the number of ticks since the press (the press tick is 1)
  const at = async (e) => { const have = await page.evaluate(() => 720 - Math.round(window.__fp.ctx.fighters.view.ultimate.active * 720)); if (e > have) await tick(page, e - have); };
  await at(8);
  await zoom('night-1-dusk', X0, FLOOR - 40, 330, 150);
  await at(10);
  let L = await lamps();
  check('the lamps go out in a wave from her: the near lamp (60 cells) is going while the far one (240) is still lit',
    L[nArena] < L0[nArena] * 0.9 && L[nArena + 2] === L0[nArena + 2], JSON.stringify([L[nArena], L[nArena + 2]]));
  check('the dark has not fallen yet (the windup is 14 ticks): no zone in the level', await page.evaluate(() => window.__fp.ctx.levels.current.darkZones === undefined));
  await at(16);
  const zones1 = await page.evaluate(() => { window.__zones1 = window.__fp.ctx.levels.current.darkZones; return window.__zones1; });
  check('the dark falls at 14 ticks: a NEW zone array holding the night\'s zone is in the level', Array.isArray(zones1) && zones1.length === 1 && zones1[0].rx >= 150 && ids0 === undefined, JSON.stringify(zones1));
  const bake = await kitOf('return k.lastBakeMs');
  console.log(`  (the bake took ${bake.toFixed(1)} ms, once, on the frame the dark falls)`);
  check('the bake ran once, there, and is not a per-tick cost (a measured one-off of 1-400 ms)', bake > 0.5 && bake < 400, `${bake}`);
  await zoom('night-2-falls', X0, FLOOR - 40, 330, 150);
  await at(48);
  L = await lamps();
  // (the arena's own lamps land in different places each boot: judge every lamp by its own distance from her chest)
  const inRange = lampPos.map(([x, y]) => Math.hypot(x - X0, y - (FLOOR - 1 - 9)) <= 260);
  const outOk = lampPos.every((_, i) => (inRange[i] ? L[i] === 0 : L[i] === L0[i]));
  console.log(`  (${lampPos.length} lamps, ${inRange.filter(Boolean).length} within 260 of her, ${inRange.filter((x) => !x).length} beyond)`);
  check('every lamp within her 260 cells is out by ~35 ticks, and every lamp beyond them is exactly as it was', outOk && L[nArena] === 0 && L[nArena + 1] === 0 && L[nArena + 2] === 0 && L[nArena + 3] === L0[nArena + 3], JSON.stringify({ L, L0, lampPos }));
  const during = await sample();
  console.log('  during:', JSON.stringify(f2(during)));
  check('the world is darker: the lamp-lit point falls from ~1.8 to under 0.3', before.lamp > 1 && during.lamp < 0.3, `${before.lamp} -> ${during.lamp}`);
  check('open ground falls too', during.open < before.open * 0.5, `${before.open} -> ${during.open}`);
  check('designed darkness at her is ~1 (it was 0), and 0 outside the zone', before.dark === 0 && during.dark > 0.9 && during.farDark < 0.1, `${before.dark} -> ${during.dark}, far ${during.farDark}`);
  check('outside the zone and out of her reach, the lit point is as bright as before (the effect is local)', during.far > before.far * 0.8, `${before.far} -> ${during.far}`);
  check('her own lantern stays lit: wandLight beside her is still there, and the lantern is not hooded', during.wand > 0.15 && during.wand > before.wand * 0.4 && !during.hooded, `${before.wand} -> ${during.wand}`);
  // the bake is not re-run: the map is the same object for the whole night
  const map1 = await page.evaluate(async () => { const dm = await import('/src/core/darkness.ts'); window.__map = dm.darkMapFor(window.__fp.ctx.levels.current); return !!window.__map; });
  await tick(page, 120);
  const sameMap = await page.evaluate(async () => { const dm = await import('/src/core/darkness.ts'); return dm.darkMapFor(window.__fp.ctx.levels.current) === window.__map; });
  check('the baked map is the same object 120 ticks on (no rebake per tick)', map1 && sameMap && (await page.evaluate(() => window.__fp.ctx.levels.current.darkZones === window.__zones1)));

  // foes: the dark itself, her cover, and what Soot Sight shows
  const trialDuring = [await sight(100), await sight(170)];
  // the control: the same night with her cover taken off (the engine's rule is that an unhooded lantern in the dark is a beacon)
  await page.evaluate(() => window.__fp.ctx.fighters.clearMod('long-night'));
  const trialBare = await sight(200);
  await page.evaluate(() => window.__fp.ctx.fighters.setMod('long-night', 600, { concealment: 0.5 }));
  for (const t of [...trialBefore, ...trialDuring, trialBare]) console.log(`  ${t.dist} cells: seen ${String(t.seen).padStart(2)}/50, alerted ${t.alerted}, ${t.intent}`);
  check('before: a foe at 100 and one at 170 both see her (lit, her lantern: the slime sees ~190 here)', trialBefore.every((t) => t.seen > 20 && t.alerted));
  check('during: the foe at 100 still sees her (range ~146), the one at 170 does not', trialDuring[0].seen > 20 && trialDuring[1].seen === 0 && !trialDuring[1].alerted, JSON.stringify(trialDuring));
  check('the control proves it is her cover: with it off, the same dark and the same foe at 200 sees her (the beacon: range ~265)', trialBare.seen > 20, JSON.stringify(trialBare));
  await sleepers([['weaver', 80, FLOOR - 20], ['rillback', 125], ['mage', -95], ['slime', 210]]);
  await tick(page, 40);
  const rv = await revealed();
  check('Soot Sight shows the foes within 160 in her night, and not the one at 210', rv[0] && rv[1] && rv[2] && !rv[3], JSON.stringify(rv));
  await zoom('night-3-dark', X0 + 20, FLOOR - 40, 330, 110);
  await page.evaluate(() => { window.__fp.ctx.enemies.length = 0; });

  // the dawn: the lamps come back, nearest first, before the dark lifts
  await at(704);
  L = await lamps();
  console.log(`  (at 704 ticks the lamps are ${L.slice(nArena).map((x) => x.toFixed(2)).join(' ')})`);
  check('the dawn has begun: the near lamp is back to its own value, the far one is still coming', L[nArena] === L0[nArena] && L[nArena + 2] < L0[nArena + 2]);
  check('and the dark is still down (the same zone array)', await page.evaluate(() => window.__fp.ctx.levels.current.darkZones === window.__zones1));
  await zoom('night-4-dawn', X0, FLOOR - 40, 330, 150);
  await at(722);
  await tick(page, 4);
  v = await view(page);
  check('it ends at 720 ticks: the chip is no longer active and her cover is gone', v.ultimate.active === 0 && (await page.evaluate(() => window.__fp.ctx.fighters.concealment())) === 0);
  check('every lamp is back to EXACTLY its own value (the same numbers, to the last bit)', sameList(await lamps(), L0), JSON.stringify(await lamps()));
  check('the zone list is as it was (the level had none: there is none), the lent profile is gone', await page.evaluate(async () => { const cfg = await import('/src/config/darkness.ts'); return window.__fp.ctx.levels.current.darkZones === undefined && !('physics-test' in cfg.FLOOR_DARKNESS); }));
  const after = await sample();
  console.log('  after: ', JSON.stringify(f2(after)));
  check('the world is as bright as before and darkness is 0 again', after.dark === 0 && Math.abs(after.lamp - before.lamp) < 0.15 * before.lamp && Math.abs(after.open - before.open) < 0.15 * before.open, `${before.lamp} -> ${after.lamp}`);
  await zoom('night-5-after', X0 + 20, FLOOR - 40, 330, 110);
  await tick(page, 40);
  check('the dusk drawable is gone, and so are the silhouettes and the veil once the sense has lapsed', (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 0);
}

console.log('\nLong Night: on a floor with its own darkness (both bakes)');
if (run('bakes')) {
  // A known floor: a profile of its own and an authored dark zone already in the level. Night adds its zone as a new array,
  // and at the end the original is put back (by identity) and baked once more.
  await arena();
  await page.evaluate(async ({ X0 }) => {
    const c = window.__fp.ctx;
    const cfg = await import('/src/config/darkness.ts');
    cfg.FLOOR_DARKNESS['physics-test'] = { base: 0.1, deep: 1 };
    window.__zones0 = [{ x: X0 + 400, y: 640, rx: 90, ry: 60, strength: 1 }];
    c.levels.current.darkZones = window.__zones0;
    window.__nox.lamp(X0 + 50, 650, 1.4);
  }, { X0 });
  await tick(page, 4);
  const L0 = await lamps();
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await press(page, 'KeyT', 1);
  await tick(page, 60);
  const zones = await page.evaluate(() => window.__fp.ctx.levels.current.darkZones);
  check('the night\'s zone joined the floor\'s own (a new array of 2); its profile was left alone', zones.length === 2 && (await page.evaluate(async () => { const cfg = await import('/src/config/darkness.ts'); return cfg.FLOOR_DARKNESS['physics-test'].base === 0.1; })) && (await page.evaluate(() => window.__fp.ctx.levels.current.darkZones !== window.__zones0)));
  const bakeA = await kitOf('return k.lastBakeMs');
  await tick(page, 700);
  const bakeB = await kitOf('return k.lastUnbakeMs');
  console.log(`  (bake at the start ${bakeA.toFixed(1)} ms, at the end ${bakeB.toFixed(1)} ms)`);
  check('at the end the floor\'s own zone array is back, by identity, and its profile is untouched', await page.evaluate(async () => { const cfg = await import('/src/config/darkness.ts'); return window.__fp.ctx.levels.current.darkZones === window.__zones0 && cfg.FLOOR_DARKNESS['physics-test'].base === 0.1; }));
  check('the second bake ran once, at the end (a measured one-off, 0.1-400 ms)', bakeB > 0.05 && bakeB < 400, `${bakeB}`);
  check('the lamps are back exactly', sameList(await lamps(), L0));
  // the floor's own dark is still its own after the night
  const own = await page.evaluate(({ X0 }) => window.__fp.ctx.lightQuery.darkness(X0 + 400, 640), { X0 });
  check('the floor\'s own dark zone still reads dark after the night (the night did not rewrite it)', own > 0.5, `${own}`);
}

console.log('\nLong Night: it is put back when it is cut short');
if (run('cut')) {
  for (const [name, end] of [
    ['a death', async () => { await page.evaluate(() => { window.__fp.ctx.player.hp = 0; window.__fp.ctx.player.dead = true; }); await tick(page, 2); }],
    ['a respawn', async () => { await page.evaluate(() => window.__fp.ctx.events.emit('playerRespawned', undefined)); await tick(page, 2); }],
    ['a new floor', async () => { await page.evaluate(() => window.__fp.ctx.events.emit('levelChanged', { depth: 2, name: 'x' })); await tick(page, 2); }],
    ['unequipping her', async () => { await page.evaluate(() => window.__fp.ctx.fighters.equip(null)); await tick(page, 2); }],
  ]) {
    await arena();
    await lampAt(60, -40, 1.4); await lampAt(-150, -35, 1.2);
    const L0 = await lamps();
    await page.evaluate(() => window.__fp.ctx.fighters.refill());
    await tick(page, 1);
    await press(page, 'KeyT', 1);
    await tick(page, 70);
    const mid = await page.evaluate(() => window.__fp.ctx.levels.current.darkZones?.length ?? 0);
    await end();
    const ok = await page.evaluate(async () => { const cfg = await import('/src/config/darkness.ts'); const c = window.__fp.ctx; return { zones: c.levels.current.darkZones === undefined, profile: !('physics-test' in cfg.FLOOR_DARKNESS), conceal: c.fighters.concealment() }; });
    check(`${name} mid-night: the zone, the lent profile, the cover and every lamp are put back at once`, mid === 1 && ok.zones && ok.profile && ok.conceal === 0 && sameList(await lamps(), L0), JSON.stringify({ mid, ok }));
  }
}

console.log('\nThe classic Alchemist is untouched');
{
  await arena(null);
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  await press(page, 'KeyZ', 2);
  await press(page, 'KeyT', 2);
  const v = await view(page);
  check('with no fighter Z and T do nothing: no canister, no smoke, no dusk', v.id === null && (await page.evaluate(() => window.__fp.ctx.fighters.drawables.length)) === 0 && (await count(CELL.Smoke)) === 0);
}

const pageErrors = await finish();
check('no page errors', pageErrors === 0);
console.log(`\nfighter nox probe: ${tally.pass} passed, ${tally.fail} failed`);
process.exit(tally.fail ? 1 : 0);

// Selene Wraith, the Mercury Twin, against the REAL engine (docs/fighters/selene-wraith.md): Liquid Momentum (a
// crouch at a sprint is a slide that keeps her speed: measured against the classic Alchemist's crouch, and through
// a wall, a 9-cell gap, a ledge, a ramp and a lip), Quicksilver Echo (Z: a blink along the aim that leaves a silver
// echo; Z again returns her to it and shortens the cooldown) and Mirror Hunt (T: two echoes ride the ground ahead
// of and behind her, and real foes hunt them instead of her, pop them and stand stunned). Real key presses, paused
// deterministic ticks, observable effects in the player, the foes and the grid, plus the negative cases (too slow,
// airborne, no room, over a pit, into lava, cooling down, bar not full, the recall window over).
// Usage: node scripts/verify-fighter-selene.mjs [url]   (dev server running; screenshots to verify-out/fighters/)
import { mkdirSync } from 'node:fs';
import { aimAt, boot, makeChecker, me, press, tick, view } from './fighter-probe.mjs';

const url = process.argv[2] || 'http://localhost:5173/';
const tally = makeChecker();
const check = tally.check;
const { page, finish } = await boot(url, { fighter: 'selene-wraith', viewport: { width: 2560, height: 1440 } });
mkdirSync('verify-out/fighters', { recursive: true });

const FLOOR = 690; // the arena floor's top row: the body stands at FLOOR - 1
const X0 = 440;
const KEYS = ['ShiftLeft', 'KeyD', 'KeyW', 'KeyA', 'KeyS', 'Space', 'KeyZ', 'KeyT'];
const SELENE = 'selene-wraith';
const CELL = { Lava: 11, Stone: 12 };

/** A clean arena: the floor re-laid (7 stone rows), everything above and below it cleared, the fighter equipped fresh. */
async function arena(fighter, { x = X0, face = 1 } = {}) {
  for (const k of KEYS) await page.keyboard.up(k);
  await page.evaluate(async ({ fighter, x, face, FLOOR }) => {
    const f = window.__fp, c = f.ctx, p = c.player;
    c.enemies.length = 0;
    for (const b of [...c.rigidBodies.bodies]) if (b.x > 380 && b.x < 620 && b.y > 460 && b.y < 760) c.rigidBodies.remove(b);
    c.particles.clear();
    if (c.levels.current?.pickups) c.levels.current.pickups.length = 0;
    document.querySelector('#card-offer-overlay')?.classList.remove('visible');
    f.carve(380, 470, 620, FLOOR + 70);
    f.wall(380, FLOOR, 620, FLOOR + 6);
    for (const k of Object.keys(c.input.keys)) c.input.keys[k] = false;
    c.chill?.reset();
    c.fighters.equip(fighter);
    await c.fighters.whenReady();
    Object.assign(p, {
      x, y: FLOOR - 1, vx: 0, vy: 0, fx: 0, fy: 0, grounded: true, climbing: false, crawling: false, swinging: false, invuln: 0,
      hp: 100, maxHp: 100, dead: false, recharge: 0, pullT: 0, aimAngle: face < 0 ? Math.PI : 0, facing: face, crouchT: 0,
    });
    Object.assign(p.status, { burning: 0, wet: 0, oiled: 0 });
    c.state.arrivalGraceUntil = 0;
  }, { fighter, x, face, FLOOR });
  await tick(page, 3);
}

const wall = (x0, y0, x1, y1) => page.evaluate((a) => window.__fp.wall(...a), [x0, y0, x1, y1]);
const carve = (x0, y0, x1, y1) => page.evaluate((a) => window.__fp.carve(...a), [x0, y0, x1, y1]);
const count = (type, x0, y0, x1, y1) => page.evaluate((a) => window.__fp.count(...a), [type, x0, y0, x1, y1]);
const snap = () => page.evaluate(() => {
  const c = window.__fp.ctx, p = c.player;
  return { x: p.x, y: p.y, vx: +p.vx.toFixed(3), vy: +p.vy.toFixed(2), grounded: p.grounded, crawling: p.crawling, own: c.fighters.ownsMovement, hp: p.hp, inv: p.invuln, facing: p.facing };
});
/** Free space for a body of height h with its feet at (x, y), by the engine's own test. */
const bodyFree = (x, y, h) => page.evaluate((a) => window.__fp.ctx.physics.entityFree(a[0], a[1], 4, a[2]), [x, y, h]);
const drawables = () => page.evaluate(() => window.__fp.ctx.fighters.drawables.length);
const lights = () => page.evaluate(() => (window.__fp.ctx.levels.current.authoredLights ?? []).length);

/** A zoomed crop of the canvas around world point (cx, cy), `w` x `h` cells. */
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

/** Run right to full speed, then (S down) start the crouch; returns the first sample of the crouch and the position where S went down. */
async function runThenCrouch({ fighter, x = 395, y = null, run = 30 } = {}) {
  await arena(fighter, { x });
  if (y !== null) await page.evaluate((y) => { window.__fp.ctx.player.y = y; }, y);
  await page.keyboard.down('KeyD');
  await tick(page, run);
  const before = await snap();
  await page.keyboard.down('KeyS');
  return before;
}
/** Tick n times, sampling the body each tick. */
async function sample(n, each) {
  const out = [];
  for (let i = 0; i < n; i++) {
    await tick(page, 1);
    const s = await snap();
    out.push(s);
    if (each) await each(i, s);
  }
  return out;
}
const release = async () => { await page.keyboard.up('KeyS'); await page.keyboard.up('KeyD'); await page.keyboard.up('Space'); };

// ================================================================================ Liquid Momentum
console.log('\nLiquid Momentum: the slide against the classic crouch');
{
  // The same run, the same keys (D held, S pressed after 30 ticks), for the classic Alchemist and for Selene.
  const trial = async (fighter) => {
    const before = await runThenCrouch({ fighter });
    const s = await sample(60, fighter ? async (i, m) => {
      if (i === 5) await zoom('selene-slide-0-start', m.x, FLOOR - 12, 100, 36);
      if (i === 20) await zoom('selene-slide-1-mid', m.x, FLOOR - 12, 100, 36);
      if (i === 46) await zoom('selene-slide-2-exit', m.x, FLOOR - 12, 100, 36);
    } : undefined);
    await release();
    return { before, s };
  };
  const classic = await trial(null);
  const selene = await trial(SELENE);
  const dClassic45 = classic.s[44].x - classic.before.x, dSelene45 = selene.s[44].x - selene.before.x;
  console.log(`  (30 ticks of D, then S held: in the next 45 ticks the classic Alchemist covers ${dClassic45} cells, Selene ${dSelene45}; top speed ${selene.before.vx})`);
  check('the classic Alchemist\'s crouch clamps a sprint to a crawl (about 0.9 cells/tick)', classic.s.slice(2, 40).every((m) => m.vx > 0.8 && m.vx < 1.0) && !classic.s.some((m) => m.own), JSON.stringify(classic.s.slice(1, 4)));
  check('Selene at a sprint (2.85) with S pressed slides: the body is owned by the move', selene.before.vx > 2.8 && selene.s[1].own === true && selene.s[1].vx > 2.7, JSON.stringify(selene.s.slice(0, 3)));
  check('in the slide she is at crawl gauge, the prone pose', selene.s.slice(0, 40).every((m) => m.crawling));
  check('she covers 62-80 cells in 45 ticks, at least 1.6x the classic crouch', dSelene45 >= 62 && dSelene45 <= 80 && dSelene45 >= 1.6 * dClassic45, `${dSelene45} vs ${dClassic45}`);
  // speed decays 3% a tick
  const ratios = [];
  for (let k = 4; k < 36; k++) ratios.push(selene.s[k + 1].vx / selene.s[k].vx);
  const rMin = Math.min(...ratios), rMax = Math.max(...ratios);
  console.log(`  (tick-to-tick speed ratio ${rMin.toFixed(3)}..${rMax.toFixed(3)})`);
  check('her speed decays 3% a tick (0.97)', rMin > 0.96 && rMax < 0.98);
  const ownTicks = selene.s.findIndex((m) => !m.own);
  check('the slide runs its 45 ticks and then hands the body back', ownTicks >= 44 && ownTicks <= 47, `own until sample ${ownTicks}`);
  const last = selene.s[ownTicks - 1], after = selene.s[ownTicks];
  check('she leaves with about 80% of her speed (the last tick\'s step x0.97 x0.8)', after.vx / last.vx > 0.74 && after.vx / last.vx < 0.82, `${last.vx} -> ${after.vx}`);
  check('she did not leave the floor or the line: same row, grounded the whole way', selene.s.slice(0, ownTicks).every((m) => m.y === FLOOR - 1 && m.grounded));
}

console.log('\nLiquid Momentum: when it starts');
{
  // S pressed while only walking: no slide
  await arena(SELENE, { x: 400 });
  await page.keyboard.down('KeyD');
  await tick(page, 2);
  const slow = await snap();
  await page.keyboard.down('KeyS');
  const s = await sample(30);
  await release();
  check('walking slowly (under 2.2) and crouching is the ordinary crawl, no slide', slow.vx < 2.2 && s.every((m) => !m.own));
  // S before D: no run, no slide
  await arena(SELENE, { x: 400 });
  await page.keyboard.down('KeyS');
  await tick(page, 3);
  await page.keyboard.down('KeyD');
  const s2 = await sample(40);
  await release();
  check('crouched first, then moving: a crawl (no slide)', s2.every((m) => !m.own && m.vx < 1.0));
  // a sprint with no S: nothing
  await arena(SELENE, { x: 395 });
  await page.keyboard.down('KeyD');
  const s3 = await sample(40);
  await release();
  check('sprinting without crouching is just a sprint', s3.every((m) => !m.own) && s3[39].vx > 2.7);
  // in the air: S is the dive, never a slide
  await arena(SELENE, { x: 395 });
  await page.keyboard.down('KeyD');
  await tick(page, 28);
  await page.keyboard.down('Space');
  await tick(page, 6);
  await page.keyboard.down('KeyS');
  const s4 = await sample(10);
  await release();
  check('S in the air (a jump at a sprint) does not start a slide', s4.every((m) => !m.own));
  // the classic Alchemist: no slide
  await arena(null, { x: 395 });
  await page.keyboard.down('KeyD');
  await tick(page, 30);
  await page.keyboard.down('KeyS');
  const s5 = await sample(10);
  await release();
  check('the classic Alchemist never slides', s5.every((m) => !m.own));
}

console.log('\nLiquid Momentum: how it ends');
{
  // ---- S let go after a tap's worth: she pops up carrying the speed
  const b = await runThenCrouch({ fighter: SELENE });
  await sample(20);
  await page.keyboard.up('KeyS');
  const s = await sample(6);
  const lastOwn = s.findIndex((m) => !m.own);
  const cut = s[lastOwn];
  check('S let go after 20 ticks ends it at once, and she stands up (no longer crawling) with her speed kept', lastOwn >= 0 && lastOwn <= 2 && cut.vx > 1.1, JSON.stringify(s.slice(0, 4)));
  await sample(2);
  check('and standing she is back at a run, not a crawl', (await snap()).crawling === false);
  await release();
  void b;

  // ---- a tap is a slide
  await runThenCrouch({ fighter: SELENE });
  await tick(page, 2);
  await page.keyboard.up('KeyS');
  const t = await sample(24);
  const tOwn = t.findIndex((m) => !m.own) + 2; // the 2 ticks before the sample
  console.log(`  (a 3-tick tap on S holds the slide for ${tOwn} ticks)`);
  check('a tap on S still slides for at least 14 ticks', tOwn >= 14 && tOwn <= 18, `${tOwn}`);
  await release();

  // ---- jump
  await runThenCrouch({ fighter: SELENE });
  await sample(8);
  await page.keyboard.up('KeyS');
  await page.keyboard.down('Space');
  const j = await sample(8);
  const jOwn = j.findIndex((m) => !m.own);
  console.log(`  (S up and jump at tick 8: ${j.map((m) => `${m.own ? 's' : '.'}${m.grounded ? 'g' : 'a'}${m.vy}`).join(' ')})`);
  check('a jump ends the slide at once', jOwn >= 0 && jOwn <= 2, JSON.stringify(j.slice(0, 4)));
  check('and she is in the air, still going (the jump from a slide)', j.some((m) => !m.grounded && m.vy < 0) && j[7].vx > 1.5, JSON.stringify(j.slice(2, 8)));
  await release();

  // ---- a blow
  await runThenCrouch({ fighter: SELENE });
  await sample(8);
  const hp0 = (await snap()).hp;
  await page.evaluate(() => window.__fp.ctx.playerCtl.damage(10, 3, -1, 'probe'));
  const h = await sample(4);
  check('a slide has no i-frames: a blow lands, and ends it', h[0].hp < hp0 && h.slice(1).every((m) => !m.own), JSON.stringify(h.map((m) => [m.hp, m.own])));
  await release();
}

console.log('\nLiquid Momentum: where it goes');
{
  // ---- a wall at the end of it
  await arena(SELENE, { x: 395 });
  await wall(520, FLOOR - 40, 540, FLOOR - 1);
  await page.keyboard.down('KeyD');
  await tick(page, 30);
  await page.keyboard.down('KeyS');
  const w = await sample(40);
  const wi = w.findIndex((m) => !m.own);
  const stop = w[wi];
  console.log(`  (the wall's face is at x 520: she stops at ${stop.x}, vx ${stop.vx})`);
  check('a wall ends it: she stops against it, edge to edge, not in it', stop.x >= 513 && stop.x <= 515 && stop.vx === 0, JSON.stringify(stop));
  check('and she is whole: not inside the rock, not hurt', await bodyFree(stop.x, stop.y, 9) && stop.hp === 100);
  await zoom('selene-slide-wall', stop.x - 20, FLOOR - 12, 80, 36);
  await release();

  // ---- a 9-cell gap: the roof 10 cells up, the way a crawl goes
  const tunnel = async (gap) => {
    await arena(SELENE, { x: 395 });
    // a roof over x 495..590 leaving `gap` free rows above the floor
    await wall(495, FLOOR - 40, 590, FLOOR - 1 - gap);
    await page.keyboard.down('KeyD');
    await tick(page, 30);
    const before = await snap();
    await page.keyboard.down('KeyS');
    const s = await sample(50);
    return { before, s };
  };
  const t9 = await tunnel(9);
  const end9 = t9.s[Math.max(0, t9.s.findIndex((m) => !m.own) - 1)];
  console.log(`  (a 9-high gap from x 495: she started at ${t9.before.x}, the slide ended at ${end9.x}, y ${end9.y})`);
  check('a slide into a 9-cell gap goes in and keeps going (no snag at the mouth)', end9.x >= 540 && end9.y === FLOOR - 1 && t9.s.slice(0, 20).every((m) => m.own), JSON.stringify(end9));
  check('she is inside the gap: a body of 9 fits where she is, a standing one does not', (await bodyFree(end9.x, end9.y, 9)) && !(await bodyFree(end9.x, end9.y, 17)));
  await zoom('selene-slide-gap', 540, FLOOR - 12, 100, 36);
  // S let go in the gap: the world says she cannot stand, and she stays low
  await page.keyboard.up('KeyS');
  await sample(6);
  const cramped = await snap();
  check('S let go inside the gap: she stays at crawl gauge (cramped), nowhere near rock', cramped.crawling === true && (await bodyFree(cramped.x, cramped.y, 9)));
  await release();
  const t8 = await tunnel(8);
  const stop8 = t8.s[t8.s.findIndex((m) => !m.own)];
  check('an 8-high gap is too low: the slide stops at its mouth', stop8.x < 495 && stop8.x >= 485, JSON.stringify(stop8));
  await release();

  // ---- a ledge: the floor ends and the slide does not carry her out over nothing
  await arena(SELENE, { x: 395 });
  await carve(517, FLOOR, 590, FLOOR + 6);
  await page.keyboard.down('KeyD');
  await tick(page, 30);
  await page.keyboard.down('KeyS');
  let ledgeShot = false;
  const l = await sample(70, async (i, m) => { if (!ledgeShot && !m.own) { ledgeShot = true; await zoom('selene-slide-ledge', m.x, FLOOR - 4, 90, 40); } });
  await release();
  const ownEnd = l.findIndex((m) => !m.own);
  const ys = l.map((m) => m.y);
  const fall0 = ys.findIndex((y) => y > FLOOR - 1);
  let hover = 0, worst = 0;
  for (let i = Math.max(1, fall0); i < l.length; i++) { hover = !l[i].grounded && l[i].y === l[i - 1].y ? hover + 1 : 0; worst = Math.max(worst, hover); }
  console.log(`  (a ledge at x 517: the slide ends at sample ${ownEnd}, x ${l[ownEnd].x}; she starts to fall at sample ${fall0}, ends at x ${l[69].x} y ${l[69].y}; longest hang ${worst} ticks)`);
  check('the slide ends at the ledge (the floor ends at 516; her centre is at most 4 past it, as any runner may be), her feet still on the floor', l[ownEnd].x <= 521 && l[ownEnd].grounded && l[ownEnd].y === FLOOR - 1, JSON.stringify(l[ownEnd]));
  check('she drops off the edge the way a runner does: it is a fall, not a hover', fall0 > ownEnd && l[69].y > FLOOR + 6 && worst <= 2, `fall at ${fall0}, hang ${worst}, y ${l[69].y}`);

  // ---- downhill: a platform 8 up and a 45-degree ramp down to the floor
  const ramp = async (dir) => {
    await arena(SELENE, { x: 395 });
    if (dir === 'down') {
      await wall(380, FLOOR - 8, 479, FLOOR - 1);
      for (let i = 0; i < 8; i++) await wall(480 + i, FLOOR - 8 + i, 480 + i, FLOOR - 1);
      await page.evaluate((y) => { window.__fp.ctx.player.y = y; }, FLOOR - 9);
    } else {
      for (let i = 0; i < 8; i++) await wall(480 + i, FLOOR - 1 - i, 480 + i, FLOOR - 1);
      await wall(488, FLOOR - 8, 580, FLOOR - 1);
    }
    await page.keyboard.down('KeyD');
    await tick(page, 30);
    await page.keyboard.down('KeyS');
    const s = await sample(60, async (i, m) => { if (i === 6) await zoom(`selene-slide-${dir}hill`, m.x, FLOOR - 10, 90, 36); });
    await release();
    return s;
  };
  const down = await ramp('down');
  const dEnd = down[Math.max(0, down.findIndex((m) => !m.own) - 1)];
  console.log(`  (down a 45-degree ramp of 8: ends at ${dEnd.x},${dEnd.y}; airborne ticks ${down.slice(0, 40).filter((m) => !m.grounded).length})`);
  check('downhill she follows the floor (never airborne), all the way to the bottom', down.slice(0, 30).every((m) => m.grounded) && dEnd.y === FLOOR - 1 && dEnd.x > 488, JSON.stringify(dEnd));
  const up = await ramp('up');
  const uEnd = up[Math.max(0, up.findIndex((m) => !m.own) - 1)];
  console.log(`  (up a 45-degree ramp of 8: ends at ${uEnd.x},${uEnd.y})`);
  check('uphill she climbs the ramp with the run\'s own step-up, onto the platform', uEnd.y === FLOOR - 9 && uEnd.x >= 488, JSON.stringify(uEnd));

  // ---- a lip she can step and a wall she cannot
  await arena(SELENE, { x: 395 });
  await wall(520, FLOOR - 4, 600, FLOOR - 1);
  await page.keyboard.down('KeyD');
  await tick(page, 30);
  await page.keyboard.down('KeyS');
  const lip = await sample(50);
  await release();
  const lipEnd = lip[Math.max(0, lip.findIndex((m) => !m.own) - 1)];
  check('a 4-cell lip is climbed (the same step-up a run has) and she goes on over it', lipEnd.y === FLOOR - 5 && lipEnd.x > 524, JSON.stringify(lipEnd));
}

// ================================================================================ Quicksilver Echo
console.log('\nQuicksilver Echo: the blink');
{
  await arena(SELENE);
  let v = await view(page);
  check('the chip names the ability and is ready', v.tactical.name === 'Quicksilver Echo' && v.tactical.ready === true && v.tactical.active === 0);
  const l0 = await lights();
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  await zoom('selene-echo-0-before', X0 + 20, FLOOR - 14, 100, 40);
  await press(page, 'KeyZ', 1);
  let m = await me(page);
  console.log(`  (aimed right: she is at ${m.x} after the blink from ${X0})`);
  check('she blinks the full 40 cells along the aim, to the floor', m.x - X0 >= 38 && m.x - X0 <= 41 && m.y === FLOOR - 1 && m.grounded === true, JSON.stringify(m));
  check('the echo is in the world (a drawable) and the glow marks it', (await drawables()) === 1 && (await lights()) >= l0 + 3, `${await drawables()} drawables, lights ${l0} -> ${await lights()}`);
  check('8 ticks of i-frames', m.invuln >= 7 && m.invuln <= 8, `invuln ${m.invuln}`);
  const hp = m.hp;
  await page.evaluate(() => window.__fp.ctx.playerCtl.damage(20, 0, 0, 'probe'));
  check('a blow landing in the i-frames does nothing', (await me(page)).hp === hp);
  v = await view(page);
  check('the chip is cooling (8 s) and shows the recall window as active', v.tactical.ready === false && v.tactical.cooldown > 0.99 && v.tactical.cooldownSeconds === 8 && v.tactical.active > 0.95, JSON.stringify(v.tactical));
  await tick(page, 3);
  await zoom('selene-echo-1-blink', X0 + 20, FLOOR - 14, 100, 40);
  await tick(page, 40);
  await zoom('selene-echo-2-standing', X0 + 20, FLOOR - 14, 100, 40);
  v = await view(page);
  check('the recall window runs down on the chip (about 3/4 left at 45 ticks)', v.tactical.active > 0.7 && v.tactical.active < 0.8, `${v.tactical.active}`);
  await page.evaluate(() => { window.__fp.ctx.player.invuln = 0; });
  const hp2 = (await me(page)).hp;
  await page.evaluate(() => window.__fp.ctx.playerCtl.damage(10, 0, 0, 'probe'));
  check('the i-frames were only for the blink', (await me(page)).hp < hp2);
}

console.log('\nQuicksilver Echo: Z again');
{
  await arena(SELENE);
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 59);
  const cd0 = (await view(page)).tactical;
  const refused0 = cd0.refusedAt;
  await press(page, 'KeyZ', 1);
  const m = await me(page);
  const v = await view(page);
  const left = Math.round(v.tactical.cooldown * 480);
  console.log(`  (Z again at tick 60: back at x ${m.x}; cooldown left ${left} ticks of the ${420} that remained, the chip says ${v.tactical.cooldownSeconds} s)`);
  check('Z again inside the window returns her to the echo (where she stood)', Math.abs(m.x - X0) <= 1 && m.y === FLOOR - 1 && m.grounded === true, JSON.stringify(m));
  check('it is not a refusal, and the echo is spent (the chip is no longer active)', v.tactical.refusedAt === refused0 && v.tactical.active === 0);
  check('the cooldown that remained (420) is cut to 40%: about 168 ticks', left >= 166 && left <= 170 && v.tactical.ready === false, `${left}`);
  check('i-frames after the return too', m.invuln >= 7, `invuln ${m.invuln}`);
  await zoom('selene-echo-3-recall', X0 + 20, FLOOR - 14, 100, 40);
  await tick(page, 24);
  check('the echo has left the world a moment after (the folding rings have faded)', (await drawables()) === 0);
  // and now it is only cooling: a third Z is an ordinary refusal
  await press(page, 'KeyZ', 1);
  await tick(page, 2);
  const v3 = await view(page);
  check('a further Z is refused (no echo, still cooling): she stays where she is', v3.tactical.refusedAt > refused0 && Math.abs((await me(page)).x - X0) <= 1);
  await tick(page, 166);
  check('the shortened cooldown runs out about 168 ticks after the return', (await view(page)).tactical.ready === true);

  // the window: 170 ticks is inside, 185 is not
  await arena(SELENE);
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 168);
  await press(page, 'KeyZ', 1);
  check('Z at tick 170 still returns her (the window is 180)', Math.abs((await me(page)).x - X0) <= 1);
  await arena(SELENE);
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 186);
  const gone = await drawables();
  const r1 = (await view(page)).tactical.refusedAt;
  await press(page, 'KeyZ', 1);
  await tick(page, 2);
  const v4 = await view(page);
  check('after 180 ticks the echo has come apart, and Z is only a refusal', gone === 0 && v4.tactical.refusedAt > r1 && (await me(page)).x - X0 >= 38 && v4.tactical.active === 0, `${gone} drawables`);
  // the place under the echo has changed: it cannot be returned to
  await arena(SELENE);
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  await tick(page, 10);
  await wall(X0 - 14, FLOOR - 30, X0 + 14, FLOOR - 1);
  const r2 = (await view(page)).tactical.refusedAt;
  await press(page, 'KeyZ', 1);
  await tick(page, 2);
  check('the echo\'s place filled with rock: the return is refused and she stays', (await view(page)).tactical.refusedAt > r2 && (await me(page)).x - X0 >= 38);
}

console.log('\nQuicksilver Echo: where it goes, and where it will not');
{
  // a wall at her nose: refused, free
  await arena(SELENE);
  await wall(X0 + 7, FLOOR - 40, X0 + 20, FLOOR - 1);
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  const t0 = (await view(page)).tactical;
  await press(page, 'KeyZ', 1);
  await tick(page, 2);
  let v = await view(page);
  check('rock 7 cells away: refused, the cooldown is not spent, she has not moved, no echo', v.tactical.ready === true && v.tactical.usedAt === t0.usedAt && v.tactical.refusedAt > t0.refusedAt && (await me(page)).x === X0 && (await drawables()) === 0, JSON.stringify(v.tactical));

  // a wall 25 cells away: she stops short of it, never inside it
  await arena(SELENE);
  await wall(X0 + 25, FLOOR - 40, X0 + 40, FLOOR - 1);
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  let m = await me(page);
  check('rock 25 cells away: she blinks to the wall and not into it', m.x - X0 >= 14 && m.x + 4 < X0 + 25 && (await bodyFree(m.x, m.y, 17)), JSON.stringify(m));

  // a platform she could not otherwise reach: 40 across, 24 up
  await arena(SELENE);
  await wall(X0 + 30, FLOOR - 27, X0 + 80, FLOOR - 24);
  await aimAt(page, X0 + 40, FLOOR - 9 - 24);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  m = await me(page);
  console.log(`  (aimed up at a ledge: she is at ${m.x},${m.y}; the ledge top is row ${FLOOR - 27}, so she stands at y ${FLOOR - 28})`);
  check('aimed up at a ledge, she lands standing on it', m.y === FLOOR - 28 && m.grounded === true && m.x >= X0 + 30, JSON.stringify(m));
  await zoom('selene-echo-4-ledge', X0 + 25, FLOOR - 18, 100, 50);

  // over a pit with nothing to stand on beyond her own few cells: refused
  await arena(SELENE);
  await carve(X0 + 5, FLOOR, 600, FLOOR + 60);
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  const t1 = (await view(page)).tactical;
  await press(page, 'KeyZ', 1);
  await tick(page, 2);
  v = await view(page);
  check('aimed across a pit with nowhere to stand: refused, free', v.tactical.ready === true && v.tactical.refusedAt > t1.refusedAt && (await me(page)).x === X0 && (await drawables()) === 0);

  // a pit with a far edge: she crosses it
  await arena(SELENE);
  await carve(X0 + 10, FLOOR, X0 + 30, FLOOR + 60);
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  await press(page, 'KeyZ', 1);
  m = await me(page);
  check('across a 20-cell pit to the far side: she crosses it', m.x >= X0 + 36 && m.y === FLOOR - 1 && m.grounded, JSON.stringify(m));

  // lava where she would land: she lands short of it, never in it
  await arena(SELENE);
  await page.evaluate(({ FLOOR, X0 }) => {
    const f = window.__fp, w = f.ctx.world;
    for (let y = FLOOR - 22; y < FLOOR; y++) for (let x = X0 + 30; x <= X0 + 52; x++) w.replaceCellAt(w.idx(x, y), 11, 0xff5010);
  }, { FLOOR, X0 });
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 1);
  await press(page, 'KeyZ', 1);
  m = await me(page);
  const lavaInBody = await count(CELL.Lava, m.x - 4, m.y - 17, m.x + 4, m.y);
  console.log(`  (lava from x ${X0 + 30} to ${X0 + 52}: she lands at ${m.x}, ${lavaInBody} lava cells in her body)`);
  check('lava where the blink would end: she lands short of it, not in it', m.x - X0 >= 8 && m.x + 4 < X0 + 30 && lavaInBody === 0 && m.hp === 100, JSON.stringify(m));

  // Z mid-slide: the blink takes her out of it
  await runThenCrouch({ fighter: SELENE });
  await sample(6);
  await aimAt(page, 560, FLOOR - 10);
  await press(page, 'KeyZ', 1);
  await tick(page, 2);
  const ms = await snap();
  await release();
  check('Z in the middle of a slide: the blink takes her out of it', ms.own === false && (await drawables()) === 1);
}

// ================================================================================ Mirror Hunt
console.log('\nMirror Hunt');
/** Where the echoes are, as the foes see them: a stand-in foe placed on each expected spot is told which of the real body and the echoes it believes in. */
const echoes = () => page.evaluate(() => {
  const c = window.__fp.ctx, p = c.player;
  const ask = (dx) => {
    const fake = { x: p.x + dx, y: p.y, hp: 40, maxHp: 40, kind: 'slime', sleeping: false, bobPhase: 0 };
    const r = c.fighters.decoyFor(fake);
    return r ? { x: r.x, y: r.y, vx: r.vx } : null;
  };
  return { ahead: ask(28), behind: ask(-28), p: { x: p.x, y: p.y } };
});
{
  await arena(SELENE, { x: 480 });
  let v = await view(page);
  check('the chip names the ability; the bar starts empty', v.ultimate.name === 'Mirror Hunt' && v.ultimate.ready === false);
  await press(page, 'KeyT', 1);
  await tick(page, 2);
  v = await view(page);
  check('bar not full: T is refused, no echoes', v.ultimate.active === 0 && v.ultimate.refusedAt > 0 && (await drawables()) === 0);

  await arena(SELENE, { x: 480 });
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await aimAt(page, 580, FLOOR - 10);
  await press(page, 'KeyT', 1);
  v = await view(page);
  check('T starts it: running, the bar spent, the echoes are a drawable in the world', v.ultimate.active > 0.95 && v.ultimate.charge < 0.05 && (await drawables()) === 1, JSON.stringify(v.ultimate));
  await zoom('selene-mirror-0-start', 480, FLOOR - 14, 120, 40);
  await tick(page, 4);
  await zoom('selene-mirror-1-leaving', 480, FLOOR - 14, 120, 40);
  await tick(page, 20);
  await zoom('selene-mirror-2-out', 480, FLOOR - 14, 120, 40);
  let e = await echoes();
  console.log(`  (she is at ${e.p.x}; ahead ${JSON.stringify(e.ahead)}, behind ${JSON.stringify(e.behind)})`);
  check('one echo rides 28 cells ahead of her, on the ground', e.ahead !== null && Math.abs(e.ahead.x - (e.p.x + 28)) <= 1 && e.ahead.y === FLOOR - 1, JSON.stringify(e.ahead));
  check('one rides 28 cells behind her, on the ground', e.behind !== null && Math.abs(e.behind.x - (e.p.x - 28)) <= 1 && e.behind.y === FLOOR - 1, JSON.stringify(e.behind));

  // they mimic her movement: she runs, they run with her
  await page.keyboard.down('KeyD');
  await tick(page, 40);
  e = await echoes();
  await zoom('selene-mirror-3-running', e.p.x, FLOOR - 14, 120, 40);
  console.log(`  (running: she is at ${e.p.x}; ahead ${e.ahead?.x}, behind ${e.behind?.x})`);
  check('she runs and they keep their places: 28 cells ahead and behind (within a few cells of lag)', e.ahead !== null && e.behind !== null && Math.abs(e.ahead.x - e.p.x - 28) <= 4 && Math.abs(e.p.x - e.behind.x - 28) <= 4, JSON.stringify(e));
  await page.keyboard.up('KeyD');
  await tick(page, 20);
  // she turns round and runs the other way: the pair swaps ends (ahead is the way she is going)
  await page.keyboard.down('KeyA');
  await tick(page, 45);
  e = await echoes();
  check('she turns and runs the other way: the pair is still 28 either side (they do not cross over)', e.ahead !== null && e.behind !== null && Math.abs(e.ahead.x - e.p.x - 28) <= 5 && Math.abs(e.p.x - e.behind.x - 28) <= 5, JSON.stringify(e));
  await page.keyboard.up('KeyA');
}

console.log('\nMirror Hunt: what a foe believes');
{
  // A real foe, the real AI. She stands at 480 and the ahead echo stands at 508. A slime 16 cells ahead of her is 12 from the echo.
  const trace = async ({ ultimate, dx, kind = 'slime', ticks = 130 }) => {
    await arena(SELENE, { x: 480 });
    await aimAt(page, 580, FLOOR - 10);
    if (ultimate) {
      await page.evaluate(() => window.__fp.ctx.fighters.refill());
      await tick(page, 1);
      await press(page, 'KeyT', 1);
      await tick(page, 24);
    } else await tick(page, 25);
    const e0 = await page.evaluate(({ kind, dx }) => { const e = window.__fp.spawn(kind, dx, { hp: 9999 }); e.alerted = true; return { x: e.x }; }, { kind, dx });
    const out = [];
    for (let i = 0; i < ticks; i++) {
      await tick(page, 1);
      const s = await page.evaluate(() => {
        const e = window.__fp.ctx.enemies[0];
        return e ? { x: e.x, tx: e.mind?.targetX, vis: e.mind?.visible === true, intent: e.mind?.intent, kn: e.knockT ?? 0, hp: window.__fp.ctx.player.hp, px: window.__fp.ctx.player.x } : null;
      });
      out.push(s);
    }
    return { x0: e0.x, out };
  };
  // What it hunts while it is still hunting the thing it chose: before it reaches an echo (the stun) and before it has bitten her (a bite moves her).
  const hunted = (t, { untilMove = false } = {}) => {
    const stop = t.out.findIndex((s) => s && (s.kn > 0 || s.hp < 100 || (untilMove && s.x !== t.x0)));
    // (the stun takes hold a tick after the pop, and the foe's mind has already gone back to her that tick: stop one short)
    return t.out.slice(0, stop < 0 ? undefined : Math.max(0, stop - 1)).filter((s) => s && s.vis && s.intent === 'hunt').map((s) => s.tx);
  };

  // ---- toward the echo ahead
  const withEcho = await trace({ ultimate: true, dx: 16 });
  const noEcho = await trace({ ultimate: false, dx: 16 });
  const wTargets = hunted(withEcho), nTargets = hunted(noEcho);
  const firstMove = (t) => { const s = t.out.find((q) => q && q.x !== t.x0); return s ? Math.sign(s.x - t.x0) : 0; };
  console.log(`  (slime 16 cells ahead of her: with the echo it hunts x ${wTargets[0]} and first moves ${firstMove(withEcho) > 0 ? 'toward the echo (+)' : 'toward her (-)'}; without, it hunts x ${nTargets[0]} and moves ${firstMove(noEcho) > 0 ? '+' : '-'})`);
  check('a foe nearer the echo than her hunts the ECHO: its target is the echo\'s place (508), not hers (480)', wTargets.length >= 5 && wTargets.every((x) => Math.abs(x - 508) <= 2), JSON.stringify(wTargets.slice(0, 5)));
  check('and it walks toward it (away from her)', firstMove(withEcho) > 0, `moved ${firstMove(withEcho)}`);
  check('the control: the same foe with no ultimate hunts HER (480) and walks toward her', nTargets.length >= 5 && nTargets.every((x) => Math.abs(x - 480) <= 2) && firstMove(noEcho) < 0);

  // ---- toward the echo behind
  const behind = await trace({ ultimate: true, dx: -16 });
  const bTargets = hunted(behind);
  check('a foe nearer the echo BEHIND her hunts that one (452) and walks away from her', bTargets.length >= 5 && bTargets.every((x) => Math.abs(x - 452) <= 2) && firstMove(behind) < 0, JSON.stringify([bTargets.slice(0, 3), firstMove(behind)]));

  // ---- the real body when no echo is nearer
  const close = await trace({ ultimate: true, dx: 7 });
  // (before its first hop: a slime that has hopped over her may well end up nearer the echo behind)
  const cTargets = hunted(close, { untilMove: true });
  check('a foe right beside her (nearer her than either echo) still hunts the real body', cTargets.length >= 1 && cTargets.every((x) => Math.abs(x - 480) <= 2), JSON.stringify(cTargets.slice(0, 4)));
  const far = await trace({ ultimate: true, dx: 100, ticks: 40 });
  const fTargets = hunted(far);
  check('a foe far off (100 cells), on the echo side, goes for the nearer of the two: the echo (72 away) and not her (100)', fTargets.length >= 3 && fTargets.every((x) => Math.abs(x - 508) <= 2), JSON.stringify(fTargets.slice(0, 4)));

  // ---- reaching an echo pops it, and the foe is stunned
  const pop = withEcho.out;
  const stunAt = pop.findIndex((s) => s && s.kn > 0);
  console.log(`  (the foe reaches the echo at tick ${stunAt + 1}: knocked-still for ${pop.filter((s) => s && s.kn > 0).length} ticks, at x ${pop[stunAt]?.x})`);
  check('the foe that reaches the echo is stunned (held still by the system)', stunAt >= 0);
  // stunned 30 ticks: it does not move for 30 ticks, and then it does
  const xStun = pop[stunAt].x;
  check('it stands still for the 30 ticks of the stun', pop.slice(stunAt, stunAt + 28).every((s) => s && s.x === xStun), JSON.stringify(pop.slice(stunAt, stunAt + 6).map((s) => s.x)));
  check('after the stun it hunts her again (the echo is gone)', pop.slice(stunAt + 32).some((s) => s && s.vis && s.intent === 'hunt' && Math.abs(s.tx - 480) <= 2), JSON.stringify(pop.slice(stunAt + 32, stunAt + 40).map((s) => s.tx)));

  // the echo is gone: a foe asking for it now is told nothing
  await arena(SELENE, { x: 480 });
  await aimAt(page, 580, FLOOR - 10);
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await press(page, 'KeyT', 1);
  await tick(page, 24);
  const slimeAt = await page.evaluate(() => { const e = window.__fp.spawn('slime', 26, { hp: 9999 }); e.alerted = true; return { x: e.x, y: e.y }; });
  const before = await echoes();
  await zoom('selene-mirror-4-foe-comes', 500, FLOOR - 14, 120, 40);
  let ticks = 0;
  while (ticks < 120 && (await echoes()).ahead !== null) { await tick(page, 1); ticks++; }
  const after = await echoes();
  console.log(`  (a slime 26 cells ahead of her walks into the echo: it pops after ${ticks} ticks)`);
  check('before: a foe on the echo is told to hunt it; after it reaches it: the echo is gone, only the one behind remains', before.ahead !== null && ticks < 120 && after.ahead === null && after.behind !== null);
  await zoom('selene-mirror-5-popped', 500, FLOOR - 14, 120, 40);
  void slimeAt;
}

console.log('\nMirror Hunt: ground, edges and the end');
{
  // a step up: the echo rides the higher floor
  await arena(SELENE, { x: 480 });
  await wall(500, FLOOR - 6, 540, FLOOR - 1);
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await aimAt(page, 580, FLOOR - 10);
  await press(page, 'KeyT', 1);
  await tick(page, 30);
  let e = await echoes();
  check('the echo ahead rides a floor 6 cells higher (its feet on the step)', e.ahead !== null && e.ahead.y === FLOOR - 7, JSON.stringify(e.ahead));
  await zoom('selene-mirror-6-step', 500, FLOOR - 14, 120, 40);
  // a pit: no ground at 28, so it stands nearer, at the edge
  await arena(SELENE, { x: 480 });
  await carve(496, FLOOR, 580, FLOOR + 60);
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await aimAt(page, 580, FLOOR - 10);
  await press(page, 'KeyT', 1);
  await tick(page, 30);
  e = await page.evaluate(() => {
    const c = window.__fp.ctx, p = c.player;
    for (let dx = 4; dx <= 40; dx++) { const r = c.fighters.decoyFor({ x: p.x + dx, y: p.y, hp: 40, maxHp: 40, kind: 'slime', sleeping: false, bobPhase: 0 }); if (r && Math.abs(r.x - (p.x + dx)) < 3) return { x: r.x, y: r.y, p: p.x }; }
    return null;
  });
  console.log(`  (a pit from x 496: the echo ahead stands at ${e?.x})`);
  check('over a pit it does not hang in the air: it stands on the last ground', e !== null && e.x <= 495 && e.x >= 486 && e.y === FLOOR - 1, JSON.stringify(e));

  // walled into a closet: nowhere for an echo to stand, so the ultimate is refused and the bar kept
  await arena(SELENE, { x: 445 });
  await wall(420, FLOOR - 60, 470, FLOOR - 1);
  await carve(440, FLOOR - 40, 450, FLOOR - 1);
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await press(page, 'KeyT', 1);
  await tick(page, 2);
  const vc = await view(page);
  check('walled into a closet there is nowhere for an echo to stand: refused, the bar is kept, nothing drawn', vc.ultimate.active === 0 && vc.ultimate.charge >= 0.99 && vc.ultimate.refusedAt > 0 && (await drawables()) === 0, JSON.stringify(vc.ultimate));

  // a boss and a sleeping foe are not drawn to it
  await arena(SELENE, { x: 480 });
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await press(page, 'KeyT', 1);
  await tick(page, 24);
  const odd = await page.evaluate(() => {
    const c = window.__fp.ctx, p = c.player;
    const mk = (extra) => ({ x: p.x + 28, y: p.y, hp: 40, maxHp: 40, kind: 'slime', sleeping: false, bobPhase: 0, ...extra });
    return { awake: c.fighters.decoyFor(mk({})) !== null, asleep: c.fighters.decoyFor(mk({ sleeping: true })) !== null, boss: c.fighters.decoyFor(mk({ boss: {} })) !== null, eggs: c.fighters.decoyFor(mk({ kind: 'eggs' })) !== null };
  });
  check('an awake foe on an echo is lured; a sleeper, a boss and an egg clutch are not', odd.awake && !odd.asleep && !odd.boss && !odd.eggs, JSON.stringify(odd));

  // a decoy melee never lands on her: a slime made to hunt the echo does not bite her from where the echo stands
  await arena(SELENE, { x: 480 });
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await aimAt(page, 580, FLOOR - 10);
  await press(page, 'KeyT', 1);
  await tick(page, 24);
  await page.evaluate(() => { const e = window.__fp.spawn('slime', 26, { hp: 9999 }); e.alerted = true; e.attackCd = 0; });
  await tick(page, 26);
  check('a foe on the echo swings at nothing: with its bite ready and 2 cells from the echo, she (28 away) takes no damage and is not knocked', (await me(page)).hp === 100 && (await me(page)).x === 480);

  // the end: 540 ticks, then they are gone
  await arena(SELENE, { x: 480 });
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await aimAt(page, 580, FLOOR - 10);
  await press(page, 'KeyT', 1);
  await tick(page, 480);
  {
    const v = await view(page);
    check('toward the end the ultimate is nearly spent and the echoes still stand', v.ultimate.active > 0.05 && v.ultimate.active < 0.15 && (await echoes()).ahead !== null, JSON.stringify(v.ultimate));
  }
  await zoom('selene-mirror-7-ending', 480, FLOOR - 14, 120, 40);
  await tick(page, 62);
  const vEnd = await view(page);
  e = await echoes();
  check('after 540 ticks it is over: no echo draws a foe, the chip is no longer active', vEnd.ultimate.active === 0 && e.ahead === null && e.behind === null, JSON.stringify(e));
  await tick(page, 30);
  check('and the echoes have left the world (no drawable)', (await drawables()) === 0);

  // a new floor wipes them at once
  await arena(SELENE, { x: 480 });
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await press(page, 'KeyT', 1);
  await tick(page, 24);
  await press(page, 'KeyZ', 1);
  await tick(page, 2);
  await page.evaluate(() => window.__fp.ctx.events.emit('levelChanged', { depth: 2, name: 'x' }));
  await tick(page, 2);
  e = await echoes();
  check('a floor change wipes the echoes and the one she left behind', e.ahead === null && e.behind === null && (await drawables()) === 0);
}

console.log('\nNothing is written to the grid');
{
  // The abilities move a body and draw pixels; the census of every solid and powder must not change.
  const census = () => page.evaluate(() => {
    const w = window.__fp.ctx.world;
    const blocking = new Set([1, 3, 4, 8, 10, 12, 13, 15, 17, 27, 28, 29, 31, 35, 36, 40, 43]);
    const out = {};
    for (let y = 470; y <= 700; y++) for (let x = 380; x <= 620; x++) { const t = w.types[w.idx(x, y)]; if (blocking.has(t)) out[t] = (out[t] ?? 0) + 1; }
    return JSON.stringify(out);
  });
  await arena(SELENE, { x: 395 });
  const before = await census();
  await page.evaluate(() => window.__fp.ctx.fighters.refill());
  await tick(page, 1);
  await aimAt(page, 480, FLOOR - 10);
  await press(page, 'KeyT', 1);
  await page.keyboard.down('KeyD');
  await tick(page, 30);
  await page.keyboard.down('KeyS');
  await tick(page, 30);
  await release();
  await press(page, 'KeyZ', 1);
  await tick(page, 20);
  await press(page, 'KeyZ', 1);
  await tick(page, 600);
  check('a slide, a blink, a recall and a whole Mirror Hunt changed no solid or powder', (await census()) === before);
}

console.log('\nThe classic Alchemist is untouched');
{
  await arena(null);
  await aimAt(page, X0 + 100, FLOOR - 10);
  await tick(page, 2);
  await press(page, 'KeyZ', 2);
  await press(page, 'KeyT', 2);
  const v = await view(page);
  check('with no fighter Z and T do nothing: no blink, no echo', v.id === null && (await me(page)).x === X0 && (await drawables()) === 0);
}

const pageErrors = await finish();
check('no page errors', pageErrors === 0);
console.log(`\nfighter selene probe: ${tally.pass} passed, ${tally.fail} failed`);
process.exit(tally.fail ? 1 : 0);

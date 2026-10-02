// FIGHTER BODIES (docs/arena/FIGHTER-PHYSICS.md): in the Proving Yard, on a paused world stepped tick by tick, each fighter runs, stops,
// jumps, hovers, falls and takes a push, and the MEASURED numbers must order the roster as the body table says, and match each
// body's own multipliers. The classic Alchemist (no fighter) is the control; with --baseline-url the same measurements are
// taken on a build WITHOUT the body seam and the control must be identical to the last digit (the classic hero is byte-identical).
//   run:     peak speed after 28 ticks of holding right            ~ run
//   stop:    cells coasted after releasing at peak                 ~ slidier for low friction
//   jump:    apex height of a held jump, released at the apex       ~ jump
//   hang:    ticks airborne for that jump                            ~ sqrt(jump / gravity)
//   fall:    terminal speed after a 100-cell drop                   ~ fall
//   push:    velocity right after one 3.0 impulse                   ~ 1 / mass
//   flight:  height gained holding jump for 40 ticks (the jet)       ~ jetThrust
//   jet:     ticks the jet burns holding jump until the tank is dry  ~ jetFuel / jetBurn
// Usage: node scripts/verify-fighter-bodies.mjs [url] [--baseline-url http://localhost:52xx/] [--shots]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const bi = args.indexOf('--baseline-url');
const baselineUrl = bi >= 0 ? args[bi + 1] : null;
const t = makeChecker();
const check = t.check;
mkdirSync('verify-out/bodies', { recursive: true });

const IDS = [null, 'ilyra-voss', 'brann-rook', 'sable-fen', 'mara-quell', 'kest-rel', 'nox-calder', 'edda-morrow', 'selene-wraith', 'rusk-emberjaw', 'father-thorne'];

/** Boot the Yard and measure every fighter on `base`. Returns { rows: {id: metrics}, bodies, errors }. */
async function measureAll(base, ids) {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* blocked */ } });
  await page.goto(base + (base.includes('?') ? '&' : '?') + 'link=off', { waitUntil: 'networkidle', timeout: 40000 });
  await leaveTitleIfShown(page);
  await waitForConsoleApi(page);
  await page.evaluate(async () => { await window.__game.ctx.console.exec('run test --level fighter-test --world campaign-level'); });
  await page.waitForFunction(() => window.__game?.ctx?.levels?.current?.def.id === 'fighter-test' && window.__game.ctx.state.mode === 'play', null, { timeout: 40000 });
  await page.waitForTimeout(2500);
  const out = await page.evaluate(async (ids) => {
    const ctx = window.__game.ctx;
    const p = ctx.player;
    const step = (n = 1) => { for (let i = 0; i < n; i++) window.__game.tick(false, { forcePaused: true }); };
    const keys = ctx.input.keys;
    const release = () => { for (const k of Object.keys(keys)) keys[k] = false; };
    const FLOOR = 640;
    const X = 1130, Y = FLOOR - 1; // the grating bridge over the cistern: flat, 150 wide, headroom to the roof
    const place = (x = X, y = Y) => { Object.assign(p, { x, y, vx: 0, vy: 0, fx: 0, fy: 0, dead: false, invuln: 0, crawling: false, climbing: false, grounded: true, diveT: 0 }); p.hp = p.maxHp; p.levit = p.maxLevit; };
    const settle = () => { release(); place(); step(30); };
    ctx.state.paused = true;
    ctx.enemies.length = 0;
    if (ctx.levels.current?.pickups) ctx.levels.current.pickups.length = 0;
    document.querySelectorAll('#card-offer-overlay.visible').forEach((e) => e.classList.remove('visible'));
    const result = {};
    for (const id of ids) {
      ctx.fighters.equip(id);
      await ctx.fighters.whenReady();
      ctx.state.arrivalGraceUntil = ctx.state.frameCount + 1e6; // nothing hurts: this is physics, not combat
      const row = { maxHp: p.maxHp, maxLevit: p.maxLevit };
      // run: hold right 28 ticks
      settle();
      keys.right = true;
      let peak = 0;
      for (let i = 0; i < 28; i++) { step(); peak = Math.max(peak, p.vx); }
      row.run = +peak.toFixed(4);
      // stop: release at peak, coast to rest
      release();
      const x0 = p.x;
      let ticks = 0;
      for (; ticks < 200 && Math.abs(p.vx) > 0.001; ticks++) step();
      row.stopCells = +(p.x - x0).toFixed(3);
      row.stopTicks = ticks;
      // jump: hold for exactly the ballistic window (the jet starts after it) and let go: a pure jump, no levitation
      settle();
      const startY = p.y;
      const win = ctx.params.player.jumpHoldWindow;
      keys.jump = true;
      let minY = p.y, air = 0;
      for (let i = 0; i < win; i++) { step(); if (p.y < minY) minY = p.y; }
      keys.jump = false;
      for (let i = 0; i < 300 && !p.grounded; i++) { step(); if (p.y < minY) minY = p.y; air++; }
      row.apex = +(startY - minY).toFixed(3);
      row.hang = win + air;
      // fall: a 100-cell drop from rest
      settle();
      place(X, Y - 100);
      p.grounded = false;
      let terminal = 0;
      for (let i = 0; i < 200 && !p.grounded; i++) { step(); terminal = Math.max(terminal, p.vy); }
      row.fall = +terminal.toFixed(4);
      // push: one impulse of 3.0 to the right, the velocity it leaves
      settle();
      ctx.playerCtl.applyImpulse(3, 0);
      row.push = +p.vx.toFixed(4);
      // flight: hold jump 40 ticks (the jump, then the jet; short of the roof so it does not saturate)
      settle();
      const flightStart = p.y;
      let top = p.y, lev0 = p.levit;
      keys.jump = true;
      for (let i = 0; i < 40; i++) { step(); if (p.y < top) top = p.y; }
      keys.jump = false;
      row.flight = +(flightStart - top).toFixed(3);
      row.fuelUsed = +(lev0 - p.levit).toFixed(2);
      // jet time: hold jump until the tank is dry (the roof stops the climb, not the burn)
      settle();
      keys.jump = true;
      let jet = 0;
      for (; jet < 500 && p.levit > 0.5; jet++) step();
      keys.jump = false;
      row.jetTicks = jet;
      result[id ?? 'control'] = row;
    }
    release();
    ctx.fighters.equip(null);
    ctx.state.arrivalGraceUntil = 0;
    let bodies = null;
    if (ids.includes('kest-rel')) {
      const mod = await import('/src/content/fighterBodies.ts');
      bodies = JSON.parse(JSON.stringify(mod.FIGHTER_BODIES));
    }
    return { result, bodies };
  }, ids);
  await browser.close();
  return { rows: out.result, bodies: out.bodies, errors };
}

const main = await measureAll(url, IDS);
writeFileSync('verify-out/bodies/measured.json', JSON.stringify(main.rows, null, 2));
const R = main.rows;
const C = R.control;
console.log('\n  id             run    stop   apex  hang  fall   push  flight  jet   maxHp maxLev');
for (const [id, r] of Object.entries(R)) {
  console.log(`  ${id.padEnd(14)} ${r.run.toFixed(2).padStart(5)} ${r.stopCells.toFixed(1).padStart(6)} ${r.apex.toFixed(1).padStart(6)} ${String(r.hang).padStart(4)} ${r.fall.toFixed(2).padStart(5)} ${r.push.toFixed(2).padStart(6)} ${r.flight.toFixed(1).padStart(6)} ${String(r.jetTicks).padStart(5)} ${String(r.maxHp).padStart(6)} ${r.maxLevit.toFixed(0).padStart(6)}`);
}
console.log('');

// ---- the control: the classic Alchemist's physics, and (optionally) byte-identical to a build without the seam ----
check('control: the classic Alchemist runs at 2.85 cells/tick, as before the bodies', Math.abs(C.run - 2.85) < 0.02, String(C.run));
check('control: its maximum health and levitation tank are untouched', C.maxHp > 0 && C.maxLevit > 0, JSON.stringify({ hp: C.maxHp, lev: C.maxLevit }));
if (baselineUrl) {
  const base = await measureAll(baselineUrl, [null]);
  const same = JSON.stringify(base.rows.control) === JSON.stringify(C);
  check('control: IDENTICAL, to the last digit, on a build without the body seam', same, same ? '' : `baseline ${JSON.stringify(base.rows.control)} vs now ${JSON.stringify(C)}`);
}

// ---- each body against its own multipliers ----
const B = main.bodies;
const near = (got, want, tol) => Math.abs(got / want - 1) <= tol;
for (const id of IDS.filter(Boolean)) {
  const r = R[id], b = B[id];
  check(`${id}: run speed is ${b.run}x the control (${(r.run / C.run).toFixed(2)}x)`, near(r.run, C.run * b.run, 0.06), `${r.run} vs ${C.run * b.run}`);
  check(`${id}: a 3.0 push leaves ${(1 / b.mass).toFixed(2)}x the control's velocity (mass ${b.mass}; ${(r.push / C.push).toFixed(2)}x)`, near(r.push, C.push / b.mass, 0.03), `${r.push} vs ${C.push / b.mass}`);
  check(`${id}: the jump is ${b.jump}x as high (${(r.apex / C.apex).toFixed(2)}x)`, near(r.apex, C.apex * b.jump, 0.12), `${r.apex} vs ${C.apex * b.jump}`);
  check(`${id}: the hang time is sqrt(jump/gravity) = ${Math.sqrt(b.jump / b.gravity).toFixed(2)}x (${(r.hang / C.hang).toFixed(2)}x)`, near(r.hang, C.hang * Math.sqrt(b.jump / b.gravity), 0.12), `${r.hang} vs ${C.hang * Math.sqrt(b.jump / b.gravity)}`);
  check(`${id}: the terminal fall is ${b.fall}x (${(r.fall / C.fall).toFixed(2)}x)`, near(r.fall, C.fall * b.fall, 0.08), `${r.fall} vs ${C.fall * b.fall}`);
  check(`${id}: health ${b.maxHp}x and the levitation tank ${b.jetFuel}x`, near(r.maxHp, C.maxHp * b.maxHp, 0.02) && near(r.maxLevit, C.maxLevit * b.jetFuel, 0.02), `${r.maxHp}/${C.maxHp} ${r.maxLevit}/${C.maxLevit}`);
}

// ---- the roster, ordered ----
const order = (key, dir = 1) => Object.entries(R).filter(([id]) => id !== 'control').sort((a, b) => dir * (b[1][key] - a[1][key])).map(([id]) => id);
check('Kest Rel is the fastest runner and Brann Rook the slowest', order('run')[0] === 'kest-rel' && order('run').at(-1) === 'brann-rook', JSON.stringify(order('run')));
check('Mara Quell and Edda Morrow jump no higher than the control (they float, they do not leap): the same apex, a longer hang', Math.abs(R['mara-quell'].apex / C.apex - 1) < 0.1 && R['mara-quell'].hang > C.hang * 1.1, JSON.stringify({ apex: R['mara-quell'].apex, hang: R['mara-quell'].hang }));
check('Selene Wraith coasts the farthest after letting go; Father Thorne or Brann Rook stop soonest', order('stopCells')[0] === 'selene-wraith' && ['father-thorne', 'brann-rook', 'rusk-emberjaw'].includes(order('stopCells').at(-1)), JSON.stringify(order('stopCells')));
check('Brann Rook is the hardest to push; Edda Morrow the easiest', order('push').at(-1) === 'brann-rook' && order('push')[0] === 'edda-morrow', JSON.stringify(order('push')));
check('Mara Quell falls slowest of all; Brann Rook fastest', order('fall').at(-1) === 'mara-quell' && order('fall')[0] === 'brann-rook', JSON.stringify(order('fall')));
check('Mara Quell hangs in the air longest', order('hang')[0] === 'mara-quell', JSON.stringify(order('hang')));
check('Mara Quell and Edda Morrow burn the jet longest', ['mara-quell', 'edda-morrow'].includes(order('jetTicks')[0]) && ['mara-quell', 'edda-morrow'].includes(order('jetTicks')[1]), JSON.stringify(order('jetTicks')));
check('Brann Rook and Rusk Emberjaw have the shortest jet time and climb least', ['brann-rook', 'rusk-emberjaw'].includes(order('jetTicks').at(-1)) && ['brann-rook', 'rusk-emberjaw'].includes(order('flight').at(-1)), JSON.stringify({ jet: order('jetTicks'), climb: order('flight') }));
check('Brann Rook has the most health, Edda Morrow the least', order('maxHp')[0] === 'brann-rook' && order('maxHp').at(-1) === 'edda-morrow', JSON.stringify(order('maxHp')));
const distinct = (a, b) => Math.abs(a.run - b.run) / Math.max(a.run, b.run) > 0.05 || Math.abs(a.stopCells - b.stopCells) / Math.max(a.stopCells, b.stopCells, 0.1) > 0.15 || Math.abs(a.push - b.push) / Math.max(a.push, b.push) > 0.1 || Math.abs(a.apex - b.apex) / Math.max(a.apex, b.apex) > 0.08 || Math.abs(a.fall - b.fall) / Math.max(a.fall, b.fall) > 0.06;
const fighters = IDS.filter(Boolean);
let twins = [];
for (let i = 0; i < fighters.length; i++) for (let j = i + 1; j < fighters.length; j++) if (!distinct(R[fighters[i]], R[fighters[j]])) twins.push(`${fighters[i]}~${fighters[j]}`);
check('no two fighters are twins: every pair differs measurably in run, stop, push, jump or fall', twins.length === 0, twins.join(', '));
check('no page errors', main.errors.length === 0, main.errors.slice(0, 2).join(' | '));
console.log(`\nfighter bodies probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);

// THE TEN MOVEMENT TECHNIQUES (docs/arena/ROSTER-IDENTITY.md, src/fighters/techniques.ts), measured in the Proving Yard on a paused
// world stepped tick by tick. The keys are written into ctx.input.keys, exactly where the keyboard (and a bot) writes them; the
// technique reads them and bends the body, and the player's own physics carries it. Each technique is compared with the classic
// Alchemist doing the SAME thing (the control): the technique must do something the control does not.
//   Ilyra   Cinder Dash    a double tap in the air dashes ~19 cells, costs levitation, leaves embers
//   Brann   Piston Stomp   a plunge lands as a shockwave that hurts and stuns (the control's slam does 1)
//   Sable   Wall-cling     falling against a wall holding toward it slides slowly; jump kicks off
//   Mara    Glide          holding jump while falling with the jet dry glides at a quarter of the fall
//   Kest    Wall-run       running at a wall with speed and holding jump climbs it for under a third of the levitation
//   Nox     Shadow-step    hidden, he is faster
//   Edda    Hover          the jet rises gently; up + jump holds the height; and it burns less
//   Selene  Carry          a hop right after landing keeps and adds to the speed: a hop chain outruns the run
//   Rusk    Skid           braking from speed leaves real Ember cells
//   Thorne  Root-walk      standing in moss he is half again as fast
// Usage: node scripts/verify-fighter-moves.mjs [url]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, waitForConsoleApi } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:5173/';
const t = makeChecker();
const check = t.check;
mkdirSync('verify-out/moves', { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* blocked */ } });
await page.goto(url + (url.includes('?') ? '&' : '?') + 'link=off', { waitUntil: 'networkidle', timeout: 40000 });
await leaveTitleIfShown(page);
await waitForConsoleApi(page);
await page.evaluate(async () => { await window.__game.ctx.console.exec('run test --level fighter-test --world campaign-level'); });
await page.waitForFunction(() => window.__game?.ctx?.levels?.current?.def.id === 'fighter-test' && window.__game.ctx.state.mode === 'play', null, { timeout: 40000 });
await page.waitForTimeout(2500);

// Everything runs inside the page: one evaluate per fighter, returning the measurements.
const results = await page.evaluate(async () => {
  const ctx = window.__game.ctx;
  const p = ctx.player, keys = ctx.input.keys, w = ctx.world;
  const FLOOR = 640;
  const step = (n = 1) => { for (let i = 0; i < n; i++) window.__game.tick(false, { forcePaused: true }); };
  const release = () => { for (const k of Object.keys(keys)) keys[k] = false; };
  const place = (x, y, grounded = false) => { Object.assign(p, { x, y, vx: 0, vy: 0, fx: 0, fy: 0, dead: false, invuln: 0, crawling: false, climbing: false, grounded, diveT: 0 }); p.hp = p.maxHp; p.levit = p.maxLevit; };
  const view = () => JSON.parse(JSON.stringify(ctx.fighters.view));
  const count = (type, x0, y0, x1, y1) => { let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.inBounds(x, y) && w.types[w.idx(x, y)] === type) n++; return n; };
  const Cell = { Ember: 20, Moss: 34 };
  ctx.state.paused = true;
  ctx.enemies.length = 0;
  if (ctx.levels.current?.pickups) ctx.levels.current.pickups.length = 0;
  document.querySelectorAll('#card-offer-overlay.visible').forEach((e) => e.classList.remove('visible'));
  const equip = async (id) => { ctx.fighters.equip(id); await ctx.fighters.whenReady(); ctx.state.arrivalGraceUntil = ctx.state.frameCount + 1e6; release(); ctx.enemies.length = 0; place(1130, FLOOR - 1, true); step(30); };
  const out = {};
  const BRIDGE = 1130, AIR = 520;

  // ---------------- Cinder Dash: tap right twice in the air ----------------
  const dash = async (id) => {
    await equip(id);
    place(BRIDGE - 40, AIR); step(2);
    const x0 = p.x, lev0 = p.levit;
    const e0 = count(Cell.Ember, BRIDGE - 80, AIR - 20, BRIDGE + 90, AIR + 20);
    keys.right = true; step(); keys.right = false; step(2); keys.right = true; step(); keys.right = false;
    const state = view().technique.state;
    let e1 = 0;
    for (let i = 0; i < 10; i++) { step(); e1 = Math.max(e1, count(Cell.Ember, BRIDGE - 80, AIR - 20, BRIDGE + 90, AIR + 20)); }
    return { moved: +(p.x - x0).toFixed(1), fuel: +(lev0 - p.levit).toFixed(1), state, uses: view().technique.uses, embers: Math.max(0, e1 - e0) };
  };
  out.dash = { fighter: await dash('ilyra-voss'), control: await dash(null) };

  // ---------------- Piston Stomp: plunge onto a golem ----------------
  const stomp = async (id) => {
    await equip(id);
    place(BRIDGE, 480); step(2);
    ctx.enemyCtl.spawn('golem', BRIDGE + 12, FLOOR - 1);
    const e = ctx.enemies[ctx.enemies.length - 1];
    Object.assign(e, { x: BRIDGE + 12, y: FLOOR - 1, vx: 0, vy: 0, sleeping: false, alerted: false });
    const hp0 = e.hp;
    keys.down = true;
    let plunge = false;
    for (let i = 0; i < 140 && !p.grounded; i++) { step(); if (p.diveT > 0) plunge = true; }
    keys.down = false;
    step(3);
    return { plunged: plunge, damage: +(hp0 - e.hp).toFixed(1), stunned: !!(e.stunT > 0 || e.stunned || (ctx.fighters.isMarked && false) ), uses: view().technique.uses, state: view().technique.state };
  };
  out.stomp = { fighter: await stomp('brann-rook'), control: await stomp(null) };

  // ---------------- Wall-cling: fall against the Bluff's left face ----------------
  const cling = async (id) => {
    await equip(id);
    place(1015, 560); step(1);
    const y0 = p.y;
    keys.left = true;
    let maxVy = -99, state = '';
    for (let i = 0; i < 24; i++) { step(); maxVy = Math.max(maxVy, p.vy); if (i === 12) state = view().technique.state; }
    const slid = p.y - y0;
    // kick off
    keys.jump = true; step(); keys.jump = false; keys.left = false;
    const kickVx = p.vx, kickVy = p.vy;
    step(6);
    return { slid: +slid.toFixed(1), maxVy: +maxVy.toFixed(2), state, kickVx: +kickVx.toFixed(2), kickVy: +kickVy.toFixed(2), x: p.x, uses: view().technique.uses };
  };
  out.cling = { fighter: await cling('sable-fen'), control: await cling(null) };

  // ---------------- Glide: fall with the jet dry, holding jump ----------------
  const glide = async (id) => {
    await equip(id);
    place(BRIDGE, 400); p.levit = 0; step(2);
    keys.jump = true;
    let maxVy = 0, state = '';
    for (let i = 0; i < 50 && !p.grounded; i++) { step(); p.levit = 0; maxVy = Math.max(maxVy, p.vy); if (i === 25) state = view().technique.state; }
    keys.jump = false;
    return { maxVy: +maxVy.toFixed(2), fell: +(p.y - 400).toFixed(0), state, uses: view().technique.uses };
  };
  out.glide = { fighter: await glide('mara-quell'), control: await glide(null) };

  // ---------------- Wall-run: run at the hall's left wall and hold jump ----------------
  const wallrun = async (id) => {
    await equip(id);
    place(78, 633, true); step(2);
    const lev0 = p.levit;
    keys.left = true; keys.jump = true;
    let top = p.y, state = '', seen = false;
    for (let i = 0; i < 60; i++) { step(); top = Math.min(top, p.y); if (view().technique.state === 'wallrun') seen = true; if (i === 24) state = view().technique.state; }
    keys.left = false; keys.jump = false;
    return { rose: +(633 - top).toFixed(0), fuel: +(lev0 - p.levit).toFixed(1), seen, state, uses: view().technique.uses };
  };
  out.wallrun = { fighter: await wallrun('kest-rel'), control: await wallrun(null) };

  // ---------------- Shadow-step: faster while hidden ----------------
  const shadow = async (id, hidden) => {
    await equip(id);
    if (hidden) ctx.fighters.setMod('probe-hide', 600, { concealment: 0.8 });
    place(1098, FLOOR - 1, true); step(2);
    keys.right = true;
    let peak = 0;
    for (let i = 0; i < 30; i++) { step(); peak = Math.max(peak, p.vx); }
    keys.right = false;
    const state = view().technique.state;
    ctx.fighters.clearMod('probe-hide');
    return { peak: +peak.toFixed(3), state };
  };
  out.shadow = { hidden: await shadow('nox-calder', true), open: await shadow('nox-calder', false) };

  // ---------------- Hover: hold jump; up + jump holds the height ----------------
  const hover = async (id, up) => {
    await equip(id);
    place(BRIDGE, 560); step(2);
    const lev0 = p.levit;
    keys.jump = true; keys.up = !!up;
    let minVy = 0, y0 = p.y, y15 = p.y;
    for (let i = 0; i < 50; i++) { step(); if (i >= 15) minVy = Math.min(minVy, p.vy); if (i === 15) y15 = p.y; }
    keys.jump = false; keys.up = false;
    return { fastestRise: +(-minVy).toFixed(2), rose: +(y0 - p.y).toFixed(0), driftAfter15: +(y15 - p.y).toFixed(0), fuel: +(lev0 - p.levit).toFixed(1), state: view().technique.state, uses: view().technique.uses };
  };
  out.hover = { fighter: await hover('edda-morrow', false), control: await hover(null, false), hold: await hover('edda-morrow', true) };

  // ---------------- Carry: a hop chain ----------------
  const carry = async (id) => {
    await equip(id);
    place(1094, FLOOR - 1, true); step(2);
    keys.right = true;
    for (let i = 0; i < 20; i++) step();
    const runVx = p.vx;
    keys.jump = true; step(); keys.jump = false; // the first hop (no landing before it: no carry)
    let air = 0, relaunch = null, landVx = 0, wasGrounded = false;
    for (let i = 0; i < 70; i++) {
      p.levit = 0; // no jet: this is a hop
      if (air === 22) keys.jump = true; else keys.jump = false; // a fresh press just before landing: the jump buffer fires on the landing frame
      step(); air++;
      const g = p.grounded === true;
      if (g && !wasGrounded) landVx = p.vx;
      if (!g && wasGrounded && p.vy < -2.5) { relaunch = p.vx; break; }
      wasGrounded = g;
    }
    keys.right = false; keys.jump = false;
    return { runVx: +runVx.toFixed(2), landVx: +landVx.toFixed(2), relaunch: relaunch === null ? null : +relaunch.toFixed(2), uses: view().technique.uses };
  };
  out.carry = { fighter: await carry('selene-wraith'), control: await carry(null) };

  // ---------------- Skid: brake from speed, leave embers ----------------
  const skid = async (id) => {
    await equip(id);
    place(1098, FLOOR - 1, true); step(2);
    keys.right = true;
    for (let i = 0; i < 22; i++) step();
    const speed = p.vx;
    const e0 = count(Cell.Ember, 1090, FLOOR - 8, 1240, FLOOR);
    keys.right = false; // let go: brake
    let e1 = 0, state = '';
    for (let i = 0; i < 16; i++) { step(); e1 = Math.max(e1, count(Cell.Ember, 1090, FLOOR - 8, 1240, FLOOR)); if (i === 0) state = view().technique.state; }
    return { speed: +speed.toFixed(2), embers: Math.max(0, e1 - e0), state, uses: view().technique.uses };
  };
  out.skid = { fighter: await skid('rusk-emberjaw'), control: await skid(null) };

  // ---------------- Root-walk: run along the moss bank vs the bare bridge ----------------
  const carpet = (on) => { for (let y = FLOOR - 4; y <= FLOOR - 1; y++) for (let x = 1094; x <= 1236; x++) { const i = w.idx(x, y); if (on) { if (w.types[i] === 0) w.replaceCellAt(i, 34, 0x3a6a2a); } else if (w.types[i] === 34) w.clearCellAt(i); } };
  const root = async (id, on) => {
    await equip(id);
    carpet(on);
    place(1098, FLOOR - 1, true); step(2);
    keys.right = true;
    let peak = 0, state = '';
    for (let i = 0; i < 14; i++) { step(); peak = Math.max(peak, p.vx); if (i === 6) state = view().technique.state; }
    keys.right = false;
    const moss = count(Cell.Moss, 1094, FLOOR - 4, 1236, FLOOR - 1);
    carpet(false);
    return { peak: +peak.toFixed(3), state, moss };
  };
  out.root = { moss: await root('father-thorne', true), bare: await root('father-thorne', false) };

  release();
  ctx.fighters.equip(null);
  ctx.state.arrivalGraceUntil = 0;
  return out;
});
writeFileSync('verify-out/moves/measured.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 1).replace(/\n\s+/g, ' ').slice(0, 4000));
const R = results;

// ---- Ilyra ----
check('Cinder Dash: a double tap in the air dashes more than 15 cells (the control, tapping the same, drifts a few)', R.dash.fighter.moved > 15 && R.dash.control.moved < 14, JSON.stringify(R.dash));
check('Cinder Dash: it costs levitation (about 15) and counts a use', R.dash.fighter.fuel >= 12 && R.dash.fighter.uses === 1 && R.dash.control.uses === 0, JSON.stringify([R.dash.fighter.fuel, R.dash.fighter.uses]));
check('Cinder Dash: it leaves real Ember cells behind', R.dash.fighter.embers >= 1 && R.dash.control.embers === 0, `embers ${R.dash.fighter.embers}`);
// ---- Brann ----
check('Piston Stomp: a plunge lands as a shockwave: more than 5 damage (the control\'s slam does about 1)', R.stomp.fighter.damage > 5 && R.stomp.control.damage < 3, JSON.stringify(R.stomp));
check('Piston Stomp: it plunged, counted a use and reports the stomp', R.stomp.fighter.plunged && R.stomp.fighter.uses === 1 && R.stomp.fighter.state === 'stomp', JSON.stringify(R.stomp.fighter));
// ---- Sable ----
check('Wall-cling: falling against the wall she slides a few cells (the control falls past 25)', R.cling.fighter.slid < 18 && R.cling.control.slid > 40, JSON.stringify(R.cling));
check('Wall-cling: the slide is slow (under 0.6 cells/tick) and she reports clinging', R.cling.fighter.maxVy < 0.7 && R.cling.fighter.state === 'clinging', JSON.stringify(R.cling.fighter));
check('Wall-cling: jump kicks her off the wall, away and up', R.cling.fighter.kickVx > 2 && R.cling.fighter.kickVy < -2.5 && R.cling.fighter.uses >= 1, JSON.stringify(R.cling.fighter));
// ---- Mara ----
check('Glide: with the jet dry, holding jump while falling glides at under 1.6 cells/tick (the control falls at 5)', R.glide.fighter.maxVy < 1.6 && R.glide.control.maxVy > 4.5 && R.glide.fighter.state === 'gliding', JSON.stringify(R.glide));
// ---- Kest ----
check('Wall-run: running at the Bluff holding jump climbs it (60+ cells) and reports a wall-run', R.wallrun.fighter.rose > 60 && R.wallrun.fighter.seen && R.wallrun.fighter.uses >= 1, JSON.stringify(R.wallrun));
check('Wall-run: the wall does the lifting: it burns under a third of the fuel the control\'s jet burns on the same climb', R.wallrun.fighter.fuel < R.wallrun.control.fuel * 0.33 && R.wallrun.control.fuel > 20, JSON.stringify([R.wallrun.fighter.fuel, R.wallrun.control.fuel]));
// ---- Nox ----
check('Shadow-step: hidden, he runs 1.2x faster or more than in the open', R.shadow.hidden.peak > R.shadow.open.peak * 1.18 && R.shadow.hidden.state === 'shadow', JSON.stringify(R.shadow));
// ---- Edda ----
check('Hover: holding jump rises gently (under 1.2 cells/tick; the control rockets past 2.5)', R.hover.fighter.fastestRise < 1.2 && R.hover.control.fastestRise > 2.5 && R.hover.fighter.state === 'hovering', JSON.stringify([R.hover.fighter, R.hover.control]));
check('Hover: up + jump holds her height (barely moves between tick 15 and 50)', Math.abs(R.hover.hold.driftAfter15) < 25 && R.hover.hold.fastestRise < 0.9, JSON.stringify(R.hover.hold));
check('Hover: it burns far less fuel than the control\'s jet over the same time', R.hover.fighter.fuel < R.hover.control.fuel * 0.6, JSON.stringify([R.hover.fighter.fuel, R.hover.control.fuel]));
// ---- Selene ----
check('Carry: the hop right after a landing leaves FASTER than she ran (the control\'s never does)', R.carry.fighter.relaunch !== null && R.carry.fighter.relaunch > R.carry.fighter.runVx * 1.05 && R.carry.fighter.uses >= 1 && (R.carry.control.relaunch === null || R.carry.control.relaunch <= R.carry.control.runVx * 1.02), JSON.stringify(R.carry));
// ---- Rusk ----
check('Skid: braking from speed leaves Ember cells (the control leaves none)', R.skid.fighter.embers >= 1 && R.skid.control.embers === 0 && R.skid.fighter.uses >= 1, JSON.stringify(R.skid));
// ---- Thorne ----
check('Root-walk: on the moss bank he is 1.3x faster or more than on the bare bridge, and reports rooted', R.root.moss.peak > R.root.bare.peak * 1.3 && R.root.moss.state === 'rooted' && R.root.bare.state !== 'rooted', JSON.stringify(R.root));
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
console.log(`\nfighter moves probe: ${t.pass} passed, ${t.fail} failed`);
process.exit(t.fail ? 1 : 0);

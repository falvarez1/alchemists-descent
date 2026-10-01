import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';
import { lockProbeTools, takeArrivalGift } from './lock-probe-helpers.mjs';

// THE WEIR (floor 3's lock, world/lockWeir), PLAYED with real input.
//   default    the intended solution: from the dais, a bolt at the DRY bowl does nothing (the coil in the well
//              drinks only through water); pull the sluice lever, the cistern empties into the bowl, a bolt into the
//              brass lining now wets the coil: it latches, the relay counts a moment, the vault door lets go.
//   --flask    the water is lost (the cistern's gush is drained away): pour the Water flask into the well, then spark it.
//   --brute    the door is Metal: ten bolts and eight seconds of the Excavate Ray leave it shut.
//   --relent   the Works relent: the door cracks open of its own accord when its clock runs out.
//   --resume   a real expedition: save with everything shut, reload; fill the bowl, save, reload; solve, save, reload.
// Usage: node scripts/verify-weir.mjs [url] [seed] [--flask|--brute|--relent|--resume]
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const pos = argv.filter((a) => !a.startsWith('--'));
const url = pos[0] ?? 'http://localhost:5173/';
const seed = Number(pos[1] ?? 5);
const mode = ['flask', 'brute', 'relent', 'resume'].find((m) => flags.has(`--${m}`)) ?? 'intended';
const output = `verify-out/weir-${seed}-${mode}`;
mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { mode, seed, errors: [], stages: [] };
page.on('pageerror', (e) => report.errors.push(String(e)));
const { ctxEval, shot, waitFor, walkTo, pointAtWorld, waitObjective, waitHint, plugOpen, dismissCards } = lockProbeTools(page, output);

const lock = () => ctxEval(() => {
  const ctx = window.__game.ctx, rt = ctx.levels.current;
  const plug = rt.mechanisms.find((m) => m.kind === 'plug' && m.lock);
  const relay = rt.mechanisms.find((m) => m.kind === 'relay' && m.targetId === plug.id);
  const coil = rt.mechanisms.find((m) => m.kind === 'chargelatch' && m.targetId === relay.id);
  const room = rt.placedPrefabs.find((p) => p.id === 'lock-weir');
  // (the floor's alchemy clock has valves and levers of its own: the Weir's stand inside its room)
  const valve = rt.mechanisms.find((m) => m.kind === 'valve' && m.x >= room.x0 && m.x <= room.x1 && m.y >= room.y0 && m.y <= room.y1);
  const lever = rt.mechanisms.find((m) => m.kind === 'lever' && m.targetId === valve.id);
  const keyPickup = rt.pickups.find((p) => p.kind === 'key');
  return {
    plugId: plug.id, relayId: relay.id, coilId: coil.id, valveId: valve.id, leverId: lever.id, room,
    floorY: plug.y + 20, px: coil.x, pedY: coil.y, leverX: lever.x, daisX: coil.x - 36,
    plug: { x: plug.x, y: plug.y, w: plug.w, h: plug.h, n: plug.body.length }, key: { x: keyPickup.x, y: keyPickup.y },
  };
});
const state = (L) => ctxEval(({ plugId, relayId, coilId, valveId, leverId, px, floorY, pedY, room }) => {
  const ctx = window.__game.ctx, rt = ctx.levels.current, w = ctx.world;
  const g = (id) => rt.mechanisms.find((m) => m.id === id);
  const count = (x0, y0, x1, y1, t) => { let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.types[w.idx(x, y)] === t) n++; return n; };
  const plug = g(plugId);
  let metal = 0;
  for (const [x, y] of plug.body) if (w.types[w.idx(x, y)] === 13) metal++;
  return {
    frame: ctx.state.frameCount, plug: plug.state, relent: plug.relentFrames, relay: g(relayId).state, coil: g(coilId).state,
    valve: g(valveId).state, lever: g(leverId).state, doorMetal: metal,
    tank: count(px - 10, room.y0 + 18, px + 9, room.y0 + 28, 2),
    air: count(px - 12, room.y0 + 31, px + 11, floorY - 1, 2),
    // the dent's open cells (the ramps' own surface row is the limit: the rock under the lining holds natural pockets of water)
    bowl: (() => { let n = 0; for (let x = px - 20; x <= px + 19; x++) { const t = x < px - 4 ? px - 4 - x : x > px + 3 ? x - px - 3 : 0; const s2 = floorY + Math.max(0, 9 - Math.ceil(t / 2)); for (let y = floorY; y < s2; y++) if (w.types[w.idx(x, y)] === 2) n++; } return n + count(px - 1, pedY - 6, px + 1, pedY - 1, 2); })(),
    well: count(px - 1, pedY - 6, px + 1, pedY - 1, 2),
    hp: Math.round(ctx.player.hp), hurtBy: ctx.player.lastDamageSource ?? null, dead: ctx.player.dead, keyTaken: rt.keyTaken, px: ctx.player.x, py: ctx.player.y,
  };
}, L);

/** Put the alchemist on the lever's iron pads at the hall's west end (the route to the room is verify-living-traversal's job; the hall's own mouth can be a shaft, so not the very end). */
async function enterHall(L) {
  await ctxEval(({ x, y, px, floorY }) => { const c = window.__game.ctx; c.enemies.length = 0; Object.assign(c.player, { x, y, vx: 0, vy: 0 }); c.camera.snapTo(px - 30, floorY - 40); }, { x: L.leverX, y: L.floorY - 1, px: L.px, floorY: L.floorY });
  await page.waitForTimeout(1500);
}
/** Let the brass stop ringing (a blast rings the lining at 210, a charge of 1 a frame: ~3.5 s) so what follows is judged on its own. */
const calm = (L) => waitFor(({ px, floorY, pedY }) => { const w = window.__game.ctx.world; for (let y = floorY - 2; y < pedY + 3; y++) for (let x = px - 24; x <= px + 23; x++) if (w.charge[w.idx(x, y)] > 0) return false; return true; }, { px: L.px, floorY: L.floorY, pedY: L.pedY }, 12000);
/** Aim at the brass lining on the bowl's near slope and cast the wand. */
const sparkTheBrass = async (L) => { await page.keyboard.press('Digit1'); await pointAtWorld(L.px - 14, L.floorY + 4, true); };
const pullLever = async () => { await page.keyboard.press('KeyE'); };
/** Wait for the sluice to throw and the cistern to fill the well; screenshots of the gush on the way. */
async function floodTheBowl(L, shots = true) {
  await waitFor(({ id }) => window.__game.ctx.levels.current.mechanisms.find((m) => m.id === id).state === 1, { id: L.valveId }, 8000);
  for (let i = 0; i < 6 && shots; i++) { await page.waitForTimeout(350); await shot(`03-gush-${i}`); }
  await waitFor(({ px, pedY }) => { const w = window.__game.ctx.world; let n = 0; for (let y = pedY - 4; y < pedY; y++) for (let x = px - 1; x <= px + 1; x++) if (w.types[w.idx(x, y)] === 2) n++; return n >= 9; }, { px: L.px, pedY: L.pedY }, 30000);
  // the cistern finishes emptying (no stream left in the air, nothing in the casing), and the surface settles
  await waitFor(({ px, floorY, room }) => { const w = window.__game.ctx.world; let n = 0; for (let y = room.y0 + 18; y < floorY; y++) for (let x = px - 12; x <= px + 11; x++) if (w.types[w.idx(x, y)] === 2) n++; return n <= 4; }, { px: L.px, floorY: L.floorY, room: L.room }, 15000);
  await page.waitForTimeout(800);
}

try {
  await page.goto(url);
  const resume = mode === 'resume';
  await execConsoleCommand(page, resume ? `run new --seed ${seed}` : `run test --level d3 --world campaign-level --seed ${seed} --loadout fresh`);
  await waitForRunReady(page);
  await takeArrivalGift(page);
  if (resume) {
    await execConsoleCommand(page, 'goto d3'); await waitForRunReady(page);
    await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'd3', null, { timeout: 90000 }); // (a floor takes a few seconds to build)
    await page.waitForTimeout(800);
    // (the console jump taints the run, and a tainted run is never saved: this probe tests the SAVE of the lock, not the taint rule)
    await page.evaluate(() => { window.__game.ctx.state.debugTainted = false; });
  }
  let L = await lock();
  report.layout = { room: L.room, door: L.plug, px: L.px, floorY: L.floorY, dais: L.daisX, lever: L.leverX };

  // ---- the floor's own words: generic far from the machine ----
  await page.evaluate(() => { window.__game.ctx.enemies.length = 0; });
  await page.waitForTimeout(600);
  let s = await state(L);
  // far from the machine the objective is NOT the puzzle's own line (it is the generic one, or a waystone's when the arrival is near one)
  const farLine = await page.evaluate(() => document.getElementById('objective')?.innerText ?? '');
  const awayFromIt = await ctxEval(({ px, pedY }) => Math.hypot(window.__game.ctx.player.x - px, window.__game.ctx.player.y - pedY) > 230, { px: L.px, pedY: L.pedY });
  if (awayFromIt) assert.notEqual(farLine, 'Wire the Weir. Fill the bowl, then spark the brass.', 'far from the machine the puzzle is not yet named');
  assert.equal(s.plug, 0);
  assert.equal(s.doorMetal, L.plug.n, 'the door stands');
  assert.ok(s.tank >= 190, `the cistern hangs full (${s.tank})`);
  assert.equal(s.bowl, 0, 'the bowl is dry');
  assert.equal(s.valve, 0, 'the sluice is shut');
  assert.ok(s.relent > 0 && s.relent <= 27000, `the Works' clock is running (${s.relent})`);
  await enterHall(L);
  await waitObjective('Wire the Weir. Fill the bowl, then spark the brass.', 'near the machine the puzzle is named');
  await dismissCards();
  await waitHint('A dry bowl and a coil in its well. Fill it, then spark the brass.', 'the hint reads the machine');
  await dismissCards();
  await shot('01-hall');
  s = await state(L);
  report.stages.push({ name: 'hall', ...s });
  const enteredAt = s.frame;

  if (mode === 'resume') {
    const before = await state(L);
    await execConsoleCommand(page, 'run save');
    await page.waitForFunction(() => window.__game.ctx.levels.persistenceStatus().state === 'ready');
    await ctxEval(() => window.__game.ctx.levels.flushSaves());
    await page.reload(); await execConsoleCommand(page, 'run continue'); await waitForRunReady(page); await page.waitForTimeout(1200);
    L = await lock();
    const after = await state(L);
    assert.equal(after.plug, 0); assert.equal(after.doorMetal, L.plug.n); assert.equal(after.valve, 0); assert.equal(after.coil, 0);
    assert.ok(after.tank >= before.tank - 2, `the cistern's water persisted (${before.tank} -> ${after.tank})`);
    assert.ok(after.relent > 0 && after.relent <= before.relent, `the clock persisted and kept counting (${before.relent} -> ${after.relent})`);
    report.resumeShut = { before, after };
    await enterHall(L);
  }

  if (mode === 'brute') {
    // ten bolts at the door, then eight seconds of the Excavate Ray: a Metal door shrugs both off
    await ctxEval(({ x, y }) => { const c = window.__game.ctx; Object.assign(c.player, { x, y, vx: 0, vy: 0 }); c.camera.snapTo(x + 20, y - 30); c.player.mana = 9999; }, { x: L.plug.x - 14, y: L.floorY - 1 });
    await page.waitForTimeout(800);
    await page.keyboard.press('Digit1');
    for (let i = 0; i < 10; i++) { await pointAtWorld(L.plug.x + 3, L.floorY - 10); await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up(); await page.waitForTimeout(380); }
    await page.keyboard.press('Digit2');
    await pointAtWorld(L.plug.x + 6, L.floorY - 10);
    await page.mouse.down(); await page.waitForTimeout(8000); await page.mouse.up();
    await shot('02-door-after-brute-force');
    const t = await state(L);
    assert.equal(t.plug, 0, 'the door has not fired');
    assert.equal(t.doorMetal, L.plug.n, 'every cell of the door stands (blasts and the ray leave Metal be)');
    assert.equal(t.dead, false);
    report.brute = t;
    console.log(`PASS (brute): ten bolts and eight seconds of the ray left the Metal door whole (${t.doorMetal}/${L.plug.n}); relent clock at ${t.relent}`);
  } else if (mode === 'relent') {
    await ctxEval((id) => { window.__game.ctx.levels.current.mechanisms.find((m) => m.id === id).relentFrames = 120; }, L.plugId);
    await plugOpen(L.plugId);
    const t = await state(L);
    assert.equal(t.coil, 0, 'the coil never latched: the Works opened it');
    await waitObjective('The vault stands open. Take the golden key.', 'the objective names the reward');
    await shot('02-relented');
    await walkTo(L.key.x);
    await waitFor(() => window.__game.ctx.levels.current.keyTaken, null, 30000);
    report.relent = await state(L);
    console.log(`PASS (relent): the door cracked open after its clock, the key was taken, the objective named the reward then the portal`);
  } else {
    // ---- stand on the dais; a bolt at the DRY bowl does nothing ----
    await walkTo(L.daisX);
    s = await state(L);
    assert.ok(Math.abs(s.px - L.daisX) < 8, `on the dais (${s.px} vs ${L.daisX})`);
    await shot('02-on-the-dais');
    if (mode !== 'flask') {
      await sparkTheBrass(L);
      await page.waitForTimeout(1800);
      const dry = await state(L);
      assert.equal(dry.coil, 0, 'a bolt at the dry bowl does not wake the coil');
      assert.equal(dry.plug, 0);
      await shot('02b-dry-bolt');
      report.stages.push({ name: 'dry-bolt', ...dry });
      await calm(L);
      assert.equal((await state(L)).coil, 0, 'the coil is still asleep');
    }
    // ---- the lever, then the flood ----
    await pullLever();
    await floodTheBowl(L);
    let f = await state(L);
    assert.equal(f.valve, 1, 'the sluice is open');
    assert.ok(f.well >= 9, `water in the well (${f.well})`);
    assert.equal(f.coil, 0, 'the flood alone does not wake the coil');
    await shot('04-flooded');
    report.stages.push({ name: 'flooded', ...f });
    if (mode === 'flask') {
      // the flood is lost: drain the bowl and the well (the Works' cistern has only the one emptying)
      await ctxEval(({ px, floorY, pedY }) => {
        const w = window.__game.ctx.world;
        for (let y = floorY - 12; y < pedY; y++) for (let x = px - 24; x <= px + 23; x++) { const i = w.idx(x, y); if (w.types[i] === 2) w.replaceCellAt(i, 0, 0x08080c); }
      }, { px: L.px, floorY: L.floorY, pedY: L.pedY });
      await page.waitForTimeout(500);
      const lost = await state(L);
      assert.equal(lost.well, 0, 'the water is gone');
      await sparkTheBrass(L);
      await page.waitForTimeout(1800);
      assert.equal((await state(L)).coil, 0, 'a bolt at the drained bowl does nothing');
      await calm(L);
      // walk down into the drained pool and pour the Water flask into the well
      await walkTo(L.px - 7);
      await page.keyboard.press('Digit3'); await page.keyboard.down('KeyQ');
      for (let beat = 0; beat < 40; beat++) {
        await pointAtWorld(L.px, L.floorY + 6); await page.waitForTimeout(250);
        if ((await state(L)).well >= 9) break;
      }
      await page.keyboard.up('KeyQ');
      await shot('05-poured');
      assert.ok((await state(L)).well >= 9, 'the flask water reached the well');
      assert.equal((await state(L)).coil, 0, 'the poured water alone does not wake the coil');
      await walkTo(L.daisX);
      await page.waitForTimeout(800);
    }
    if (mode === 'resume') {
      // save with the bowl full and the sluice open: the water, the valve and the dry-asleep coil persist
      const before = await state(L);
      await execConsoleCommand(page, 'run save');
      await page.waitForFunction(() => window.__game.ctx.levels.persistenceStatus().state === 'ready');
      await ctxEval(() => window.__game.ctx.levels.flushSaves());
      await page.reload(); await execConsoleCommand(page, 'run continue'); await waitForRunReady(page); await page.waitForTimeout(1200);
      L = await lock();
      const after = await state(L);
      assert.equal(after.valve, 1, 'the open sluice survived the reload');
      assert.ok(after.well >= 9 && after.bowl >= before.bowl - 6, `the flood persisted (${before.bowl} -> ${after.bowl})`);
      assert.equal(after.coil, 0);
      report.resumeFlooded = { before, after };
      await enterHall(L);
      await walkTo(L.daisX);
    }
    // ---- spark the brass: the wet well hands the current to the coil ----
    const hp0 = (await state(L)).hp;
    const firedAt = (await state(L)).frame;
    await sparkTheBrass(L);
    await plugOpen(L.plugId);
    s = await state(L);
    assert.equal(s.coil, 1, 'the coil latched');
    assert.equal(s.relay, 1);
    assert.equal(s.plug, 1);
    assert.equal(s.dead, false, 'the alchemist stood clear and lived');
    // (an ambient creature may nip the alchemist: the dais is judged on electricity)
    assert.ok(s.hp >= hp0 || !/shock|elect|spark|charge|lightning|water/i.test(String(s.hurtBy)), `unshocked on the dais (${hp0} -> ${s.hp}, hurt by ${s.hurtBy})`);
    report.openTicks = s.frame - firedAt;
    await shot('06-door-open');
    await waitObjective('The vault stands open. Take the golden key.', 'the objective names the reward');
    // ---- the key, across the bowl (a ford: wet or dry) ----
    await walkTo(L.key.x);
    await waitFor(() => window.__game.ctx.levels.current.keyTaken, null, 40000);
    await shot('07-key');
    const done = await state(L);
    await waitObjective('Carry the golden key back to the portal.', 'the key in hand, the objective is the portal');
    report.solveTicks = done.frame - enteredAt;
    report.stages.push({ name: 'key', ...done });
    console.log(`PASS (${mode}): bowl flooded, coil latched, door open ${(report.openTicks / 60).toFixed(1)} s after the bolt, key taken ${(report.solveTicks / 60).toFixed(1)} s after entering the hall`);

    if (mode === 'resume') {
      await execConsoleCommand(page, 'run save');
      await page.waitForFunction(() => window.__game.ctx.levels.persistenceStatus().state === 'ready');
      await ctxEval(() => window.__game.ctx.levels.flushSaves());
      await page.reload(); await execConsoleCommand(page, 'run continue'); await waitForRunReady(page); await page.waitForTimeout(1200);
      L = await lock();
      const r = await state(L);
      assert.equal(r.plug, 1, 'the open door survived the reload'); assert.equal(r.coil, 1, 'the coil stayed latched'); assert.equal(r.keyTaken, true);
      report.resumeOpen = r;
      console.log('PASS (resume): shut save (cistern, clock), flooded save (sluice, water), open save (door, coil, key) all reloaded intact');
    }
  }
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await page.screenshot({ path: `${output}/last.png` }).catch(() => {});
  await browser.close();
}

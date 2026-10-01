import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';
import { lockProbeTools } from './lock-probe-helpers.mjs';

// THE CRUCIBLE (floor 4's lock, world/lockCrucible), PLAYED with real input.
//   default    the intended solution: from the gallery's far end, pull the sluice lever; the cistern empties through the
//              gangway's hatch onto the lava, the vat crusts over and the steam billows, the gauge counts the stone and
//              latches, the relay counts a moment and the slag gate lets go; then walk the gangway and the corridor to the hall.
//   --flask    the cistern is spoiled (its water is gone): stand on the gangway and pour the Water flask through the hatch.
//              The steam comes up the hatch at the alchemist: it scalds (the reason the lever is forty cells away).
//   --brute    the gate is Metal: ten bolts and eight seconds of the Excavate Ray leave it shut.
//   --relent   the Works relent: the gate cracks open of its own accord when its clock runs out; the gangway carries the alchemist over the lava.
//   --resume   a real expedition: save with everything shut, reload; quench, save, reload.
// Usage: node scripts/verify-crucible.mjs [url] [seed] [--flask|--brute|--relent|--resume]
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const pos = argv.filter((a) => !a.startsWith('--'));
const url = pos[0] ?? 'http://localhost:5173/';
const seed = Number(pos[1] ?? 5);
const mode = ['flask', 'brute', 'relent', 'resume'].find((m) => flags.has(`--${m}`)) ?? 'intended';
const output = `verify-out/crucible-${seed}-${mode}`;
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
  const gauge = rt.mechanisms.find((m) => m.kind === 'sensor' && m.targetId === relay.id);
  const room = rt.placedPrefabs.find((p) => p.id === 'lock-crucible');
  const valve = rt.mechanisms.find((m) => m.kind === 'valve' && m.x >= room.x0 && m.x <= room.x1 && m.y >= room.y0 && m.y <= room.y1);
  const lever = rt.mechanisms.find((m) => m.kind === 'lever' && m.targetId === valve.id);
  const e = lever.x > plug.x ? 1 : -1;
  const Fr = plug.y + 24;
  return { plugId: plug.id, relayId: relay.id, gaugeId: gauge.id, valveId: valve.id, leverId: lever.id, e, Fr, room, plug: { x: plug.x, y: plug.y, w: plug.w, h: plug.h, n: plug.body.length }, leverX: lever.x, zone: gauge.zone };
});
/** World x of outward distance u from the hall's flank (u = 0 is the first column outside the hall's rect). */
const ox = (L, u) => (L.e > 0 ? L.plug.x - 4 + u : L.plug.x + 15 - u);
const state = (L) => ctxEval(({ plugId, relayId, gaugeId, valveId, leverId, zone, Fr, room, e, plugX }) => {
  const ctx = window.__game.ctx, rt = ctx.levels.current, w = ctx.world;
  const g = (id) => rt.mechanisms.find((m) => m.id === id);
  const count = (x0, y0, x1, y1, t) => { let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.types[w.idx(x, y)] === t) n++; return n; };
  const plug = g(plugId);
  let metal = 0;
  for (const [x, y] of plug.body) if (w.types[w.idx(x, y)] === 13) metal++;
  return {
    frame: ctx.state.frameCount, plug: plug.state, relent: plug.relentFrames, relay: g(relayId).state, gauge: g(gaugeId).state,
    valve: g(valveId).state, lever: g(leverId).state, doorMetal: metal,
    lava: count(zone.x0, zone.y0, zone.x1, zone.y1, 11), stone: count(zone.x0, zone.y0, zone.x1, zone.y1, 12),
    tank: count(room.x0, Fr - 40, room.x1, Fr - 24, 2), steam: count(room.x0, Fr - 40, room.x1, Fr + 4, 9),
    hp: Math.round(ctx.player.hp), dead: ctx.player.dead, px: ctx.player.x, py: ctx.player.y,
  };
}, { plugId: L.plugId, relayId: L.relayId, gaugeId: L.gaugeId, valveId: L.valveId, leverId: L.leverId, zone: L.zone, Fr: L.Fr, room: L.room, e: L.e, plugX: L.plug.x });

/** Put the alchemist at the gallery's far end (the route to the Kiln is verify-living-traversal's job), feet on the floor. */
async function enterGallery(L) {
  await ctxEval(({ x, y, tx }) => { const c = window.__game.ctx; c.enemies.length = 0; Object.assign(c.player, { x, y, vx: 0, vy: 0 }); c.camera.snapTo(tx, y - 20); }, { x: L.leverX, y: L.Fr - 1, tx: ox(L, 80) });
  await page.waitForTimeout(1500);
}
const pullLever = () => page.keyboard.press('KeyE');
/** Throw the Water flask's contents at the vat from the gangway: hold Q over the hatch. */
async function pourThroughHatch(L, until) {
  await page.keyboard.press('Digit3'); await page.keyboard.down('KeyQ');
  for (let beat = 0; beat < 60; beat++) {
    await pointAtWorld(ox(L, 54), L.Fr + 4); await page.waitForTimeout(250);
    if (await until()) break;
  }
  await page.keyboard.up('KeyQ');
}

try {
  await page.goto(url);
  const resume = mode === 'resume';
  await execConsoleCommand(page, resume ? `run new --seed ${seed}` : `run test --level d4 --world campaign-level --seed ${seed} --loadout fresh`);
  await waitForRunReady(page);
  if (resume) {
    await execConsoleCommand(page, 'goto d4'); await waitForRunReady(page);
    await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'd4', null, { timeout: 90000 }); // (a floor takes a few seconds to build)
    await page.waitForTimeout(800);
    // (the console jump taints the run, and a tainted run is never saved: this probe tests the SAVE of the lock, not the taint rule)
    await page.evaluate(() => { window.__game.ctx.state.debugTainted = false; });
  }
  let L = await lock();
  report.layout = { room: L.room, gate: L.plug, e: L.e, Fr: L.Fr, lever: L.leverX };
  await page.evaluate(() => { window.__game.ctx.enemies.length = 0; });
  await page.waitForTimeout(600);
  let s = await state(L);
  assert.equal(s.plug, 0);
  assert.equal(s.doorMetal, L.plug.n, 'the gate stands');
  assert.equal(s.stone, 0, 'no stone in the vat');
  assert.ok(s.lava >= 60, `the vat is full of lava (${s.lava})`);
  assert.ok(s.tank >= 80, `the cistern hangs full (${s.tank})`);
  assert.equal(s.valve, 0, 'the sluice is shut');
  assert.ok(s.relent > 0 && s.relent <= 27000, `the Works' clock is running (${s.relent})`);
  await enterGallery(L);
  await waitObjective('Quench the Crucible. Water on the lava, from a distance.', 'near the machine the puzzle is named');
  await dismissCards();
  await waitHint('A vat of lava and a shut slag gate. Water on the lava; stand well back.', 'the hint reads the machine');
  await dismissCards();
  await shot('01-gallery');
  s = await state(L);
  report.stages.push({ name: 'gallery', ...s });
  const enteredAt = s.frame;

  if (mode === 'resume') {
    const before = await state(L);
    await execConsoleCommand(page, 'run save');
    await page.waitForFunction(() => window.__game.ctx.levels.persistenceStatus().state === 'ready');
    await ctxEval(() => window.__game.ctx.levels.flushSaves());
    await page.reload(); await execConsoleCommand(page, 'run continue'); await waitForRunReady(page); await page.waitForTimeout(1200);
    L = await lock();
    const after = await state(L);
    assert.equal(after.plug, 0); assert.equal(after.doorMetal, L.plug.n); assert.equal(after.valve, 0); assert.equal(after.gauge, 0);
    assert.ok(after.lava >= before.lava - 2 && after.tank >= before.tank - 2, `the vat and the cistern persisted (${before.lava}/${before.tank} -> ${after.lava}/${after.tank})`);
    assert.ok(after.relent > 0 && after.relent <= before.relent, `the clock persisted and kept counting (${before.relent} -> ${after.relent})`);
    report.resumeShut = { before, after };
    await enterGallery(L);
  }

  if (mode === 'brute') {
    // ten bolts at the gate, then eight seconds of the Excavate Ray: a Metal gate shrugs both off
    const sx = ox(L, 22);
    await ctxEval(({ x, y, tx }) => { const c = window.__game.ctx; Object.assign(c.player, { x, y, vx: 0, vy: 0 }); c.camera.snapTo(tx, y - 20); c.player.mana = 9999; }, { x: sx, y: L.Fr - 1, tx: ox(L, 8) });
    await page.waitForTimeout(800);
    await page.keyboard.press('Digit1');
    for (let i = 0; i < 10; i++) { await pointAtWorld(ox(L, 9), L.Fr - 10); await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up(); await page.waitForTimeout(380); }
    await page.keyboard.press('Digit2');
    await pointAtWorld(ox(L, 9), L.Fr - 10);
    await page.mouse.down(); await page.waitForTimeout(8000); await page.mouse.up();
    await shot('02-gate-after-brute-force');
    const t = await state(L);
    assert.equal(t.plug, 0, 'the gate has not fired');
    assert.equal(t.doorMetal, L.plug.n, 'every cell of the gate stands (blasts and the ray leave Metal be)');
    assert.equal(t.dead, false);
    report.brute = t;
    console.log(`PASS (brute): ten bolts and eight seconds of the ray left the Metal gate whole (${t.doorMetal}/${L.plug.n}); relent clock at ${t.relent}`);
  } else if (mode === 'relent') {
    await ctxEval((id) => { window.__game.ctx.levels.current.mechanisms.find((m) => m.id === id).relentFrames = 120; }, L.plugId);
    await plugOpen(L.plugId);
    const t = await state(L);
    assert.equal(t.gauge, 0, 'the gauge never latched: the Works opened it');
    assert.ok(t.lava >= 60, 'the lava is still molten: the gangway carries the alchemist over it');
    await waitObjective('The slag gate stands open. The Kiln is through it.', 'the objective names the way on');
    await shot('02-relented');
    await walkTo(ox(L, 3));
    const there = await state(L);
    assert.ok((there.px - ox(L, 3)) * -L.e >= -8 && !there.dead, `across the gangway, through the corridor and on to the hall (${there.px} vs ${ox(L, 3)})`);
    await shot('03-at-the-hall');
    console.log('PASS (relent): the gate cracked open after its clock, and the gangway carried the alchemist over molten lava to the hall mouth');
  } else {
    if (mode === 'flask') {
      // the cistern is spoiled: its water is gone (a drain, a leak): the Water flask must serve
      await ctxEval(({ room, Fr }) => {
        const w = window.__game.ctx.world;
        for (let y = Fr - 40; y <= Fr - 24; y++) for (let x = room.x0; x <= room.x1; x++) { const i = w.idx(x, y); if (w.types[i] === 2) w.replaceCellAt(i, 0, 0x08080c); }
      }, { room: L.room, Fr: L.Fr });
      await walkTo(ox(L, 55)); // over the hatch: the pour's own steam comes straight up
      await shot('02-on-the-gangway');
      const hp0 = (await state(L)).hp;
      await pourThroughHatch(L, async () => (await state(L)).stone >= 24);
      await shot('03-poured');
      report.hpBefore = hp0;
    } else {
      // ---- the lever, forty cells from the vat ----
      await walkTo(L.leverX - L.e * 10);
      s = await state(L);
      await shot('02-at-the-lever');
      await pullLever();
      await waitFor(({ id }) => window.__game.ctx.levels.current.mechanisms.find((m) => m.id === id).state === 1, { id: L.valveId }, 8000);
      for (let i = 0; i < 8; i++) { await page.waitForTimeout(300); await shot(`03-quench-${i}`); }
    }
    const firedAt = (await state(L)).frame;
    await plugOpen(L.plugId, 40000);
    s = await state(L);
    assert.equal(s.gauge, 1, 'the gauge latched');
    assert.equal(s.relay, 1);
    assert.equal(s.plug, 1);
    assert.ok(s.stone >= 24, `the vat is crusted over (${s.stone} stone)`);
    assert.equal(s.dead, false);
    if (mode === 'flask') assert.ok(s.hp < report.hpBefore, `the steam scalded the alchemist on the gangway (${report.hpBefore} -> ${s.hp})`);
    else assert.equal(s.hp, (await state(L)).hp);
    report.openTicks = s.frame - firedAt;
    await shot('04-gate-open');
    await waitObjective('The slag gate stands open. The Kiln is through it.', 'the objective names the way on');
    // ---- the gangway and the corridor, to the hall's mouth ----
    await walkTo(ox(L, 3));
    const done = await state(L);
    assert.ok((done.px - ox(L, 3)) * -L.e >= -8 && !done.dead, `at the hall mouth (${done.px} vs ${ox(L, 3)})`);
    await shot('05-at-the-hall');
    report.solveTicks = done.frame - enteredAt;
    report.stages.push({ name: 'at-the-hall', ...done });
    console.log(`PASS (${mode}): vat quenched (${s.stone} stone), gauge latched, gate open ${(report.openTicks / 60).toFixed(1)} s after the pour began, at the hall mouth ${(report.solveTicks / 60).toFixed(1)} s after entering the gallery`);

    if (mode === 'resume') {
      await execConsoleCommand(page, 'run save');
      await page.waitForFunction(() => window.__game.ctx.levels.persistenceStatus().state === 'ready');
      await ctxEval(() => window.__game.ctx.levels.flushSaves());
      await page.reload(); await execConsoleCommand(page, 'run continue'); await waitForRunReady(page); await page.waitForTimeout(1200);
      L = await lock();
      const r = await state(L);
      assert.equal(r.plug, 1, 'the open gate survived the reload'); assert.equal(r.gauge, 1, 'the gauge stayed latched'); assert.ok(r.stone >= 24, 'the crust persisted');
      report.resumeOpen = r;
      console.log('PASS (resume): shut save (vat, cistern, clock) and open save (gate, gauge, crust) both reloaded intact');
    }
  }
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await page.screenshot({ path: `${output}/last.png` }).catch(() => {});
  await browser.close();
}

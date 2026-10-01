import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';

// THE GAS BELL (floor 2's lock, world/lockGasBell), PLAYED with real input.
//   default    the intended solution: walk to the brass inlay, one Spark Bolt up through the bell's porthole,
//              watch the bell burn, the clapper ring and the vault door open, walk in and take the key.
//   --brute    the door is Metal: ten bolts and eight seconds of the Excavate Ray leave it shut.
//   --botch    a bell with no gas in it rings nothing; the vent refills it and the second shot rings the door open.
//   --relent   the Works relent: the door cracks open of its own accord when its clock runs out.
//   --resume   a real expedition: save with the door shut, reload, and the bell, vent and clock are all there;
//              then ring it, save again, and the open door and the latched clapper survive the reload.
// Usage: node scripts/verify-gas-bell.mjs [url] [seed] [--brute|--botch|--relent|--resume]
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const pos = argv.filter((a) => !a.startsWith('--'));
const url = pos[0] ?? 'http://localhost:5173/';
const seed = Number(pos[1] ?? 2);
const mode = ['brute', 'botch', 'relent', 'resume'].find((m) => flags.has(`--${m}`)) ?? 'intended';
const output = `verify-out/gas-bell-${seed}-${mode}`;
mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { mode, seed, errors: [], stages: [] };
page.on('pageerror', (e) => report.errors.push(String(e)));

const ctxEval = (fn, arg) => page.evaluate(fn, arg);
const lock = () => ctxEval(() => {
  const ctx = window.__game.ctx, rt = ctx.levels.current;
  const plug = rt.mechanisms.find((m) => m.kind === 'plug' && m.lock);
  const relay = rt.mechanisms.find((m) => m.kind === 'relay' && m.targetId === plug.id);
  const sensor = rt.mechanisms.find((m) => m.kind === 'sensor' && m.targetId === relay.id);
  const room = rt.placedPrefabs.find((p) => p.id === 'lock-gas-bell');
  const floorY = plug.y + 20, bx = room.x1 - 86, by = floorY - 26;
  const keyPickup = rt.pickups.find((p) => p.kind === 'key');
  return {
    plugId: plug.id, relayId: relay.id, sensorId: sensor.id, room, floorY, bx, by,
    markX: room.x0 + 42, plug: { x: plug.x, y: plug.y, w: plug.w, h: plug.h, n: plug.body.length },
    key: { x: keyPickup.x, y: keyPickup.y }, sensor: { x: sensor.x, y: sensor.y },
  };
});
const state = (L) => ctxEval(({ plugId, relayId, sensorId, bx, by, floorY, room }) => {
  const ctx = window.__game.ctx, rt = ctx.levels.current, w = ctx.world;
  const g = (id) => rt.mechanisms.find((m) => m.id === id);
  let gas = 0, fire = 0, metal = 0;
  for (let y = by - 30; y <= by + 4; y++) for (let x = bx - 24; x <= bx + 24; x++) { const t = w.types[w.idx(x, y)]; if (t === 38) gas++; else if (t === 5) fire++; }
  const plug = g(plugId);
  for (const [x, y] of plug.body) if (w.types[w.idx(x, y)] === 13) metal++;
  let hall = 0;
  for (let y = room.y0 + 10; y < floorY; y++) for (let x = room.x0 + 8; x < room.x1 - 8; x++) if (w.types[w.idx(x, y)] === 38) hall++;
  return {
    frame: ctx.state.frameCount, plug: plug.state, relent: plug.relentFrames, relay: g(relayId).state, sensor: g(sensorId).state, gas, fire, hall, doorMetal: metal,
    hp: Math.round(ctx.player.hp), dead: ctx.player.dead, keyTaken: rt.keyTaken, px: ctx.player.x, py: ctx.player.y,
    objective: document.getElementById('objective')?.innerText ?? '', hint: ctx.hints?.current?.line ?? null,
  };
}, L);
const playerX = () => ctxEval(() => window.__game.ctx.player.x);

async function walkTo(x) {
  // Hold the direction like a player; hop any lip that stops us; feather the last cells.
  let px = await playerX(), last = px, still = 0;
  const key = px < x ? 'KeyD' : 'KeyA', sign = px < x ? 1 : -1;
  await page.keyboard.down(key);
  for (let i = 0; i < 160 && sign * (x - px) > 10; i++) {
    await page.waitForTimeout(100); px = await playerX();
    still = Math.abs(px - last) < 1 ? still + 1 : 0; last = px;
    if (still >= 3) { await page.keyboard.down('Space'); await page.waitForTimeout(380); await page.keyboard.up('Space'); still = 0; }
  }
  await page.keyboard.up(key);
  for (let i = 0; i < 30; i++) {
    px = await playerX();
    if (Math.abs(px - x) < 5) break;
    const k = px < x ? 'KeyD' : 'KeyA';
    await page.keyboard.down(k); await page.waitForTimeout(60); await page.keyboard.up(k); await page.waitForTimeout(80);
  }
}
async function pointAtWorld(worldX, worldY, click = false) {
  const target = await ctxEval(({ worldX, worldY }) => {
    const ctx = window.__game.ctx;
    const canvas = document.querySelector('canvas[data-input-attached="true"]');
    const rect = canvas.getBoundingClientRect();
    const viewW = 640, viewH = 360, zoom = ctx.camera.zoom;
    const fracX = ctx.camera.x - Math.floor(ctx.camera.x), fracY = ctx.camera.y - Math.floor(ctx.camera.y);
    const scaleX = (1 + 4 / viewW) * zoom, scaleY = (1 + 4 / viewH) * zoom;
    const ndcX = -fracX * (2 / viewW) * zoom + ((worldX - ctx.camera.renderX) / viewW - .5) * 2 * scaleX;
    const ndcY = fracY * (2 / viewH) * zoom + (.5 - (worldY - ctx.camera.renderY) / viewH) * 2 * scaleY;
    return { x: rect.left + (ndcX + 1) * .5 * rect.width, y: rect.top + (1 - ndcY) * .5 * rect.height };
  }, { worldX, worldY });
  await page.mouse.move(target.x, target.y);
  if (click) { await page.mouse.down(); await page.waitForTimeout(160); await page.mouse.up(); }
}
const shot = (name) => page.screenshot({ path: `${output}/${name}.png` });
/** Put the alchemist at the hall's west end (the route to the room is verify-living-traversal's job), feet on the floor. */
async function enterHall(L) {
  await ctxEval(({ x, y, bx, floorY }) => { const c = window.__game.ctx; c.enemies.length = 0; Object.assign(c.player, { x, y, vx: 0, vy: 0 }); c.camera.snapTo(bx - 50, floorY - 40); }, { x: L.room.x0 + 16, y: L.floorY - 1, bx: L.bx, floorY: L.floorY });
  await page.waitForTimeout(1500);
}
/** Aim up into the porthole from wherever the alchemist stands and cast the wand. */
const shootPorthole = async (L) => { await page.keyboard.press('Digit1'); await pointAtWorld(L.bx - 19, L.by - 6, true); };
const waitFor = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout });
const plugOpen = (id) => waitFor((i) => window.__game.ctx.levels.current.mechanisms.find((m) => m.id === i).state === 1, id, 15000);

try {
  await page.goto(url);
  const resume = mode === 'resume';
  // A resumable save needs a real expedition; test runs are disposable by design.
  await execConsoleCommand(page, resume ? `run new --seed ${seed}` : `run test --level d2 --world campaign-level --seed ${seed} --loadout fresh`);
  await waitForRunReady(page);
  if (resume) { await execConsoleCommand(page, 'goto d2'); await waitForRunReady(page); await page.waitForTimeout(800); }
  let L = await lock();
  report.layout = { room: L.room, door: L.plug, markX: L.markX, bell: { x: L.bx, y: L.by } };

  // ---- the floor's own words: generic far from the machine ----
  await page.evaluate(() => { window.__game.ctx.enemies.length = 0; });
  await page.waitForTimeout(600);
  let s = await state(L);
  assert.equal(s.objective, 'Find the golden key. The Works keep it under lock.', 'far from the machine the objective is the generic one');
  assert.equal(s.plug, 0);
  assert.equal(s.doorMetal, L.plug.n, 'the door stands');
  assert.ok(s.gas > 600, `the bell hangs full of gas (${s.gas})`);
  assert.ok(s.relent > 0 && s.relent <= 27000, `the Works' clock is running (${s.relent})`);
  await enterHall(L);
  // (the HUD re-reads its objective on its own cadence: wait for the line to turn)
  await page.waitForFunction(() => document.getElementById('objective')?.innerText.startsWith('Ring the Gas Bell'), null, { timeout: 8000 }).catch(() => undefined);
  s = await state(L);
  assert.equal(s.objective, 'Ring the Gas Bell. Light the gas from a distance.', 'near the machine the puzzle is named');
  assert.equal(s.hint, 'A bell of marsh gas. Light it from a distance; the vault answers.', 'the hint reads the machine');
  await shot('01-hall');
  report.stages.push({ name: 'hall', ...s });
  const enteredAt = s.frame;

  if (mode === 'resume') {
    // save with the door shut, reload, find everything where it was
    const before = await state(L);
    await execConsoleCommand(page, 'run save');
    await page.waitForFunction(() => window.__game.ctx.levels.persistenceStatus().state === 'ready');
    await ctxEval(() => window.__game.ctx.levels.flushSaves());
    await page.reload(); await execConsoleCommand(page, 'run continue'); await waitForRunReady(page); await page.waitForTimeout(1200);
    L = await lock();
    const after = await state(L);
    const ems = await ctxEval(() => window.__game.ctx.levels.current.emitters?.length ?? 0);
    assert.equal(after.plug, 0); assert.equal(after.doorMetal, L.plug.n);
    assert.ok(after.gas >= before.gas - 5, `the bell's gas persisted (${before.gas} -> ${after.gas})`);
    assert.ok(after.relent > 0 && after.relent <= before.relent, `the clock persisted and kept counting (${before.relent} -> ${after.relent})`);
    assert.equal(ems, 1, 'the vent was regenerated with the floor');
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
    // run the clock down (the tick count of a 7.5 minute wait is not worth sitting through): the Works relent
    await ctxEval((id) => { window.__game.ctx.levels.current.mechanisms.find((m) => m.id === id).relentFrames = 120; }, L.plugId);
    await plugOpen(L.plugId);
    const t = await state(L);
    assert.equal(t.sensor, 0, 'the clapper never rang: the Works opened it');
    assert.equal(t.objective, 'The vault stands open. Take the golden key.');
    await page.waitForTimeout(600);
    await shot('02-relented');
    await walkTo(L.key.x);
    await waitFor(() => window.__game.ctx.levels.current.keyTaken, null, 20000);
    report.relent = await state(L);
    console.log(`PASS (relent): the door cracked open after its clock (${t.relent} frames left of ${27000}), the key was taken, the objective became "${report.relent.objective}"`);
  } else {
    // the standing mark, thirty-odd cells off the bell's porthole
    await walkTo(L.markX);
    s = await state(L);
    assert.ok(Math.abs(s.px - L.markX) < 8, `standing on the brass (${s.px} vs ${L.markX})`);
    if (mode === 'botch') {
      // the gas is lost before the shot (a leak, a stray flame elsewhere): all but a pinch is gone
      await ctxEval(({ bx, by, sx, sy }) => {
        const w = window.__game.ctx.world; let kept = 0;
        for (let y = by - 30; y <= by + 2; y++) for (let x = bx - 20; x <= bx + 20; x++) { const i = w.idx(x, y); if (w.types[i] === 38) { if (kept < 5 && x > bx - 8) { kept++; } else w.replaceCellAt(i, 0, 0x08080c); } }
      }, { bx: L.bx, by: L.by });
      await page.waitForTimeout(500);
      const thin = await state(L);
      assert.ok(thin.gas <= 6 + 10, `only a pinch of gas is left (${thin.gas})`);
      await shootPorthole(L);
      await page.waitForTimeout(1800);
      const t1 = await state(L);
      assert.equal(t1.sensor, 0, 'a pinch of gas does not ring the clapper');
      assert.equal(t1.plug, 0, 'the door stands');
      assert.equal(t1.dead, false);
      await shot('02-botched');
      report.stages.push({ name: 'botched', ...t1 });
      // the vent refills the bell (the porthole is gone, so some drifts out too); light it again
      await waitFor(({ bx, by }) => { const w = window.__game.ctx.world; let g = 0; for (let y = by - 30; y <= by + 4; y++) for (let x = bx - 24; x <= bx + 24; x++) if (w.types[w.idx(x, y)] === 38) g++; return g >= 200; }, { bx: L.bx, by: L.by }, 30000);
      await shot('03-refilled');
      await pointAtWorld(L.bx - 19, L.by - 6, true);
    } else {
      await shot('02-on-the-brass');
      const hp0 = (await state(L)).hp;
      await shootPorthole(L);
      report.hpBefore = hp0;
    }
    const firedAt = (await state(L)).frame;
    await plugOpen(L.plugId);
    s = await state(L);
    assert.equal(s.sensor, 1, 'the clapper rang');
    assert.equal(s.relay, 1);
    assert.equal(s.plug, 1);
    assert.equal(s.dead, false, 'the alchemist stood clear and lived');
    assert.ok(s.hp >= 100 || s.hp >= (report.hpBefore ?? 0) - 0, `unhurt (${s.hp})`);
    report.openTicks = s.frame - firedAt;
    await shot('04-door-open');
    assert.equal(s.objective, 'The vault stands open. Take the golden key.');
    // the vent halted for good with the ring: no more gas
    await page.waitForTimeout(2500);
    const calm = await state(L);
    assert.equal(calm.gas, 0, 'the bell stays empty once rung');
    // the key, through the opened door
    await walkTo(L.key.x);
    await waitFor(() => window.__game.ctx.levels.current.keyTaken, null, 25000);
    await shot('05-key');
    const done = await state(L);
    assert.equal(done.objective, 'Carry the golden key back to the portal.');
    report.solveTicks = done.frame - enteredAt;
    report.stages.push({ name: 'key', ...done });
    console.log(`PASS (${mode}): bell burned, clapper rang, door open ${(report.openTicks / 60).toFixed(1)} s after the shot, key taken ${(report.solveTicks / 60).toFixed(1)} s after entering the hall`);

    if (mode === 'resume') {
      // save with the door open and the clapper latched; reload; the open door and the quiet bell persist
      await execConsoleCommand(page, 'run save');
      await page.waitForFunction(() => window.__game.ctx.levels.persistenceStatus().state === 'ready');
      await ctxEval(() => window.__game.ctx.levels.flushSaves());
      await page.reload(); await execConsoleCommand(page, 'run continue'); await waitForRunReady(page); await page.waitForTimeout(1200);
      L = await lock();
      const r = await state(L);
      assert.equal(r.plug, 1, 'the open door survived the reload'); assert.equal(r.sensor, 1, 'the clapper stayed rung'); assert.equal(r.keyTaken, true);
      assert.equal(r.gas, 0);
      report.resumeOpen = r;
      console.log('PASS (resume): shut-door save (gas, clock, vent), open-door save (door, clapper, key) both reloaded intact');
    }
  }
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await page.screenshot({ path: `${output}/last.png` }).catch(() => {});
  await browser.close();
}

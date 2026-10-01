import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';
import { lockProbeTools, takeArrivalGift } from './lock-probe-helpers.mjs';

// THE PERISCOPE (floor 3b's lock, world/galleryPuzzles: the attic lens's relay breaks the strongroom's gate), PLAYED with real input.
//   default    stand on the brass inlay under the light well and shine straight up (the mouse): the beam runs up the well, off the silvered
//              mirror at its head and along the tunnel to the lens in the attic; the lens drinks, the relay counts a moment and the vault
//              door lets go; walk the room's floor to the strongroom and take the key.
//   --botch    a beam from the same spot aimed across the room lights nothing; then the right aim works.
//   --brute    the door is Metal: ten bolts and eight seconds of the Excavate Ray leave it shut.
//   --relent   the Works relent: the door cracks open of its own accord when its clock runs out.
// Usage: node scripts/verify-periscope.mjs [url] [seed] [--botch|--brute|--relent]
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const pos = argv.filter((a) => !a.startsWith('--'));
const url = pos[0] ?? 'http://localhost:5173/';
const seed = Number(pos[1] ?? 5);
const mode = ['botch', 'brute', 'relent'].find((m) => flags.has(`--${m}`)) ?? 'intended';
const output = `verify-out/periscope-${seed}-${mode}`;
mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { mode, seed, errors: [], stages: [] };
page.on('pageerror', (e) => report.errors.push(String(e)));
const { ctxEval, shot, waitFor, walkTo, pointAtWorld, waitObjective, waitHint, plugOpen, dismissCards, aimToward } = lockProbeTools(page, output);

const lock = () => ctxEval(() => {
  const rt = window.__game.ctx.levels.current;
  const plug = rt.mechanisms.find((m) => m.kind === 'plug' && m.lock);
  if (!plug) throw new Error(`no lock plug on ${rt.def.id}`);
  const relay = rt.mechanisms.find((m) => m.kind === 'relay' && m.targetId === plug.id);
  const lens = rt.mechanisms.find((m) => m.kind === 'sensor' && m.sensorType === 'light' && m.targetId === relay.id);
  const room = rt.placedPrefabs.find((p) => p.id === 'glass-periscope');
  const key = rt.pickups.find((p) => p.kind === 'key');
  return {
    plugId: plug.id, relayId: relay.id, lensId: lens.id, room, floorY: plug.y + 19, wellX: lens.x - 40, lens: { x: lens.x, y: lens.y },
    plug: { x: plug.x, y: plug.y, w: plug.w, h: plug.h, n: plug.body.length }, key: { x: key.x, y: key.y },
  };
});
const state = (L) => ctxEval(({ plugId, relayId, lensId }) => {
  const ctx = window.__game.ctx, w = ctx.world, rt = ctx.levels.current;
  const g = (id) => rt.mechanisms.find((m) => m.id === id);
  let metal = 0;
  for (const [x, y] of g(plugId).body) if (w.types[w.idx(x, y)] === 13) metal++;
  return {
    frame: ctx.state.frameCount, plug: g(plugId).state, relent: g(plugId).relentFrames, relay: g(relayId).state, doorMetal: metal,
    lens: +(g(lensId).reading ?? 0).toFixed(2), lensState: g(lensId).state,
    hp: Math.round(ctx.player.hp), dead: ctx.player.dead, keyTaken: rt.keyTaken, px: ctx.player.x, py: ctx.player.y,
  };
}, { plugId: L.plugId, relayId: L.relayId, lensId: L.lensId });
/** Put the alchemist on the brass inlay under the light well (the way in is verify-living-traversal's job), lantern un-hooded. */
async function stand(L) {
  await ctxEval(({ x, y }) => { const c = window.__game.ctx; c.enemies.length = 0; c.state.lanternHooded = false; Object.assign(c.player, { x, y, vx: 0, vy: 0 }); c.camera.snapTo(x + 30, y - 40); c.player.mana = 9999; }, { x: L.wellX, y: L.floorY - 1 });
  await page.waitForTimeout(1500);
  // (a crate or a pickup may have nudged the alchemist as he landed: step back onto the brass's middle, like a player)
  await walkTo(L.wellX);
  await page.waitForTimeout(400);
  const px = await ctxEval(() => window.__game.ctx.player.x);
  // (the beam works from -3 to +2 cells of the well's middle; a prop crate resting on the brass can nudge the alchemist past that: pick another seed)
  assert.ok(px - L.wellX >= -3 && px - L.wellX <= 2, `standing on the brass's middle (${px} vs ${L.wellX}: a prop on the brass? try another seed)`);
}

try {
  await page.goto(url);
  await execConsoleCommand(page, `run test --level d3b --world campaign-level --seed ${seed} --loadout fresh`);
  await waitForRunReady(page);
  await takeArrivalGift(page);
  let L = await lock();
  report.layout = { room: L.room, door: L.plug, well: L.wellX, lens: L.lens };
  await page.evaluate(() => { window.__game.ctx.enemies.length = 0; });
  await page.waitForTimeout(600);
  let s = await state(L);
  assert.equal(s.plug, 0);
  assert.equal(s.doorMetal, L.plug.n, 'the door stands');
  assert.ok(s.relent > 0 && s.relent <= 27000, `the Works clock is running (${JSON.stringify(s)})`);
  await stand(L);
  await waitObjective('Open the Periscope vault. Shine a beam up the light well.', 'near the machine the puzzle is named');
  await dismissCards();
  await waitHint('A mirror at the head of a light well. Stand on the brass and shine straight up.', 'the hint reads the machine');
  await dismissCards();
  await shot('01-on-the-brass');
  s = await state(L);
  report.stages.push({ name: 'brass', ...s });
  const enteredAt = s.frame;

  if (mode === 'brute') {
    await ctxEval(({ x, y }) => { const c = window.__game.ctx; Object.assign(c.player, { x, y, vx: 0, vy: 0 }); c.camera.snapTo(x + 20, y - 30); c.player.mana = 9999; }, { x: L.plug.x - 14, y: L.floorY - 1 });
    await page.waitForTimeout(800);
    await page.keyboard.press('Digit1');
    for (let i = 0; i < 10; i++) { await pointAtWorld(L.plug.x + 1, L.floorY - 10); await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up(); await page.waitForTimeout(380); }
    await page.keyboard.press('Digit2');
    await pointAtWorld(L.plug.x + 1, L.floorY - 10);
    await page.mouse.down(); await page.waitForTimeout(8000); await page.mouse.up();
    await shot('02-door-after-brute-force');
    const t = await state(L);
    assert.equal(t.plug, 0, 'the door has not fired');
    assert.equal(t.doorMetal, L.plug.n, 'every cell of the door stands (blasts and the ray leave Metal be)');
    assert.equal(t.dead, false);
    console.log(`PASS (brute): ten bolts and eight seconds of the ray left the Metal door whole (${t.doorMetal}/${L.plug.n}); relent clock at ${t.relent}`);
  } else if (mode === 'relent') {
    await ctxEval((id) => { window.__game.ctx.levels.current.mechanisms.find((m) => m.id === id).relentFrames = 120; }, L.plugId);
    await plugOpen(L.plugId);
    const t = await state(L);
    assert.equal(t.lensState, 0, 'the lens never drank: the Works opened it');
    await waitObjective('The vault stands open. Take the golden key.', 'the objective names the reward');
    await walkTo(L.key.x);
    await waitFor(() => window.__game.ctx.levels.current.keyTaken, null, 40000);
    console.log('PASS (relent): the door cracked open after its clock, the key was taken');
  } else {
    if (mode === 'botch') {
      await aimToward(L.wellX + 60, L.floorY - 20); // across the room: not up the well
      await page.waitForTimeout(3500);
      const b = await state(L);
      assert.equal(b.plug, 0); assert.ok(b.lens < 5, `a beam across the room does not light the lens (${b.lens})`);
      await shot('02-botched');
    }
    // ---- straight up the well ----
    assert.ok(await aimToward(L.wellX, L.floorY - 80), 'the wand points straight up the well');
    const firedAt = (await state(L)).frame;
    await shot('02-aiming-up');
    await plugOpen(L.plugId, 25000);
    s = await state(L);
    assert.equal(s.relay, 1);
    assert.equal(s.plug, 1);
    assert.equal(s.dead, false);
    report.openTicks = s.frame - firedAt;
    await shot('03-door-open');
    await waitObjective('The vault stands open. Take the golden key.', 'the objective names the reward');
    await walkTo(L.key.x);
    await waitFor(() => window.__game.ctx.levels.current.keyTaken, null, 40000);
    await shot('04-key');
    const done = await state(L);
    await waitObjective('Carry the golden key back to the portal.', 'the key in hand, the objective is the portal');
    report.solveTicks = done.frame - enteredAt;
    console.log(`PASS (${mode}): the lens drank, door open ${(report.openTicks / 60).toFixed(1)} s after the aim, key taken ${(report.solveTicks / 60).toFixed(1)} s after standing on the brass`);
  }
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await page.screenshot({ path: `${output}/last.png` }).catch(() => {});
  await browser.close();
}

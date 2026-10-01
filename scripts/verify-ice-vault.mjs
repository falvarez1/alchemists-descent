import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';
import { lockProbeTools } from './lock-probe-helpers.mjs';

// THE ICE VAULT (floor 2b's lock, world/coldStorePuzzles: the strongroom's wall of real ice is a route-seal plug), PLAYED with real input.
//   default    the quick way in: three Spark Bolts at the coal bank under the ice wall blow a passage through it;
//              walk into the strongroom and take the golden key.
//   --relent   the Works relent: the whole wall cracks away of its own accord when its clock runs out.
// (The slow ways in - the lit coal, the brine cistern - are verify-cold-store.mjs's chemistry.)
// (Save/resume of a plug and its cells is the generic mechanism save the Weir and Crucible probes play; a `goto` to a second door is not a resumable position.)
// Usage: node scripts/verify-ice-vault.mjs [url] [seed] [--relent]
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const pos = argv.filter((a) => !a.startsWith('--'));
const url = pos[0] ?? 'http://localhost:5173/';
const seed = Number(pos[1] ?? 5);
const mode = ['relent'].find((m) => flags.has(`--${m}`)) ?? 'intended';
const output = `verify-out/ice-vault-${seed}-${mode}`;
mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { mode, seed, errors: [], stages: [] };
page.on('pageerror', (e) => report.errors.push(String(e)));
const { ctxEval, shot, waitFor, walkTo, pointAtWorld, waitObjective, waitHint, plugOpen } = lockProbeTools(page, output);

const lock = () => ctxEval(() => {
  const rt = window.__game.ctx.levels.current;
  const plug = rt.mechanisms.find((m) => m.kind === 'plug' && m.lock);
  if (!plug) throw new Error(`no lock plug on ${rt.def.id} (plugs: ${JSON.stringify(rt.mechanisms.filter((m) => m.kind === 'plug').map((m) => [m.x, m.y, m.lock]))}; prefabs: ${rt.placedPrefabs.map((p) => p.id).join(',')})`);
  const room = rt.placedPrefabs.find((p) => p.id === 'cold-ice-vault');
  const key = rt.pickups.find((p) => p.kind === 'key');
  return { plugId: plug.id, room, floorY: plug.y + 26, plug: { x: plug.x, y: plug.y, w: plug.w, h: plug.h, n: plug.body.length }, key: { x: key.x, y: key.y } };
});
const state = (L) => ctxEval(({ plugId, plug }) => {
  const ctx = window.__game.ctx, w = ctx.world, rt = ctx.levels.current;
  let ice = 0;
  for (let y = plug.y; y < plug.y + plug.h; y++) for (let x = plug.x; x < plug.x + plug.w; x++) if (w.types[w.idx(x, y)] === 10) ice++;
  const m = rt.mechanisms.find((q) => q.id === plugId);
  return { frame: ctx.state.frameCount, plug: m.state, relent: m.relentFrames, ice, hp: Math.round(ctx.player.hp), dead: ctx.player.dead, keyTaken: rt.keyTaken, px: ctx.player.x, py: ctx.player.y };
}, { plugId: L.plugId, plug: L.plug });
/** Put the alchemist on the cold room's entrance ledge, well west of the ice wall, feet on the floor. */
async function enterRoom(L) {
  await ctxEval(({ x, y }) => { const c = window.__game.ctx; c.enemies.length = 0; Object.assign(c.player, { x, y, vx: 0, vy: 0 }); c.camera.snapTo(x, y - 20); c.player.mana = 9999; }, { x: L.plug.x - 28, y: L.floorY - 1 });
  await page.waitForTimeout(1500);
}

try {
  await page.goto(url);
  await execConsoleCommand(page, `run test --level d2b --world campaign-level --seed ${seed} --loadout fresh`);
  await waitForRunReady(page);
  let L = await lock();
  report.layout = { room: L.room, wall: L.plug, key: L.key };
  await page.evaluate(() => { window.__game.ctx.enemies.length = 0; });
  await page.waitForTimeout(600);
  let s = await state(L);
  assert.equal(s.plug, 0);
  assert.equal(s.ice, L.plug.n, 'the wall is whole ice');
  assert.ok(s.relent > 0 && s.relent <= 27000, `the Works' clock is running (${JSON.stringify(s)})`);
  await enterRoom(L);
  await waitObjective('Open the Ice Vault. Melt it, salt it, or blast it.', 'near the vault the puzzle is named');
  await waitHint('A strongroom in a block of ice. Heat, brine or a blast will have it.', 'the hint reads the vault');
  await shot('01-room');
  s = await state(L);
  report.stages.push({ name: 'room', ...s });
  const enteredAt = s.frame;

  if (mode === 'relent') {
    await ctxEval((id) => { window.__game.ctx.levels.current.mechanisms.find((m) => m.id === id).relentFrames = 120; }, L.plugId);
    await plugOpen(L.plugId);
    const t = await state(L);
    assert.equal(t.ice, 0, 'the relent clears the whole wall');
    await waitObjective('The vault stands open. Take the golden key.', 'the objective names the reward');
    await shot('02-relented');
    await walkTo(L.key.x);
    await waitFor(() => window.__game.ctx.levels.current.keyTaken, null, 30000);
    console.log('PASS (relent): the Works cracked the ice wall away after their clock, and the key was taken');
  } else {
    // ---- bolts at the wall's foot and heart: the blasts go through ice (a handful opens a passage) ----
    await page.keyboard.press('Digit1');
    let bolts = 0;
    for (; bolts < 16; bolts++) {
      await pointAtWorld(L.plug.x + 1, L.floorY - (bolts % 2 === 0 ? 4 : 12), true); await page.waitForTimeout(450);
      if (bolts >= 2 && (await state(L)).ice < L.plug.n * 0.4) break;
    }
    await page.waitForTimeout(2500);
    s = await state(L);
    await shot('02-blasted');
    assert.ok(s.ice < L.plug.n * 0.6, `the blasts took the wall (${s.ice}/${L.plug.n} ice left after ${bolts + 1} bolts)`);
    assert.equal(s.dead, false);
    // ---- in, and the key ----
    for (let round = 0; round < 4; round++) {
      await walkTo(L.key.x);
      const got = await waitFor(() => window.__game.ctx.levels.current.keyTaken, null, 9000).then(() => true, () => false);
      if (got) break;
      // (the passage is not clear: a few more bolts at what stands in the way)
      for (let k = 0; k < 3; k++) { await pointAtWorld(L.plug.x + 1, L.floorY - 6 - k * 4, true); await page.waitForTimeout(450); }
    }
    await waitFor(() => window.__game.ctx.levels.current.keyTaken, null, 5000);
    await shot('03-key');
    const done = await state(L);
    await waitObjective('Carry the golden key back to the portal.', 'the key in hand, the objective is the portal');
    report.solveTicks = done.frame - enteredAt;
    report.stages.push({ name: 'key', ...done });
    console.log(`PASS (${mode}): wall blasted (${s.ice}/${L.plug.n} ice left), key taken ${(report.solveTicks / 60).toFixed(1)} s after entering the room`);
  }
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await page.screenshot({ path: `${output}/last.png` }).catch(() => {});
  await browser.close();
}

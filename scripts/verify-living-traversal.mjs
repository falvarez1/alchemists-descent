import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';

const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { setup: 'Fresh canonical expedition with hostiles removed after spawn to isolate authored navigation. Only keyboard/mouse inputs after start; no positioning, invulnerability, inventory injection or terrain fixture.', errors: [], samples: [], stages: [], discoveries: [] };
page.on('pageerror', error => report.errors.push(String(error)));
const sample = () => page.evaluate(() => {
  const ctx = window.__game.ctx, p = ctx.player;
  return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, hp: p.hp, dead: p.dead, grounded: p.grounded, levit: p.levit,
    room: ctx.levels.current.living.room, tick: ctx.state.frameCount, sanctum: ctx.sanctum.isOpen, paused: ctx.state.paused, crawling: p.crawling,
    keys: { ...ctx.input.keys }, valve: ctx.levels.current.mechanisms.find(m => m.kind === 'valve').state };
});

async function acceptDiscoveredPage() {
  const offer = page.locator('#card-offer-overlay.visible .card-offer-card').first();
  if (!await offer.isVisible()) return;
  report.discoveries.push(await offer.innerText());
  await page.screenshot({ path: `${output}/traversal-spell-${report.discoveries.length}.png` });
  await offer.click();
  return true;
}

async function waitForGameplay(predicate, timeout = 6000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    await acceptDiscoveredPage();
    if (await page.evaluate(predicate)) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`Gameplay condition timed out: ${String(predicate)}; ${JSON.stringify(await sample())}`);
}

async function moveTo(target, label) {
  let previous = await sample(), stuck = 0, actionUntil = 0, attempts = 0;
  const direction = target > previous.x ? 'KeyD' : 'KeyA', sign = direction === 'KeyD' ? 1 : -1;
  await page.keyboard.down(direction);
  try {
    for (let step = 0; step < 100; step++) {
      if (await acceptDiscoveredPage()) await page.keyboard.down(direction);
      await page.waitForTimeout(150);
      const state = await sample(); report.samples.push({ ...state, stage: label });
      assert.equal(state.dead, false, `Alive during ${label}`);
      if (sign * (state.x - target) >= 0 || state.sanctum) { report.stages.push({ label, ...state }); return; }
      stuck = Math.abs(state.x - previous.x) < 2 ? stuck + 1 : 0;
      if (stuck >= 2 && step > actionUntil) {
        // Catwalk braces have a low crawl passage. Try the actual crawl verb
        // as well as jumping; holding jump cannot fit beneath a timber knee.
        if (attempts++ % 2 === 0) await page.keyboard.down('KeyS');
        else { await page.keyboard.down('Space'); await page.keyboard.down('KeyW'); }
        actionUntil = step + 6; stuck = 0;
      }
      if (step === actionUntil) { await page.keyboard.up('Space'); await page.keyboard.up('KeyW'); await page.keyboard.up('KeyS'); }
      previous = state;
    }
    throw new Error(`Traversal stalled during ${label}: ${JSON.stringify(await sample())}`);
  } finally {
    await page.keyboard.up(direction); await page.keyboard.up('Space'); await page.keyboard.up('KeyW'); await page.keyboard.up('KeyS');
  }
}

async function settleAt(target, label) {
  try {
    for (let step = 0; step < 120; step++) {
      await acceptDiscoveredPage();
      const p = await sample(); report.samples.push({ ...p, stage: label });
      assert.equal(p.dead, false, `Alive during ${label}`);
      if (p.sanctum) { report.stages.push({ label, ...p }); return; }
      if (p.grounded && Math.abs(p.x - target) < 8 && Math.abs(p.vx) < .2) {
        report.stages.push({ label, ...p }); return;
      }
      // Account for carried air momentum; countersteering is ordinary input.
      const error = target - p.x - p.vx * 3;
      if (Math.abs(p.x - target) < 5 && Math.abs(p.vx) < .6) {
        await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
        await page.waitForTimeout(40); continue;
      }
      if (error > 1) { await page.keyboard.up('KeyA'); await page.keyboard.down('KeyD'); }
      else if (error < -1) { await page.keyboard.up('KeyD'); await page.keyboard.down('KeyA'); }
      else { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
      if (step > 0 && step % 16 === 0 && p.grounded && Math.abs(p.vx) < .05) {
        await page.keyboard.press('Space', { delay: 150 });
      }
      await page.waitForTimeout(40);
    }
    throw new Error(`${label} stalled: ${JSON.stringify(await sample())}`);
  } finally { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
}

async function flyTo(x, y, label) {
  await page.keyboard.down('Space'); await page.keyboard.down('KeyW');
  try {
    for (let step = 0; step < 120; step++) {
      await acceptDiscoveredPage();
      const p = await sample(); report.samples.push({ ...p, stage: label });
      assert.equal(p.dead, false, `Alive during ${label}`);
      if (p.y <= y && Math.abs(p.x - x) < 8) { report.stages.push({ label, ...p }); return; }
      const error = x - p.x - p.vx * 5;
      if (error > 3) { await page.keyboard.up('KeyA'); await page.keyboard.down('KeyD'); }
      else if (error < -3) { await page.keyboard.up('KeyD'); await page.keyboard.down('KeyA'); }
      else { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
      await page.waitForTimeout(60);
    }
    throw new Error(`${label} stalled: ${JSON.stringify(await sample())}`);
  } finally {
    await page.keyboard.up('Space'); await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
  }
}

async function followChute(from, to, label) {
  try {
    for (let step = 0; step < 100; step++) {
      await acceptDiscoveredPage();
      const p = await sample(); report.samples.push({ ...p, stage: label });
      assert.equal(p.dead, false);
      if (p.y >= to.y - 18) { report.stages.push({ label, ...p }); return; }
      // Aim down the passage, including the pipe lip at the pressure entrance.
      const fraction = Math.max(0, Math.min(1, (p.y + 36 - from.y) / (to.y - from.y)));
      const target = from.x + (to.x - from.x) * fraction;
      if (p.x < target - 3) { await page.keyboard.up('KeyA'); await page.keyboard.down('KeyD'); }
      else if (p.x > target + 3) { await page.keyboard.up('KeyD'); await page.keyboard.down('KeyA'); }
      else { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
      await page.waitForTimeout(100);
    }
    throw new Error(`${label} stalled: ${JSON.stringify(await sample())}`);
  } finally { await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); }
}

async function pointAtWorld(worldX, worldY, click = false) {
  const target = await page.evaluate(({ worldX, worldY }) => {
    const ctx = window.__game.ctx;
    const canvas = document.querySelector('canvas[data-input-attached="true"]');
    const rect = canvas.getBoundingClientRect();
    const viewW = 640, viewH = 360, zoom = ctx.camera.zoom;
    const fracX = ctx.camera.x - Math.floor(ctx.camera.x);
    const fracY = ctx.camera.y - Math.floor(ctx.camera.y);
    const scaleX = (1 + 4 / viewW) * zoom;
    const scaleY = (1 + 4 / viewH) * zoom;
    const offsetX = -fracX * (2 / viewW) * zoom;
    const offsetY = fracY * (2 / viewH) * zoom;
    const texU = (worldX - ctx.camera.renderX) / viewW;
    const texV = (worldY - ctx.camera.renderY) / viewH;
    const ndcX = offsetX + (texU - .5) * 2 * scaleX;
    const ndcY = offsetY + (.5 - texV) * 2 * scaleY;
    return { x: rect.left + (ndcX + 1) * .5 * rect.width,
      y: rect.top + (1 - ndcY) * .5 * rect.height };
  }, { worldX, worldY });
  await page.mouse.move(target.x, target.y);
  if (click) {
    await page.mouse.down();
    await page.waitForTimeout(180);
    await page.mouse.up();
  }
}

try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/', { waitUntil: 'networkidle' });
  await execConsoleCommand(page, 'run new --seed 777');
  await waitForRunReady(page);
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  await page.evaluate(() => { window.__game.ctx.enemies.length = 0; });
  await flyTo(265, 246, 'discover the lost page above the intake');
  await settleAt(265, 'land on the spell-page shelf');
  if (!report.discoveries.some(text => /bouncing charm/i.test(text))) {
    await page.locator('#card-offer-overlay.visible .card-offer-card').first().waitFor({ state: 'visible', timeout: 5000 });
    await acceptDiscoveredPage();
  }
  assert.ok(report.discoveries.some(text => /bouncing charm/i.test(text)), 'The optional intake detour gives a spell through its real offer');
  await moveTo(347, 'cross the intake to the return hatch');
  await settleAt(347, 'land on the upper return rung');
  await flyTo(400, 356, 'enter the lower intake tunnel');
  await moveTo(520, 'follow the lower intake tunnel');
  await moveTo(488, 'step around the handwheel platform');
  await waitForGameplay(() => window.__game.ctx.player.levit >= 70);
  await flyTo(488, 366, 'rise beside the sluice handwheel');
  await settleAt(524, 'land at handwheel');
  await page.screenshot({ path: `${output}/traversal-handwheel.png` });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__game.ctx.levels.current.mechanisms.find(m => m.kind === 'valve').state === 1, null, { timeout: 3000 });
  assert.equal((await sample()).valve, 1, 'Handwheel opens through actual interaction');
  await page.keyboard.press('KeyV');
  await moveTo(965, 'drained sluice crossing');
  await moveTo(1035, 'gallery entrance');
  await moveTo(1428, 'feeding gallery and pressure chute');
  await followChute({ x: 1432, y: 450 }, { x: 1415, y: 590 }, 'pressure chute');
  await moveTo(1115, 'cross the pressure shelters');
  await waitForGameplay(() => window.__game.ctx.player.y >= 705);
  await settleAt(930, 'land at the east refuge steps');
  await page.keyboard.down('KeyA');
  await page.keyboard.press('Space', { delay: 90 });
  await page.waitForTimeout(260);
  await page.keyboard.up('KeyA');
  await settleAt(910, 'step onto the refuge plinth');
  await moveTo(880, 'walk through the frost shrine');
  await waitForGameplay(() => window.__game.ctx.levels.current.pickups.some(pickup =>
    pickup.kind === 'tome' && pickup.data.card === 'frostshard' && pickup.taken));
  await moveTo(857, 'pressure chamber to refuge');
  await settleAt(857, 'rest at warm stone');
  await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD');
  await page.keyboard.up('Space'); await page.keyboard.up('KeyW'); await page.keyboard.up('KeyS');
  // Rest is intentionally interruptible by a pursuing creature; the route
  // audit does not turn that optional combat/reset beat into a traversal gate.
  await page.waitForTimeout(500);
  report.refugeRested = await page.evaluate(() => window.__game.ctx.levels.current.living.rested);
  report.stages.push({ label: 'refuge rest', ...await sample() });
  await page.screenshot({ path: `${output}/traversal-refuge.png` });
  assert.ok(report.discoveries.some(text => /frost shard/i.test(text)), 'The lower refuge grants the return-loop ability');
  await page.keyboard.press('KeyB');
  await page.locator('#wand-bench.visible').waitFor();
  await page.locator('#wand-bench [data-bench-card-id="frostshard"]').click();
  await page.locator('#wand-bench [data-bench-wand="0"][data-bench-slot="0"]').click();
  await page.waitForFunction(() => window.__game.ctx.wands.wands[0].cards[0] === 'frostshard');
  await page.screenshot({ path: `${output}/traversal-bench.png` });
  await page.setViewportSize({ width: 720, height: 480 });
  await page.screenshot({ path: `${output}/traversal-bench-compact.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.keyboard.press('KeyB');
  await moveTo(344, 'cross the silt garden to the return shaft');
  await settleAt(344, 'stand beneath the return ladder');
  // The authored landings deliberately alternate around a clear center lane.
  // Rise through that lane, then drift onto every second west landing to
  // recharge; trying to thrust straight through a platform is not a route.
  for (const y of [780, 719, 649, 579, 509, 439, 369]) {
    await waitForGameplay(() => window.__game.ctx.player.levit >= 95);
    await flyTo(371, y, `return-shaft climb to ${y}`);
    await settleAt(344, `return-shaft landing ${y}`);
  }
  await waitForGameplay(() => window.__game.ctx.player.levit >= 95);
  await flyTo(347, 306, 'rise through the intake hatch');
  await settleAt(370, 'land beside the cold census');
  await page.screenshot({ path: `${output}/traversal-backtrack-intake.png` });
  // The recessed tank is deliberately targetable from the safe hatch lip.
  // Cast through the open inspection well; no precision drop into the water.
  for (let cast = 0; cast < 3; cast++) {
    await pointAtWorld(315, 338, true);
    await page.waitForTimeout(650);
    const open = await page.evaluate(() => window.__game.ctx.levels.current.mechanisms
      .filter(mechanism => mechanism.id === 8301 || mechanism.id === 8302)
      .every(gate => gate.state === 1));
    if (open) break;
  }
  await page.waitForFunction(() => {
    const ctx = window.__game.ctx;
    const gates = ctx.levels.current.mechanisms.filter(m => m.id === 8301 || m.id === 8302);
    return gates.length === 2 && gates.every(gate => gate.state === 1 && !gate.dissolve?.length);
  }, null, { timeout: 10000 });
  report.stages.push({ label: 'cold census opened', ...await sample() });
  await page.screenshot({ path: `${output}/traversal-cold-census.png` });
  await settleAt(430, 'return to the engine crank');
  // The engine is PLAYED: the probe pulls the crank, walks the catwalk under
  // the chain and answers each of the three faults with the real verb and
  // real input — a Spark Bolt click on the priming pan, a kick (F) at the
  // Persuader, the water flask (Q) poured through the duck's grate.
  const teaStage = () => page.evaluate(() => window.__game.ctx.levels.current.living.tea?.stage ?? 0);
  const waitStage = (n, timeout = 30000) => waitForGameplay(new Function(`return (window.__game.ctx.levels.current.living.tea?.stage ?? 0) >= ${n}`), timeout);
  await page.keyboard.press('KeyE'); // deliberate crank pull
  await waitStage(1, 6000);
  report.machineVerbs = [];
  await waitStage(2);
  await moveTo(500, 'walk under the broken coupling');
  await settleAt(505, 'stand under the priming pan');
  for (let shot = 0; shot < 4 && await teaStage() === 2; shot++) {
    await pointAtWorld(523, 266, true); report.machineVerbs.push({ verb: 'spark', shot });
    await page.waitForTimeout(700);
  }
  await waitStage(3, 4000);
  await moveTo(734, 'follow the boulder to the tollgate');
  await settleAt(740, 'stand under the Persuader');
  await waitStage(6);
  for (let kick = 0; kick < 6 && await teaStage() === 6; kick++) {
    if (kick > 0) await settleAt(744, 'back under the Persuader'); // each kick recoils the kicker
    const bob = await page.evaluate(() => { const b = window.__game.ctx.rigidBodies.bodies.find(body => body.tag === 'tea-persuader'); return { x: b.x, y: b.y }; });
    await pointAtWorld(bob.x, bob.y); await page.keyboard.press('KeyF'); report.machineVerbs.push({ verb: 'kick', kick });
    await page.waitForTimeout(600);
  }
  await waitStage(7, 4000);
  await moveTo(1026, 'follow the dominoes to the duck');
  await settleAt(1030, 'stand beside the grate');
  await waitStage(9);
  await page.keyboard.press('Digit3'); // the water flask
  await page.keyboard.down('KeyQ');
  for (let beat = 0; beat < 12 && await teaStage() === 9; beat++) { await pointAtWorld(1000, 312); await page.waitForTimeout(250); }
  await page.keyboard.up('KeyQ'); report.machineVerbs.push({ verb: 'pour' });
  await waitStage(10, 4000);
  await waitForGameplay(() => { const tea = window.__game.ctx.levels.current.living.tea; return tea.completed || tea.stalled; }, 60000);
  const machine = await page.evaluate(() => window.__game.ctx.levels.current.living.tea);
  report.machineResult = { stage: machine.stage, completed: machine.completed, ticks: machine.ticks };
  assert.equal(machine.stalled, false, `Bell & Tea Engine completes its chain reaction: ${JSON.stringify(machine)}`);
  assert.equal(machine.completed, true);
  assert.ok(machine.ticks < 60 * 40, `a player who answers the faults finishes the engine inside 40 s (${machine.ticks} ticks)`);
  report.stages.push({ label: 'bell engine complete', ...await sample() });
  await moveTo(1541, 'cross the opened engine catwalk to the receiver');
  await settleAt(1541, 'land at the bell receiver tray');
  await waitForGameplay(() => window.__game.ctx.levels.current.keyTaken);
  report.stages.push({ label: 'bell collected', ...await sample() });
  await page.screenshot({ path: `${output}/traversal-bell.png` });
  await followChute({ x: 1541, y: 315 }, { x: 1455, y: 450 }, 'receiver ladder to gallery');
  await moveTo(1432, 'return to pressure chute');
  await followChute({ x: 1432, y: 450 }, { x: 1415, y: 590 }, 'pressure chute return');
  await moveTo(1115, 'cross the pressure shelters again');
  await waitForGameplay(() => window.__game.ctx.player.y >= 705);
  // GEN_VERSION 45: the Undertow chute opens at the garden's far west end,
  // past the return shaft, clear of the sunken garden pool.
  await moveTo(196, 'refuge and garden to the west chute');
  await followChute({ x: 190, y: 815 }, { x: 330, y: 1008 }, 'undertow arrival');
  await moveTo(1400, 'undertow to lower gate');
  await settleAt(1400, 'touch the lower gate');
  await page.locator('#perk-row .perk-card').first().waitFor({ state: 'visible' });
  await page.screenshot({ path: `${output}/traversal-boon.png` });
  await page.setViewportSize({ width: 720, height: 480 });
  await page.screenshot({ path: `${output}/traversal-boon-compact.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#perk-row .perk-card').first().click();
  await page.locator('#descend-btn').click();
  await page.waitForFunction(() => window.__game.ctx.levels.current?.def.id === 'd2' && !window.__game.ctx.levels.transitioning);
  report.arrival = await page.evaluate(() => ({ level: window.__game.ctx.levels.current.def.id, alive: !window.__game.ctx.player.dead }));
  assert.equal(report.arrival.alive, true);
  await page.screenshot({ path: `${output}/traversal-depth-two.png` });
  assert.deepEqual(report.errors, []);
  report.completed = true;
} catch (error) {
  report.failure = String(error);
  report.lastState = await sample().catch(() => null);
  await page.screenshot({ path: `${output}/traversal-failure.png` }).catch(() => {});
  throw error;
} finally {
  writeFileSync(`${output}/traversal.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

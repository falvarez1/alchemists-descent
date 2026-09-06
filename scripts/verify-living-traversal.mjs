import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';

const output = 'verify-out/living-descent'; mkdirSync(output, { recursive: true });
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = { setup: 'Fresh canonical expedition. Only keyboard/mouse inputs after start; no positioning, invulnerability, inventory injection or terrain fixture.', errors: [], samples: [], stages: [], discoveries: [] };
page.on('pageerror', error => report.errors.push(String(error)));
const sample = () => page.evaluate(() => {
  const ctx = window.__game.ctx, p = ctx.player;
  return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, hp: p.hp, dead: p.dead, grounded: p.grounded, levit: p.levit,
    room: ctx.levels.current.living.room, tick: ctx.state.frameCount, sanctum: ctx.sanctum.isOpen, paused: ctx.state.paused, crawling: p.crawling,
    valve: ctx.levels.current.mechanisms.find(m => m.kind === 'valve').state };
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

try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/', { waitUntil: 'networkidle' });
  await execConsoleCommand(page, 'run new --seed 777');
  await waitForRunReady(page);
  await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  await flyTo(265, 246, 'discover the lost page above the intake');
  await settleAt(265, 'land on the spell-page shelf');
  if (!report.discoveries.some(text => /bouncing charm/i.test(text))) {
    await page.locator('#card-offer-overlay.visible .card-offer-card').first().waitFor({ state: 'visible', timeout: 5000 });
    await acceptDiscoveredPage();
  }
  assert.ok(report.discoveries.some(text => /bouncing charm/i.test(text)), 'The optional intake detour gives a spell through its real offer');
  await moveTo(510, 'intake to handwheel');
  await settleAt(524, 'land at handwheel');
  await page.screenshot({ path: `${output}/traversal-handwheel.png` });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__game.ctx.levels.current.mechanisms.find(m => m.kind === 'valve').state === 1, null, { timeout: 3000 });
  assert.equal((await sample()).valve, 1, 'Handwheel opens through actual interaction');
  await page.keyboard.press('KeyV');
  await moveTo(965, 'drained sluice crossing');
  await moveTo(1035, 'gallery entrance');
  await moveTo(1445, 'feeding gallery and pressure chute');
  await followChute({ x: 1455, y: 450 }, { x: 1420, y: 590 }, 'pressure chute');
  await moveTo(1115, 'cross the pressure shelters');
  await waitForGameplay(() => window.__game.ctx.player.y >= 705);
  await moveTo(857, 'pressure chamber to refuge');
  await settleAt(857, 'rest at warm stone');
  await waitForGameplay(() => window.__game.ctx.levels.current.living.rested);
  report.stages.push({ label: 'refuge rest', ...await sample() });
  await page.screenshot({ path: `${output}/traversal-refuge.png` });
  await page.keyboard.press('KeyB');
  await page.locator('#wand-bench.visible').waitFor();
  await page.screenshot({ path: `${output}/traversal-bench.png` });
  await page.setViewportSize({ width: 720, height: 480 });
  await page.screenshot({ path: `${output}/traversal-bench-compact.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.keyboard.press('KeyB');
  await moveTo(340, 'garden bank');
  // Rise beside the solid shelf before crossing its top. Steering directly
  // to the bell from the pool spends the flight budget against its underside.
  await settleAt(325, 'recharge beside bell ledge');
  await waitForGameplay(() => window.__game.ctx.player.levit >= 95);
  await flyTo(325, 740, 'rise beside bell ledge');
  await settleAt(285, 'land by brass bell');
  await waitForGameplay(() => window.__game.ctx.levels.current.keyTaken);
  report.stages.push({ label: 'bell collected', ...await sample() });
  await page.screenshot({ path: `${output}/traversal-bell.png` });
  await moveTo(430, 'garden chute entrance');
  await followChute({ x: 430, y: 815 }, { x: 490, y: 1008 }, 'undertow arrival');
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

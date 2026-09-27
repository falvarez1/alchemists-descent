import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForRunReady } from './run-helpers.mjs';

// The Bell & Tea Engine, PLAYED with real input: open the cold lock the real
// way (freeze its cistern), walk to the crank, press Use, then walk the
// catwalk under the chain and answer each fault — a Spark Bolt click on the
// priming pan, F at the Persuader, Q with the water flask over the grate.
// Asserts the player keeps control throughout, the camera keeps him in shot
// under its pan-speed cap, the caption card shows each fault's verb (and fits
// a compact viewport), and the bell is collected at the receiver.
// Usage: node scripts/verify-tea-machine.mjs [url] [seed] [--resume] [--comfort] [--idle]
//   --resume   save mid-chain, reload, continue; the props and plates persist
//   --comfort  reduced camera motion: no close zoom
//   --idle     answer nothing; the three backups must finish the engine
const seed = Number(process.argv[3] ?? 777), resume = process.argv.includes('--resume');
const comfort = process.argv.includes('--comfort'), idle = process.argv.includes('--idle');
const output = `verify-out/tea-machine-${seed}${resume ? '-resume' : ''}${comfort ? '-comfort' : ''}${idle ? '-idle' : ''}`;
mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { errors: [], stages: [], seed, resume, comfort, idle, verbs: [] };
page.on('pageerror', e => report.errors.push(String(e)));

const tea = () => page.evaluate(() => { const t = window.__game.ctx.levels.current.living.tea; return t && { ...t, bodies: undefined }; });
const stage = async () => (await tea())?.stage ?? 0;
const playerX = () => page.evaluate(() => window.__game.ctx.player.x);
async function walkTo(x) {
  // Hold the direction like a player; hop any lip that stops us; feather the last cells.
  let px = await playerX(), last = px, still = 0;
  const key = px < x ? 'KeyD' : 'KeyA', sign = px < x ? 1 : -1;
  await page.keyboard.down(key);
  for (let i = 0; i < 120 && sign * (x - px) > 10; i++) {
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
  const target = await page.evaluate(({ worldX, worldY }) => {
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
const waitStage = (n, timeout = 40000) => page.waitForFunction(n => (window.__game.ctx.levels.current.living.tea?.stage ?? 0) >= n, n, { timeout });

try {
  await page.goto(process.argv[2] ?? 'http://localhost:5173/');
  // A resumable save needs a real expedition; test runs are disposable by design.
  await execConsoleCommand(page, resume ? `run new --seed ${seed}` : `run test --level d1 --world campaign-level --seed ${seed} --loadout fresh`);
  await waitForRunReady(page);
  if (comfort) {
    await page.locator('#expedition-pause').click(); await page.locator('#pause-settings').click();
    await page.locator('[name="cameraShake"]').uncheck();
    await page.locator('#player-settings button[value="close"]').click(); await page.keyboard.press('Escape');
  }
  // The cold lock, solved the way a player solves it: ice in the census cistern.
  await page.evaluate(() => { const c = window.__game.ctx, w = c.world; c.enemies.length = 0;
    for (let y = 333; y <= 341; y++) for (let x = 302; x <= 327; x++) if (w.type(x, y) === 2) w.replaceCellAt(w.idx(x, y), 10, 0xbfe6f2); });
  await page.waitForFunction(() => window.__game.ctx.levels.current.mechanisms.filter(m => m.id === 8301 || m.id === 8302).every(m => m.state === 1), null, { timeout: 15000 });
  await walkTo(428);
  await page.keyboard.press('KeyE');
  await waitStage(1, 8000);
  // Sampled every frame: camera pan per tick, and whether the player is in shot.
  await page.evaluate(() => {
    const probe = window.teaProbe = { maxPanPerTick: 0, outOfShot: 0, framed: 0 };
    let prev = null;
    const sample = () => {
      const c = window.__game.ctx, cam = c.camera, s = c.levels.current.living.tea;
      if (cam.actionFocus && prev && c.state.frameCount > prev.frame) {
        probe.framed++;
        probe.maxPanPerTick = Math.max(probe.maxPanPerTick, Math.hypot(cam.x - prev.x, cam.y - prev.y) / (c.state.frameCount - prev.frame));
        const w = 640 / cam.zoom, h = 360 / cam.zoom, cx = cam.x + 320, cy = cam.y + 180;
        if (Math.abs(c.player.x - cx) > w / 2 || Math.abs(c.player.y - 9 - cy) > h / 2) probe.outOfShot++;
      }
      prev = { x: cam.x, y: cam.y, frame: c.state.frameCount };
      if (!s?.completed || s.stageTicks < 400) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  // Control is never taken: the alchemist walks while the fuse burns.
  const before = await playerX();
  await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
  assert.ok(await playerX() > before + 8, 'the player keeps control while the engine runs');

  const card = async (name, fault = true) => {
    if (fault) await page.locator('#tea-view .tea-fault').waitFor({ state: 'visible', timeout: 5000 });
    const text = await page.locator('#tea-view .tea-caption').innerText();
    report.stages.push({ name, stage: await stage(), card: text });
    await page.screenshot({ path: `${output}/${name}.png` });
    return text;
  };
  let resumed = false;
  // ---- Fault 1: the coupling. Spark Bolt at the priming pan.
  await waitStage(2);
  await walkTo(505);
  assert.match(await card('fault-spark'), /Left click[\s\S]*Wand/);
  await page.setViewportSize({ width: 720, height: 480 });
  const rect = await page.locator('#tea-view .tea-caption').boundingBox();
  assert.ok(rect.x >= 0 && rect.x + rect.width <= 721 && rect.y >= 0 && rect.y + rect.height <= 481, 'the caption card fits a compact viewport');
  await page.screenshot({ path: `${output}/compact-fault.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  if (!idle) for (let shot = 0; shot < 4 && await stage() === 2; shot++) {
    await pointAtWorld(523, 266, true); report.verbs.push({ verb: 'spark', shot }); await page.waitForTimeout(700);
  }
  // ---- Fault 2: the tollgate. Kick the Persuader.
  await waitStage(6);
  await walkTo(740);
  assert.match(await card('fault-kick'), /F[\s\S]*Kick/);
  if (!idle) for (let kick = 0; kick < 6 && await stage() === 6; kick++) {
    if (kick > 0) await walkTo(744); // each kick recoils the kicker
    const bob = await page.evaluate(() => { const b = window.__game.ctx.rigidBodies.bodies.find(body => body.tag === 'tea-persuader'); return { x: b.x, y: b.y }; });
    await pointAtWorld(bob.x, bob.y); await page.keyboard.press('KeyF'); report.verbs.push({ verb: 'kick', kick }); await page.waitForTimeout(600);
  }
  await waitStage(7);
  if (resume && !resumed) {
    report.saved = await tea();
    await execConsoleCommand(page, 'run save');
    await page.waitForFunction(() => window.__game.ctx.levels.persistenceStatus().state === 'ready');
    await page.evaluate(() => window.__game.ctx.levels.flushSaves()); // the write must land before the reload
    await page.reload(); await execConsoleCommand(page, 'run continue'); await waitForRunReady(page);
    const restored = await page.evaluate(() => ({ props: window.__game.ctx.rigidBodies.bodies.filter(b => b.tag?.startsWith('tea-')).length,
      tea: window.__game.ctx.levels.current.living.tea }));
    report.restored = { props: restored.props, stage: restored.tea.stage, travel: restored.tea.travel };
    assert.equal(restored.props, 15, 'every prop survives the save');
    assert.ok(restored.tea.stage >= report.saved.stage, `resumed at stage ${restored.tea.stage}, saved at ${report.saved.stage}`);
    assert.ok((restored.tea.travel?.gate ?? 0) >= (report.saved.travel?.gate ?? 0), 'the tollgate stays open');
    resumed = true;
  }
  // ---- Fault 3: the downpipe. Pour the water flask through the grate.
  await waitStage(9, 60000);
  await walkTo(1030);
  assert.match(await card('fault-pour'), /Q[\s\S]*Water flask/);
  if (!idle) {
    await page.keyboard.press('Digit3'); await page.keyboard.down('KeyQ');
    for (let beat = 0; beat < 12 && await stage() === 9; beat++) { await pointAtWorld(1000, 312); await page.waitForTimeout(250); }
    await page.keyboard.up('KeyQ'); report.verbs.push({ verb: 'pour' });
  }
  // ---- The finale: follow it to the receiver.
  await waitStage(10, 60000);
  await card('marble', false);
  await walkTo(1400);
  await page.waitForFunction(() => window.__game.ctx.levels.current.living.tea.completed, null, { timeout: 60000 });
  await card('served', false);
  report.final = await tea();
  report.probe = await page.evaluate(() => window.teaProbe);
  console.log(JSON.stringify({ final: { stage: report.final.stage, ticks: report.final.ticks, travel: report.final.travel }, probe: report.probe, verbs: report.verbs.length }));
  assert.equal(report.final.completed, true);
  if (report.probe) { // the camera probe does not survive the --resume reload
    assert.ok(report.probe.maxPanPerTick <= 2.401, `camera travel stays under its speed cap (${report.probe.maxPanPerTick})`);
    assert.equal(report.probe.outOfShot, 0, 'the framed camera never loses the player');
  }
  if (!idle && !resume) assert.ok(report.final.ticks < 60 * 40, `answered promptly, the engine finishes inside 40 s (${report.final.ticks} ticks)`);
  if (comfort) assert.ok(await page.evaluate(() => window.__game.ctx.camera.zoom) <= 1.025, 'reduced camera motion suppresses close zoom');
  assert.deepEqual(report.errors, []);
  // The bell, through the real catwalk.
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.__game.ctx.player.x > 1528, null, { timeout: 20000 });
  await page.keyboard.up('KeyD'); await page.keyboard.down('Space'); await page.waitForTimeout(800); await page.keyboard.up('Space');
  await page.waitForFunction(() => window.__game.ctx.levels.current.keyTaken, null, { timeout: 8000 });
  await page.waitForFunction(() => window.__game.ctx.camera.actionFocus === null, null, { timeout: 10000 });
  report.bellCollected = true;
  console.log('PASS: the engine was played through real input, the player kept control and the bell was collected.');
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await page.screenshot({ path: `${output}/last.png` }).catch(() => {});
  await browser.close();
}

// Run against a freshly started Vite server so probe and game share pose modules.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { leaveTitleIfShown, startConsoleTestRun } from './run-helpers.mjs';
import { makeChecker } from './fighter-probe.mjs';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:5187/'); url.searchParams.set('link', 'off');
const webgpu = url.searchParams.get('renderBackend') === 'webgpu';
const dir = `verify-out/foliage-cover${webgpu ? '-webgpu' : ''}`; mkdirSync(dir, { recursive: true });
const check = makeChecker(), errors = [];
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 60000 });
  await leaveTitleIfShown(page);
  await startConsoleTestRun(page, { level: 'd1', world: 'campaign-level', seed: 1337, settleMs: 1500, timeout: 60000 });
  await page.waitForFunction(() => window.__game.composer.layers.ready);
  await page.addStyleTag({ content: '#wave-banner, #toast-stack, .hint-teach-overlay { visibility: hidden !important; }' });
  const setup = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    const { visibleSurfaceFoliage } = await import('/src/game/SurfaceFoliage.ts');
    ctx.state.paused = true; ctx.state.arrivalGraceUntil = 0;
    ctx.player.godMode = true; ctx.enemies.length = 0;
    ctx.camera.snapTo(270, 314);
    const roots = visibleSurfaceFoliage(ctx);
    const root = roots.find(p => p.foreground && p.x >= 264 && p.x <= 282 && p.y === 314);
    if (!root) throw new Error('No natural cover on the generated Intake path');
    Object.assign(ctx.player, { x: root.x - 30, y: 314, vx: 0, vy: 0, grounded: true });
    window.__coverRoot = { x: root.x, y: root.y };
    return { root: window.__coverRoot, front: roots.filter(p => p.foreground).length, back: roots.filter(p => !p.foreground).length };
  });
  check.check('ordinary generated level supplies both foreground and background foliage', setup.front > 0 && setup.back > 0, JSON.stringify(setup));
  await page.evaluate(() => {
    const stream = document.querySelector('#canvas-holder > canvas').captureStream(24), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 2800000 });
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.start(); window.__coverRecording = { recorder, stream, chunks };
    window.__game.ctx.state.paused = false;
  });
  await page.screenshot({ path: `${dir}/approach.png` });
  await page.keyboard.down('KeyD');
  await page.waitForFunction(x => window.__game.ctx.player.x >= x - 3, setup.root.x, { timeout: 5000, polling: 'raf' });
  await page.keyboard.up('KeyD');
  await page.waitForFunction(() => window.__game.ctx.foliageCover.hidden, null, { timeout: 5000 }).catch(async error => {
    await page.screenshot({ path: `${dir}/failed-settle.png` });
    console.log(await page.evaluate(() => {
      const ctx = window.__game.ctx, p = ctx.player, c = ctx.foliageCover;
      return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: p.grounded, firing: p.firing, recoil: p.recoilT,
        hidden: c.hidden, coverage: c.coverage, progress: c.progress, frame: ctx.state.frameCount, mode: ctx.state.mode };
    }));
    throw error;
  });
  await page.screenshot({ path: `${dir}/concealed.png` });
  const native = await page.evaluate(() => {
    const ctx = window.__game.ctx; ctx.state.paused = true;
    return { x: ctx.player.x, y: ctx.player.y, hidden: ctx.foliageCover.hidden, coverage: ctx.foliageCover.coverage,
      label: document.querySelector('#foliage-cover').textContent, labelVisible: !document.querySelector('#foliage-cover').hidden };
  });
  check.check('native movement settles behind foreground fronds and reports concealment', native.hidden && native.coverage >= .55 && native.labelVisible && native.label === 'Concealed in foliage', JSON.stringify(native));

  const senses = await page.evaluate(async () => {
    const game = window.__game, ctx = game.ctx;
    const { ensureCreatureMind } = await import('/src/creatures/perception.ts');
    const enemy = ctx.enemyCtl.spawn('golem', 350, 314);
    const mind = ensureCreatureMind(enemy, ctx.state.worldSeed); mind.facing = -1;
    const step = count => {
      for (let i = 0; i < count; i++) {
        Object.assign(enemy, { x: 350, y: 314, vx: 0, vy: 0 });
        mind.facing = -1; game.tick(false, { forcePaused: true });
      }
    };
    step(15); const hiddenFromEnemy = !mind.visible;
    ctx.foliageCover.reveal(); step(15); const exposedVisible = mind.visible;
    const seenX = mind.targetX;
    step(130); const hiddenAgain = ctx.foliageCover.hidden && !mind.visible;
    return { hiddenFromEnemy, exposedVisible, hiddenAgain, lastSeenX: mind.targetX, seenX, intent: mind.intent };
  });
  check.check('real creature loses sight in cover but sees the revealed player', senses.hiddenFromEnemy && senses.exposedVisible, JSON.stringify(senses));
  check.check('creature investigates its last sighting after concealment returns', senses.hiddenAgain && senses.lastSeenX === senses.seenX && senses.intent === 'investigate', JSON.stringify(senses));

  // Fire with real mouse input, not an emitted test event.
  await page.evaluate(() => { window.__game.ctx.enemies.length = 0; window.__game.ctx.state.paused = false; });
  await page.mouse.move(1450, 450); await page.mouse.down();
  try {
    await page.waitForFunction(() => !window.__game.ctx.foliageCover.hidden, null, { timeout: 5000, polling: 'raf' });
  } finally { await page.mouse.up(); }
  const attack = await page.evaluate(() => ({ hidden: window.__game.ctx.foliageCover.hidden, shots: window.__game.ctx.projectiles.length }));
  check.check('native wand input immediately breaks concealment', !attack.hidden, JSON.stringify(attack));
  await page.screenshot({ path: `${dir}/revealed.png` });
  await page.waitForFunction(() => window.__game.ctx.foliageCover.hidden, null, { timeout: 6000 });

  const removal = await page.evaluate(async () => {
    const ctx = window.__game.ctx; ctx.state.paused = true;
    const { visibleSurfaceFoliage } = await import('/src/game/SurfaceFoliage.ts');
    const { VISUAL_FIDELITY } = await import('/src/config/visualFidelity.ts');
    VISUAL_FIDELITY.enabled = false;
    const roots = [...visibleSurfaceFoliage(ctx)].filter(p => p.foreground && Math.abs(p.x - ctx.player.x) < 45 && Math.abs(p.y - ctx.player.y) < 45);
    const hiddenWithCosmeticsOff = ctx.foliageCover.hidden;
    for (const p of roots) ctx.world.clearCell(p.x, p.y);
    window.__game.tick(false, { forcePaused: true });
    const exposedAfterCutting = !ctx.foliageCover.hidden && ctx.foliageCover.coverage === 0;
    VISUAL_FIDELITY.enabled = true;
    return { roots: roots.length, hiddenWithCosmeticsOff, exposedAfterCutting };
  });
  check.check('cutting the real roots removes cover immediately', removal.roots > 0 && removal.exposedAfterCutting, JSON.stringify(removal));
  check.check('cosmetic quality settings do not control concealment', removal.hiddenWithCosmeticsOff);
  await page.screenshot({ path: `${dir}/cut-cover.png` });
  const backend = await page.evaluate(() => window.__game.getRenderBackendStatus());
  if (webgpu) check.check('WebGPU renderer and live composition are active',
    backend.actual === 'webgpu' && backend.webgpu?.compose?.bridge === 'validated', JSON.stringify(backend));
  const clip = await page.evaluate(async () => {
    const { recorder, stream, chunks } = window.__coverRecording;
    await new Promise(resolve => { recorder.onstop = resolve; recorder.stop(); });
    stream.getTracks().forEach(t => t.stop());
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let raw = ''; for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(raw);
  });
  writeFileSync(`${dir}/cover-play.webm`, Buffer.from(clip, 'base64'));
  check.check('no browser exceptions', errors.length === 0, errors.join('\n'));
  writeFileSync(`${dir}/measured.json`, JSON.stringify({ setup, native, senses, attack, removal, backend, errors, pass: check.pass, fail: check.fail }, null, 2));
  console.log(`Foliage cover: ${check.pass} passed, ${check.fail} failed`);
  if (check.fail) process.exitCode = 1;
} finally { await browser.close(); }

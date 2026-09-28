import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';
import { collectBackendCapabilities, currentGitState } from './perf-harness.mjs';

// Run variants serially on an otherwise idle machine. URL flags select the
// renderer; the scene, seed, camera, input and sampling window stay identical.
const url = process.argv[2] ?? 'http://127.0.0.1:5182/';
const label = process.argv[3] ?? 'fidelity';
const seconds = Math.max(10, Number(process.argv[4] ?? 30));
assert.match(label, /^[a-z0-9-]+$/);
const output = 'verify-out/living-descent';
mkdirSync(output, { recursive: true });
const report = { label, url, seconds, startedAt: new Date().toISOString(), git: currentGitState(), errors: [], scenes: [] };
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => report.errors.push(String(e)));
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await waitForConsoleApi(page);
  await page.evaluate(() => window.__game.ctx.levels.ready);
  for (const level of (process.argv[5] ?? 'd1,d4,gallery').split(',')) {
    await execConsoleCommand(page, level === 'd1' ? 'run new --seed 777' : level === 'gallery' || level === 'sluice'
      ? 'run test --level d1 --world campaign-level --seed 777 --loadout fresh --hp 9999 --max-hp 9999'
      : 'run test --level d4 --world campaign-level --seed 777 --loadout fresh');
    await waitForRunReady(page);
    await page.waitForFunction(() => window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
    if (process.argv[6] === 'trickshot') {
      await page.locator('#expedition-pause').click(); await page.locator('#pause-settings').click();
      await page.locator('[name="trickshotEnabled"]').check();
      await page.getByRole('button', { name: 'Close settings', exact: true }).click(); await page.keyboard.press('Escape');
    }
    if (level === 'gallery') await execConsoleCommand(page, 'tp 1230 387');
    await page.waitForTimeout(6000);
    if (level === 'sluice') {
      await execConsoleCommand(page, 'tp 524 374'); await page.waitForTimeout(700); await page.keyboard.press('KeyE');
      await page.waitForFunction(() => window.__game.ctx.levels.current.mechanisms.some(m => m.kind === 'valve' && m.state === 1));
      await execConsoleCommand(page, 'tp 680 324'); await page.waitForTimeout(700);
    }
    const start = await page.evaluate(() => {
      window.__perfRecord = true; window.__perfSamples = []; window.__perfTicks = [];
      const game = window.__game;
      return { time: performance.now(), tick: game.ctx.state.frameCount, debt: game.cadence.debt,
        camera: { x: game.ctx.camera.x, y: game.ctx.camera.y }, player: { x: game.ctx.player.x, y: game.ctx.player.y } };
    });
    console.log(`${label}: ${level}, ${seconds}s timing started`);
    for (let t = 0; t < seconds; t += 5) await page.waitForTimeout(Math.min(5, seconds - t) * 1000);
    const scene = await page.evaluate(({ level, start }) => {
      window.__perfRecord = false;
      const game = window.__game, samples = window.__perfSamples, elapsed = performance.now() - start.time;
      const stats = values => { values.sort((a, b) => a - b); return { mean: values.reduce((a, b) => a + b, 0) / Math.max(1, values.length),
        p95: values[Math.floor(values.length * .95)] ?? 0, p99: values[Math.floor(values.length * .99)] ?? 0, max: values.at(-1) ?? 0 }; };
      return { level, start, elapsed, frames: samples.length, ticksPerSecond: (game.ctx.state.frameCount - start.tick) * 1000 / elapsed,
        droppedMs: samples.reduce((sum, s) => sum + s.dropped, 0), endingDebt: game.cadence.debt,
        frame: stats(samples.map(s => s.frame)), interval: stats(samples.map(s => s.interval)),
        compose: stats(samples.map(s => s.compose)), submit: stats(samples.map(s => s.gl)),
        ticks: Object.fromEntries(['sim', 'creatures', 'gameplay', 'total'].map(k => [k, stats(window.__perfTicks.map(s => s[k]))])),
        alive: !game.ctx.player.dead, enemies: game.ctx.enemies.length, fauna: game.ctx.critters.list.length,
        backend: game.getRenderBackendStatus(), pixelStep: game.composer.pixelStep,
        light: { width: game.composer.light.LW, height: game.composer.light.LH } };
    }, { level, start });
    report.scenes.push(scene);
    console.log(JSON.stringify(scene));
    assert.ok(scene.alive, 'Timing must exercise live gameplay');
    assert.equal(scene.droppedMs, 0, 'Simulation time must not be discarded');
    assert.notEqual(scene.backend.webgpu?.compose?.bridge, 'failed', 'A failed WebGPU composition is not a valid performance result');
    await page.screenshot({ path: `${output}/${label}-${level}.png` });
    // Sampling profiler runs AFTER timing; its overhead never enters A/B data.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
    await page.waitForTimeout(5000);
    const { profile } = await cdp.send('Profiler.stop');
    await cdp.detach();
    writeFileSync(`${output}/${label}-${level}.cpuprofile`, JSON.stringify(profile));
    const nodes = new Map(profile.nodes.map(n => [n.id, n])), time = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const n = nodes.get(profile.samples[i]), key = `${n.callFrame.functionName} ${n.callFrame.url.replace(/^.*\/src\//, 'src/').split('?')[0]}`;
      time.set(key, (time.get(key) ?? 0) + profile.timeDeltas[i]);
    }
    scene.cpuProfileTop = [...time].map(([fn, us]) => ({ fn, ms: us / 1000 })).sort((a, b) => b.ms - a.ms).slice(0, 16);
    console.log(JSON.stringify(scene.cpuProfileTop));
  }
  report.environment = await collectBackendCapabilities(page);
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(`${output}/${label}.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

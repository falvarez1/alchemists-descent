// Isolate the clear-water presentation changed in the fidelity pass. Compare
// both backends consecutively inside one animation frame, with assets ready.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { startConsoleTestRun } from './run-helpers.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:5182/';
const url = new URL(base); url.searchParams.set('pixelScale', '1'); url.searchParams.set('link', 'off');
const webgpu = url.searchParams.get('renderBackend') === 'webgpu';
const suffix = webgpu ? '-webgpu' : '';
const dir = 'verify-out/fidelity-parity'; mkdirSync(dir, { recursive: true });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 60000 });
  await startConsoleTestRun(page, { level: 'd1', world: 'campaign-level', seed: 1337, settleMs: 1800 });
  await page.waitForFunction(() => window.__game.composer.layers.ready && window.__game.ctx.levels.findabilityReady, null, { timeout: 60000 });
  const result = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
    const game = window.__game, ctx = game.ctx;
    ctx.state.paused = true; ctx.state.frameCount = 420;
    ctx.enemies.length = 0; ctx.projectiles.length = 0; ctx.particles.clear();
    ctx.state.postFx.enabled = false; ctx.state.postFx.subcell = false;
    Object.assign(ctx.camera, { x: 483, y: 157, renderX: 483, renderY: 157, presentationX: 483, presentationY: 157 });
    const realRandom = Math.random; Math.random = () => .5; window.__composeFlickerMid = true;
    const source = document.querySelector('#canvas-holder > canvas'), canvas = document.createElement('canvas');
    canvas.width = source.width; canvas.height = source.height;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const capture = gpu => {
      ctx.state.postFx.gpuCompose = gpu;
      // Rendering synchronizes backend flags and presentation offsets. Warm
      // the requested path before reading its next, fully composed frame.
      game.composer.compose(ctx, 1); game.renderer.render(ctx);
      game.composer.compose(ctx, 1); game.renderer.render(ctx); g.drawImage(source, 0, 0);
      return { pixels: g.getImageData(0, 0, canvas.width, canvas.height).data, image: canvas.toDataURL('image/png').split(',')[1] };
    };
    const cpu = capture(false), repeat = capture(false), gpu = capture(true);
    let samples = 0, sum = 0, max = 0, big = 0, repeatMax = 0, energy = 0;
    for (let py = 0; py < canvas.height; py++) for (let px = 0; px < canvas.width; px++) {
      const wx = 483 + Math.floor(px / canvas.width * 640), wy = 157 + Math.floor(py / canvas.height * 360);
      if (ctx.world.type(wx, wy) !== 2 || ctx.world.type(wx, wy - 1) !== 2 || ctx.world.type(wx, wy + 1) !== 2) continue;
      const i = (py * canvas.width + px) * 4;
      let localMax = 0;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(cpu.pixels[i + c] - gpu.pixels[i + c]); sum += d; energy += gpu.pixels[i + c]; max = Math.max(max, d); localMax = Math.max(localMax, d);
        repeatMax = Math.max(repeatMax, Math.abs(cpu.pixels[i + c] - repeat.pixels[i + c]));
      }
      samples++; if (localMax > 2) big++;
    }
    Math.random = realRandom;
    const status = game.getRenderBackendStatus();
    resolve({ samples, mean: sum / (samples * 3), max, bigPct: big / samples * 100, repeatMax, brightness: energy / (samples * 3), backend: status.actual, bridge: status.webgpu?.compose?.bridge,
      gpuAvailable: game.composer.target.gpuComposeAvailable, gpuActive: ctx.state.postFx.gpuCompose, cpu: cpu.image, gpu: gpu.image });
  })));
  writeFileSync(`${dir}/cpu${suffix}.png`, Buffer.from(result.cpu, 'base64'));
  writeFileSync(`${dir}/gpu${suffix}.png`, Buffer.from(result.gpu, 'base64'));
  delete result.cpu; delete result.gpu;
  const pass = result.samples > 1000 && result.brightness > 5 && result.repeatMax <= 1 && result.gpuAvailable && result.gpuActive && result.mean <= .1 && result.bigPct <= .2 && errors.length === 0 &&
    (!webgpu || (result.backend === 'webgpu' && result.bridge === 'validated'));
  writeFileSync(`${dir}/measured${suffix}.json`, JSON.stringify({ ...result, pass, errors }, null, 2));
  console.log(`${pass ? 'PASS' : 'FAIL'} clear-water CPU/GPU parity: ${JSON.stringify(result)}`);
  if (!pass) process.exitCode = 1;
} finally { await browser.close(); }

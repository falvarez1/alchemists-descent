// Phase 3 WebGPU presentation probe.
// Usage: node scripts/probe-webgpu-presentation.mjs [baseUrl]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

import { startConsoleTestRun } from './run-helpers.mjs';
import {
  currentCommandLine,
  currentGitCommit,
  currentGitState,
  newBenchmarkPage,
  summarizeBuckets,
  writeJson,
} from './perf-harness.mjs';

const outDir = 'verify-out/webgpu-presentation';
const timestamp = Date.now();
const providedBaseUrl = process.argv[2] ?? null;
const PERF_FRAMES = Number(process.env.WEBGPU_PRESENTATION_FRAMES ?? 180);
const WEBGPU_COMPOSE_CAPABILITY_REQUIREMENTS = {
  maxTextureDimension2D: 2172,
  maxSampledTexturesPerShaderStage: 9,
  maxSamplersPerShaderStage: 2,
  maxUniformBufferBindingSize: 4096,
  maxStorageBufferBindingSize: 1266820,
  maxBufferSize: 1553664,
};

async function startViteServer() {
  const server = await createServer({
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 5196,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5196;
  return { server, baseUrl: `http://127.0.0.1:${port}/` };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function applyPngFilter(filter, row, previous, channels) {
  const stride = channels;
  for (let x = 0; x < row.length; x++) {
    const left = x >= stride ? row[x - stride] : 0;
    const up = previous ? previous[x] : 0;
    const upLeft = previous && x >= stride ? previous[x - stride] : 0;
    let value = 0;
    if (filter === 1) {
      value = left;
    } else if (filter === 2) {
      value = up;
    } else if (filter === 3) {
      value = Math.floor((left + up) / 2);
    } else if (filter === 4) {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      value = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
    } else if (filter !== 0) {
      throw new Error(`Unsupported PNG filter ${filter}`);
    }
    row[x] = (row[x] + value) & 0xff;
  }
  return row;
}

function decodePng(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) throw new Error('Not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error(`Unsupported PNG format bitDepth=${bitDepth} interlace=${interlace}`);
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!channels) throw new Error(`Unsupported PNG colorType=${colorType}`);

  const inflated = inflateSync(Buffer.concat(idat));
  const rowLength = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let input = 0;
  let previous = null;
  let nonBlackPixels = 0;
  let maxChannel = 0;
  let sumRgb = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[input++];
    const row = Buffer.from(inflated.subarray(input, input + rowLength));
    input += rowLength;
    applyPngFilter(filter, row, previous, channels);
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      const r = row[src];
      const g = row[src + 1];
      const b = row[src + 2];
      rgba[dst] = r;
      rgba[dst + 1] = g;
      rgba[dst + 2] = b;
      rgba[dst + 3] = channels === 4 ? row[src + 3] : 255;
      sumRgb += r + g + b;
      maxChannel = Math.max(maxChannel, r, g, b);
      if (r + g + b > 30) nonBlackPixels++;
    }
    previous = row;
  }

  const pixels = width * height;
  return {
    width,
    height,
    rgba,
    stats: {
      width,
      height,
      nonBlackPixels,
      nonBlackPct: pixels === 0 ? 0 : (nonBlackPixels / pixels) * 100,
      avgRgb: pixels === 0 ? 0 : sumRgb / pixels / 3,
      maxChannel,
    },
  };
}

function diffPng(before, after) {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`PNG size mismatch: ${before.width}x${before.height} vs ${after.width}x${after.height}`);
  }
  let differingPixels = 0;
  let maxChannelDelta = 0;
  let totalChannelDelta = 0;
  for (let i = 0; i < before.rgba.length; i += 4) {
    let pixelDifferent = false;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(before.rgba[i + c] - after.rgba[i + c]);
      totalChannelDelta += delta;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      if (delta > 8) pixelDifferent = true;
    }
    if (pixelDifferent) differingPixels++;
  }
  const pixels = before.width * before.height;
  return {
    width: before.width,
    height: before.height,
    pixels,
    differingPixels,
    differingPixelPct: pixels === 0 ? 0 : (differingPixels / pixels) * 100,
    maxChannelDelta,
    meanChannelDelta: before.rgba.length === 0 ? 0 : totalChannelDelta / before.rgba.length,
  };
}

function pageUrl(baseUrl, backend, extraSearch = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set('renderBackend', backend);
  for (const [key, value] of Object.entries(extraSearch)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function waitForFrames(page, frames) {
  await page.evaluate(() => {
    window.__perfSamples = [];
    window.__perfRecord = true;
  });
  await page.waitForFunction(
    (targetFrames) => (window.__perfSamples?.length ?? 0) >= targetFrames,
    frames,
    { timeout: Math.max(30000, frames * 120) },
  );
  return page.evaluate(() => {
    window.__perfRecord = false;
    return window.__perfSamples ?? [];
  });
}

function evaluateWebGpuComposeCapability(status) {
  const webgpu = status?.webgpu ?? {};
  const limits = webgpu.deviceLimits ?? {};
  const features = Array.isArray(webgpu.deviceFeatures) ? webgpu.deviceFeatures : [];
  const failures = [];
  if (status?.actual !== 'webgpu') failures.push('actual backend is not WebGPU');
  if (!Array.isArray(webgpu.deviceFeatures)) failures.push('deviceFeatures missing');
  if (webgpu.deviceLimits === null || typeof webgpu.deviceLimits !== 'object') {
    failures.push('deviceLimits missing');
  }
  for (const [key, minimum] of Object.entries(WEBGPU_COMPOSE_CAPABILITY_REQUIREMENTS)) {
    const value = limits[key];
    if (typeof value !== 'number') {
      failures.push(`${key} missing`);
    } else if (value < minimum) {
      failures.push(`${key} ${value} < ${minimum}`);
    }
  }
  if (typeof webgpu.timestampQueryAvailable !== 'boolean') {
    failures.push('timestampQueryAvailable is not reported as a boolean');
  } else if (webgpu.timestampQueryAvailable !== features.includes('timestamp-query')) {
    failures.push('timestampQueryAvailable does not match deviceFeatures');
  }
  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    requirements: WEBGPU_COMPOSE_CAPABILITY_REQUIREMENTS,
    failures,
    observed: {
      deviceFeatures: features,
      deviceLimits: webgpu.deviceLimits ?? null,
      timestampQueryAvailable: webgpu.timestampQueryAvailable ?? null,
    },
  };
}

async function runVariant(
  browser,
  baseUrl,
  {
    backend,
    postEnabled,
    label = `${backend}-${postEnabled ? 'post-on' : 'post-off'}`,
    bloomEnabled = true,
    lensEnabled = true,
    measurePerf = true,
    query = {},
  },
) {
  const page = await newBenchmarkPage(browser, { diagnosticsLabel: `webgpu-presentation-${label}` });
  page.setDefaultTimeout(30000);
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !text.includes('[vite] failed to connect to websocket')) {
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(pageUrl(baseUrl, backend, query), { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__game?.ctx?.console, null, { timeout: 30000 });
  await startConsoleTestRun(page, { seed: 777, settleMs: 900 });

  await page.evaluate(({ enabled, bloomEnabled, lensEnabled }) => {
    const ctx = window.__game.ctx;
    const w = ctx.world;
    w.clear();
    ctx.enemies.length = 0;
    ctx.projectiles.length = 0;
    ctx.shockwaves.length = 0;
    ctx.particles.clear();
    if (ctx.lightning?.arcs) ctx.lightning.arcs.length = 0;
    if (ctx.levels.current?.authoredLights) ctx.levels.current.authoredLights.length = 0;

    const Cell = {
      Sand: 1,
      Water: 2,
      Wall: 3,
      Fire: 5,
      Lava: 11,
      Stone: 12,
      Metal: 13,
      Ember: 20,
      Glowshroom: 33,
      Moss: 34,
    };
    const set = (x, y, type, color, life = 0, charge = 0) => {
      if (!w.inBounds(x, y)) return;
      const i = w.idx(x, y);
      w.types[i] = type;
      w.colors[i] = color;
      w.life[i] = life;
      w.charge[i] = charge;
    };
    const cx = 600;
    const cy = 500;
    for (let x = cx - 230; x <= cx + 230; x++) {
      for (let y = cy + 56; y <= cy + 92; y++) {
        const edge = y === cy + 56 || x % 17 < 4;
        set(x, y, edge ? Cell.Stone : Cell.Wall, edge ? 0x4d4945 : 0x251d18);
      }
    }
    for (let x = cx - 240; x <= cx + 240; x += 19) {
      for (let y = cy - 120; y <= cy + 45; y++) {
        if ((x + y) % 5 !== 0) set(x, y, Cell.Stone, 0x3b4146);
      }
    }
    for (let x = cx - 165; x <= cx - 95; x++) {
      for (let y = cy + 35; y <= cy + 55; y++) set(x, y, Cell.Water, 0x2566a6);
    }
    for (let x = cx + 90; x <= cx + 155; x++) {
      for (let y = cy + 40; y <= cy + 55; y++) set(x, y, Cell.Lava, 0xff7a18, 40);
    }
    for (let x = cx - 50; x <= cx + 45; x++) {
      for (let y = cy + 42; y <= cy + 55; y++) set(x, y, Cell.Sand, 0xb79554);
    }
    for (const [x, y, type, color, life, charge] of [
      [cx - 185, cy + 20, Cell.Fire, 0xffd36b, 40, 0],
      [cx + 124, cy + 22, Cell.Ember, 0xffad3b, 70, 0],
      [cx + 170, cy - 35, Cell.Glowshroom, 0x8fffd8, 0, 0],
      [cx - 58, cy - 64, Cell.Moss, 0x266b36, 0, 0],
      [cx + 26, cy + 30, Cell.Metal, 0xaab7c3, 0, 12],
    ]) {
      for (let dx = -5; dx <= 5; dx++) {
        for (let dy = -5; dy <= 5; dy++) {
          if (dx * dx + dy * dy <= 25) set(x + dx, y + dy, type, color, life, charge);
        }
      }
    }

    ctx.player.x = cx;
    ctx.player.y = cy + 39;
    ctx.player.fx = 0;
    ctx.player.fy = 0;
    ctx.player.vx = 0;
    ctx.player.vy = 0;
    ctx.player.hp = ctx.player.maxHp;
    ctx.player.dead = false;
    ctx.player.grounded = true;
    ctx.state.mode = 'play';
    ctx.input.mouse.x = cx + 120;
    ctx.input.mouse.y = cy;
    ctx.camera.zoomLock = 1;
    ctx.camera.zoom = 1;
    ctx.camera.setInspectionFocus(cx, cy, { snap: true });
    ctx.camera.updateSimBounds(w);

    ctx.state.postFx.gpuCompose = false;
    ctx.state.postFx.enabled = enabled;
    ctx.state.postFx.bloomEnabled = enabled && bloomEnabled;
    ctx.state.postFx.lensEnabled = enabled && lensEnabled;
    ctx.state.postFx.grain = 0;
    ctx.fx.bloomKick = 0;
    ctx.fx.screenShake = 0;
    ctx.player.hp = ctx.player.maxHp;
    ctx.state.paused = true;
  }, { enabled: postEnabled, bloomEnabled, lensEnabled });

  await page.waitForFunction(
    (expectedBackend) => {
      const status = window.__game?.getRenderBackendStatus?.();
      if (!status) return false;
      if (expectedBackend === 'webgpu') {
        return status.implementation === 'WebGPURenderBackend' && status.health !== 'recovering';
      }
      return status.implementation === 'WebGLRenderBackend' && status.actual === 'webgl2';
    },
    backend,
    { timeout: 30000 },
  );

  await page.waitForTimeout(500);
  const screenshotPath = join(outDir, `${label}-${timestamp}.png`);
  const pngBuffer = await page.locator('#canvas-holder > canvas').screenshot({ path: screenshotPath });
  const png = decodePng(pngBuffer);

  let summary = null;
  if (measurePerf) {
    await page.evaluate(() => {
      window.__game.ctx.state.paused = false;
    });
    await page.waitForTimeout(300);
    const samples = await waitForFrames(page, PERF_FRAMES);
    summary = summarizeBuckets({
      sim: samples.map((sample) => sample.sim),
      entities: samples.map((sample) => sample.entities),
      compose: samples.map((sample) => sample.compose),
      gl: samples.map((sample) => sample.gl),
      render: samples.map((sample) => sample.render),
      frame: samples.map((sample) => sample.frame),
    });
  }

  const status = await page.evaluate(() => window.__game.getRenderBackendStatus());
  const identity = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const holder = document.getElementById('canvas-holder');
    const canvases = Array.from(holder?.children ?? []).filter((child) => child instanceof HTMLCanvasElement);
    const canvas = canvases[0] ?? null;
    canvas?.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: Math.max(1, canvas.getBoundingClientRect().left + 10),
      clientY: Math.max(1, canvas.getBoundingClientRect().top + 10),
    }));
    return {
      mode: ctx.state.mode,
      renderBackend: ctx.state.render.backend,
      holderConnected: holder?.isConnected === true,
      holderCanvasCount: canvases.length,
      canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
      mouseFinite: Number.isFinite(ctx.input.mouse.x) && Number.isFinite(ctx.input.mouse.y),
    };
  });

  await page.context().close();

  return {
    label,
    backend,
    postEnabled,
    status,
    identity,
    perf: measurePerf ? { frames: PERF_FRAMES, summary } : null,
    screenshot: { path: screenshotPath, stats: png.stats },
    png,
    consoleErrors,
    pageErrors,
  };
}

async function runFallbackProbe(browser, baseUrl) {
  const page = await newBenchmarkPage(browser, { diagnosticsLabel: 'webgpu-presentation-fallback' });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !text.includes('[vite] failed to connect to websocket')) {
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(pageUrl(baseUrl, 'webgpu', { simulateWebGpuInitFailure: 1 }), {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForFunction(() => window.__game?.ctx?.console, null, { timeout: 30000 });
  await page.waitForFunction(
    () => {
      const status = window.__game?.getRenderBackendStatus?.();
      return status?.implementation === 'WebGLRenderBackend' && status.actual === 'webgl2';
    },
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(500);
  const status = await page.evaluate(() => window.__game.getRenderBackendStatus());
  const identity = await page.evaluate(() => {
    const ctx = window.__game.ctx;
    const holder = document.getElementById('canvas-holder');
    const canvases = Array.from(holder?.children ?? []).filter((child) => child instanceof HTMLCanvasElement);
    const canvas = canvases[0] ?? null;
    canvas?.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: Math.max(1, canvas.getBoundingClientRect().left + 10),
      clientY: Math.max(1, canvas.getBoundingClientRect().top + 10),
    }));
    return {
      holderConnected: holder?.isConnected === true,
      holderCanvasCount: canvases.length,
      canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
      mouseFinite: Number.isFinite(ctx.input.mouse.x) && Number.isFinite(ctx.input.mouse.y),
    };
  });
  const screenshotPath = join(outDir, `webgpu-init-fallback-${timestamp}.png`);
  const pngBuffer = await page.locator('#canvas-holder > canvas').screenshot({ path: screenshotPath });
  const png = decodePng(pngBuffer);
  await page.context().close();
  return {
    status,
    identity,
    screenshot: { path: screenshotPath, stats: png.stats },
    consoleErrors,
    pageErrors,
  };
}

let viteServer = null;
let browser = null;
let payload = null;

try {
  const serverInfo = providedBaseUrl
    ? { server: null, baseUrl: normalizeBaseUrl(providedBaseUrl) }
    : await startViteServer();
  viteServer = serverInfo.server;
  const baseUrl = normalizeBaseUrl(serverInfo.baseUrl);
  mkdirSync(outDir, { recursive: true });
  browser = await chromium.launch({ channel: 'msedge', headless: true });

  const webglOff = await runVariant(browser, baseUrl, { backend: 'webgl', postEnabled: false });
  const webgpuOff = await runVariant(browser, baseUrl, { backend: 'webgpu', postEnabled: false });
  const webglOn = await runVariant(browser, baseUrl, { backend: 'webgl', postEnabled: true });
  const webgpuOn = await runVariant(browser, baseUrl, { backend: 'webgpu', postEnabled: true });
  const webgpuLensOff = await runVariant(browser, baseUrl, {
    backend: 'webgpu',
    postEnabled: true,
    label: 'webgpu-bloom-on-lens-off',
    lensEnabled: false,
    measurePerf: false,
  });
  const fallbackProbe = await runFallbackProbe(browser, baseUrl);

  const postOffDiff = diffPng(webglOff.png, webgpuOff.png);
  const postOnDiff = diffPng(webglOn.png, webgpuOn.png);
  const presentation = {
    postOffGlMean: {
      webgl: webglOff.perf.summary.gl.mean,
      webgpu: webgpuOff.perf.summary.gl.mean,
      pct:
        webglOff.perf.summary.gl.mean === 0
          ? 0
          : ((webgpuOff.perf.summary.gl.mean - webglOff.perf.summary.gl.mean) /
              webglOff.perf.summary.gl.mean) *
            100,
    },
    postOnGlMean: {
      webgl: webglOn.perf.summary.gl.mean,
      webgpu: webgpuOn.perf.summary.gl.mean,
      pct:
        webglOn.perf.summary.gl.mean === 0
          ? 0
          : ((webgpuOn.perf.summary.gl.mean - webglOn.perf.summary.gl.mean) /
              webglOn.perf.summary.gl.mean) *
            100,
    },
  };
  const composeCapabilityGate = evaluateWebGpuComposeCapability(webgpuOff.status);

  const variants = [webglOff, webgpuOff, webglOn, webgpuOn].map(({ png: _png, ...variant }) => variant);
  const postControls = {
    lensOffBloomOn: {
      label: webgpuLensOff.label,
      status: webgpuLensOff.status,
      identity: webgpuLensOff.identity,
      screenshot: webgpuLensOff.screenshot,
      consoleErrors: webgpuLensOff.consoleErrors,
      pageErrors: webgpuLensOff.pageErrors,
    },
  };
  const failures = [];
  const warnings = [];
  const expectedCanvas = {
    width: webglOff.status.canvas.width,
    height: webglOff.status.canvas.height,
  };
  for (const variant of [webglOff, webgpuOff, webglOn, webgpuOn]) {
    if (variant.consoleErrors.length > 0) failures.push(`${variant.label}: console errors`);
    if (variant.pageErrors.length > 0) failures.push(`${variant.label}: page errors`);
    if (variant.status.canvas.width !== expectedCanvas.width || variant.status.canvas.height !== expectedCanvas.height) {
      failures.push(
        `${variant.label}: unexpected canvas size ${variant.status.canvas.width}x${variant.status.canvas.height}; ` +
          `expected ${expectedCanvas.width}x${expectedCanvas.height}`,
      );
    }
    if (variant.identity.holderCanvasCount !== 1 || !variant.identity.holderConnected) {
      failures.push(`${variant.label}: canvas-holder ownership changed`);
    }
    if (!variant.identity.mouseFinite) failures.push(`${variant.label}: mouse state invalid`);
    if (variant.screenshot.stats.nonBlackPixels <= 0 || variant.screenshot.stats.maxChannel <= 32) {
      failures.push(`${variant.label}: screenshot is blank`);
    }
  }
  if (webgpuOff.status.actual !== 'webgpu' || webgpuOn.status.actual !== 'webgpu') {
    failures.push('WebGPU variants did not report actual WebGPU backend');
  }
  if (composeCapabilityGate.status !== 'passed') {
    failures.push(`WebGPU compose capability gate failed: ${composeCapabilityGate.failures.join('; ')}`);
  }
  if (fallbackProbe.status.actual !== 'webgl2' || fallbackProbe.status.implementation !== 'WebGLRenderBackend') {
    failures.push('simulated WebGPU init failure did not fall back to WebGL2');
  }
  if (!fallbackProbe.status.fallback || !fallbackProbe.status.reason.includes('webgpu-init-failed')) {
    failures.push('simulated WebGPU init fallback did not report fallback reason');
  }
  if (fallbackProbe.identity.holderCanvasCount !== 1 || !fallbackProbe.identity.mouseFinite) {
    failures.push('simulated WebGPU init fallback did not preserve canvas/input ownership');
  }
  if (fallbackProbe.screenshot.stats.nonBlackPixels <= 0 || fallbackProbe.screenshot.stats.maxChannel <= 32) {
    failures.push('simulated WebGPU init fallback screenshot is blank');
  }
  if (webgpuLensOff.status.actual !== 'webgpu') {
    failures.push('WebGPU lens-off control variant did not report actual WebGPU backend');
  }
  if (webgpuLensOff.screenshot.stats.avgRgb <= webgpuOff.screenshot.stats.avgRgb + 0.25) {
    failures.push('WebGPU lens-off control appears to suppress bloom/exposure');
  }
  if (postOffDiff.meanChannelDelta > 6 || postOffDiff.differingPixelPct > 25) {
    failures.push('post-off WebGPU screenshot diverged beyond tolerance');
  }
  if (postOnDiff.meanChannelDelta > 12) {
    failures.push('post-on WebGPU screenshot diverged beyond tolerance');
  }
  if (postOnDiff.differingPixelPct > 45) {
    failures.push('post-on WebGPU screenshot changed more than 45% of pixels');
  }
  if (presentation.postOffGlMean.pct > 20) {
    warnings.push('post-off no-post WebGPU path is slower than WebGL; WebGPU shell remains boot-gated');
  }
  if (presentation.postOnGlMean.pct > 20) {
    failures.push('WebGPU post-on presentation gl bucket regressed by more than 20%');
  }

  payload = {
    status: failures.length === 0 ? 'passed' : 'failed',
    commit: currentGitCommit(),
    git: currentGitState(),
    command: currentCommandLine(),
    generatedAt: new Date().toISOString(),
    baseUrl,
    variants,
    postControls,
    fallbackProbe,
    composeCapabilityGate,
    diffs: { postOff: postOffDiff, postOn: postOnDiff },
    presentation,
    failures,
    warnings,
    phase3Files: [
      'src/render/WebGpuRenderBackend.ts',
      'src/render/Renderer.ts',
      'src/game/Game.ts',
      'scripts/probe-webgpu-presentation.mjs',
      'docs/WEBGPU-PRESENTATION-CONTRACT.md',
      'docs/WEBGPU-BENCHMARK-LEDGER.md',
      'docs/WEBGPU-TSL-COMPUTE-IMPLEMENTATION-PLAN.md',
    ],
    phase4_1Files: [
      'docs/WEBGPU-COMPOSE-ABI.md',
      'src/render/pixels.ts',
      'src/render/WebGpuRenderBackend.ts',
      'scripts/probe-webgpu-presentation.mjs',
    ],
  };

  const jsonPath = join(outDir, `probe-${timestamp}.json`);
  writeJson(jsonPath, payload);
  payload.artifacts = {
    json: jsonPath,
    screenshots: [
      ...variants.map((variant) => variant.screenshot.path),
      postControls.lensOffBloomOn.screenshot.path,
      fallbackProbe.screenshot.path,
    ],
  };
  console.log(JSON.stringify(payload, null, 2));
  if (payload.status !== 'passed') throw new Error('WebGPU presentation probe failed');
} catch (error) {
  const failedPath = join(outDir, `probe-${timestamp}-failed.json`);
  writeJson(failedPath, {
    status: 'failed',
    commit: currentGitCommit(),
    git: currentGitState(),
    command: currentCommandLine(),
    generatedAt: new Date().toISOString(),
    payload,
    error: {
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    },
  });
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (viteServer) await viteServer.close();
}

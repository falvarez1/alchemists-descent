// Phase 4.11 live WebGPU compose probe.
// Boots the real game with WebGPURenderer, enables the raw WGSL
// compose path, and compares a frozen CPU-compose frame against a frozen
// WebGPU-compose frame. Half-float storage preserves HDR compose values, but a
// one-channel readback delta is accepted for presentation quantization.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

import {
  captureCanvasPng,
  currentCommandLine,
  currentGitCommit,
  currentGitState,
  writeJson,
} from './perf-harness.mjs';

const outDir = 'verify-out/webgpu-live-compose';
const timestamp = Date.now();
const providedBaseUrl = process.argv[2] ?? null;
const COMPOSE_PAD = 64;
const PARAM_BYTES = 160 * 4;

function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function composeDimensions(status) {
  const storage = status?.webgpu?.compose?.outputStorage;
  const viewW = storage?.width;
  const viewH = storage?.height;
  if (!Number.isFinite(viewW) || !Number.isFinite(viewH)) return null;
  return {
    viewW,
    viewH,
    winW: viewW + COMPOSE_PAD * 2,
    winH: viewH + COMPOSE_PAD * 2,
    lightW: (viewW >> 1) + 1,
    lightH: (viewH >> 1) + 1,
  };
}

async function startViteServer() {
  const server = await createServer({
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 5206,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5206;
  return { server, baseUrl: `http://127.0.0.1:${port}/` };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function liveComposeUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set('renderBackend', 'webgpu');
  url.searchParams.set('enableWebGpuLiveCompose', '1');
  return url.toString();
}

function validateStatus(status) {
  const failures = [];
  const compose = status?.webgpu?.compose;
  const storage = compose?.outputStorage;

  if (status?.implementation !== 'WebGPURenderBackend') {
    failures.push(`expected WebGPURenderBackend, got ${status?.implementation ?? 'missing'}`);
  }
  if (status?.actual !== 'webgpu') {
    failures.push(`expected actual WebGPU backend, got ${status?.actual ?? 'missing'}`);
  }
  if (status?.health !== 'active') {
    failures.push(`expected active backend, got ${status?.health ?? 'missing'}`);
  }
  if (status?.features?.compose !== true) {
    failures.push(`expected render.compose feature flag true, got ${status?.features?.compose ?? 'missing'}`);
  }
  if (compose?.bridge !== 'validated') {
    failures.push(`expected validated live compose bridge, got ${compose?.bridge ?? 'missing'}`);
  }
  if (compose?.productionAvailable !== false) {
    failures.push('live compose productionAvailable must remain false while query-gated');
  }
  if (!storage) {
    failures.push('live compose outputStorage metadata missing');
  } else {
    if (storage.format !== 'rgba16float') failures.push(`expected rgba16float storage, got ${storage.format}`);
    if (!Number.isFinite(storage.width) || !Number.isFinite(storage.height) || storage.width <= 0 || storage.height <= 0) {
      failures.push(`expected positive storage dimensions, got ${storage.width}x${storage.height}`);
    }
    if (storage.mipLevelCount !== 1) failures.push(`expected one mip level, got ${storage.mipLevelCount}`);
  }
  return failures;
}

function validateLiveMetrics(status) {
  const failures = [];
  const metrics = status?.webgpu?.compose?.liveMetrics;
  const dims = composeDimensions(status);
  if (!metrics) {
    failures.push('live compose metrics missing after GPU-composed frame');
    return failures;
  }
  if (!dims) {
    failures.push('live compose storage dimensions missing for metrics validation');
    return failures;
  }

  const expectedWorldLogical = dims.winW * dims.winH * 4;
  const expectedWorldSubmitted = align(dims.winW * 4, 256) * dims.winH;
  const expectedVisibleWorldLogical = dims.viewW * (dims.viewH + 1) * 4;
  const expectedVisibleWorldSubmitted = align(dims.viewW * 4, 256) * (dims.viewH + 1);
  const expectedOverlayLogical = dims.viewW * dims.viewH * 8;
  const expectedOverlaySubmitted = align(dims.viewW * 8, 256) * dims.viewH;
  const expectedLightLogical = dims.lightW * dims.lightH * 16;
  const expectedLightSubmitted = align(dims.lightW * 16, 256) * dims.lightH;
  const expectedLutBytes = 256 * 4;

  const finiteNonNegative = [
    'beginFrameCpuMs',
    'commitCpuMs',
    'packWindowCpuMs',
    'worldWindowUploadCpuMs',
    'lightPackCpuMs',
    'lightUploadCpuMs',
    'lutPackCpuMs',
    'lutUploadCpuMs',
    'paramsUploadCpuMs',
    'overlayPackCpuMs',
    'overlayUploadCpuMs',
    'commandEncodeSubmitCpuMs',
  ];
  for (const key of finiteNonNegative) {
    if (!Number.isFinite(metrics[key]) || metrics[key] < 0) {
      failures.push(`live metrics ${key} must be finite and >= 0, got ${metrics[key]}`);
    }
  }

  if (metrics.outputPixels !== dims.viewW * dims.viewH) {
    failures.push(`live metrics outputPixels expected ${dims.viewW * dims.viewH}, got ${metrics.outputPixels}`);
  }
  if (metrics.dispatchWorkgroupsX !== Math.ceil(dims.viewW / 8)) {
    failures.push(`live metrics dispatchWorkgroupsX expected ${Math.ceil(dims.viewW / 8)}, got ${metrics.dispatchWorkgroupsX}`);
  }
  if (metrics.dispatchWorkgroupsY !== Math.ceil(dims.viewH / 8)) {
    failures.push(`live metrics dispatchWorkgroupsY expected ${Math.ceil(dims.viewH / 8)}, got ${metrics.dispatchWorkgroupsY}`);
  }
  const worldUploadMatches =
    (metrics.worldWindowLogicalUploadBytes === expectedVisibleWorldLogical &&
      metrics.worldWindowSubmittedUploadBytes === expectedVisibleWorldSubmitted) ||
    (metrics.worldWindowLogicalUploadBytes === expectedWorldLogical &&
      metrics.worldWindowSubmittedUploadBytes === expectedWorldSubmitted);
  if (!worldUploadMatches) {
    failures.push(
      `live metrics world bytes expected visible ${expectedVisibleWorldLogical}/${expectedVisibleWorldSubmitted} ` +
        `or full ${expectedWorldLogical}/${expectedWorldSubmitted}, got ` +
        `${metrics.worldWindowLogicalUploadBytes}/${metrics.worldWindowSubmittedUploadBytes}`,
    );
  }
  if (metrics.packWindowBytes !== metrics.worldWindowLogicalUploadBytes) {
    failures.push(
      `live metrics packWindowBytes ${metrics.packWindowBytes} should match world logical upload ${metrics.worldWindowLogicalUploadBytes}`,
    );
  }
  const overlayUploadMatches =
    (metrics.overlayLogicalUploadBytes === 0 && metrics.overlaySubmittedUploadBytes === 0) ||
    (metrics.overlayLogicalUploadBytes > 0 &&
      metrics.overlayLogicalUploadBytes <= expectedOverlayLogical &&
      metrics.overlaySubmittedUploadBytes >= metrics.overlayLogicalUploadBytes &&
      metrics.overlaySubmittedUploadBytes <= expectedOverlaySubmitted);
  if (!overlayUploadMatches) {
    failures.push(
      `live metrics overlay bytes expected 0/0 or <= full ${expectedOverlayLogical}/${expectedOverlaySubmitted}, got ` +
        `${metrics.overlayLogicalUploadBytes}/${metrics.overlaySubmittedUploadBytes}`,
    );
  }
  if (
    metrics.overlayLogicalUploadBytes > 0 &&
    metrics.overlayLogicalUploadBytes < expectedOverlayLogical &&
    metrics.overlaySubmittedUploadBytes >= expectedOverlaySubmitted
  ) {
    failures.push(
      `live metrics sparse overlay upload submitted ${metrics.overlaySubmittedUploadBytes} bytes; expected below full ${expectedOverlaySubmitted}`,
    );
  }
  if (
    metrics.overlayTouchedPixels > 0 &&
    metrics.overlayTouchedPixels <= 4096 &&
    metrics.overlayLogicalUploadBytes >= expectedOverlayLogical
  ) {
    failures.push(
      `live metrics sparse overlay frame touched ${metrics.overlayTouchedPixels} pixels but uploaded full overlay ${metrics.overlayLogicalUploadBytes} bytes`,
    );
  }
  const lutUploadMatches =
    (metrics.lutLogicalUploadBytes === 0 && metrics.lutSubmittedUploadBytes === 0) ||
    (metrics.lutLogicalUploadBytes === expectedLutBytes && metrics.lutSubmittedUploadBytes === expectedLutBytes);
  if (!lutUploadMatches) {
    failures.push(
      `live metrics LUT bytes expected 0/0 or ${expectedLutBytes}/${expectedLutBytes}, got logical=${metrics.lutLogicalUploadBytes} submitted=${metrics.lutSubmittedUploadBytes}`,
    );
  }
  if (metrics.paramsUploadBytes !== PARAM_BYTES) {
    failures.push(`live metrics params bytes expected ${PARAM_BYTES}, got ${metrics.paramsUploadBytes}`);
  }
  if (metrics.lightUploadedThisFrame) {
    if (metrics.lightLogicalUploadBytes !== expectedLightLogical) {
      failures.push(`live metrics light logical bytes expected ${expectedLightLogical}, got ${metrics.lightLogicalUploadBytes}`);
    }
    if (metrics.lightSubmittedUploadBytes !== expectedLightSubmitted) {
      failures.push(`live metrics light submitted bytes expected ${expectedLightSubmitted}, got ${metrics.lightSubmittedUploadBytes}`);
    }
  } else if (metrics.lightLogicalUploadBytes !== 0 || metrics.lightSubmittedUploadBytes !== 0) {
    failures.push(
      `live metrics light bytes should be 0 when lightUploadedThisFrame=false, got ` +
        `${metrics.lightLogicalUploadBytes}/${metrics.lightSubmittedUploadBytes}`,
    );
  }
  if (metrics.backdropSubmittedUploadBytes < metrics.backdropLogicalUploadBytes) {
    failures.push(
      `live metrics backdrop submitted bytes ${metrics.backdropSubmittedUploadBytes} below logical ${metrics.backdropLogicalUploadBytes}`,
    );
  }
  const expectedTotalLogical =
    metrics.worldWindowLogicalUploadBytes +
    metrics.lightLogicalUploadBytes +
    metrics.lutLogicalUploadBytes +
    metrics.paramsUploadBytes +
    metrics.backdropLogicalUploadBytes +
    metrics.overlayLogicalUploadBytes;
  const expectedTotalSubmitted =
    metrics.worldWindowSubmittedUploadBytes +
    metrics.lightSubmittedUploadBytes +
    metrics.lutSubmittedUploadBytes +
    metrics.paramsUploadBytes +
    metrics.backdropSubmittedUploadBytes +
    metrics.overlaySubmittedUploadBytes;
  if (metrics.totalLogicalUploadBytes !== expectedTotalLogical) {
    failures.push(`live metrics total logical bytes expected ${expectedTotalLogical}, got ${metrics.totalLogicalUploadBytes}`);
  }
  if (metrics.totalSubmittedUploadBytes !== expectedTotalSubmitted) {
    failures.push(`live metrics total submitted bytes expected ${expectedTotalSubmitted}, got ${metrics.totalSubmittedUploadBytes}`);
  }
  if (metrics.totalSubmittedUploadBytes < metrics.totalLogicalUploadBytes) {
    failures.push('live metrics submitted bytes should be >= logical bytes');
  }

  return failures;
}

function validateToggle(probe) {
  const failures = [];
  if (!probe?.exists) {
    failures.push('WGSL header toggle missing');
    return failures;
  }
  if (probe.label !== 'WGSL') failures.push(`expected WGSL toggle label, got ${probe.label}`);
  if (probe.before.compose !== true) failures.push('WGSL toggle should boot with render.compose=true from query seed');
  if (probe.before.lit !== true) failures.push('WGSL toggle should be lit on boot');
  if (probe.before.aria !== 'true') failures.push(`WGSL toggle aria before should be true, got ${probe.before.aria}`);
  if (probe.off.compose !== false) failures.push('WGSL toggle did not set render.compose=false');
  if (probe.off.lit !== false) failures.push('WGSL toggle stayed lit after disabling');
  if (probe.off.aria !== 'false') failures.push(`WGSL toggle aria after off should be false, got ${probe.off.aria}`);
  if (probe.off.status?.features?.compose !== false) {
    failures.push(`backend status did not report compose=false after off: ${probe.off.status?.features?.compose}`);
  }
  if (probe.on.compose !== true) failures.push('WGSL toggle did not restore render.compose=true');
  if (probe.on.lit !== true) failures.push('WGSL toggle not lit after re-enabling');
  if (probe.on.aria !== 'true') failures.push(`WGSL toggle aria after on should be true, got ${probe.on.aria}`);
  if (probe.on.status?.features?.compose !== true) {
    failures.push(`backend status did not report compose=true after on: ${probe.on.status?.features?.compose}`);
  }
  if (probe.on.status?.webgpu?.compose?.bridge !== 'validated') {
    failures.push(`live compose bridge not validated after toggle on: ${probe.on.status?.webgpu?.compose?.bridge}`);
  }
  return failures;
}

function validateBootstrap(probe) {
  const failures = [];
  if (!probe?.exists) {
    failures.push('WGSL bootstrap toggle missing on default boot');
    return failures;
  }
  if (probe.before.backend !== 'webgl') {
    failures.push(`WGSL bootstrap should start from webgl backend, got ${probe.before.backend}`);
  }
  if (probe.before.compose !== false) {
    failures.push(`WGSL bootstrap should start with render.compose=false, got ${probe.before.compose}`);
  }
  if (probe.before.lit !== false) {
    failures.push('WGSL bootstrap should start unlit on default boot');
  }
  if (probe.after.backend !== 'webgpu') {
    failures.push(`WGSL bootstrap should reload with render.backend=webgpu, got ${probe.after.backend}`);
  }
  if (probe.after.compose !== true) {
    failures.push(`WGSL bootstrap should reload with render.compose=true, got ${probe.after.compose}`);
  }
  if (probe.after.lit !== true) {
    failures.push('WGSL bootstrap should be lit after reload');
  }
  if (!probe.after.url?.includes('renderBackend=webgpu')) {
    failures.push(`WGSL bootstrap URL missing renderBackend=webgpu: ${probe.after.url}`);
  }
  if (!probe.after.url?.includes('enableWebGpuLiveCompose=1')) {
    failures.push(`WGSL bootstrap URL missing enableWebGpuLiveCompose=1: ${probe.after.url}`);
  }
  if (probe.after.status?.actual !== 'webgpu') {
    failures.push(`WGSL bootstrap status should be actual WebGPU, got ${probe.after.status?.actual}`);
  }
  return failures;
}

function validateVisual(result) {
  const failures = [];
  const staticDiff = result?.staticDiff;
  const postFxDiff = result?.postFxDiff;
  const lava = result?.lava;
  const disabledComposeProbe = result?.disabledComposeProbe;

  if (!staticDiff) {
    failures.push('staticDiff missing');
  } else {
    if (staticDiff.maxd > 1) failures.push(`static maxd ${staticDiff.maxd} > 1`);
    if (staticDiff.bigPct !== 0) failures.push(`static bigPct ${staticDiff.bigPct} > 0`);
    if (staticDiff.meand > 0.02) failures.push(`static meand ${staticDiff.meand} > 0.02`);
    if (staticDiff.exactPct < 95) failures.push(`static exactPct ${staticDiff.exactPct} < 95`);
  }

  if (!postFxDiff) {
    failures.push('postFxDiff missing');
  } else {
    if (postFxDiff.bigPct > 2) failures.push(`postFx bigPct ${postFxDiff.bigPct} > 2`);
    if (postFxDiff.meand > 0.5) failures.push(`postFx meand ${postFxDiff.meand} > 0.5`);
  }

  if (!lava) {
    failures.push('lava brightness sample missing');
  } else {
    const redDev = Math.abs(lava.gpu.mean[0] - lava.cpu.mean[0]) / Math.max(1, lava.cpu.mean[0]);
    const greenDev = Math.abs(lava.gpu.mean[1] - lava.cpu.mean[1]) / Math.max(1, lava.cpu.mean[1]);
    if (redDev > 0.04) failures.push(`lava red mean deviation ${(redDev * 100).toFixed(2)}% > 4%`);
    if (greenDev > 0.04) failures.push(`lava green mean deviation ${(greenDev * 100).toFixed(2)}% > 4%`);
  }

  if (!disabledComposeProbe) {
    failures.push('disabled compose fallback probe missing');
  } else {
    if (disabledComposeProbe.renderCompose !== false) {
      failures.push(`disabled compose probe expected render.compose=false, got ${disabledComposeProbe.renderCompose}`);
    }
    if (disabledComposeProbe.postFxStayedOn !== true) {
      failures.push('disabled compose fallback flipped postFx.gpuCompose off');
    }
    if (disabledComposeProbe.status?.features?.compose !== false) {
      failures.push(`disabled compose status should report compose=false, got ${disabledComposeProbe.status?.features?.compose}`);
    }
  }

  return failures;
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
  const url = liveComposeUrl(baseUrl);
  mkdirSync(outDir, { recursive: true });

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  page.on('console', (message) => {
    const text = message.text();
    const noisyFavicon =
      (text.includes('favicon') && text.includes('404')) ||
      (text.includes('Failed to load resource') && text.includes('404'));
    const noisyPowerPreference = text.includes('powerPreference option is currently ignored');
    const noisyViteSocket = text.includes('[vite] failed to connect to websocket');
    const noisyDeprecatedInit = text.includes('using deprecated parameters for the initialization function');
    if (noisyFavicon || noisyPowerPreference || noisyViteSocket || noisyDeprecatedInit) return;
    if (message.type() === 'error') consoleErrors.push(text);
    if (message.type() === 'warning') consoleWarnings.push(text);
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  const bootstrapUrl = new URL(baseUrl);
  bootstrapUrl.searchParams.delete('renderBackend');
  bootstrapUrl.searchParams.delete('enableWebGpuLiveCompose');
  await page.goto(bootstrapUrl.toString(), { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__game?.ctx, null, { timeout: 30000 });
  const bootstrapProbe = await page.evaluate(() => {
    const button = document.getElementById('webgpu-compose-toggle');
    const ctx = window.__game.ctx;
    if (!button) return { exists: false };
    const before = {
      url: window.location.href,
      backend: ctx.state.render.backend,
      compose: ctx.state.render.compose,
      lit: button.classList.contains('lit'),
      aria: button.getAttribute('aria-pressed'),
    };
    button.click();
    return {
      exists: true,
      label: button.textContent?.trim() ?? '',
      before,
    };
  });
  await page.waitForURL((currentUrl) => {
    const params = currentUrl.searchParams;
    return params.get('renderBackend') === 'webgpu' && params.get('enableWebGpuLiveCompose') === '1';
  }, { timeout: 30000 });
  await page.waitForFunction(() => window.__game?.ctx, null, { timeout: 30000 });
  await page.waitForFunction(
    () => {
      const ctx = window.__game?.ctx;
      const button = document.getElementById('webgpu-compose-toggle');
      const status = window.__game?.getRenderBackendStatus?.();
      return (
        ctx?.state?.render?.backend === 'webgpu' &&
        ctx.state.render.compose === true &&
        button?.classList.contains('lit') &&
        status?.implementation === 'WebGPURenderBackend' &&
        status.health !== 'recovering'
      );
    },
    null,
    { timeout: 30000 },
  );
  bootstrapProbe.after = await page.evaluate(() => {
    const button = document.getElementById('webgpu-compose-toggle');
    const ctx = window.__game.ctx;
    return {
      url: window.location.href,
      backend: ctx.state.render.backend,
      compose: ctx.state.render.compose,
      lit: button?.classList.contains('lit') ?? false,
      aria: button?.getAttribute('aria-pressed') ?? null,
      status: window.__game.getRenderBackendStatus(),
    };
  });
  await page.waitForTimeout(2500);
  await page.waitForFunction(
    () => {
      const status = window.__game?.getRenderBackendStatus?.();
      return (
        status?.implementation === 'WebGPURenderBackend' &&
        status.health !== 'recovering' &&
        status.webgpu?.compose?.bridge !== 'initializing'
      );
    },
    null,
    { timeout: 30000 },
  );

  const beforeStatus = await page.evaluate(() => window.__game.getRenderBackendStatus());
  const toggleProbe = await page.evaluate(async () => {
    const button = document.getElementById('webgpu-compose-toggle');
    const ctx = window.__game.ctx;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    if (!button) return { exists: false };
    const state = () => ({
      compose: ctx.state.render.compose,
      lit: button.classList.contains('lit'),
      aria: button.getAttribute('aria-pressed'),
    });
    const before = state();
    button.click();
    await wait(250);
    const off = { ...state(), status: window.__game.getRenderBackendStatus() };
    button.click();
    await wait(250);
    const on = { ...state(), status: window.__game.getRenderBackendStatus() };
    return {
      exists: true,
      label: button.textContent?.trim() ?? '',
      before,
      off,
      on,
    };
  });
  const visual = await page.evaluate(async () => {
    const ctx = window.__game.ctx;
    const world = ctx.world;
    const width = world.width;

    let frozenFrame = 1000;
    let frameStore = ctx.state.frameCount;
    Object.defineProperty(ctx.state, 'frameCount', {
      configurable: true,
      get: () => frozenFrame,
      set: (value) => {
        frameStore = value;
      },
    });
    void frameStore;

    ctx.state.paused = true;
    ctx.state.mode = 'build';
    ctx.state.playtestSource = null;
    ctx.state.postFx.enabled = false;
    ctx.state.postFx.gpuCompose = false;
    ctx.enemies.length = 0;
    ctx.projectiles.length = 0;
    ctx.shockwaves.length = 0;
    ctx.particles.clear();
    ctx.lightning.clear();
    ctx.fx.screenShake = 0;
    ctx.fx.bloomKick = 0;
    ctx.fx.digBeam = null;

    const originalRandom = Math.random;
    Math.random = () => 0.5;
    window.__composeFlickerMid = true;

    ctx.camera.snapTo(700, 480);
    ctx.camera.zoom = 1;
    ctx.camera.zoomLock = null;
    const camX = ctx.camera.renderX;
    const camY = ctx.camera.renderY;

    const paint = (vx0, vy0, vx1, vy1, type, color, life = 0) => {
      for (let vy = vy0; vy <= vy1; vy++) {
        for (let vx = vx0; vx <= vx1; vx++) {
          const x = camX + vx;
          const y = camY + vy;
          if (!world.inBounds(x, y)) continue;
          const i = x + y * width;
          world.types[i] = type;
          world.colors[i] = color;
          world.life[i] = life;
          world.charge[i] = 0;
        }
      }
    };

    paint(10, 10, 160, 120, 0, 0x08080c);
    paint(20, 200, 80, 260, 12, 0x606870);
    paint(90, 200, 130, 260, 13, 0x607080);
    paint(140, 220, 160, 240, 17, 0xd9b54a);
    paint(180, 200, 220, 240, 29, 0x7fd4e8);
    paint(230, 200, 260, 230, 33, 0x59d98f);
    paint(270, 200, 300, 215, 34, 0x3f7a4f);
    paint(270, 216, 300, 230, 15, 0x2e6b3a);
    paint(270, 231, 300, 245, 30, 0x6fae5d);
    for (let vy = 210; vy <= 220; vy++) {
      for (let vx = 100; vx <= 110; vx++) {
        world.charge[camX + vx + (camY + vy) * width] = 9;
      }
    }
    paint(320, 200, 370, 245, 13, 0x607080);
    paint(321, 201, 369, 214, 0, 0x08080c);
    paint(321, 215, 369, 244, 2, 0x1e8ce6);
    paint(380, 200, 430, 245, 13, 0x607080);
    paint(381, 210, 429, 244, 11, 0xfc3c08);
    paint(440, 210, 460, 230, 5, 0xff9632, 30000);
    paint(470, 210, 490, 230, 20, 0xff6420, 30000);

    const canvas = document.querySelector('#canvas-holder > canvas');
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const g = probe.getContext('2d', { willReadFrequently: true });
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const capture = () =>
      new Promise((resolve, reject) => {
        const tryOnce = (attempt) => {
          if (attempt > 60) return reject(new Error('capture: 60 black frames'));
          requestAnimationFrame(() => {
            g.drawImage(canvas, 0, 0);
            const data = g.getImageData(0, 0, probe.width, probe.height).data;
            let sum = 0;
            for (let i = 0; i < data.length; i += 16004) sum += data[i] + data[i + 1] + data[i + 2];
            if (sum > 50) resolve(data);
            else tryOnce(attempt + 1);
          });
        };
        tryOnce(0);
      });
    const captureRect = (x, y, w, h) =>
      new Promise((resolve, reject) => {
        const tryOnce = (attempt) => {
          if (attempt > 60) return reject(new Error('captureRect: 60 black frames'));
          requestAnimationFrame(() => {
            g.drawImage(canvas, 0, 0);
            const data = g.getImageData(x, y, w, h).data;
            let sum = 0;
            for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
            if (sum > 50) resolve(data);
            else tryOnce(attempt + 1);
          });
        };
        tryOnce(0);
      });
    const diff = (a, b) => {
      let exact = 0;
      let maxd = 0;
      let sumd = 0;
      let big = 0;
      const n = a.length;
      for (let i = 0; i < n; i += 4) {
        const d0 = Math.abs(a[i] - b[i]);
        const d1 = Math.abs(a[i + 1] - b[i + 1]);
        const d2 = Math.abs(a[i + 2] - b[i + 2]);
        const m = Math.max(d0, d1, d2);
        if (m === 0) exact++;
        if (m > maxd) maxd = m;
        if (m > 2) big++;
        sumd += d0 + d1 + d2;
      }
      const pixels = n / 4;
      return {
        exactPct: +((100 * exact) / pixels).toFixed(3),
        maxd,
        meand: +(sumd / (pixels * 3)).toFixed(5),
        bigPct: +((100 * big) / pixels).toFixed(4),
      };
    };
    const meanRgb = (data) => {
      const sum = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum[0] += data[i];
        sum[1] += data[i + 1];
        sum[2] += data[i + 2];
        n++;
      }
      return sum.map((value) => +(value / Math.max(1, n)).toFixed(3));
    };

    ctx.state.postFx.gpuCompose = false;
    await wait(150);
    const cpu = await capture();
    const lavaCpu = await captureRect(2 * 386 + 6, 2 * 216 + 6, 2 * (424 - 386) - 12, 2 * (240 - 216) - 12);
    ctx.state.postFx.gpuCompose = true;
    await wait(150);
    const gpu = await capture();
    const lavaGpu = await captureRect(2 * 386 + 6, 2 * 216 + 6, 2 * (424 - 386) - 12, 2 * (240 - 216) - 12);

    ctx.state.postFx.enabled = true;
    ctx.state.postFx.gpuCompose = false;
    await wait(150);
    const postCpu = await capture();
    ctx.state.postFx.gpuCompose = true;
    await wait(150);
    const postGpu = await capture();
    const statusAfterGpuFrame = window.__game.getRenderBackendStatus();
    ctx.state.render.compose = false;
    ctx.state.postFx.gpuCompose = true;
    await wait(150);
    const disabledComposeProbe = {
      postFxStayedOn: ctx.state.postFx.gpuCompose === true,
      renderCompose: ctx.state.render.compose,
      status: window.__game.getRenderBackendStatus(),
    };
    ctx.state.render.compose = true;
    await wait(150);

    Math.random = originalRandom;
    return {
      staticDiff: diff(cpu, gpu),
      postFxDiff: diff(postCpu, postGpu),
      lava: {
        cpu: { mean: meanRgb(lavaCpu) },
        gpu: { mean: meanRgb(lavaGpu) },
      },
      statusAfterGpuFrame,
      disabledComposeProbe,
    };
  });

  const cpuScreenshot = join(outDir, `cpu-${timestamp}.png`);
  const gpuScreenshot = join(outDir, `gpu-${timestamp}.png`);
  await page.evaluate(async () => {
    window.__game.ctx.state.postFx.gpuCompose = false;
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
  await captureCanvasPng(page, cpuScreenshot);
  await page.evaluate(async () => {
    window.__game.ctx.state.postFx.gpuCompose = true;
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
  await captureCanvasPng(page, gpuScreenshot);

  const statusFailures = [
    ...validateStatus(beforeStatus),
    ...validateStatus(visual.statusAfterGpuFrame).map((failure) => `after GPU frame: ${failure}`),
    ...validateLiveMetrics(visual.statusAfterGpuFrame).map((failure) => `after GPU frame: ${failure}`),
  ];
  const bootstrapFailures = validateBootstrap(bootstrapProbe);
  const toggleFailures = validateToggle(toggleProbe);
  const visualFailures = validateVisual(visual);
  const failures = [...statusFailures, ...bootstrapFailures, ...toggleFailures, ...visualFailures];
  if (consoleErrors.length > 0) failures.push('console errors');
  if (pageErrors.length > 0) failures.push('page errors');

  payload = {
    status: failures.length === 0 ? 'passed' : 'failed',
    commit: currentGitCommit(),
    git: currentGitState(),
    command: currentCommandLine(),
    generatedAt: new Date().toISOString(),
    baseUrl,
    url,
    bootstrapProbe,
    beforeStatus,
    toggleProbe,
    visual,
    liveMetrics: visual.statusAfterGpuFrame?.webgpu?.compose?.liveMetrics ?? null,
    consoleErrors,
    consoleWarnings,
    pageErrors,
    failures,
    acceptance: {
      staticMaxDelta: '<= 1',
      staticBigPct: '0',
      staticMeanDelta: '<= 0.02',
      staticExactPct: '>= 95',
      postFxMeanDelta: '<= 0.5',
      postFxBigPct: '<= 2',
      lavaMeanDeviation: '<= 4% red and green',
      productionAvailable: false,
      bootstrapToggle: 'clicking WGSL from the default URL reloads with renderBackend=webgpu&enableWebGpuLiveCompose=1',
      runtimeToggle: 'webgpu-compose-toggle toggles render.compose off/on',
      querySeed: 'enableWebGpuLiveCompose=1 initializes render.compose for probes',
      liveMetrics: 'GPU-composed frame reports pack/upload/submit CPU timings plus logical/submitted upload bytes',
    },
    artifacts: {
      json: join(outDir, `probe-${timestamp}.json`),
      cpuScreenshot,
      gpuScreenshot,
    },
  };
  writeJson(payload.artifacts.json, payload);
  console.log(JSON.stringify(payload, null, 2));
  if (payload.status !== 'passed') throw new Error('WebGPU live compose probe failed');
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

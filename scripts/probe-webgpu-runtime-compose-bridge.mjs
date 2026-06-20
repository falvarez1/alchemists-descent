// Phase 4.8/4.9 WebGPU runtime compose bridge probe.
// Boots the real game renderer, validates the opt-in StorageTexture bridge,
// validates a raw WGSL write into that bridge, and verifies production WebGPU
// compose remains disabled.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

import { startConsoleTestRun } from './run-helpers.mjs';
import {
  captureCanvasPng,
  currentCommandLine,
  currentGitCommit,
  currentGitState,
  newBenchmarkPage,
  writeJson,
} from './perf-harness.mjs';

const outDir = 'verify-out/webgpu-runtime-compose-bridge';
const timestamp = Date.now();
const providedBaseUrl = process.argv[2] ?? null;
const COPY_SRC_USAGE = 0x01;
const STORAGE_BINDING_USAGE = 0x08;

async function startViteServer() {
  const server = await createServer({
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 5202,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5202;
  return { server, baseUrl: `http://127.0.0.1:${port}/` };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function pageUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set('renderBackend', 'webgpu');
  url.searchParams.set('validateWebGpuComposeBridge', '1');
  url.searchParams.set('validateWebGpuComposeRawWgsl', '1');
  return url.toString();
}

function validateStatus(status) {
  const failures = [];
  const compose = status?.webgpu?.compose;
  const outputStorage = compose?.outputStorage;
  const rawWgslWrite = compose?.rawWgslWrite;

  if (status?.implementation !== 'WebGPURenderBackend') {
    failures.push(`expected WebGPURenderBackend, got ${status?.implementation ?? 'missing'}`);
  }
  if (status?.actual !== 'webgpu') {
    failures.push(`expected actual WebGPU backend, got ${status?.actual ?? 'missing'}`);
  }
  if (status?.health !== 'active') {
    failures.push(`expected active WebGPU backend, got ${status?.health ?? 'missing'}`);
  }
  if (compose?.productionAvailable !== false) {
    failures.push('WebGPU compose productionAvailable must remain false');
  }
  if (compose?.bridge !== 'validated') {
    failures.push(`expected validated compose bridge, got ${compose?.bridge ?? 'missing'}`);
  }
  if (!outputStorage) {
    failures.push('compose bridge outputStorage metadata missing');
  } else {
    if (outputStorage.format !== 'rgba8unorm') {
      failures.push(`expected rgba8unorm output storage, got ${outputStorage.format}`);
    }
    if (!Number.isFinite(outputStorage.width) || !Number.isFinite(outputStorage.height) || outputStorage.width <= 0 || outputStorage.height <= 0) {
      failures.push(`expected positive output storage dimensions, got ${outputStorage.width}x${outputStorage.height}`);
    }
    if (outputStorage.mipLevelCount !== 1) {
      failures.push(`expected one mip level, got ${outputStorage.mipLevelCount}`);
    }
    if (
      typeof outputStorage.usage !== 'number' ||
      (outputStorage.usage & STORAGE_BINDING_USAGE) === 0 ||
      (outputStorage.usage & COPY_SRC_USAGE) === 0
    ) {
      failures.push(`expected COPY_SRC and STORAGE_BINDING usage bits, got ${outputStorage.usage ?? 'missing'}`);
    }
    if (outputStorage.source !== 'three-r184-backend-get') {
      failures.push(`expected guarded Three r184 access source, got ${outputStorage.source}`);
    }
  }
  if (!rawWgslWrite) {
    failures.push('compose rawWgslWrite metadata missing');
  } else {
    if (rawWgslWrite.status !== 'validated') {
      failures.push(`expected validated raw WGSL write, got ${rawWgslWrite.status}`);
    }
    if (rawWgslWrite.maxDelta !== 0) {
      failures.push(`expected exact raw WGSL maxDelta 0, got ${rawWgslWrite.maxDelta}`);
    }
    if (rawWgslWrite.mismatchPct !== 0) {
      failures.push(`expected raw WGSL mismatchPct 0, got ${rawWgslWrite.mismatchPct}`);
    }
    if (typeof rawWgslWrite.gpuSubmitReadbackWallMs !== 'number' || rawWgslWrite.gpuSubmitReadbackWallMs <= 0) {
      failures.push(`expected positive raw WGSL readback wall time, got ${rawWgslWrite.gpuSubmitReadbackWallMs}`);
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
  mkdirSync(outDir, { recursive: true });

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await newBenchmarkPage(browser, {
    diagnosticsLabel: 'webgpu-runtime-compose-bridge',
  });
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
    if (noisyFavicon || noisyPowerPreference || noisyViteSocket) return;
    if (message.type() === 'error') consoleErrors.push(text);
    if (message.type() === 'warning') consoleWarnings.push(text);
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(pageUrl(baseUrl), { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__game?.ctx?.console, null, { timeout: 30000 });
  await startConsoleTestRun(page, { seed: 777, settleMs: 600 });

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

  const status = await page.evaluate(() => window.__game.getRenderBackendStatus());
  const failClosedCheck = await page.evaluate(async () => {
    const game = window.__game;
    const ctx = game.ctx;
    ctx.state.postFx.gpuCompose = true;
    ctx.state.paused = false;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      postFxGpuCompose: ctx.state.postFx.gpuCompose,
      status: game.getRenderBackendStatus(),
    };
  });
  const screenshotPath = join(outDir, `runtime-compose-bridge-${timestamp}.png`);
  await captureCanvasPng(page, screenshotPath);

  const failures = validateStatus(status);
  const afterFlagFailures = validateStatus(failClosedCheck.status).map((failure) => `after gpuCompose flag: ${failure}`);
  failures.push(...afterFlagFailures);
  if (failClosedCheck.postFxGpuCompose !== true) {
    failures.push('postFx.gpuCompose flag did not stay enabled for fail-closed check');
  }
  if (consoleErrors.length > 0) failures.push('console errors');
  if (pageErrors.length > 0) failures.push('page errors');

  payload = {
    status: failures.length === 0 ? 'passed' : 'failed',
    commit: currentGitCommit(),
    git: currentGitState(),
    command: currentCommandLine(),
    generatedAt: new Date().toISOString(),
    baseUrl,
    statusBeforeGpuComposeFlag: status,
    statusAfterGpuComposeFlag: failClosedCheck.status,
    consoleErrors,
    consoleWarnings,
    pageErrors,
    failures,
    phase4_8_9Files: [
      'src/render/WebGpuComposeBridge.ts',
      'src/render/WebGpuRenderBackend.ts',
      'src/render/Renderer.ts',
      'src/render/pixels.ts',
      'scripts/probe-webgpu-runtime-compose-bridge.mjs',
      'package.json',
      'docs/WEBGPU-BENCHMARK-LEDGER.md',
      'docs/WEBGPU-TSL-COMPUTE-IMPLEMENTATION-PLAN.md',
    ],
    artifacts: {
      json: join(outDir, `probe-${timestamp}.json`),
      screenshot: screenshotPath,
    },
  };
  writeJson(payload.artifacts.json, payload);
  console.log(JSON.stringify(payload, null, 2));
  if (payload.status !== 'passed') throw new Error('WebGPU runtime compose bridge probe failed');
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

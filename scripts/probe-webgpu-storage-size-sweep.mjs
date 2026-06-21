// Phase 4.5 WebGPU storage bridge size sweep.
// Reuses the storage bridge page with query-string dimensions to identify
// whether Three r184 StorageTexture behavior changes at production-like sizes.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

import { currentCommandLine, currentGitCommit, currentGitState, writeJson } from './perf-harness.mjs';
import { validateStorageBridgeScreenshot } from './webgpu-storage-screenshot-validation.mjs';

const outDir = 'verify-out/webgpu-storage-size-sweep';
const timestamp = Date.now();
const providedBaseUrl = process.argv[2] ?? null;
const cases = [
  { label: 'baseline-powerish', w: 128, h: 96, scale: 4, expectedStatus: 'passed' },
  { label: 'view-width-small-height', w: 575, h: 96, scale: 2, expectedStatus: 'passed' },
  { label: 'small-width-view-height', w: 128, h: 391, scale: 2, expectedStatus: 'passed' },
  { label: 'aligned-view-neighbor', w: 576, h: 392, scale: 2, expectedStatus: 'passed' },
  { label: 'view-width-aligned-height', w: 575, h: 392, scale: 2, expectedStatus: 'passed' },
  { label: 'aligned-width-view-height', w: 576, h: 391, scale: 2, expectedStatus: 'passed' },
  { label: 'production-view', w: 575, h: 391, scale: 2, expectedStatus: 'passed' },
  { label: 'production-view-padded-storage', w: 575, h: 391, storageW: 576, scale: 2, expectedStatus: 'passed' },
];

async function startViteServer() {
  const server = await createServer({
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 5200,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5200;
  return { server, baseUrl: `http://127.0.0.1:${port}/` };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

async function runCase(page, baseUrl, testCase) {
  const url = new URL('scripts/probe-webgpu-storage-bridge.html', baseUrl);
  url.searchParams.set('w', String(testCase.w));
  url.searchParams.set('h', String(testCase.h));
  url.searchParams.set('scale', String(testCase.scale));
  if (testCase.storageW) url.searchParams.set('storageW', String(testCase.storageW));
  if (testCase.storageH) url.searchParams.set('storageH', String(testCase.storageH));
  await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__webgpuStorageBridgeResult, null, { timeout: 30000 });
  const result = await page.evaluate(() => window.__webgpuStorageBridgeResult);
  const screenshotPath = join(outDir, `bridge-${testCase.label}-${timestamp}.png`);
  await page.locator('#webgpu-storage-bridge-output').screenshot({ path: screenshotPath });
  const expectedScreenshotDimensions = [testCase.w * testCase.scale, testCase.h * testCase.scale];
  const screenshotValidation = validateStorageBridgeScreenshot(screenshotPath, testCase.w, testCase.h);
  return {
    ...testCase,
    status: result.status,
    failures: result.failures,
    backend: result.backend,
    bridge: result.bridge,
    screenshot: screenshotPath,
    expectedScreenshotDimensions,
    screenshotValidation,
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
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !text.includes('[vite] failed to connect to websocket')) {
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  const results = [];
  for (const testCase of cases) {
    results.push(await runCase(page, baseUrl, testCase));
  }

  const failures = [];
  for (const result of results) {
    if (result.status !== result.expectedStatus) {
      failures.push(`${result.label} expected ${result.expectedStatus}, got ${result.status}`);
    }
    if (
      result.screenshotValidation.dimensions[0] !== result.expectedScreenshotDimensions[0] ||
      result.screenshotValidation.dimensions[1] !== result.expectedScreenshotDimensions[1]
    ) {
      failures.push(
        `${result.label} screenshot dimensions expected ${result.expectedScreenshotDimensions[0]}x` +
          `${result.expectedScreenshotDimensions[1]}, got ${result.screenshotValidation.dimensions[0]}x` +
          `${result.screenshotValidation.dimensions[1]}`,
      );
    }
    if (
      result.screenshotValidation.comparison.maxDelta > 1 ||
      result.screenshotValidation.comparison.mismatches > 0 ||
      result.screenshotValidation.image.nonBlackPct < 0.98
    ) {
      failures.push(`${result.label} screenshot mismatched expected gradient`);
    }
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
    cases,
    results,
    consoleErrors,
    pageErrors,
    failures,
    phase4_5Files: [
      'scripts/probe-webgpu-storage-size-sweep.mjs',
      'scripts/probe-webgpu-storage-bridge-page.js',
      'scripts/probe-webgpu-storage-bridge.html',
      'package.json',
      'docs/WEBGPU-BENCHMARK-LEDGER.md',
      'docs/WEBGPU-TSL-COMPUTE-IMPLEMENTATION-PLAN.md',
    ],
    artifacts: {
      json: join(outDir, `probe-${timestamp}.json`),
    },
  };
  writeJson(payload.artifacts.json, payload);
  console.log(JSON.stringify(payload, null, 2));
  if (payload.status !== 'passed') throw new Error('WebGPU storage bridge size sweep failed');
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

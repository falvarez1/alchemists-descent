// Phase 4.6 WebGPU raw WGSL -> Three StorageTexture -> TSL presentation probe.
// This combines the production-shaped compose fixture with the GPU-resident
// presentation bridge before any live renderer WebGPU compose flag is enabled.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

import { currentCommandLine, currentGitCommit, currentGitState, writeJson } from './perf-harness.mjs';
import {
  SCALE,
  VIEW_H,
  VIEW_W,
  composeReference,
  makeLightField,
  makeLut,
  makeOverlay,
  makeWorldWindow,
} from './webgpu-compose-storage-fixture-model.mjs';
import {
  compareRgbaPixels,
  readPngRgba,
  sampleLogicalPixels,
  summarizeImage,
} from './webgpu-storage-screenshot-validation.mjs';

const outDir = 'verify-out/webgpu-compose-storage-fixture';
const timestamp = Date.now();
const providedBaseUrl = process.argv[2] ?? null;

async function startViteServer() {
  const server = await createServer({
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 5201,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5201;
  return { server, baseUrl: `http://127.0.0.1:${port}/` };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function expectedReference() {
  return composeReference(makeWorldWindow(), makeLightField(), makeLut(), makeOverlay());
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
    const noisyFavicon =
      (text.includes('favicon') && text.includes('404')) ||
      (text.includes('Failed to load resource') && text.includes('404'));
    const noisyPowerPreference = text.includes('powerPreference option is currently ignored');
    if (
      (message.type() === 'error' || message.type() === 'warning') &&
      !text.includes('[vite] failed to connect to websocket') &&
      !noisyFavicon &&
      !noisyPowerPreference
    ) {
      consoleErrors.push(`${message.type()}: ${text}`);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(new URL('scripts/probe-webgpu-compose-storage-fixture.html', baseUrl).toString(), {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForFunction(() => window.__webgpuComposeStorageFixtureResult, null, { timeout: 30000 });
  const result = await page.evaluate(() => window.__webgpuComposeStorageFixtureResult);
  const screenshotPath = join(outDir, `compose-storage-${timestamp}.png`);
  await page.locator('#webgpu-compose-storage-fixture-output').screenshot({ path: screenshotPath });

  const image = readPngRgba(screenshotPath);
  const logical = sampleLogicalPixels(image, VIEW_W, VIEW_H);
  const reference = expectedReference();
  const screenshotComparison = compareRgbaPixels(reference.data, logical, 1, VIEW_W);
  const screenshotSummary = summarizeImage(logical);
  const expectedScreenshotDimensions = [VIEW_W * SCALE, VIEW_H * SCALE];

  const failures = [...(result.failures ?? [])];
  if (image.width !== expectedScreenshotDimensions[0] || image.height !== expectedScreenshotDimensions[1]) {
    failures.push(
      `screenshot dimensions expected ${expectedScreenshotDimensions[0]}x${expectedScreenshotDimensions[1]}, ` +
        `got ${image.width}x${image.height}`,
    );
  }
  if (
    screenshotComparison.maxDelta > 1 ||
    screenshotComparison.mismatches > 0 ||
    screenshotSummary.nonBlackPct < 0.98
  ) {
    failures.push('TSL-presented compose screenshot mismatched CPU reference');
  }
  if (consoleErrors.length > 0) failures.push('console errors');
  if (pageErrors.length > 0) failures.push('page errors');

  payload = {
    status: result.status === 'passed' && failures.length === 0 ? 'passed' : 'failed',
    commit: currentGitCommit(),
    git: currentGitState(),
    command: currentCommandLine(),
    generatedAt: new Date().toISOString(),
    baseUrl,
    result,
    screenshotValidation: {
      dimensions: [image.width, image.height],
      expectedDimensions: expectedScreenshotDimensions,
      logicalDimensions: [VIEW_W, VIEW_H],
      comparison: screenshotComparison,
      image: screenshotSummary,
      cpuReferenceMs: reference.ms,
    },
    consoleErrors,
    pageErrors,
    failures,
    phase4_6Files: [
      'scripts/probe-webgpu-compose-storage-fixture.mjs',
      'scripts/probe-webgpu-compose-storage-fixture.html',
      'scripts/probe-webgpu-compose-storage-fixture-page.js',
      'scripts/webgpu-compose-storage-fixture-model.mjs',
      'scripts/webgpu-storage-screenshot-validation.mjs',
      'src/render/WebGpuStorageTextureAccess.ts',
      'tests/webgpu-storage-texture-access.test.ts',
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
  if (payload.status !== 'passed') throw new Error('WebGPU compose storage fixture probe failed');
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

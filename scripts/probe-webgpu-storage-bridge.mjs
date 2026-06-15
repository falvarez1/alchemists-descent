// Phase 4.4 WebGPU storage-texture bridge probe.
// Proves a TSL compute-written StorageTexture can be sampled by the TSL
// RenderPipeline without a production-frame readback.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

import { currentCommandLine, currentGitCommit, currentGitState, writeJson } from './perf-harness.mjs';
import { validateStorageBridgeScreenshot } from './webgpu-storage-screenshot-validation.mjs';

const outDir = 'verify-out/webgpu-storage-bridge';
const timestamp = Date.now();
const providedBaseUrl = process.argv[2] ?? null;

async function startViteServer() {
  const server = await createServer({
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 5199,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5199;
  return { server, baseUrl: `http://127.0.0.1:${port}/` };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
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

  await page.goto(new URL('scripts/probe-webgpu-storage-bridge.html', baseUrl).toString(), {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForFunction(() => window.__webgpuStorageBridgeResult, null, { timeout: 30000 });
  const result = await page.evaluate(() => window.__webgpuStorageBridgeResult);
  const screenshotPath = join(outDir, `bridge-${timestamp}.png`);
  await page.locator('#webgpu-storage-bridge-output').screenshot({ path: screenshotPath });
  const [logicalWidth, logicalHeight] = result.bridge?.dimensions ?? [128, 96];
  const [expectedScreenshotWidth, expectedScreenshotHeight] = result.bridge?.outputDimensions ?? [logicalWidth, logicalHeight];
  const screenshotValidation = validateStorageBridgeScreenshot(screenshotPath, logicalWidth, logicalHeight);

  const failures = [...(result.failures ?? [])];
  if (
    screenshotValidation.dimensions[0] !== expectedScreenshotWidth ||
    screenshotValidation.dimensions[1] !== expectedScreenshotHeight
  ) {
    failures.push(
      `storage texture bridge screenshot dimensions expected ${expectedScreenshotWidth}x${expectedScreenshotHeight}, ` +
        `got ${screenshotValidation.dimensions[0]}x${screenshotValidation.dimensions[1]}`,
    );
  }
  if (
    screenshotValidation.comparison.maxDelta > 1 ||
    screenshotValidation.comparison.mismatches > 0 ||
    screenshotValidation.image.nonBlackPct < 0.98
  ) {
    failures.push('storage texture bridge screenshot mismatched expected gradient');
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
    expectedScreenshotDimensions: [expectedScreenshotWidth, expectedScreenshotHeight],
    screenshotValidation,
    consoleErrors,
    pageErrors,
    failures,
    phase4_4Files: [
      'scripts/probe-webgpu-storage-bridge.mjs',
      'scripts/probe-webgpu-storage-bridge.html',
      'scripts/probe-webgpu-storage-bridge-page.js',
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
  if (payload.status !== 'passed') throw new Error('WebGPU storage bridge probe failed');
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

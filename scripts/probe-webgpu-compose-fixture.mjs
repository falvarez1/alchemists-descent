// Phase 4.3 WebGPU compose WGSL fixture.
// Exercises production-shaped compose resources through a raw WGSL render pass
// on the active Three WebGPU device, then compares readback to a CPU reference.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

import { currentCommandLine, currentGitCommit, currentGitState, writeJson } from './perf-harness.mjs';

const outDir = 'verify-out/webgpu-compose-fixture';
const timestamp = Date.now();
const providedBaseUrl = process.argv[2] ?? null;

async function startViteServer() {
  const server = await createServer({
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 5198,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5198;
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

  await page.goto(new URL('scripts/probe-webgpu-compose-fixture.html', baseUrl).toString(), {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForFunction(() => window.__webgpuComposeFixtureResult, null, { timeout: 30000 });
  const result = await page.evaluate(() => window.__webgpuComposeFixtureResult);
  const screenshotPath = join(outDir, `fixture-${timestamp}.png`);
  const output = page.locator('#webgpu-compose-fixture-output');
  const outputCount = await output.count();
  if (outputCount > 0) {
    await output.screenshot({ path: screenshotPath });
  } else {
    await page.screenshot({ path: screenshotPath });
  }

  const failures = [...(result.failures ?? [])];
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
    consoleErrors,
    pageErrors,
    failures,
    phase4_3Files: [
      'scripts/probe-webgpu-compose-fixture.mjs',
      'scripts/probe-webgpu-compose-fixture.html',
      'scripts/probe-webgpu-compose-fixture-page.js',
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
  if (payload.status !== 'passed') throw new Error('WebGPU compose fixture failed');
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

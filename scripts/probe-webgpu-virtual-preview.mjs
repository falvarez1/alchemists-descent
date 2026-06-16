// WebGPU virtual-world preview compute probe (research spike). Runs a raw WGSL value-noise
// preview kernel on the real GPU via headless Edge and records timing + a screenshot.
// Usage: node scripts/probe-webgpu-virtual-preview.mjs [baseUrl]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

import { currentCommandLine, currentGitCommit, currentGitState, writeJson } from './perf-harness.mjs';

const outDir = 'verify-out/webgpu-virtual-preview';
const timestamp = Date.now();
const providedBaseUrl = process.argv[2] ?? null;

async function startViteServer() {
  const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 5198, strictPort: false } });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5198;
  return { server, baseUrl: `http://127.0.0.1:${port}/` };
}
const normalize = (u) => (u.endsWith('/') ? u : `${u}/`);

let viteServer = null;
let browser = null;
try {
  const info = providedBaseUrl ? { server: null, baseUrl: normalize(providedBaseUrl) } : await startViteServer();
  viteServer = info.server;
  const baseUrl = normalize(info.baseUrl);
  mkdirSync(outDir, { recursive: true });

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => {
    const t = m.text();
    // Ignore the Vite HMR socket notice and the favicon 404 (this minimal page has no assets).
    if (m.type() === 'error' && !t.includes('[vite] failed to connect') && !t.includes('Failed to load resource')) {
      consoleErrors.push(t);
    }
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(new URL('scripts/probe-webgpu-virtual-preview.html', baseUrl).toString(), { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__virtualPreviewResult, null, { timeout: 30000 });
  const result = await page.evaluate(() => window.__virtualPreviewResult);
  const screenshot = join(outDir, `preview-${timestamp}.png`);
  await page.locator('#preview').screenshot({ path: screenshot });

  const failures = [...(result.failures ?? [])];
  if (consoleErrors.length) failures.push('console errors');
  if (pageErrors.length) failures.push('page errors');
  const status = result.status === 'passed' && failures.length === 0 ? 'passed' : 'failed';

  const payload = {
    status,
    commit: currentGitCommit(),
    git: currentGitState(),
    command: currentCommandLine(),
    generatedAt: new Date().toISOString(),
    baseUrl,
    result,
    consoleErrors,
    pageErrors,
    failures,
    artifacts: { json: join(outDir, `probe-${timestamp}.json`), screenshot },
  };
  writeJson(payload.artifacts.json, payload);
  console.log(JSON.stringify({ status, available: result.available, stats: result.stats, failures }, null, 2));
  console.log(`screenshot ${screenshot}`);
  if (status !== 'passed') {
    // An unavailable GPU is a recorded environment finding, not a code failure.
    if (result.available === false) console.log('NOTE: WebGPU adapter unavailable in this environment (recorded, not a code error).');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (viteServer) await viteServer.close();
}

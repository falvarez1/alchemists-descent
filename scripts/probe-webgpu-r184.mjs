// Three r184 WebGPU/TSL/WGSL API spike. This does not load or mutate the game.
// Usage: node scripts/probe-webgpu-r184.mjs [baseUrl]
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

import {
  collectWebGpuAdapterCapabilities,
  currentCommandLine,
  currentGitCommit,
  currentGitState,
  writeJson,
} from './perf-harness.mjs';

const outDir = 'verify-out/webgpu-r184-spike';
const providedBaseUrl = process.argv[2] ?? null;
const timestamp = Date.now();

function assertExportSet(label, module, names) {
  const result = {};
  const missing = [];
  for (const name of names) {
    result[name] = typeof module[name];
    if (module[name] === undefined) missing.push(name);
  }
  if (missing.length > 0) throw new Error(`${label} missing exports: ${missing.join(', ')}`);
  return result;
}

async function startViteServer() {
  const server = await createServer({
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 5194,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5194;
  return { server, baseUrl: `http://127.0.0.1:${port}/` };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function applyPngFilter(filter, row, previous, bytesPerPixel) {
  for (let x = 0; x < row.length; x++) {
    const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
    const up = previous ? previous[x] : 0;
    const upLeft = previous && x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
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

function pngPixelStats(buffer) {
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
      const i = x * channels;
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
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
    nonBlackPixels,
    nonBlackPct: pixels === 0 ? 0 : (nonBlackPixels / pixels) * 100,
    avgRgb: pixels === 0 ? 0 : sumRgb / pixels / 3,
    maxChannel,
  };
}

const webgpu = await import('three/webgpu');
const tsl = await import('three/tsl');
const staticExports = {
  webgpu: assertExportSet('three/webgpu', webgpu, [
    'WebGPURenderer',
    'WebGPUBackend',
    'WebGLBackend',
    'RenderPipeline',
    'StorageBufferAttribute',
    'StorageTexture',
    'REVISION',
  ]),
  tsl: assertExportSet('three/tsl', tsl, [
    'Fn',
    'wgslFn',
    'attributeArray',
    'storage',
    'instanceIndex',
    'float',
    'uv',
    'vec4',
    'renderOutput',
    'pass',
  ]),
};

const phase1Files = [
  'package.json',
  'vite.config.ts',
  'scripts/perf-harness.mjs',
  'scripts/perf-ab-feature.mjs',
  'scripts/perf-ab-compose.mjs',
  'scripts/perf-scene.mjs',
  'scripts/probe-webgpu-r184.mjs',
  'scripts/probe-webgpu-r184-browser.js',
  'scripts/probe-webgpu-r184-host.html',
  'docs/WEBGPU-BENCHMARK-LEDGER.md',
  'docs/WEBGPU-THREE-R184-SPIKE.md',
];

let viteServer = null;
let browser = null;
let payload = null;

try {
  const serverInfo = providedBaseUrl
    ? { server: null, baseUrl: normalizeBaseUrl(providedBaseUrl) }
    : await startViteServer();
  viteServer = serverInfo.server;
  const baseUrl = normalizeBaseUrl(serverInfo.baseUrl);
  const probeUrl = new URL('scripts/probe-webgpu-r184-host.html', baseUrl).toString();

  mkdirSync(outDir, { recursive: true });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 420 } });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(probeUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__webgpuR184Probe?.status, null, { timeout: 30000 });

  const adapter = await collectWebGpuAdapterCapabilities(page);
  const browserProbe = await page.evaluate(() => window.__webgpuR184Probe);
  const screenshot = join(outDir, `render-pipeline-${timestamp}.png`);
  let screenshotCaptured = false;
  let screenshotStats = null;
  try {
    const canvas = page.locator('#webgpu-r184-probe-canvas');
    const png = await canvas.screenshot({ path: screenshot });
    screenshotStats = pngPixelStats(png);
    screenshotCaptured = true;
  } catch {
    screenshotCaptured = false;
  }

  if (browserProbe?.renderPipeline) {
    browserProbe.renderPipeline.screenshotStats = screenshotStats;
    browserProbe.renderPipeline.nonBlank = Boolean(
      screenshotStats && screenshotStats.nonBlackPixels > 0 && screenshotStats.maxChannel > 32,
    );
  }

  payload = {
    status: browserProbe.status,
    commit: currentGitCommit(),
    git: currentGitState(),
    command: currentCommandLine(),
    baseUrl,
    probeUrl,
    generatedAt: new Date().toISOString(),
    staticExports,
    adapter,
    browserProbe,
    consoleErrors,
    pageErrors,
    artifacts: {
      screenshot: screenshotCaptured ? screenshot : null,
    },
    phase1Files,
  };

  const jsonPath = join(outDir, `probe-${timestamp}.json`);
  writeJson(jsonPath, payload);
  payload.artifacts.json = jsonPath;

  console.log(JSON.stringify(payload, null, 2));

  if (browserProbe.status !== 'passed') throw new Error('Browser WebGPU r184 probe failed');
  if (!browserProbe.renderPipeline?.nonBlank) throw new Error('RenderPipeline screenshot is blank');
  if (consoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(
      `Probe produced console/page errors: console=${consoleErrors.length} page=${pageErrors.length}`,
    );
  }
} catch (error) {
  const failedPath = join(outDir, `probe-${timestamp}-failed.json`);
  writeJson(failedPath, {
    status: 'failed',
    commit: currentGitCommit(),
    git: currentGitState(),
    command: currentCommandLine(),
    generatedAt: new Date().toISOString(),
    staticExports,
    phase1Files,
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

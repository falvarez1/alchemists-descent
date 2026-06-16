// Cross-backend compose benchmark.
//
// Runs the existing same-session postFx.gpuCompose A/B harness once on the
// production WebGL2 path and once on the WebGPU live-compose diagnostic path,
// then compares the GPU-compose-on variants. This keeps startup-only backend
// selection honest without duplicating the scene/perf sampling code.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

import {
  currentCommandLine,
  currentGitCommit,
  currentGitState,
  PERF_BUCKETS,
  printBucketComparison,
  sanitizeLabel,
  writeJson,
} from './perf-harness.mjs';

const providedBaseUrl = process.argv[2] ?? null;
const FRAMES = Number(process.argv[3] ?? 360);
const BLOCKS = Number(process.argv[4] ?? 4);
const scenario = process.argv[5] ?? 'chaos';
const runId = Date.now();

async function startViteServer() {
  const server = await createServer({
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 5214,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5214;
  return { server, baseUrl: `http://127.0.0.1:${port}/` };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function webGpuUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set('renderBackend', 'webgpu');
  url.searchParams.set('enableWebGpuLiveCompose', '1');
  return url.toString();
}

function runPerfAb(label, url) {
  console.log(`\n=== ${label.toUpperCase()} compose A/B ===`);
  const output = execFileSync(
    process.execPath,
    [
      'scripts/perf-ab-feature.mjs',
      'postFx.gpuCompose',
      'false',
      'true',
      url,
      String(FRAMES),
      String(BLOCKS),
      scenario,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, PERF_CAPTURE_VISUALS: process.env.PERF_CAPTURE_VISUALS ?? '0' },
    },
  );
  process.stdout.write(output);
  const match = output.match(/Wrote\s+(.+\.json)/);
  if (!match) throw new Error(`Could not find perf-ab output path for ${label}`);
  const artifact = match[1].trim();
  return {
    artifact,
    payload: JSON.parse(readFileSync(artifact, 'utf8')),
  };
}

function summarizeBackend(payload, valueLabel) {
  const blocks = payload.capabilities?.blocks ?? [];
  const variantBlocks = blocks.filter((block) => block.label === 'variant');
  const actualBackends = Array.from(
    new Set(variantBlocks.map((block) => block.capabilities?.actualBackend).filter(Boolean)),
  );
  return {
    artifact: payload.command?.includes('perf-ab-feature') ? null : undefined,
    url: payload.url,
    valueLabel,
    actualBackends,
    summary: payload.summaries.variant,
    comparison: payload.comparison,
    runtimeCounts: payload.runtimeCounts,
  };
}

let viteServer = null;
try {
  const serverInfo = providedBaseUrl
    ? { server: null, baseUrl: normalizeBaseUrl(providedBaseUrl) }
    : await startViteServer();
  viteServer = serverInfo.server;
  const baseUrl = normalizeBaseUrl(serverInfo.baseUrl);
  const webglUrl = baseUrl;
  const gpuUrl = webGpuUrl(baseUrl);

  const webgl = runPerfAb('webgl2', webglUrl);
  const webgpu = runPerfAb('webgpu', gpuUrl);

  const webglVariant = {};
  const webgpuVariant = {};
  for (const bucket of PERF_BUCKETS) {
    webglVariant[bucket] = webgl.payload.raw.variant[bucket];
    webgpuVariant[bucket] = webgpu.payload.raw.variant[bucket];
  }

  const comparison = printBucketComparison(
    'WebGL2 GPU compose',
    'WebGPU WGSL compose',
    webglVariant,
    webgpuVariant,
    PERF_BUCKETS,
  );

  const outputPath = `verify-out/perf-compose-backends-${sanitizeLabel(scenario)}-${runId}.json`;
  const payload = {
    createdAt: new Date().toISOString(),
    commit: currentGitCommit(),
    git: currentGitState(),
    command: currentCommandLine(),
    baseUrl,
    scenario,
    framesPerBlock: FRAMES,
    blocksPerValue: BLOCKS,
    artifacts: {
      webgl: webgl.artifact,
      webgpu: webgpu.artifact,
      json: outputPath,
    },
    webgl: summarizeBackend(webgl.payload, 'postFx.gpuCompose=true'),
    webgpu: summarizeBackend(webgpu.payload, 'postFx.gpuCompose=true'),
    comparison,
    raw: {
      webglVariant,
      webgpuVariant,
    },
  };
  payload.webgl.artifact = webgl.artifact;
  payload.webgpu.artifact = webgpu.artifact;
  writeJson(outputPath, payload);
  console.log(`\nWrote ${outputPath}`);
} finally {
  if (viteServer) await viteServer.close();
}

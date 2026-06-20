// Cross-backend compose benchmark.
//
// Runs the existing same-session postFx.gpuCompose A/B harness once on the
// production WebGL2 path and once on the WebGPU live-compose diagnostic path,
// then compares the GPU-compose-on variants. This keeps startup-only backend
// selection honest without duplicating the scene/perf sampling code.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
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

const maybeBaseUrl = process.argv[2] ?? null;
const providedBaseUrl = maybeBaseUrl && /^https?:\/\//i.test(maybeBaseUrl) ? maybeBaseUrl : null;
const argOffset = providedBaseUrl ? 3 : 2;
const FRAMES = Number(process.argv[argOffset] ?? 360);
const BLOCKS = Number(process.argv[argOffset + 1] ?? 4);
const scenario = process.argv[argOffset + 2] ?? 'chaos';
const runId = Date.now();
const execFileAsync = promisify(execFile);

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

async function runPerfAb(label, url) {
  console.log(`\n=== ${label.toUpperCase()} compose A/B ===`);
  const { stdout, stderr } = await execFileAsync(
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
      env: { ...process.env, PERF_CAPTURE_VISUALS: process.env.PERF_CAPTURE_VISUALS ?? '0' },
      maxBuffer: 1024 * 1024 * 64,
    },
  );
  const output = stdout ?? '';
  process.stdout.write(output);
  if (stderr) process.stderr.write(stderr);
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
  const measuredCapabilities = variantBlocks.map((block) => block.endCapabilities ?? block.capabilities);
  const actualBackends = Array.from(
    new Set(measuredCapabilities.map((capabilities) => capabilities?.actualBackend).filter(Boolean)),
  );
  return {
    artifact: payload.command?.includes('perf-ab-feature') ? null : undefined,
    url: payload.url,
    valueLabel,
    actualBackends,
    fallbackBlocks: measuredCapabilities.filter((capabilities) => capabilities?.fellBackToWebGL2 === true).length,
    backendStatuses: measuredCapabilities.map((capabilities) => capabilities?.backendStatus).filter(Boolean),
    liveMetrics: measuredCapabilities
      .map((capabilities) => capabilities?.backendStatus?.webgpu?.compose?.liveMetrics)
      .filter(Boolean),
    summary: payload.summaries.variant,
    comparison: payload.comparison,
    runtimeCounts: payload.runtimeCounts,
  };
}

function backendValidationFailures(summary, expectedBackend) {
  const failures = [];
  if (summary.actualBackends.length === 0) {
    failures.push(`${summary.valueLabel} did not report an actual backend`);
    return failures;
  }
  const unexpected = summary.actualBackends.filter((backend) => backend !== expectedBackend);
  if (unexpected.length > 0) {
    failures.push(
      `${summary.valueLabel} expected ${expectedBackend} blocks, got ${summary.actualBackends.join(', ')}`,
    );
  }
  if (summary.fallbackBlocks > 0) {
    failures.push(`${summary.valueLabel} fell back to WebGL2 in ${summary.fallbackBlocks} measured blocks`);
  }
  return failures;
}

function webGpuLiveComposeValidationFailures(summary) {
  const failures = [];
  if (summary.backendStatuses.length === 0) {
    failures.push('WebGPU run did not record backend statuses');
  }
  const invalid = summary.backendStatuses.filter(
    (status) =>
      status?.actual !== 'webgpu' ||
      status?.features?.compose !== true ||
      status?.webgpu?.compose?.bridge !== 'validated',
  );
  if (invalid.length > 0) {
    failures.push(`WebGPU run had ${invalid.length} measured blocks without validated live compose`);
  }
  if (summary.liveMetrics.length === 0) {
    failures.push('WebGPU run did not capture live compose upload metrics');
  }
  return failures;
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

  const webgl = await runPerfAb('webgl2', webglUrl);
  const webgpu = await runPerfAb('webgpu', gpuUrl);

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
  const webglSummary = summarizeBackend(webgl.payload, 'WebGL2 postFx.gpuCompose=true');
  const webgpuSummary = summarizeBackend(webgpu.payload, 'WebGPU postFx.gpuCompose=true');
  const validationFailures = [
    ...backendValidationFailures(webglSummary, 'webgl2'),
    ...backendValidationFailures(webgpuSummary, 'webgpu'),
    ...webGpuLiveComposeValidationFailures(webgpuSummary),
  ];

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
    validationFailures,
    webgl: webglSummary,
    webgpu: webgpuSummary,
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
  if (validationFailures.length > 0) {
    console.error(`\nFAIL:\n - ${validationFailures.join('\n - ')}`);
    process.exitCode = 1;
  }
} finally {
  if (viteServer) await viteServer.close();
}

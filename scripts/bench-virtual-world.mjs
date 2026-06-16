import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const opts = parseOptions(process.argv.slice(2));
const server = await createServer({ logLevel: 'error', server: { hmr: false, middlewareMode: true } });

try {
  const virtual = await server.ssrLoadModule('/src/world/virtual/index.ts');
  const def = virtual.createDefaultVirtualWorldDef(opts.seed);
  const requestedPlanes = opts.planes === 'preview'
    ? ['previewRgba']
    : ['types', 'colors', 'life', 'charge'];
  const backendRun = await resolveBackendRun(virtual, def, opts, requestedPlanes);
  const syncRun = runSyncBenchmark(virtual, def, opts, requestedPlanes);
  const selectedRun = backendRun ?? syncRun;
  const fallback = backendRun ? (backendRun.fallback ?? null) : fallbackInfoFor(virtual, opts.backend);

  const out = {
    seed: opts.seed,
    radius: opts.radius,
    repeats: opts.repeats,
    chunkSize: def.chunkSize,
    requestedBackend: opts.backend,
    actualBackend: selectedRun.actualBackend,
    fallbackUsed: fallback !== null,
    fallbackBackend: fallback ? selectedRun.actualBackend : null,
    fallbackReason: fallback?.reason ?? null,
    backendAvailable: fallback?.available ?? true,
    backendError: fallback?.error ?? null,
    authoritativeCells: selectedRun.authoritativeCells,
    requestedPlanes,
    planeMode: opts.planes,
    fixtures: selectedRun.fixtureHashes,
    syncReference: {
      actualBackend: syncRun.actualBackend,
      fixtures: syncRun.fixtureHashes,
      chunkMs: syncRun.chunkMs,
      windowMs: syncRun.windowMs,
      serializeMs: syncRun.serializeMs,
      generatedBytes: syncRun.generatedBytes,
      transferBytes: syncRun.transferBytes,
    },
    timingScope: selectedRun.timingScope,
    chunkMs: selectedRun.chunkMs,
    windowMs: selectedRun.windowMs,
    serializeMs: selectedRun.serializeMs,
    generatedBytes: selectedRun.generatedBytes,
    transferBytes: selectedRun.transferBytes,
    backendInfo: selectedRun.backendInfo,
    generatedAt: new Date().toISOString(),
  };

  await mkdir('verify-out', { recursive: true });
  const path = `verify-out/virtual-world-bench-${Date.now()}.json`;
  await writeFile(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log(`wrote ${path}`);
} finally {
  await server.close();
}

function parseOptions(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split('=');
    if (inline !== undefined) flags[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
    else flags[key] = 'true';
  }
  const backend = normalizeBackend(String(flags.backend ?? 'auto'));
  const planes = String(flags.planes ?? 'full') === 'preview' ? 'preview' : 'full';
  return {
    seed: Number(flags.seed ?? positional[0] ?? 0x4e4f4954) >>> 0,
    radius: Math.max(0, Number(flags.radius ?? positional[1] ?? 1) | 0),
    repeats: Math.max(1, Number(flags.repeats ?? positional[2] ?? 8) | 0),
    backend,
    planes,
  };
}

function runSyncBenchmark(virtual, def, opts, requestedPlanes) {
  const fixtures = [
    [0, 0],
    [1, 0],
    [-1, 2],
    [7, -3],
  ];

  for (const [cx, cy] of fixtures) virtual.generateVirtualChunk(def, cx, cy);

  const chunkTimes = [];
  const serializeTimes = [];
  const fixtureHashes = {};
  let generatedBytes = 0;
  let transferBytes = 0;
  for (let r = 0; r < opts.repeats; r++) {
    for (const [cx, cy] of fixtures) {
      const t0 = performance.now();
      const chunk = virtual.generateVirtualChunk(def, cx, cy);
      chunkTimes.push(performance.now() - t0);
      const s0 = performance.now();
      const transferable = virtual.toTransferableChunk(chunk, requestedPlanes).chunk;
      serializeTimes.push(performance.now() - s0);
      fixtureHashes[`${cx},${cy}`] = chunk.meta.hash;
      generatedBytes = transferable.metrics.generatedBytes;
      transferBytes = transferable.metrics.transferBytes;
    }
  }

  const cx0 = -opts.radius;
  const cy0 = -opts.radius;
  const cx1 = opts.radius;
  const cy1 = opts.radius;
  const windowTimes = [];
  for (let r = 0; r < opts.repeats; r++) {
    const t0 = performance.now();
    const chunks = virtual.generateVirtualWindow(def, cx0, cy0, cx1, cy1);
    windowTimes.push(performance.now() - t0);
    generatedBytes = 0;
    transferBytes = 0;
    for (const chunk of chunks) {
      const s0 = performance.now();
      const transferable = virtual.toTransferableChunk(chunk, requestedPlanes).chunk;
      serializeTimes.push(performance.now() - s0);
      generatedBytes += transferable.metrics.generatedBytes;
      transferBytes += transferable.metrics.transferBytes;
    }
  }

  return {
    actualBackend: 'sync',
    authoritativeCells: true,
    backendInfo: { kind: 'sync', label: 'Synchronous reference', available: true, authoritativeCells: true, details: {} },
    timingScope: 'sync generation plus local plane serialization',
    fixtureHashes,
    chunkMs: stats(chunkTimes),
    windowMs: stats(windowTimes),
    serializeMs: stats(serializeTimes),
    generatedBytes,
    transferBytes,
  };
}

async function resolveBackendRun(virtual, def, opts, requestedPlanes) {
  const backend = createBackend(virtual, opts.backend);
  if (!backend) return null;
  if (!backend.info.implemented) {
    const info = { reason: `${backend.info.label} is planned and not implemented yet; synchronous reference used`, available: backend.info.available, error: null };
    backend.dispose();
    return { ...runSyncBenchmark(virtual, def, opts, requestedPlanes), fallback: info };
  }
  if (!backend.info.available) {
    const info = { reason: `${backend.info.label} unavailable in this process`, available: false, error: null };
    backend.dispose();
    return { ...runSyncBenchmark(virtual, def, opts, requestedPlanes), fallback: info };
  }
  try {
    await backend.init(def);
    const result = await runBackendBenchmark(backend, opts, requestedPlanes);
    backend.dispose();
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    backend.dispose();
    return { ...runSyncBenchmark(virtual, def, opts, requestedPlanes), fallback: { reason: `${backend.info.label} failed; synchronous reference used`, available: true, error: reason } };
  }
}

async function runBackendBenchmark(backend, opts, requestedPlanes) {
  const fixtures = [
    [0, 0],
    [1, 0],
    [-1, 2],
    [7, -3],
  ];
  const chunkTimes = [];
  const fixtureHashes = {};
  let generatedBytes = 0;
  let transferBytes = 0;
  let jobId = 1;
  for (let r = 0; r < opts.repeats; r++) {
    for (const [cx, cy] of fixtures) {
      const t0 = performance.now();
      const { chunk } = await backend.generateChunk({ jobId: jobId++, cx, cy, requestedPlanes });
      chunkTimes.push(performance.now() - t0);
      fixtureHashes[`${cx},${cy}`] = chunk.meta.hash;
      generatedBytes = chunk.metrics.generatedBytes;
      transferBytes = chunk.metrics.transferBytes;
    }
  }
  const windowTimes = [];
  let window = null;
  for (let r = 0; r < opts.repeats; r++) {
    const t0 = performance.now();
    window = await backend.generateWindow({
      jobId: jobId++,
      cx0: -opts.radius,
      cy0: -opts.radius,
      cx1: opts.radius,
      cy1: opts.radius,
      centerCx: 0,
      centerCy: 0,
      requestedPlanes,
    });
    windowTimes.push(performance.now() - t0);
  }
  return {
    actualBackend: backend.info.kind,
    authoritativeCells: backend.info.authoritativeCells,
    backendInfo: backend.info,
    timingScope: 'backend end-to-end roundtrip',
    fixtureHashes,
    chunkMs: stats(chunkTimes),
    windowMs: stats(windowTimes),
    serializeMs: null,
    generatedBytes: window?.metrics.generatedBytes || generatedBytes,
    transferBytes: window?.metrics.transferBytes || transferBytes,
  };
}

function createBackend(virtual, requestedBackend) {
  const backend = requestedBackend === 'auto' ? 'ts-worker' : requestedBackend;
  if (backend === 'ts-worker') return new virtual.TsWorkerBackend();
  if (backend === 'webgpu-preview') return new virtual.WebGpuPreviewBackend();
  if (backend === 'wasm') return new virtual.WasmBackend();
  return null;
}

function fallbackInfoFor(virtual, requestedBackend) {
  if (requestedBackend === 'sync') return null;
  const backend = createBackend(virtual, requestedBackend);
  if (!backend) return { reason: requestedBackend === 'auto' ? 'auto selected synchronous reference because no worker backend is available in this process' : `unknown backend ${requestedBackend}`, available: false, error: null };
  try {
    const reason = backend.info.available
      ? `${backend.info.label} did not complete; synchronous reference used`
      : `${backend.info.label} unavailable in this process`;
    return { reason, available: backend.info.available, error: null };
  } finally {
    backend.dispose();
  }
}

function normalizeBackend(value) {
  switch (value) {
    case 'sync':
    case 'auto':
    case 'ts-worker':
    case 'webgpu-preview':
    case 'wasm':
      return value;
    case 'ts':
    case 'worker':
      return 'ts-worker';
    case 'webgpu':
      return 'webgpu-preview';
    default:
      throw new Error(`Unknown backend "${value}". Use sync, auto, ts-worker, webgpu-preview, or wasm.`);
  }
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    count: values.length,
    mean,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

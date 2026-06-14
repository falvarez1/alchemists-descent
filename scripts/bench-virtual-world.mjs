import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const seed = Number(process.argv[2] ?? 0x4e4f4954) >>> 0;
const radius = Number(process.argv[3] ?? 1);
const repeats = Number(process.argv[4] ?? 8);

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } });

try {
  const {
    createDefaultVirtualWorldDef,
    generateVirtualChunk,
    generateVirtualWindow,
    chunkBytes,
  } = await server.ssrLoadModule('/src/world/virtual/index.ts');

  const def = createDefaultVirtualWorldDef(seed);
  const fixtures = [
    [0, 0],
    [1, 0],
    [-1, 2],
    [7, -3],
  ];

  for (const [cx, cy] of fixtures) generateVirtualChunk(def, cx, cy);

  const chunkTimes = [];
  const fixtureHashes = {};
  let bytesPerChunk = 0;
  for (let r = 0; r < repeats; r++) {
    for (const [cx, cy] of fixtures) {
      const t0 = performance.now();
      const chunk = generateVirtualChunk(def, cx, cy);
      chunkTimes.push(performance.now() - t0);
      fixtureHashes[`${cx},${cy}`] = chunk.meta.hash;
      bytesPerChunk = chunkBytes(chunk);
    }
  }

  const cx0 = -radius;
  const cy0 = -radius;
  const cx1 = radius;
  const cy1 = radius;
  const windowTimes = [];
  let windowBytes = 0;
  for (let r = 0; r < repeats; r++) {
    const t0 = performance.now();
    const chunks = generateVirtualWindow(def, cx0, cy0, cx1, cy1);
    windowTimes.push(performance.now() - t0);
    windowBytes = chunks.reduce((sum, chunk) => sum + chunkBytes(chunk), 0);
  }

  const out = {
    seed,
    radius,
    repeats,
    chunkSize: def.chunkSize,
    fixtures: fixtureHashes,
    bytesPerChunk,
    windowBytes,
    chunkMs: stats(chunkTimes),
    windowMs: stats(windowTimes),
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

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
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

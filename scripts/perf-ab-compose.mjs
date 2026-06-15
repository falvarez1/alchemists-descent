// Compatibility wrapper for the old compose-only A/B command.
// Usage stays: node scripts/perf-ab-compose.mjs [url] [framesPerBlock] [blocks]
// The implementation now routes through perf-ab-feature so compose baselines
// get the same deterministic scene rebuild, metadata, and JSON artifact.
import { spawnSync } from 'node:child_process';

const url = process.argv[2] ?? 'http://localhost:5173/';
const frames = process.argv[3] ?? '360';
const blocks = process.argv[4] ?? '4';

const result = spawnSync(
  process.execPath,
  [
    'scripts/perf-ab-feature.mjs',
    'postFx.gpuCompose',
    'false',
    'true',
    url,
    frames,
    blocks,
    'chaos',
  ],
  { stdio: 'inherit', env: process.env },
);

process.exit(result.status ?? 1);

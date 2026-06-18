// Runs Vitest while filtering Node's own localStorage warning from workers.
// The warning is emitted by Node when test code probes the built-in
// localStorage accessor without a storage file. The tests intentionally stub or
// delete storage themselves, so this keeps passing output quiet without changing
// the unit-test environment.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const vitestBin = resolve(fileURLToPath(new URL('..', import.meta.url)), 'node_modules/vitest/vitest.mjs');
const child = spawn(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

function pipeFiltered(readable, writable) {
  let buffer = '';
  let skipTraceHint = false;
  readable.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (/^\(node:\d+\) Warning: `--localstorage-file` was provided without a valid path$/.test(line)) {
        skipTraceHint = true;
        continue;
      }
      if (skipTraceHint && /^\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)$/.test(line)) {
        skipTraceHint = false;
        continue;
      }
      skipTraceHint = false;
      writable.write(line + '\n');
    }
  });
  readable.on('end', () => {
    if (buffer.length > 0) writable.write(buffer);
  });
}

pipeFiltered(child.stdout, process.stdout);
pipeFiltered(child.stderr, process.stderr);

child.on('close', (code) => {
  process.exit(code ?? 1);
});

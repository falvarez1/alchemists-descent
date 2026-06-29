import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const scripts = [
  'verify-findability.mjs',
  'verify-encounter-lairs.mjs',
];

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`scripts/${script}`, ...args], { stdio: 'inherit' });
    child.on('close', (code, signal) => {
      resolve({ script, code: code ?? (signal ? 1 : 0), signal });
    });
  });
}

for (const script of scripts) {
  const result = await run(script);
  if (result.code !== 0) {
    console.error(`${result.script} failed${result.signal ? ` (${result.signal})` : ''}`);
    process.exit(result.code);
  }
}

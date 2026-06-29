// One discoverable entry point for browser runtime/UI smoke probes.
// Usage:
//   npm run verify:runtime              # spawns a dev server
//   npm run verify:runtime -- <url>     # runs against an existing server
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 5201;
const argUrl = process.argv[2];
let port = DEFAULT_PORT;
let url = argUrl || `http://localhost:${port}/`;
const PROBES = [
  'verify-game.mjs',
  'verify-run-launcher.mjs',
  'verify-app-dialogs.mjs',
  'verify-card-offers.mjs',
  'verify-runtime-ui.mjs',
  'verify-debug-tool.mjs',
  'verify-minimap-popovers.mjs',
  'verify-minimap-waypoint.mjs',
  'verify-encounter-lairs.mjs',
  'verify-enemy-ai-regressions.mjs',
  'verify-organic-enemy-trio.mjs',
  'verify-organic-enemy-trio-sprites.mjs',
];
const PROBE_TIMEOUT_MS = 240_000;

function ping(targetUrl) {
  return new Promise((resolve) => {
    const req = http.get(targetUrl, (res) => {
      res.destroy();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(targetUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ping(targetUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function canBindPort(candidatePort) {
  return new Promise((resolvePort) => {
    const server = net.createServer();
    server.once('error', () => resolvePort(false));
    server.once('listening', () => {
      server.close(() => resolvePort(true));
    });
    server.listen(candidatePort, '127.0.0.1');
  });
}

async function pickPort(startPort) {
  for (let candidate = startPort; candidate < startPort + 20; candidate++) {
    if (await canBindPort(candidate)) return candidate;
  }
  throw new Error(`No free port found from ${startPort} to ${startPort + 19}`);
}

function killChild(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function runProbe(probe) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`scripts/${probe}`, url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      out += `\nTimed out after ${PROBE_TIMEOUT_MS}ms`;
      killChild(child);
    }, PROBE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const clean = out.trim();
      const exitCode = timedOut ? 1 : code ?? 1;
      const summary = clean.split(/\r?\n/).slice(-3).join(' | ') || (exitCode === 0 ? 'ok' : 'errored');
      resolve({ probe, code: exitCode, summary });
    });
  });
}

let server = null;
function cleanup() {
  if (!server) return;
  try {
    killChild(server);
  } catch {
    // best effort
  }
  server = null;
}

if (argUrl) {
  if (!(await ping(url))) {
    console.error(`No dev server reachable at ${url}`);
    process.exit(2);
  }
  console.log(`Using server already running at ${url}`);
} else {
  port = await pickPort(DEFAULT_PORT);
  url = `http://localhost:${port}/`;
  console.log(`Spawning dev server on :${port} ...`);
  const viteBin = resolve(fileURLToPath(new URL('..', import.meta.url)), 'node_modules/vite/bin/vite.js');
  server = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  if (!(await waitForServer(url, 60000))) {
    console.error('Dev server did not come up in 60s');
    cleanup();
    process.exit(2);
  }
}

const results = [];
for (const probe of PROBES) {
  process.stdout.write(`  ${probe.padEnd(30)} `);
  const result = await runProbe(probe);
  results.push(result);
  console.log(`${result.code === 0 ? 'PASS' : 'FAIL'}  (${result.summary})`);
}
cleanup();

const failed = results.filter((result) => result.code !== 0);
console.log(`\nverify:runtime - ${results.length - failed.length}/${results.length} probes passed`);
if (failed.length > 0) console.log('  failed: ' + failed.map((result) => result.probe).join(', '));
process.exit(failed.length > 0 ? 1 : 0);

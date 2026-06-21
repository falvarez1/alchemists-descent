// Managed release gate for Builder/game decoupling.
//
// Usage:
//   node scripts/verify-builder-decoupling-suite.mjs
//   node scripts/verify-builder-decoupling-suite.mjs http://127.0.0.1:5173/
//
// The optional URL is used for dev-server probes. The production bundle/network
// checks still build and run against a local Vite preview server.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DEV_PORT = 5310;
const DEFAULT_PREVIEW_PORT = 5320;
const existingDevUrl = process.argv.find((arg) => /^https?:\/\//i.test(arg)) ?? null;
const viteBin = resolve(fileURLToPath(new URL('..', import.meta.url)), 'node_modules/vite/bin/vite.js');
const tscBin = resolve(fileURLToPath(new URL('..', import.meta.url)), 'node_modules/typescript/bin/tsc');

const results = [];
const servers = [];
const activeChildren = new Set();
const logDir = 'verify-out/builder-decoupling';
mkdirSync(logDir, { recursive: true });

function taskkill(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function cleanup() {
  for (const child of activeChildren) taskkill(child);
  activeChildren.clear();
  while (servers.length > 0) taskkill(servers.pop());
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

function ping(targetUrl) {
  return new Promise((resolvePing) => {
    const req = http.get(targetUrl, (res) => {
      res.destroy();
      resolvePing(res.statusCode === 200);
    });
    req.on('error', () => resolvePing(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolvePing(false);
    });
  });
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
  for (let candidate = startPort; candidate < startPort + 30; candidate++) {
    if (await canBindPort(candidate)) return candidate;
  }
  throw new Error(`No free port found from ${startPort} to ${startPort + 29}`);
}

function summarize(output, failed = false) {
  const clean = output.trim();
  if (!clean) return 'ok';
  return clean.split(/\r?\n/).slice(failed ? -20 : -3).join(' | ').slice(0, failed ? 1800 : 600);
}

function logPathFor(label) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'step';
  return `${logDir}/${slug}.log`;
}

function runCommand(label, command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 180_000;
  return new Promise((resolveRun) => {
    process.stdout.write(`  ${label.padEnd(34)} `);
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    } catch (error) {
      const result = { label, code: 1, logPath: logPathFor(label), summary: String(error) };
      writeFileSync(result.logPath, result.summary);
      results.push(result);
      console.log(`FAIL  ${result.summary}`);
      resolveRun(result);
      return;
    }
    let output = '';
    const timer = setTimeout(() => {
      output += `\nTimed out after ${timeoutMs}ms`;
      taskkill(child);
    }, timeoutMs);
    activeChildren.add(child);
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', (code) => {
      activeChildren.delete(child);
      clearTimeout(timer);
      const result = { label, code: code ?? 1, logPath: logPathFor(label), summary: '' };
      writeFileSync(result.logPath, output);
      result.summary = summarize(output, result.code !== 0);
      results.push(result);
      console.log(`${result.code === 0 ? 'PASS' : 'FAIL'}  ${result.summary}`);
      resolveRun(result);
    });
  });
}

async function spawnServer(label, args, startPort) {
  const port = await pickPort(startPort);
  const url = `http://127.0.0.1:${port}/`;
  const logPath = logPathFor(`${label} server`);
  console.log(`Spawning ${label} on :${port} ...`);
  const child = spawn(process.execPath, [viteBin, ...args, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  let exited = false;
  writeFileSync(logPath, '');
  child.stdout.on('data', (chunk) => appendFileSync(logPath, chunk));
  child.stderr.on('data', (chunk) => appendFileSync(logPath, chunk));
  child.on('close', (code, signal) => {
    exited = true;
    appendFileSync(logPath, `\n${label} exited with code=${code ?? 'null'} signal=${signal ?? 'null'}\n`);
  });
  servers.push(child);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`${label} exited before becoming reachable at ${url}; log: ${logPath}`);
    if (await ping(url)) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 750));
      if (exited) throw new Error(`${label} exited immediately after becoming reachable at ${url}; log: ${logPath}`);
      if (!(await ping(url))) throw new Error(`${label} stopped responding after readiness at ${url}; log: ${logPath}`);
      return url;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  taskkill(child);
  throw new Error(`${label} did not become reachable at ${url}; log: ${logPath}`);
}

async function runRequired(label, command, args, options) {
  const result = await runCommand(label, command, args, options);
  if (result.code !== 0) {
    console.error(`\nStopping after required step failed: ${label}`);
    process.exit(1);
  }
}

await runRequired('builder boundaries', process.execPath, ['scripts/verify-builder-boundaries.mjs', '--strict']);
await runRequired('production typecheck', process.execPath, [tscBin, '--noEmit'], { timeoutMs: 180_000 });
await runRequired('production Vite build', process.execPath, [viteBin, 'build'], { timeoutMs: 180_000 });
await runRequired('bundle boundary', process.execPath, ['scripts/verify-builder-bundle-boundary.mjs']);

let previewUrl = null;
try {
  previewUrl = await spawnServer('Vite preview', ['preview'], DEFAULT_PREVIEW_PORT);
  await runRequired('prod network lazy-load', process.execPath, ['scripts/verify-builder-prod-network.mjs', previewUrl], {
    timeoutMs: 120_000,
  });
} finally {
  cleanup();
}

let devUrl = existingDevUrl;
if (devUrl) {
  if (!(await ping(devUrl))) {
    console.error(`No dev server reachable at ${devUrl}`);
    process.exit(2);
  }
  console.log(`Using existing dev server at ${devUrl}`);
} else {
  devUrl = await spawnServer('Vite dev server', [], DEFAULT_DEV_PORT);
}

const devProbes = [
  ['runtime smoke', 'scripts/verify-game.mjs'],
  ['runtime UI', 'scripts/verify-runtime-ui.mjs'],
  ['builder assets', 'scripts/verify-builder-assets.mjs'],
  ['builder UX', 'scripts/verify-builder-ux.mjs'],
  ['builder pro workflow', 'scripts/verify-builder-pro.mjs'],
  ['builder dock split', 'scripts/verify-builder-dock-split.mjs'],
  ['builder responsive', 'scripts/verify-builder-responsive.mjs'],
  ['builder expedition safety', 'scripts/verify-builder-expedition.mjs'],
  ['virtual playtest render', 'scripts/verify-virtual-playtest.mjs'],
  ['campaign playtest render', 'scripts/verify-campaign-playtest.mjs'],
  ['findability audit', 'scripts/verify-findability.mjs', 600_000],
];

for (const [label, script, timeoutMs = 240_000] of devProbes) {
  if (!(await ping(devUrl))) {
    const result = {
      label,
      code: 1,
      logPath: logPathFor(label),
      summary: `dev server not reachable before ${label}: ${devUrl}`,
    };
    writeFileSync(result.logPath, result.summary);
    results.push(result);
    console.log(`  ${label.padEnd(34)} FAIL  ${result.summary}`);
    continue;
  }
  await runCommand(label, process.execPath, [script, devUrl], { timeoutMs });
}

cleanup();

const failed = results.filter((result) => result.code !== 0);
console.log(`\nBuilder decoupling suite: ${results.length - failed.length}/${results.length} steps passed`);
if (failed.length > 0) {
  console.log('Failed steps:');
  for (const result of failed) console.log(`  - ${result.label}: ${result.summary}\n    log: ${result.logPath}`);
}
process.exit(failed.length > 0 ? 1 : 0);

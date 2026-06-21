// One gate for all the game-feel + sim probes: levitation/recoil/inertia,
// tap/jump/air movement, dive-stomp, hidden ore, lava-water, difficulty scaling.
// Reuses a dev server if one is already up on the port, else spawns + tears down
// its own.
//
//   npm run verify:feel              # spawns its own dev server
//   npm run verify:feel -- <url>     # runs against an already-running server
//
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';

const PORT = 5199;
const argUrl = process.argv[2];
const url = argUrl || `http://localhost:${PORT}/`;

const PROBES = [
  'verify-feel.mjs', // levitation ramp + wand recoil + air inertia
  'verify-tap-precision.mjs',
  'verify-jump-precision.mjs',
  'verify-air-tap.mjs',
  'verify-slope-speed.mjs',
  'verify-stomp.mjs',
  'verify-rawore.mjs',
  'verify-lava-water.mjs',
  'verify-difficulty.mjs',
];
const PROBE_TIMEOUT_MS = 240_000;

function ping(u) {
  return new Promise((resolve) => {
    const req = http.get(u, (res) => { res.destroy(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

async function waitForServer(u, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ping(u)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
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
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      const m = out.match(/(\d+) passed, (\d+) failed/);
      const exitCode = timedOut ? 1 : code ?? 1;
      const tail = out.trim().split(/\r?\n/).slice(-3).join(' | ');
      const summary = m ? `${m[1]} passed, ${m[2]} failed` : exitCode === 0 ? 'ok' : tail || 'errored';
      resolve({ probe, code: exitCode, summary });
    });
  });
}

let server = null;
function cleanup() {
  if (!server) return;
  try {
    killChild(server);
  } catch { /* best effort */ }
  server = null;
}

const alreadyUp = await ping(url);
if (!alreadyUp) {
  if (argUrl) { console.error(`No dev server reachable at ${url}`); process.exit(2); }
  console.log(`Spawning dev server on :${PORT} ...`);
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', shell: true });
  if (!(await waitForServer(url, 60000))) { console.error('Dev server did not come up in 60s'); cleanup(); process.exit(2); }
} else {
  console.log(`Using server already running at ${url}`);
}

const results = [];
for (const p of PROBES) {
  process.stdout.write(`  ${p.padEnd(28)} `);
  const r = await runProbe(p);
  results.push(r);
  console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  (${r.summary})`);
}
cleanup();

const failed = results.filter((r) => r.code !== 0);
console.log(`\nverify:feel — ${results.length - failed.length}/${results.length} probes passed`);
if (failed.length) console.log('  failed: ' + failed.map((r) => r.probe).join(', '));
process.exit(failed.length ? 1 : 0);

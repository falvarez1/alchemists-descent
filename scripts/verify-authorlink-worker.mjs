// Cloudflare Durable Object probe — runs the REAL worker under workerd via
// `wrangler dev`, with no Cloudflare account and no deploy.
//
// This covers the code path that only exists in `servers/authorlink/worker.js`:
// Durable Object routing, the hibernation-style `acceptWebSocket` accept, and
// snapshot persistence through `state.storage`. The last one is the reason
// this probe is worth having — a relay that loses its tuning snapshot when the
// object is evicted works perfectly until the room goes quiet for a minute and
// then silently stops catching up late joiners. It is restarted mid-probe to
// force exactly that.
//
// Usage: node scripts/verify-authorlink-worker.mjs
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workerDir = join(repoRoot, 'servers', 'authorlink');
const PORT = 8799;
const TOKEN = 'worker-probe-token';
const GOOD_ORIGIN = 'http://localhost:5173';
const URL_BASE = `ws://127.0.0.1:${PORT}/__authorlink?room=probe`;

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

let child = null;
function startWorker() {
  return new Promise((resolve, reject) => {
    child = spawn(
      'npx',
      ['wrangler', 'dev', '--port', String(PORT), '--local', '--var', `ROOM_TOKEN:${TOKEN}`],
      { cwd: workerDir, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
    );
    const timer = setTimeout(() => reject(new Error('wrangler dev did not become ready')), 90_000);
    const onData = (chunk) => {
      if (String(chunk).includes('Ready on http')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) reject(new Error(`wrangler exited ${code}`));
    });
  });
}

async function stopWorker() {
  if (!child) return;
  const pid = child.pid;
  child = null;
  await new Promise((resolve) => {
    // workerd is a grandchild of the shell on Windows; a plain kill() orphans
    // it and the next start fails on a busy port.
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }).on('exit', resolve);
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          /* already gone */
        }
      }
      resolve();
    }
  });
  await settle(1500);
}

const env = (type, clientId, payload) =>
  JSON.stringify({ type, protocol: 1, room: 'probe', clientId, revision: 0, sentAt: Date.now(), payload });

function connect(origin = GOOD_ORIGIN) {
  const ws = new WebSocket(URL_BASE, origin ? { headers: { Origin: origin } } : undefined);
  const inbox = [];
  ws.on('error', () => undefined);
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
  const opened = new Promise((resolve) => {
    ws.once('open', () => resolve('open'));
    ws.once('error', () => resolve('refused'));
    ws.once('close', () => resolve('refused'));
    setTimeout(() => resolve('timeout'), 10_000);
  });
  return { ws, inbox, opened };
}

// A clean slate: leftover Durable Object storage from a previous run would
// make the persistence assertion below pass for the wrong reason.
await rm(join(workerDir, '.wrangler'), { recursive: true, force: true });

try {
  console.log('-- starting the real Durable Object under workerd');
  await startWorker();
  check('wrangler dev started the Worker + Durable Object binding', true);

  const a = connect();
  const b = connect();
  check('an allowlisted origin connects', (await a.opened) === 'open' && (await b.opened) === 'open');

  a.ws.send(env('hello', 'w-a', { role: 'builder', build: 'probe', token: TOKEN }));
  b.ws.send(env('hello', 'w-b', { role: 'play', build: 'probe', token: TOKEN }));
  await settle(700);
  check('the DO welcomes clients', a.inbox.some((m) => m.type === 'welcome'));

  b.inbox.length = 0;
  a.ws.send(env('tuning', 'w-a', { changes: [{ path: 'global.ambient', value: 0.37 }] }));
  await settle(700);
  check('a patch fans out through the Durable Object', b.inbox.some((m) => m.type === 'tuning'));

  a.inbox.length = 0;
  b.inbox.length = 0;
  a.ws.send(env('tuning', 'w-a', { changes: [{ path: 'global.ambient', value: 9999 }] }));
  await settle(700);
  check('the DO enforces ranges (strict is always on here)', !b.inbox.some((m) => m.type === 'tuning'));
  check(
    'and says why',
    a.inbox.some((m) => m.type === 'error' && m.payload.code === 'rejected'),
    JSON.stringify(a.inbox.map((m) => m.type)),
  );

  console.log('-- a late joiner catches up on the room snapshot');
  const c = connect();
  await c.opened;
  c.ws.send(env('hello', 'w-c', { role: 'play', build: 'probe', token: TOKEN }));
  await settle(700);
  const welcome = c.inbox.find((m) => m.type === 'welcome');
  check(
    'the snapshot reaches a late joiner',
    welcome?.payload.tuning?.some((t) => t.path === 'global.ambient' && t.value === 0.37),
    JSON.stringify(welcome?.payload.tuning),
  );

  console.log('-- a client with no token is read-only');
  const anon = connect();
  await anon.opened;
  anon.ws.send(env('hello', 'w-anon', { role: 'play', build: 'probe' }));
  await settle(700);
  check('an untokened client is welcomed', anon.inbox.some((m) => m.type === 'welcome'));
  check('an untokened client is told it is read-only', anon.inbox.some((m) => m.type === 'error'));
  b.inbox.length = 0;
  anon.ws.send(env('tuning', 'w-anon', { changes: [{ path: 'global.ambient', value: 0.29 }] }));
  await settle(700);
  check('an untokened client cannot write', !b.inbox.some((m) => m.type === 'tuning'));

  console.log('-- the origin allowlist is enforced by the Worker');
  const bad = connect('http://evil.example');
  check('a disallowed origin is refused', (await bad.opened) === 'refused');

  for (const conn of [a, b, c, anon, bad]) conn.ws.close();
  await settle(500);

  console.log('-- RESTART: the room snapshot must survive losing the object');
  // This is the hibernation risk in its harshest form: the object does not
  // just lose memory, the whole runtime goes away. If `restore()` and the
  // persisted snapshot are wired correctly, a fresh client still catches up.
  await stopWorker();
  await startWorker();

  const revived = connect();
  check('reconnects after the Worker restarts', (await revived.opened) === 'open');
  revived.ws.send(env('hello', 'w-revived', { role: 'play', build: 'probe', token: TOKEN }));
  await settle(1200);
  const revivedWelcome = revived.inbox.find((m) => m.type === 'welcome');
  check(
    'the tuning snapshot survived the restart',
    revivedWelcome?.payload.tuning?.some((t) => t.path === 'global.ambient' && t.value === 0.37),
    JSON.stringify(revivedWelcome?.payload.tuning),
  );
  check(
    'the revision counter survived too',
    typeof revivedWelcome?.payload.revision === 'number' && revivedWelcome.payload.revision > 0,
    `revision=${revivedWelcome?.payload.revision}`,
  );
  revived.ws.close();
} finally {
  await stopWorker();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

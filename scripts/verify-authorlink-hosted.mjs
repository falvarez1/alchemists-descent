// Hosted-relay probe: a PRODUCTION build of the static client, served from
// dist, talking to an EXTERNAL relay process in strict mode.
//
// This is the shape a Cloudflare deployment has — static client on one origin,
// relay on another, strict validation, room token — minus Cloudflare itself.
// It is what can be verified without an account, and it covers the parts most
// likely to be wrong: build-time relay config, cross-origin WebSocket, token
// gating, and per-path range enforcement.
//
// Usage: node scripts/verify-authorlink-hosted.mjs
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser-launch.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const RELAY_PORT = 8791;
const SITE_PORT = 8792;
const TOKEN = 'probe-token-9f3a';

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

const run = (cmd, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });

console.log('-- building the static client against an external relay origin');
await run('npm', ['run', 'build'], {
  VITE_AUTHORLINK_URL: `ws://localhost:${RELAY_PORT}`,
  VITE_AUTHORLINK_TOKEN: TOKEN,
});

console.log('-- ensuring the relay range schema is current');
await run('node', ['scripts/gen-tuning-ranges.mjs', '--check']);

// A deliberately minimal static host: the point is that the client is a plain
// static artifact with no server of its own, exactly like GitHub Pages.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.map': 'application/json' };
const dist = join(repoRoot, 'dist');
const site = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = normalize(join(dist, decodeURIComponent(url.pathname)));
    if (!file.startsWith(dist)) {
      res.writeHead(403).end();
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
site.listen(SITE_PORT);
await once(site, 'listening');

console.log(`-- starting an external STRICT relay on :${RELAY_PORT}`);
const relay = spawn(
  process.execPath,
  [
    'scripts/authorlink-server.mjs',
    '--port',
    String(RELAY_PORT),
    '--strict',
    '--token',
    TOKEN,
    '--origin',
    `http://localhost:${SITE_PORT}`,
  ],
  { cwd: repoRoot, stdio: ['ignore', 'pipe', 'inherit'] },
);
relay.stdout.setEncoding('utf8');
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('relay did not start')), 15000);
  relay.stdout.on('data', (chunk) => {
    if (chunk.includes('relay on ws://')) {
      clearTimeout(timer);
      resolve();
    }
  });
});
check('strict relay started with a token and an origin allowlist', true);

const browser = await launchBrowser();
const errs = [];
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const a = await ctxA.newPage();
const b = await ctxB.newPage();
for (const [tag, p] of [['A', a], ['B', b]]) p.on('pageerror', (e) => errs.push(`${tag}: ${e}`));

// A production build exposes no `window.__game`: that handle is dev-only, and
// relying on it would mean this probe never actually tested a shipped
// artifact. Everything below goes through the real UI instead.
const boot = async (page) => {
  await page.goto(`http://localhost:${SITE_PORT}/?link=hosted`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#g-ambient', { timeout: 40000 });
  await page.waitForFunction(() => !document.getElementById('boot-overlay'), { timeout: 40000 });
};
await boot(a);
await boot(b);

// A production build has no `window.__authorLink` debug handle, so the probe
// asserts through OBSERVABLE behavior — the pill and the live params — which
// is the right level anyway: it is what a user can actually see.
const pillOf = async (page) =>
  page.evaluate(() => {
    const el = document.getElementById('authorlink-status');
    return el ? { text: el.textContent, state: el.dataset.state } : null;
  });

let connected = false;
try {
  await a.waitForFunction(
    () => document.getElementById('authorlink-status')?.dataset.state === 'connected',
    { timeout: 25000 },
  );
  await b.waitForFunction(
    () => document.getElementById('authorlink-status')?.dataset.state === 'connected',
    { timeout: 25000 },
  );
  connected = true;
} catch {
  connected = false;
}
check('the production build connected to the external relay', connected, JSON.stringify(await pillOf(a)));

let sawPeer = false;
try {
  await a.waitForFunction(() => /LINK\s+1/.test(document.getElementById('authorlink-status')?.textContent ?? ''), {
    timeout: 20000,
  });
  sawPeer = true;
} catch {
  sawPeer = false;
}
check('both static clients joined the hosted room', sawPeer, JSON.stringify(await pillOf(a)));

console.log('-- tuning: a real slider drag crosses the hosted relay');
// Driven through the actual Sandbox slider, in a production build, over a
// cross-origin WebSocket. Playwright's fill fires native input/change events,
// so this exercises the same binding a human would.
const readAmbient = async (page) => (await page.locator('#g-ambient-value').innerText()).trim();
const startedAt = await readAmbient(b);
await a.locator('#g-ambient').fill('0.44');
let crossed = false;
try {
  await b.waitForFunction(() => document.getElementById('g-ambient-value')?.textContent?.trim() === '0.44', {
    timeout: 12000,
  });
  crossed = true;
} catch {
  crossed = false;
}
check('in-range tuning applied across the relay', crossed, `peer was ${startedAt}, now ${await readAmbient(b)}`);
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();

// ---------------------------------------------------------------------------
// The strict-mode edges are protocol behavior, not UI behavior, and a slider
// physically cannot produce an out-of-range value. Raw sockets test them
// directly and unambiguously, against the same running relay.
console.log('-- strict: raw-socket checks against the same relay');
const { WebSocket: NodeWebSocket } = await import('ws');
const RELAY_URL = `ws://localhost:${RELAY_PORT}/__authorlink?room=hosted`;
const GOOD_ORIGIN = `http://localhost:${SITE_PORT}`;

const connect = (origin) => {
  const ws = new NodeWebSocket(RELAY_URL, origin ? { headers: { Origin: origin } } : undefined);
  const inbox = [];
  ws.on('error', () => undefined);
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
  return { ws, inbox };
};
const env = (type, clientId, payload) =>
  JSON.stringify({ type, protocol: 1, room: 'hosted', clientId, revision: 0, sentAt: Date.now(), payload });
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

const one = connect(GOOD_ORIGIN);
const two = connect(GOOD_ORIGIN);
await Promise.all([once(one.ws, 'open'), once(two.ws, 'open')]);
one.ws.send(env('hello', 'raw-1', { role: 'builder', build: 'probe', token: TOKEN }));
two.ws.send(env('hello', 'raw-2', { role: 'play', build: 'probe', token: TOKEN }));
await settle();
two.inbox.length = 0;

one.ws.send(env('tuning', 'raw-1', { changes: [{ path: 'global.ambient', value: 0.33 }] }));
await settle(600);
check('an in-range patch fans out', two.inbox.some((m) => m.type === 'tuning'));

two.inbox.length = 0;
one.inbox.length = 0;
one.ws.send(env('tuning', 'raw-1', { changes: [{ path: 'global.ambient', value: 9999 }] }));
await settle(600);
check('an out-of-range patch is not fanned out', !two.inbox.some((m) => m.type === 'tuning'));
check(
  'the sender is told why',
  one.inbox.some((m) => m.type === 'error' && m.payload.code === 'rejected'),
  JSON.stringify(one.inbox.map((m) => m.type)),
);

one.inbox.length = 0;
one.ws.send(env('tuning', 'raw-1', { changes: [{ path: 'pacing.playerStart', value: 0.5 }] }));
await settle(600);
check(
  'an unboundable path is refused rather than guessed at',
  one.inbox.some((m) => m.type === 'error' && m.payload.code === 'rejected'),
);

console.log('-- strict: a client with no token is read-only, not disconnected');
const anon = connect(GOOD_ORIGIN);
await once(anon.ws, 'open');
anon.ws.send(env('hello', 'raw-anon', { role: 'play', build: 'probe' }));
await settle(600);
check('an untokened client is still welcomed', anon.inbox.some((m) => m.type === 'welcome'));
check(
  'an untokened client is told it is read-only',
  anon.inbox.some((m) => m.type === 'error' && /token/i.test(m.payload.detail ?? '')),
);
two.inbox.length = 0;
anon.ws.send(env('tuning', 'raw-anon', { changes: [{ path: 'global.ambient', value: 0.31 }] }));
await settle(600);
check('an untokened client cannot write', !two.inbox.some((m) => m.type === 'tuning'));

console.log('-- strict: the origin allowlist is enforced at the handshake');
const badOrigin = connect('http://evil.example');
// `events.once` special-cases 'error' by REJECTING, and a refused handshake
// emits exactly that — so this waits on the raw listeners instead.
const outcome = await new Promise((resolve) => {
  const done = (v) => resolve(v);
  badOrigin.ws.once('open', () => done('opened'));
  badOrigin.ws.once('error', () => done('refused'));
  badOrigin.ws.once('close', () => done('refused'));
  setTimeout(() => done('timeout'), 6000);
});
check('a disallowed origin cannot open the room', outcome === 'refused', String(outcome));

for (const c of [one, two, anon, badOrigin]) c.ws.close();
relay.kill();
site.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

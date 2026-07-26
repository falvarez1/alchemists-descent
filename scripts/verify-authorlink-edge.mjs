// Live-edge probe: verifies a DEPLOYED AuthorLink relay over real wss://.
//
// This is the only probe that exercises the two things local testing cannot:
// TLS termination at Cloudflare's edge, and the Durable Object running on
// Cloudflare's runtime rather than local workerd.
//
// Waits are deliberately generous (1.5s). Edge round-trips are an order of
// magnitude slower than localhost, and a 700ms wait produced a false failure
// that looked like broken token handling. Give a freshly deployed Worker a few
// seconds to propagate first — the very first attempt against a just-deployed
// Worker was refused outright.
//
// Usage: node scripts/verify-authorlink-edge.mjs <token-file> <relay-host>
//   AUTHORLINK_ORIGIN must match one of the relay's ALLOWED_ORIGINS exactly.
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';

const TOKEN = process.argv[2] ? readFileSync(process.argv[2], 'utf8').trim() : '';
const HOST = process.argv[3];
if (!TOKEN || !HOST) {
  // No default host on purpose: the one this was first run against was a
  // temporary preview that expires within hours, and a stale default would
  // fail confusingly instead of telling you what is missing.
  console.error('usage: node scripts/verify-authorlink-edge.mjs <token-file> <relay-host>');
  console.error('  e.g. node scripts/verify-authorlink-edge.mjs .token my-relay.workers.dev');
  process.exit(2);
}
const URL_BASE = `wss://${HOST}/__authorlink?room=edge`;
// Must match one of the relay's ALLOWED_ORIGINS entries exactly.
const GOOD_ORIGIN = process.env.AUTHORLINK_ORIGIN ?? 'https://falvarez1.github.io';

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
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const env = (type, clientId, payload) =>
  JSON.stringify({ type, protocol: 1, room: 'edge', clientId, revision: 0, sentAt: Date.now(), payload });

function connect(origin = GOOD_ORIGIN) {
  const ws = new WebSocket(URL_BASE, origin ? { headers: { Origin: origin } } : undefined);
  const inbox = [];
  ws.on('error', () => undefined);
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
  const opened = new Promise((r) => {
    ws.once('open', () => r('open'));
    ws.once('error', () => r('refused'));
    ws.once('close', () => r('refused'));
    setTimeout(() => r('timeout'), 15000);
  });
  return { ws, inbox, opened };
}

console.log(`-- wss:// to ${HOST}`);
const a = connect(), b = connect();
check('TLS-terminated wss:// connection established at the edge',
  (await a.opened) === 'open' && (await b.opened) === 'open');

a.ws.send(env('hello', 'edge-a', { role: 'builder', build: 'probe', token: TOKEN }));
b.ws.send(env('hello', 'edge-b', { role: 'play', build: 'probe', token: TOKEN }));
await settle();
check('the Durable Object welcomed both clients', a.inbox.some((m) => m.type === 'welcome'));

b.inbox.length = 0;
a.ws.send(env('tuning', 'edge-a', { changes: [{ path: 'global.ambient', value: 0.31 }] }));
await settle();
check('a patch fans out through the edge DO', b.inbox.some((m) => m.type === 'tuning'));

a.inbox.length = 0; b.inbox.length = 0;
a.ws.send(env('tuning', 'edge-a', { changes: [{ path: 'global.ambient', value: 9999 }] }));
await settle();
check('range validation runs on the edge', !b.inbox.some((m) => m.type === 'tuning'));
check('and the sender is told', a.inbox.some((m) => m.type === 'error' && m.payload.code === 'rejected'));

console.log('-- token + origin enforcement at the edge');
const anon = connect();
await anon.opened;
anon.ws.send(env('hello', 'edge-anon', { role: 'play', build: 'probe' }));
await settle();
check('an untokened client is welcomed read-only', anon.inbox.some((m) => m.type === 'welcome'));
b.inbox.length = 0;
anon.ws.send(env('tuning', 'edge-anon', { changes: [{ path: 'global.ambient', value: 0.22 }] }));
await settle();
check('an untokened client cannot write', !b.inbox.some((m) => m.type === 'tuning'));

const bad = connect('https://evil.example');
check('a disallowed origin is refused at the edge', (await bad.opened) === 'refused');

console.log('-- DO state: a late joiner catches up from real edge storage');
const c = connect();
await c.opened;
c.ws.send(env('hello', 'edge-c', { role: 'play', build: 'probe', token: TOKEN }));
await settle(1200);
const w = c.inbox.find((m) => m.type === 'welcome');
check('snapshot served from the live Durable Object',
  w?.payload.tuning?.some((t) => t.path === 'global.ambient' && t.value === 0.31),
  JSON.stringify(w?.payload.tuning));

for (const x of [a, b, anon, bad, c]) x.ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

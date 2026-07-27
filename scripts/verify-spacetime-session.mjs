#!/usr/bin/env node
/**
 * Live verification of the SpacetimeDB session substrate.
 *
 * Runs against a REAL local SpacetimeDB with the module published — no mocks,
 * no in-memory stand-in. The whole point of staging the substrate under the
 * editor first is to find out what actually happens, so this drives genuine
 * WebSocket clients through genuine reducers and reads the resulting rows back.
 *
 *   spacetime start                                          (separate shell)
 *   spacetime publish alchemists-descent --server local --yes --project-path servers/spacetime/spacetimedb
 *   node scripts/verify-spacetime-session.mjs
 *
 * What it proves, in order of how much it would hurt to get wrong:
 *
 *   1. HOST MIGRATION. The host disconnecting hands off to the
 *      longest-connected survivor rather than stranding the room.
 *   2. Durability — the session outlives every member leaving, which is the
 *      entire reason this plane exists.
 *   3. Frame relay round-trips an opaque AuthorLink envelope byte-for-byte.
 *   4. The guards actually refuse: non-members cannot publish, oversized
 *      frames are rejected, only the host may transfer the host role.
 *
 * The generated bindings use extensionless bundler-style imports, which Vite
 * resolves natively in the browser but Node's ESM loader will not. esbuild
 * bundles them here so the probe stays a plain `node` script.
 */

import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'verify-out', 'spacetime');
const URI = process.env.SPACETIME_URI ?? 'ws://127.0.0.1:3000';
const DB = process.env.SPACETIME_DB ?? 'alchemists-descent';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, detail = '') {
  passed++;
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function bad(name, detail) {
  failed++;
  failures.push(`${name}: ${detail}`);
  console.log(`  FAIL  ${name} — ${detail}`);
}
function check(name, cond, detail = '') {
  if (cond) ok(name, detail);
  else bad(name, detail || 'assertion failed');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until `fn()` is truthy, so nothing depends on a guessed sleep. */
async function until(label, fn, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(50);
  }
}

async function bundleBindings() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const outfile = join(OUT, 'bindings.mjs');
  await build({
    entryPoints: [join(ROOT, 'servers', 'spacetime', 'bindings', 'index.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    // Resolve `spacetimedb` from node_modules rather than inlining the SDK.
    packages: 'external',
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

/**
 * Bundle the REAL client stack — `AuthorLinkClient` over `SpacetimeDbTransport`
 * over `createSpacetimeConnector` — so the last phase exercises the shipping
 * code rather than a reimplementation of it. A probe that re-derives the
 * behaviour it is checking proves only that the probe works.
 */
async function bundleClientStack() {
  const entry = join(OUT, 'entry.ts');
  writeFileSync(
    entry,
    [
      "export { AuthorLinkClient } from '@/net/AuthorLinkClient';",
      "export { SpacetimeDbTransport } from '@/net/SpacetimeDbTransport';",
      "export { createSpacetimeConnector } from '@/net/spacetimeConnector';",
    ].join('\n'),
    'utf8',
  );
  const outfile = join(OUT, 'client.mjs');
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    alias: { '@': join(ROOT, 'src') },
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

/**
 * One connected window.
 *
 * Each client gets a FRESH anonymous identity by not reusing a token. That
 * matters: real browser windows on one machine share a localStorage token and
 * therefore an Identity, which is exactly why the module keys members by
 * ConnectionId. Both shapes are exercised — see the shared-identity check.
 */
async function connect({ DbConnection }, { clientId, role = 'builder', token }) {
  const frames = [];
  const conn = await new Promise((resolvePromise, rejectPromise) => {
    const builder = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnect((c) => resolvePromise(c))
      .onConnectError((_ctx, error) => rejectPromise(error));
    if (token) builder.withToken(token);
    builder.build();
  });

  await new Promise((resolvePromise, rejectPromise) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => resolvePromise())
      .onError((_ctx, error) => rejectPromise(error ?? new Error('subscription error')))
      .subscribe(['SELECT * FROM session', 'SELECT * FROM player', 'SELECT * FROM frame', 'SELECT * FROM chat', 'SELECT * FROM presence']);
  });

  conn.db.frame.onInsert((_ctx, row) => frames.push(row));

  return {
    conn,
    clientId,
    frames,
    connKey: () => conn.connectionId?.toHexString?.() ?? String(conn.connectionId),
    join: (room) => conn.reducers.joinSession({ room, clientId, role, build: 'verify' }),
    publish: (room, data) => conn.reducers.publishFrame({ room, data }),
    close: () => conn.disconnect(),
  };
}

const sessionRow = (client, room) => [...client.conn.db.session.iter()].find((s) => s.name === room);
const hostKey = (client, room) => {
  const row = sessionRow(client, room);
  const host = row?.host;
  if (!host) return null;
  return host.toHexString?.() ?? String(host);
};
const members = (client, room) => [...client.conn.db.player.iter()].filter((p) => p.room === room);

/**
 * Call a reducer and report the outcome.
 *
 * The SDK resolves on commit and REJECTS with the module's `SenderError` on a
 * refusal, so the guard checks read the server's actual reason rather than
 * inferring one from an absent side effect.
 */
async function call(fn) {
  try {
    await fn();
    return { ok: true };
  } catch (error) {
    return { ok: false, failed: String(error?.message ?? error) };
  }
}

async function main() {
  console.log(`SpacetimeDB session substrate — ${URI}/${DB}\n`);
  const bindings = await bundleBindings();
  const room = `verify-${process.pid}`;
  const open = [];
  const track = (c) => (open.push(c), c);

  try {
    /* ---------- membership and first host ---------- */
    console.log('membership');
    const a = track(await connect(bindings, { clientId: 'peer-a', role: 'builder' }));
    await call(() => a.join(room));
    await until('session row', () => sessionRow(a, room));
    check('room is created on first join', !!sessionRow(a, room));
    check('first joiner becomes host', hostKey(a, room) === a.connKey(), `host=${hostKey(a, room)?.slice(0, 12)}`);

    const b = track(await connect(bindings, { clientId: 'peer-b', role: 'play' }));
    await call(() => b.join(room));
    await until('two members', () => members(a, room).length === 2);
    check('second joiner does not steal the host', hostKey(a, room) === a.connKey());

    const c = track(await connect(bindings, { clientId: 'peer-c', role: 'sandbox' }));
    await call(() => c.join(room));
    await until('three members', () => members(a, room).length === 3);
    check('roster tracks every window', members(a, room).length === 3, '3 members');

    /* ---------- two windows, one identity ---------- */
    // A returning client reusing its token is the same Identity as an existing
    // one — the real two-browser-windows case. Both must count as members.
    const aToken = a.conn.token;
    const twin = track(await connect(bindings, { clientId: 'peer-a-twin', role: 'play', token: aToken }));
    await call(() => twin.join(room));
    await until('four members', () => members(a, room).length === 4);
    const identities = new Set(members(a, room).map((p) => p.identity.toHexString()));
    check(
      'two windows sharing one identity are two members',
      members(a, room).length === 4 && identities.size === 3,
      `${members(a, room).length} members across ${identities.size} identities`,
    );

    /* ---------- frame relay ---------- */
    console.log('\ntransport');
    const envelope = JSON.stringify({
      type: 'cells',
      protocol: 1,
      room,
      clientId: 'peer-a',
      revision: 0,
      sentAt: 1,
      payload: { label: 'paint', world: { kind: 'sandbox' }, patch: { idxs: [1, 2, 3] } },
    });
    b.frames.length = 0;
    await call(() => a.publish(room, envelope));
    await until('frame delivered', () => b.frames.length > 0);
    check('frame round-trips verbatim', b.frames[0].data === envelope, `${b.frames[0].data.length}B`);
    check('frame names its sender', b.frames[0].senderClientId === 'peer-a');
    check('frame carries a room revision', b.frames[0].revision > 0n, `rev ${b.frames[0].revision}`);

    // The sender sees its own frame; AuthorLinkClient drops it by clientId.
    await until('self echo', () => a.frames.length > 0, 3000).catch(() => {});
    check('sender receives its own frame (client-side echo suppression)', a.frames.length > 0);

    /* ---------- guards ---------- */
    console.log('\nguards');
    const stranger = track(await connect(bindings, { clientId: 'stranger', role: 'play' }));
    const strangerResult = await call(() => stranger.publish(room, envelope));
    check('a non-member cannot publish into a room', !strangerResult.ok, strangerResult.failed ?? 'was accepted');

    const huge = JSON.stringify({ type: 'cells', blob: 'x'.repeat(600 * 1024) });
    const hugeResult = await call(() => a.publish(room, huge));
    check('an oversized frame is refused', !hugeResult.ok, `${huge.length}B`);

    const seizeResult = await call(() => b.conn.reducers.transferHost({ room, toClientId: 'peer-b' }));
    check('a non-host cannot seize the host role', !seizeResult.ok, seizeResult.failed ?? 'was accepted');

    /* ---------- host migration ---------- */
    console.log('\nhost migration');
    const bKey = b.connKey();
    check('host is peer-a before it leaves', hostKey(b, room) === a.connKey());
    a.close();
    await until('host migrated', () => hostKey(b, room) !== null && hostKey(b, room) !== a.connKey(), 10000);
    check(
      'host migrates to the longest-connected survivor',
      hostKey(b, room) === bKey,
      `host=${hostKey(b, room)?.slice(0, 12)} expected peer-b=${bKey.slice(0, 12)}`,
    );
    check('the departed host is off the roster', !members(b, room).some((p) => p.clientId === 'peer-a'));

    // ...and again, to prove it is a rule rather than a one-off.
    const cKey = c.connKey();
    b.close();
    await until('second migration', () => hostKey(c, room) !== null && hostKey(c, room) !== bKey, 10000);
    check('migration repeats on the next host loss', hostKey(c, room) === cKey, `host=${hostKey(c, room)?.slice(0, 12)}`);

    /* ---------- durability ---------- */
    console.log('\ndurability');
    await call(() => c.conn.reducers.sendChat({ body: "a line that must outlive the room" }));
    await until('chat stored', () => [...c.conn.db.chat.iter()].some((m) => m.room === room));

    c.close();
    twin.close();
    stranger.close();
    await sleep(1200);

    const observer = track(await connect(bindings, { clientId: 'observer', role: 'play' }));
    await until('observer sees the room', () => sessionRow(observer, room));
    const dormant = sessionRow(observer, room);
    check('the session outlives every member', !!dormant, `revision ${dormant?.revision}`);
    check('an empty room has no host', !dormant?.host, 'host cleared');
    check('members are all gone', members(observer, room).length === 0);
    check(
      'durable state survives the room emptying',
      [...observer.conn.db.chat.iter()].some((m) => m.room === room && m.body.includes('outlive')),
      'chat retained',
    );

    await call(() => observer.join(room));
    await until('rehosted', () => hostKey(observer, room) !== null);
    check('rejoining a dormant room takes the host role', hostKey(observer, room) === observer.connKey());

    /* ---------- the real client stack ---------- */
    // Everything above drives reducers directly. This drives the code the game
    // actually runs: AuthorLinkClient, unmodified, with SpacetimeDB underneath
    // instead of the WebSocket relay.
    console.log('\nAuthorLinkClient over SpacetimeDB');
    const { AuthorLinkClient, SpacetimeDbTransport, createSpacetimeConnector } = await bundleClientStack();
    const connector = createSpacetimeConnector(bindings.DbConnection);
    const linkRoom = `${room}-link`;

    const makeClient = (clientId, role) => {
      const received = [];
      const client = new AuthorLinkClient({
        url: URI,
        room: linkRoom,
        role,
        build: 'verify',
        clientId,
        transportFactory: () =>
          new SpacetimeDbTransport({
            uri: URI,
            moduleName: DB,
            room: linkRoom,
            clientId,
            role,
            build: 'verify',
            connector,
          }),
      });
      client.on('tuning', (m) => received.push(m));
      client.connect();
      return { client, received };
    };

    const editor = makeClient('link-editor', 'builder');
    const game = makeClient('link-game', 'play');
    await until('both links connected', () => editor.client.connected && game.client.connected, 15000);
    check('AuthorLinkClient connects over SpacetimeDB', editor.client.connected && game.client.connected);

    // `welcome` is synthesized by the transport; without it the client would
    // never leave 'connecting'.
    await until('welcome applied', () => editor.client.getStatus().kind === 'connected', 8000);
    check('the synthesized welcome lands', editor.client.getStatus().kind === 'connected');
    await until('peers counted', () => editor.client.getStatus().peers >= 1, 10000);
    check('presence reports the other window', editor.client.getStatus().peers === 1, `peers=${editor.client.getStatus().peers}`);

    const sent = editor.client.send('tuning', { changes: [{ path: 'global.gravity', value: 0.42 }] });
    check('publish is accepted by the transport', sent === true);
    await until('tuning delivered', () => game.received.length > 0, 10000);
    const delivered = game.received[0];
    check(
      'a tuning change crosses windows intact',
      delivered?.payload?.changes?.[0]?.path === 'global.gravity' && delivered.payload.changes[0].value === 0.42,
      JSON.stringify(delivered?.payload?.changes?.[0] ?? null),
    );
    check('the sender does not see its own publish', editor.received.length === 0, `${editor.received.length} self-echoes`);
    check('the client tracks a room revision', editor.client.getStatus().revision > 0, `rev ${editor.client.getStatus().revision}`);

    editor.client.dispose();
    game.client.dispose();
  } finally {
    for (const client of open) {
      try {
        client.close();
      } catch {
        /* already gone */
      }
    }
    await sleep(300);
  }

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed) {
    console.log('\nfailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('\nprobe aborted:', error?.message ?? error);
  process.exitCode = 1;
});

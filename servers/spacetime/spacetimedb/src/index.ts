/**
 * Alchemist's Descent — session substrate.
 *
 * This is the DURABLE plane of the two-plane architecture recorded in
 * docs/MULTIPLAYER-ARCHITECTURE.md: sessions, membership, presence, chat, and
 * the host-migration rule. It deliberately does NOT carry the cell grid.
 *
 * WHY NOT THE GRID. Measured on this codebase, the sim changes ~5–10k cells a
 * second. That would fit inside SpacetimeDB's throughput budget, which is
 * exactly why the exclusion has to be written down rather than assumed: cell
 * deltas are ephemeral, loss-tolerant, and worthless once superseded, so
 * serializable ACID transactions and durable history are pure cost against
 * state whose correct recovery strategy is "send the current grid again". The
 * grid rides a binary stream plane instead.
 *
 * The one seam between the planes is `frame` (see below), which carries the
 * editor's opaque envelopes so `SessionTransport` has something to plug into
 * today. It is an EVENT table precisely so it never becomes grid storage.
 */

import { schema, table, t, SenderError } from 'spacetimedb/server';
import type { InferSchema, ReducerCtx } from 'spacetimedb/server';

/**
 * Mirror of `MAX_MESSAGE_BYTES` in src/net/authorLinkProtocol.ts.
 *
 * The module cannot import the game's TypeScript (separate build, separate
 * runtime), so this is a copy — and copies drift. `tests/spacetime-module.test.ts`
 * reads this file and fails if the two numbers stop agreeing.
 */
const MAX_FRAME_BYTES = 512 * 1024;

/** A room name has to be addressable and loggable; keep it boring. */
const MAX_ROOM_LEN = 64;
const MAX_CHAT_LEN = 2000;
/** Chat kept per room. Old lines fall off so an idle room is not unbounded. */
const CHAT_KEEP = 200;

/**
 * A room. Survives every member leaving — that is the point of durable state,
 * and it is why `host` is optional rather than the row being deleted.
 */
const session = table(
  { name: 'session', public: true },
  {
    name: t.string().primaryKey(),
    /**
     * Monotonic per-room counter, mirroring the AuthorLink relay's revision so
     * client semantics do not change with the transport underneath them.
     *
     * COST NOTE, because this looks like a scaling mistake and is not: every
     * frame updates this one row, so all of a room's writes serialize on it.
     * That is correct for editor traffic (tens of messages a second) and would
     * be wrong for gameplay cell traffic — which is on the other plane by
     * design, and must stay there.
     */
    revision: t.u64(),
    /**
     * The connection currently authoritative for the simulation, if any.
     *
     * A CONNECTION, not an identity: two windows of the same browser share one
     * Identity (one localStorage token), and the editor link is explicitly two
     * windows. Keying the host on identity would make a peer able to migrate
     * the host onto its own other tab.
     */
    host: t.option(t.connectionId()),
    hostSince: t.timestamp(),
    createdAt: t.timestamp(),
  },
);

/**
 * One connected window.
 *
 * Keyed by ConnectionId for the reason above: Identity answers "who", but the
 * session model needs "which window". `identity` is kept alongside for
 * authorization and display.
 */
const player = table(
  { name: 'player', public: true },
  {
    connectionId: t.connectionId().primaryKey(),
    identity: t.identity().index('btree'),
    room: t.string().index('btree'),
    /** The AuthorLink client id, so echo suppression works unchanged. */
    clientId: t.string(),
    /** Presentation only: 'sandbox' | 'play' | 'builder'. */
    role: t.string(),
    /** Build stamp, so a stale window is visible rather than mysteriously wrong. */
    build: t.string(),
    joinedAt: t.timestamp(),
  },
);

/** Where a peer is looking. Rewritten constantly, never worth history. */
const presence = table(
  { name: 'presence', public: true },
  {
    connectionId: t.connectionId().primaryKey(),
    room: t.string().index('btree'),
    /** `worldIdentityKey()` from the game — which world this peer has open. */
    worldKey: t.string(),
    camX: t.i32(),
    camY: t.i32(),
    updatedAt: t.timestamp(),
  },
);

const chat = table(
  { name: 'chat', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    room: t.string().index('btree'),
    sender: t.identity(),
    senderClientId: t.string(),
    body: t.string(),
    sentAt: t.timestamp(),
  },
);

/**
 * The transport plane for editor frames.
 *
 * EVENT TABLE on purpose: rows are broadcast to subscribers and never stored
 * in the client cache. A relayed message is not state — retaining it would
 * turn a chat-sized table into an unbounded log of every brush stroke, and
 * would tempt someone into treating this as grid storage later.
 *
 * `data` is an opaque AuthorLink envelope. The module never parses it: that is
 * what keeps `SessionTransport` honest — it moves bytes and knows no vocabulary.
 */
const frame = table(
  { name: 'frame', public: true, event: true },
  {
    room: t.string(),
    /** Echo suppression is the receiver's job, so senders are named, not filtered. */
    senderClientId: t.string(),
    senderConnection: t.connectionId(),
    revision: t.u64(),
    data: t.string(),
  },
);

const spacetimedb = schema({ session, player, presence, chat, frame });
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

/* ===================== helpers ===================== */

function normalizeRoom(room: string): string {
  const trimmed = room.trim();
  if (!trimmed || trimmed.length > MAX_ROOM_LEN) {
    throw new SenderError(`room must be 1..${MAX_ROOM_LEN} characters`);
  }
  return trimmed;
}

/** Fetch the room, creating it on first join. */
function ensureSession(ctx: Ctx, room: string) {
  const existing = ctx.db.session.name.find(room);
  if (existing) return existing;
  ctx.db.session.insert({
    name: room,
    revision: 0n,
    host: undefined,
    hostSince: ctx.timestamp,
    createdAt: ctx.timestamp,
  });
  return ctx.db.session.name.find(room)!;
}

/** Advance the room revision and return the new value. */
function bumpRevision(ctx: Ctx, room: string): bigint {
  const row = ctx.db.session.name.find(room);
  if (!row) return 0n;
  const revision = row.revision + 1n;
  ctx.db.session.name.update({ ...row, revision });
  return revision;
}

/**
 * The successor when a host leaves — the longest-connected remaining window.
 *
 * Determinism matters more than the policy here: two connections dropping in
 * the same instant must not be able to elect different hosts, so ties break on
 * the connection id's bytes rather than on iteration order, which is not
 * guaranteed stable.
 */
function chooseHost(ctx: Ctx, room: string, excluding?: string) {
  const candidates = [...ctx.db.player.room.filter(room)].filter(
    (p) => connectionKey(p.connectionId) !== excluding,
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const at = a.joinedAt.microsSinceUnixEpoch;
    const bt = b.joinedAt.microsSinceUnixEpoch;
    if (at !== bt) return at < bt ? -1 : 1;
    return connectionKey(a.connectionId) < connectionKey(b.connectionId) ? -1 : 1;
  });
  return candidates[0];
}

/** Stable string form of a ConnectionId, for comparison and tie-breaking. */
function connectionKey(id: { toHexString(): string }): string {
  return id.toHexString();
}

type ConnectionRef = NonNullable<Ctx['connectionId']>;

/**
 * The calling connection, or a refusal.
 *
 * `ctx.connectionId` is nullable because not every reducer call arrives from a
 * client: a scheduled reducer, or the module owner running `spacetime call`,
 * has no connection. Every table here is keyed per-window, so those callers are
 * refused outright rather than being allowed to act as an arbitrary member.
 */
function requireConnection(ctx: Ctx): ConnectionRef {
  const id = ctx.connectionId;
  if (!id) throw new SenderError('this reducer must be called from a client connection');
  return id;
}

/** Drop a room's member and any presence they were publishing. */
function removeMember(ctx: Ctx, conn: ConnectionRef): string | null {
  const leaving = ctx.db.player.connectionId.find(conn);
  if (!leaving) return null;
  ctx.db.player.connectionId.delete(conn);
  if (ctx.db.presence.connectionId.find(conn)) ctx.db.presence.connectionId.delete(conn);
  return leaving.room;
}

/**
 * Apply the departure of `conn` to its room's host slot.
 *
 * Shared by the deliberate `leaveSession` and the involuntary `onDisconnect`
 * so a clean exit and a crash cannot diverge — one rule, exercised twice.
 */
function releaseHost(ctx: Ctx, room: string, conn: ConnectionRef): void {
  const row = ctx.db.session.name.find(room);
  if (!row) return;
  const wasHost = row.host !== undefined && connectionKey(row.host) === connectionKey(conn);
  if (!wasHost) {
    bumpRevision(ctx, room);
    return;
  }
  const successor = chooseHost(ctx, room, connectionKey(conn));
  ctx.db.session.name.update({
    ...row,
    host: successor ? successor.connectionId : undefined,
    hostSince: ctx.timestamp,
    revision: row.revision + 1n,
  });
}

/* ===================== lifecycle ===================== */

export const init = spacetimedb.init((_ctx) => {
  // Rooms are created on demand by `joinSession`; nothing to seed.
});

export const onConnect = spacetimedb.clientConnected((_ctx) => {
  // A connection is not yet a member — membership starts at `joinSession`,
  // which is where the room and role are known.
});

/**
 * A window went away. This is the whole host-migration rule.
 *
 * Decision (2026-07-27): the session MIGRATES rather than ending. A host
 * crash-quitting is an ordinary event over a long expedition, and ending
 * everyone's session because one machine's tab closed throws away exactly the
 * durable progress this plane exists to protect.
 *
 * The session row is deliberately left behind with `host: undefined` when the
 * last member leaves, so hero state, expedition seed, and progression survive
 * an empty room and the next join resumes instead of restarting.
 */
export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  // Not `requireConnection`: a lifecycle hook must never throw its way out of
  // cleanup, or a dropped socket would leave a ghost member in the room.
  const conn = ctx.connectionId;
  if (!conn) return;
  const room = removeMember(ctx, conn);
  if (room === null) return;
  releaseHost(ctx, room, conn);
});

/* ===================== membership ===================== */

/**
 * Join (or rejoin) a room.
 *
 * Reconnect-safe: a returning window arrives with a new ConnectionId, so this
 * inserts rather than updates, and the stale row is already gone via
 * `onDisconnect`. The first member to join an unhosted room becomes host —
 * including the first to rejoin a dormant one.
 */
export const joinSession = spacetimedb.reducer(
  { room: t.string(), clientId: t.string(), role: t.string(), build: t.string() },
  (ctx, { room, clientId, role, build }) => {
    const conn = requireConnection(ctx);
    const name = normalizeRoom(room);
    const row = ensureSession(ctx, name);

    // A window that re-joins (switching rooms, or re-announcing) keeps its
    // connection, so replace rather than insert a duplicate.
    if (ctx.db.player.connectionId.find(conn)) ctx.db.player.connectionId.delete(conn);

    ctx.db.player.insert({
      connectionId: conn,
      identity: ctx.sender,
      room: name,
      clientId,
      role,
      build,
      joinedAt: ctx.timestamp,
    });

    const needsHost = row.host === undefined;
    ctx.db.session.name.update({
      ...row,
      host: needsHost ? conn : row.host,
      hostSince: needsHost ? ctx.timestamp : row.hostSince,
      revision: row.revision + 1n,
    });
  },
);

/**
 * Leave deliberately. Same migration path as a disconnect, so a clean exit and
 * a crash cannot diverge — one rule, exercised twice.
 */
export const leaveSession = spacetimedb.reducer((ctx) => {
  const conn = requireConnection(ctx);
  const room = removeMember(ctx, conn);
  if (room === null) return;
  releaseHost(ctx, room, conn);
});

/**
 * Hand the host role over on purpose (a player choosing who simulates).
 *
 * Only the current host may do this. Without that check any peer could seize
 * simulation authority, which is the one privilege in this schema worth
 * guarding.
 */
export const transferHost = spacetimedb.reducer(
  { room: t.string(), toClientId: t.string() },
  (ctx, { room, toClientId }) => {
    const conn = requireConnection(ctx);
    const name = normalizeRoom(room);
    const row = ctx.db.session.name.find(name);
    if (!row) throw new SenderError(`no such session: ${name}`);
    if (row.host === undefined || connectionKey(row.host) !== connectionKey(conn)) {
      throw new SenderError('only the current host may transfer the host role');
    }
    const target = [...ctx.db.player.room.filter(name)].find((p) => p.clientId === toClientId);
    if (!target) throw new SenderError(`no such peer in ${name}: ${toClientId}`);
    ctx.db.session.name.update({
      ...row,
      host: target.connectionId,
      hostSince: ctx.timestamp,
      revision: row.revision + 1n,
    });
  },
);

/* ===================== transport ===================== */

/**
 * Publish one opaque AuthorLink envelope to the room.
 *
 * Membership is required, so a connection cannot broadcast into a room it
 * never joined. The payload is never parsed here — see the `frame` table.
 */
export const publishFrame = spacetimedb.reducer(
  { room: t.string(), data: t.string() },
  (ctx, { room, data }) => {
    const conn = requireConnection(ctx);
    const name = normalizeRoom(room);
    const me = ctx.db.player.connectionId.find(conn);
    if (!me || me.room !== name) throw new SenderError(`not a member of ${name}`);
    if (data.length > MAX_FRAME_BYTES) {
      throw new SenderError(`frame of ${data.length}B exceeds ${MAX_FRAME_BYTES}B`);
    }
    const revision = bumpRevision(ctx, name);
    ctx.db.frame.insert({
      room: name,
      senderClientId: me.clientId,
      senderConnection: conn,
      revision,
      data,
    });
  },
);

/* ===================== presence ===================== */

export const setPresence = spacetimedb.reducer(
  { worldKey: t.string(), camX: t.i32(), camY: t.i32() },
  (ctx, { worldKey, camX, camY }) => {
    const conn = requireConnection(ctx);
    const me = ctx.db.player.connectionId.find(conn);
    if (!me) throw new SenderError('join a session before publishing presence');
    const row = {
      connectionId: conn,
      room: me.room,
      worldKey,
      camX,
      camY,
      updatedAt: ctx.timestamp,
    };
    if (ctx.db.presence.connectionId.find(conn)) {
      ctx.db.presence.connectionId.update(row);
    } else {
      ctx.db.presence.insert(row);
    }
  },
);

/* ===================== chat ===================== */

export const sendChat = spacetimedb.reducer({ body: t.string() }, (ctx, { body }) => {
  const me = ctx.db.player.connectionId.find(requireConnection(ctx));
  if (!me) throw new SenderError('join a session before chatting');
  const text = body.trim();
  if (!text) throw new SenderError('empty message');
  if (text.length > MAX_CHAT_LEN) throw new SenderError(`message exceeds ${MAX_CHAT_LEN} characters`);

  ctx.db.chat.insert({
    id: 0n,
    room: me.room,
    sender: ctx.sender,
    senderClientId: me.clientId,
    body: text,
    sentAt: ctx.timestamp,
  });

  // Trim oldest-first. autoInc ids are not guaranteed gapless, so order on the
  // timestamp we control rather than on the key.
  const all = [...ctx.db.chat.room.filter(me.room)].sort((a, b) => {
    const at = a.sentAt.microsSinceUnixEpoch;
    const bt = b.sentAt.microsSinceUnixEpoch;
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
  for (let i = 0; i < all.length - CHAT_KEEP; i++) ctx.db.chat.id.delete(all[i].id);
});

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

// Generated from the game's own schema by scripts/gen-tuning-ranges.mjs — the
// SAME table the relay enforces. Two hosted backends disagreeing about which
// values are legal is exactly the drift that generator exists to prevent.
import { tuningRangeFor } from './tuningRanges.generated';

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
/** The single `config` row's key. */
const CONFIG_ROW = 0;
/** Tuning changes accepted in one call. A drag emits a handful, never hundreds. */
const MAX_TUNING_CHANGES = 256;
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

/**
 * A tuning value: number or boolean, matching `TuningScalar` in the game.
 *
 * A sum type rather than two nullable columns, so an impossible row — both set,
 * or neither — cannot be represented at all.
 */
// Variants are PascalCase deliberately: client codegen PascalCases them, so
// naming them `num`/`bool` here would leave the server reading `.tag === 'num'`
// while every client had to write `'Num'`. Matching removes the trap.
const TuningValue = t.enum('TuningValue', { Num: t.f64(), Bool: t.bool() });

/**
 * Accumulated room tuning, so a window joining mid-session inherits what has
 * already been applied.
 *
 * The relay does this in memory and loses it on restart. Here it is a table,
 * so it survives one — which is the first place this backend is strictly
 * better than the one it can replace, rather than merely equivalent.
 */
const tuning = table(
  {
    name: 'tuning',
    public: true,
    indexes: [{ accessor: 'by_room_path', algorithm: 'btree', columns: ['room', 'path'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    room: t.string().index('btree'),
    /** Dotted path: `global.gravity`, `materials.11.density`, ... */
    path: t.string(),
    value: TuningValue,
    updatedAt: t.timestamp(),
  },
);

/**
 * Module-wide posture. Exactly one row, written at `init`.
 *
 * `owner` is captured from the publisher because a database has no environment
 * variables to read a policy out of — the equivalent of the relay's deploy-time
 * config is a row only the publisher may rewrite.
 */
const config = table(
  { name: 'config', public: true },
  {
    id: t.u32().primaryKey(),
    owner: t.identity(),
    /**
     * Strict rooms refuse tuning paths they cannot bound, mirroring the hosted
     * relay. Defaults to TRUE: a published database is network-reachable the
     * moment it exists, so the safe posture has to be the one you get by
     * default rather than the one you remember to turn on.
     */
    strict: t.bool(),
  },
);

const spacetimedb = schema({ session, player, presence, chat, frame, tuning, config });
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

/** The caller's membership in `room`, or a refusal. */
function requireMember(ctx: Ctx, conn: ConnectionRef, room: string) {
  const me = ctx.db.player.connectionId.find(conn);
  if (!me || me.room !== room) throw new SenderError(`not a member of ${room}`);
  return me;
}

function strictMode(ctx: Ctx): boolean {
  // Absent config means a database published before the row existed; treat the
  // missing case as strict, so a failure to read policy never widens it.
  return ctx.db.config.id.find(CONFIG_ROW)?.strict ?? true;
}

/**
 * Put one opaque envelope on the room's event table.
 *
 * Shared by `publishFrame` and `applyTuning` so both bump the revision and
 * stamp the sender identically — a tuning change that reached peers by a
 * different route than a cell patch would be a second protocol to keep honest.
 */
function broadcast(
  ctx: Ctx,
  room: string,
  me: { clientId: string },
  conn: ConnectionRef,
  data: string,
): void {
  if (data.length > MAX_FRAME_BYTES) {
    throw new SenderError(`frame of ${data.length}B exceeds ${MAX_FRAME_BYTES}B`);
  }
  const revision = bumpRevision(ctx, room);
  ctx.db.frame.insert({ room, senderClientId: me.clientId, senderConnection: conn, revision, data });
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

export const init = spacetimedb.init((ctx) => {
  // Rooms are created on demand by `joinSession`. The only thing to seed is the
  // posture row: who published this, and strict until they say otherwise.
  ctx.db.config.insert({ id: CONFIG_ROW, owner: ctx.sender, strict: true });
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
    const me = requireMember(ctx, conn, name);
    broadcast(ctx, name, me, conn, data);
  },
);

/* ===================== tuning ===================== */

/**
 * Apply tuning: record it durably AND broadcast it, in one transaction.
 *
 * Deliberately not two calls. If the durable table and the broadcast could
 * fail independently, a room would eventually disagree with itself about its
 * own settings — peers showing one value while a late joiner inherits another.
 * A reducer is atomic, so either both happen or neither does.
 *
 * `data` is the same opaque envelope `publishFrame` would have carried, so
 * receivers apply tuning through their normal path and know nothing about this
 * table. `changes` is the structured mirror this side needs in order to
 * validate and accumulate.
 */
export const applyTuning = spacetimedb.reducer(
  {
    room: t.string(),
    data: t.string(),
    changes: t.array(t.object('TuningChange', { path: t.string(), value: TuningValue })),
  },
  (ctx, { room, data, changes }) => {
    const conn = requireConnection(ctx);
    const name = normalizeRoom(room);
    const me = requireMember(ctx, conn, name);
    if (changes.length > MAX_TUNING_CHANGES) {
      throw new SenderError(`${changes.length} changes exceeds ${MAX_TUNING_CHANGES}`);
    }

    if (strictMode(ctx)) {
      // Validate EVERYTHING before writing anything: a reducer is atomic, so a
      // half-applied batch is not a state this can end in — but throwing after
      // a partial write would still be a confusing thing to reason about.
      const rejected: string[] = [];
      for (const change of changes) {
        const range = tuningRangeFor(change.path);
        if (!range) {
          // A shared room accepts only dials it can bound. Silently clamping an
          // unknown path would let a typo look like it worked.
          rejected.push(change.path);
          continue;
        }
        if (change.value.tag === 'Num' && (change.value.value < range.min || change.value.value > range.max)) {
          rejected.push(change.path);
        }
      }
      if (rejected.length > 0) {
        throw new SenderError(`out-of-range or unknown tuning paths: ${rejected.slice(0, 6).join(', ')}`);
      }
    }

    for (const change of changes) {
      const existing = [...ctx.db.tuning.by_room_path.filter([name, change.path])][0];
      if (existing) {
        ctx.db.tuning.id.update({ ...existing, value: change.value, updatedAt: ctx.timestamp });
      } else {
        ctx.db.tuning.insert({
          id: 0n,
          room: name,
          path: change.path,
          value: change.value,
          updatedAt: ctx.timestamp,
        });
      }
    }

    broadcast(ctx, name, me, conn, data);
  },
);

/**
 * Relax validation for local development, mirroring the relay's non-strict
 * rooms. Owner-only: this is the one switch that widens what a room accepts,
 * so it must not be reachable by an ordinary member.
 */
export const setStrict = spacetimedb.reducer({ strict: t.bool() }, (ctx, { strict }) => {
  const row = ctx.db.config.id.find(CONFIG_ROW);
  if (!row) throw new SenderError('config row missing');
  if (!row.owner.isEqual(ctx.sender)) throw new SenderError('only the database owner may change strictness');
  ctx.db.config.id.update({ ...row, strict });
});

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

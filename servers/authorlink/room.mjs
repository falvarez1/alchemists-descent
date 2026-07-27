/**
 * AuthorLink room logic — host-agnostic.
 *
 * There are two hosts for this: the Node `ws` server that rides the Vite dev
 * server, and a Cloudflare Durable Object for shared/hosted rooms. They must
 * behave identically, so all the behavior lives here and the hosts only own
 * sockets and persistence. A second copy of "what does a room do" is exactly
 * how a hosted room and a local room start disagreeing about what is legal.
 *
 * Deliberately free of Node and Workers APIs: no `ws`, no `WebSocket`, no
 * timers, no storage. `handle()` returns a list of DELIVERIES and the host
 * performs them. That makes the whole protocol testable without a socket.
 *
 * TRUST MODEL. A local dev room is two windows the same person owns, so it is
 * permissive. A hosted room is reachable by anyone who learns the URL, so
 * `strict` mode turns on the checks that a shared room needs: an origin
 * allowlist, a room token for writes, and per-path range validation. The
 * difference is configuration, not code.
 */

export const AUTHORLINK_PROTOCOL = 1;
export const AUTHORLINK_PATH = '/__authorlink';
export const MAX_MESSAGE_BYTES = 512 * 1024;
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

const RELAYED_TYPES = new Set([
  'tuning',
  'cells',
  'cmd',
  'objects',
  'world.announce',
  'world.request',
  'world.snapshot',
  // Peer poses (co-presence). Published only when a player actually moves, so
  // a still window stays silent and an idle room stays idle.
  'peer',
]);

const KNOWN_TYPES = new Set([
  'hello',
  'welcome',
  'presence',
  'tuning',
  'cells',
  'cmd',
  'objects',
  'world.announce',
  'world.request',
  'world.snapshot',
  'peer',
  'ping',
  'pong',
  'error',
]);

/** Only a whole-world transfer may exceed the streaming cap. */
export const capFor = (type) => (type === 'world.snapshot' ? MAX_SNAPSHOT_BYTES : MAX_MESSAGE_BYTES);

/** Per-client message budget. A stuck drag emits fast; a loop emits faster. */
const RATE_WINDOW_MS = 1000;
const RATE_LIMIT = 240;

export function isEnvelope(value) {
  if (typeof value !== 'object' || value === null) return false;
  if (typeof value.type !== 'string' || !KNOWN_TYPES.has(value.type)) return false;
  if (value.protocol !== AUTHORLINK_PROTOCOL) return false;
  if (typeof value.room !== 'string' || typeof value.clientId !== 'string') return false;
  if (typeof value.revision !== 'number' || !Number.isFinite(value.revision)) return false;
  if (typeof value.sentAt !== 'number' || !Number.isFinite(value.sentAt)) return false;
  if (typeof value.payload !== 'object' || value.payload === null) return false;
  return true;
}

function envelope(type, roomId, revision, payload, now) {
  return {
    type,
    protocol: AUTHORLINK_PROTOCOL,
    room: roomId,
    clientId: 'relay',
    revision,
    sentAt: now,
    payload,
  };
}

/**
 * Shared origin rule, used by BOTH hosts before the handshake completes: the
 * Node host refuses the HTTP upgrade, the Worker returns 403 instead of 101.
 * An empty allowlist means "any", which is right for a local dev relay and
 * wrong for anything reachable — hence `ALLOWED_ORIGINS` in wrangler.toml.
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkOrigin(origin, allowedOrigins) {
  if (!allowedOrigins || allowedOrigins.length === 0) return { ok: true };
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) return { ok: true };
  return { ok: false, reason: `origin ${origin ?? '<none>'} not allowed` };
}

/**
 * @param {object} options
 * @param {string} options.id
 * @param {() => number} [options.now]
 * @param {boolean} [options.strict]           hosted posture: token + range checks
 * @param {string[]} [options.allowedOrigins]  exact-match origin allowlist ([] = any)
 * @param {string} [options.token]             required for writes when strict
 * @param {(path: string) => {min:number,max:number}|null} [options.rangeFor]
 * @param {(state: {revision:number, tuning:[string, number|boolean][]}) => void} [options.persist]
 */
export function createRoom(options) {
  const id = options.id;
  const now = options.now ?? (() => Date.now());
  const strict = options.strict === true;
  const allowedOrigins = options.allowedOrigins ?? [];
  const token = options.token ?? null;
  const rangeFor = options.rangeFor ?? (() => null);
  const persist = options.persist ?? (() => undefined);

  let revision = 0;
  /** path -> scalar; the catch-up snapshot for a window that joins late. */
  const tuning = new Map();
  /** client -> { id, role, windowStart, count, authed } */
  const clients = new Map();

  const err = (code, detail) => [{ to: 'sender', message: envelope('error', id, revision, { code, detail }, now()) }];

  const presenceDeliveries = () => {
    const roles = [...clients.values()].map((c) => c.role);
    // Peers means "other windows", so the recipient is never counted.
    return [
      {
        to: 'all',
        message: envelope('presence', id, revision, { peers: clients.size - 1, roles }, now()),
      },
    ];
  };

  /** Out-of-range values are the reason a hosted room needs a schema at all. */
  function validateTuning(changes) {
    const rejected = [];
    for (const change of changes) {
      if (typeof change?.path !== 'string') {
        rejected.push('<malformed>');
        continue;
      }
      const value = change.value;
      if (typeof value !== 'number' && typeof value !== 'boolean') {
        rejected.push(change.path);
        continue;
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        rejected.push(change.path);
        continue;
      }
      if (!strict) continue;
      const range = rangeFor(change.path);
      if (!range) {
        // A shared room accepts only dials it can bound. Silently clamping an
        // unknown path would be worse: the sender would think it took effect.
        rejected.push(change.path);
        continue;
      }
      if (typeof value === 'number' && (value < range.min || value > range.max)) {
        rejected.push(change.path);
      }
    }
    return rejected;
  }

  return {
    get id() {
      return id;
    },
    get revision() {
      return revision;
    },
    get size() {
      return clients.size;
    },
    get tuningSnapshot() {
      return [...tuning].map(([path, value]) => ({ path, value }));
    },

    /** Restore persisted state after a Durable Object wakes from hibernation. */
    restore(state) {
      if (!state) return;
      if (typeof state.revision === 'number' && Number.isFinite(state.revision)) revision = state.revision;
      for (const [path, value] of state.tuning ?? []) tuning.set(path, value);
    },

    /** @returns {{ok: true} | {ok: false, reason: string}} */
    checkOrigin(origin) {
      return checkOrigin(origin, allowedOrigins);
    },

    join(client) {
      clients.set(client, { id: 'pending', role: 'sandbox', windowStart: now(), count: 0, authed: !strict });
    },

    leave(client) {
      if (!clients.delete(client)) return [];
      if (clients.size === 0) return [];
      return presenceDeliveries();
    },

    /**
     * @returns {Array<{to: 'sender'|'others'|'all'|string, message: object}>}
     *          `to` of `client:<id>` targets one peer.
     */
    handle(client, text) {
      const record = clients.get(client);
      if (!record) return [];

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return err('protocol', 'malformed JSON');
      }
      if (!isEnvelope(parsed)) return err('protocol', 'bad envelope');
      // Size is checked AFTER parsing so the cap can depend on the type: a
      // world transfer is legitimately megabytes, an incremental patch is not.
      if (text.length > capFor(parsed.type)) {
        return err('too-large', `${parsed.type} ${text.length} bytes`);
      }

      const at = now();
      if (at - record.windowStart > RATE_WINDOW_MS) {
        record.windowStart = at;
        record.count = 0;
      }
      if (++record.count > RATE_LIMIT) return err('rate-limit', `${RATE_LIMIT}/s exceeded`);

      if (parsed.type === 'hello') {
        record.id = parsed.clientId;
        record.role = typeof parsed.payload.role === 'string' ? parsed.payload.role : 'sandbox';
        if (strict && token !== null) {
          record.authed = parsed.payload.token === token;
          if (!record.authed) {
            return [
              ...err('rejected', 'bad or missing room token'),
              // Still welcome them: a spectator that can watch but not write is
              // more useful than a silent disconnect, and it makes the failure
              // legible in the client's status pill.
              {
                to: 'sender',
                message: envelope(
                  'welcome',
                  id,
                  revision,
                  { clientId: parsed.clientId, revision, peers: clients.size - 1, tuning: this.tuningSnapshot },
                  at,
                ),
              },
            ];
          }
        }
        return [
          {
            to: 'sender',
            message: envelope(
              'welcome',
              id,
              revision,
              { clientId: parsed.clientId, revision, peers: clients.size - 1, tuning: this.tuningSnapshot },
              at,
            ),
          },
          ...presenceDeliveries(),
        ];
      }

      if (parsed.type === 'pong') return [];
      if (parsed.type === 'ping') {
        return [{ to: 'sender', message: envelope('pong', id, revision, {}, at) }];
      }

      if (!RELAYED_TYPES.has(parsed.type)) return [];
      if (!record.authed) return err('rejected', 'read-only: no valid room token');

      if (parsed.type === 'tuning') {
        const changes = Array.isArray(parsed.payload.changes) ? parsed.payload.changes : [];
        const rejected = validateTuning(changes);
        if (rejected.length > 0) {
          return err('rejected', `out-of-range or unknown tuning paths: ${rejected.slice(0, 6).join(', ')}`);
        }
        // Fold into the room snapshot so a window opened later catches up.
        for (const change of changes) tuning.set(change.path, change.value);
        persist({ revision: revision + 1, tuning: [...tuning] });
      }

      parsed.revision = ++revision;

      if (parsed.type === 'world.request') {
        // Directed: three open windows must not all answer with a 75KB grid.
        const target = parsed.payload?.target;
        if (typeof target !== 'string') return [];
        return [{ to: `client:${target}`, message: parsed }];
      }

      return [{ to: 'others', message: parsed }];
    },

    /**
     * Relay one BINARY frame (the stream plane — packed cell columns).
     *
     * The relay stays deliberately dumb here: it checks that the bytes are
     * plausibly ours, that the sender may write, and that the frame is within
     * the incremental cap — then forwards them VERBATIM. It does not decode
     * the header, because doing so would mean a second copy of the frame
     * format living on the server, and that copy would drift.
     *
     * REVISION. A binary frame advances the room revision but is not rewritten
     * with it: the header is JSON of variable length, so stamping it would mean
     * re-serialising, which is exactly the decode this stays out of. Clients
     * take the sender's stamp instead, which lags but never regresses. That is
     * fine because `revision` is a status counter here, not a correctness
     * mechanism — nothing in the cells path branches on it.
     *
     * @param {*} client
     * @param {Uint8Array} bytes
     * @returns {Array<{to: string, binary?: Uint8Array, message?: object}>}
     */
    handleBinary(client, bytes) {
      const record = clients.get(client);
      if (!record) return [];
      if (bytes.length > MAX_MESSAGE_BYTES) {
        return err('too-large', `binary ${bytes.length} bytes`);
      }

      const at = now();
      if (at - record.windowStart > RATE_WINDOW_MS) {
        record.windowStart = at;
        record.count = 0;
      }
      if (++record.count > RATE_LIMIT) return err('rate-limit', `${RATE_LIMIT}/s exceeded`);
      if (!record.authed) return err('rejected', 'read-only: no valid room token');
      // 'ADBF', little-endian, version 1. Enough to refuse a stray upload
      // without pretending to understand the payload.
      if (bytes.length < 8 || bytes[0] !== 0x46 || bytes[1] !== 0x42 || bytes[2] !== 0x44 || bytes[3] !== 0x41) {
        return err('protocol', 'unrecognised binary frame');
      }

      revision++;
      return [{ to: 'others', binary: bytes }];
    },

    /** Resolve a delivery target to the concrete clients the host should send to. */
    resolve(sender, to) {
      if (to === 'sender') return [sender];
      if (to === 'all') return [...clients.keys()];
      if (to === 'others') return [...clients.keys()].filter((c) => c !== sender);
      if (to.startsWith('client:')) {
        const wanted = to.slice('client:'.length);
        return [...clients.entries()].filter(([, r]) => r.id === wanted).map(([c]) => c);
      }
      return [];
    },
  };
}

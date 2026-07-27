import type {
  SpacetimeConnectOptions,
  SpacetimeConnector,
  SpacetimeRoomHandle,
  SpacetimeRoomHooks,
  SpacetimeRoomState,
} from '@/net/SpacetimeDbTransport';
import type { AuthorLinkRole, TuningChange } from '@/net/authorLinkProtocol';

/**
 * Wires `SpacetimeDbTransport` to a real SpacetimeDB connection.
 *
 * The generated `DbConnection` class is PASSED IN rather than imported. That
 * keeps `src/net` free of both the SpacetimeDB SDK and the codegen output in
 * `servers/spacetime/bindings/`, which matters for three reasons:
 *
 *   - the game bundle must not grow by a backend that is off by default;
 *   - generated bindings change shape whenever the schema does, and `src/`
 *     should not carry that churn;
 *   - the verification probe bundles the same code for Node without needing
 *     the browser's module resolution.
 *
 * ORDERING. Subscribe first, then join, then report. Joining before the
 * subscription is applied loses the client's own membership row and the first
 * frames published while it was still catching up.
 */

/** The shape this needs from the generated bindings — nothing more. */
export interface StdbRowHandle<Row> {
  iter(): Iterable<Row>;
  onInsert(cb: (ctx: unknown, row: Row) => void): void;
  onDelete(cb: (ctx: unknown, row: Row) => void): void;
  onUpdate?(cb: (ctx: unknown, old: Row, row: Row) => void): void;
}

interface StdbHexId {
  toHexString(): string;
}

interface StdbPlayerRow {
  connectionId: StdbHexId;
  room: string;
  clientId: string;
  role: string;
}

interface StdbSessionRow {
  name: string;
  revision: bigint;
}

interface StdbFrameRow {
  room: string;
  data: string;
}

/**
 * The module stores a tuning value as a sum type, so an impossible row — both
 * set, or neither — cannot exist. Variant tags are PascalCase because client
 * codegen PascalCases them; the module names them to match.
 */
type StdbTuningValue = { tag: 'Num'; value: number } | { tag: 'Bool'; value: boolean };

interface StdbTuningRow {
  room: string;
  path: string;
  value: StdbTuningValue;
}

export interface StdbConnection {
  connectionId: StdbHexId | null;
  db: {
    player: StdbRowHandle<StdbPlayerRow>;
    session: StdbRowHandle<StdbSessionRow>;
    frame: StdbRowHandle<StdbFrameRow>;
    tuning: StdbRowHandle<StdbTuningRow>;
  };
  reducers: {
    joinSession(args: { room: string; clientId: string; role: string; build: string }): Promise<void>;
    leaveSession(): Promise<void>;
    publishFrame(args: { room: string; data: string }): Promise<void>;
    applyTuning(args: {
      room: string;
      data: string;
      changes: { path: string; value: StdbTuningValue }[];
    }): Promise<void>;
  };
  subscriptionBuilder(): {
    onApplied(cb: () => void): { subscribe(queries: string[]): unknown };
    onError(cb: (ctx: unknown, error?: Error) => void): {
      onApplied(cb: () => void): { subscribe(queries: string[]): unknown };
    };
  };
  disconnect(): void;
}

export interface StdbConnectionBuilder {
  withUri(uri: string): StdbConnectionBuilder;
  withDatabaseName(name: string): StdbConnectionBuilder;
  withToken(token?: string): StdbConnectionBuilder;
  onConnect(cb: (conn: StdbConnection) => void): StdbConnectionBuilder;
  onConnectError(cb: (ctx: unknown, error: Error) => void): StdbConnectionBuilder;
  onDisconnect(cb: (ctx: unknown, error?: Error) => void): StdbConnectionBuilder;
  build(): StdbConnection;
}

export interface StdbConnectionClass {
  builder(): StdbConnectionBuilder;
}

const ROLES: ReadonlySet<string> = new Set(['sandbox', 'play', 'builder']);
const asRole = (value: string): AuthorLinkRole => (ROLES.has(value) ? (value as AuthorLinkRole) : 'play');

/** Rows this client's own subscription needs. Presence and chat are not the transport's business. */
const QUERIES = [
  'SELECT * FROM session',
  'SELECT * FROM player',
  'SELECT * FROM frame',
  'SELECT * FROM tuning',
];

const toStdbValue = (value: number | boolean): StdbTuningValue =>
  typeof value === 'boolean' ? { tag: 'Bool', value } : { tag: 'Num', value };

export function createSpacetimeConnector(DbConnection: StdbConnectionClass): SpacetimeConnector {
  return (options: SpacetimeConnectOptions, hooks: SpacetimeRoomHooks): SpacetimeRoomHandle => {
    let conn: StdbConnection | null = null;
    let joined = false;
    let closed = false;

    const readState = (active: StdbConnection): SpacetimeRoomState => {
      const self = active.connectionId?.toHexString() ?? '';
      const roster = [...active.db.player.iter()].filter((p) => p.room === options.room);
      // `peers` excludes this client, matching the relay's semantics exactly —
      // the status pill counts other windows, not the population.
      const others = roster.filter((p) => p.connectionId.toHexString() !== self);
      const session = [...active.db.session.iter()].find((s) => s.name === options.room);
      return {
        peers: others.length,
        roles: others.map((p) => asRole(p.role)),
        revision: session ? Number(session.revision) : 0,
      };
    };

    /** The room's accumulated tuning, for the joining client to catch up on. */
    const readTuning = (active: StdbConnection): TuningChange[] =>
      [...active.db.tuning.iter()]
        .filter((row) => row.room === options.room)
        .map((row) => ({ path: row.path, value: row.value.value }));

    const publishState = (): void => {
      if (!conn || !joined || closed) return;
      hooks.onState(readState(conn));
    };

    const builder = DbConnection.builder()
      .withUri(options.uri)
      .withDatabaseName(options.moduleName)
      .onConnect((active) => {
        conn = active;
        active
          .subscriptionBuilder()
          .onError((_ctx, error) => hooks.onError(error?.message ?? 'subscription error'))
          .onApplied(() => {
            active.db.frame.onInsert((_ctx, row) => {
              if (row.room === options.room) hooks.onFrame(row.data);
            });
            active.db.player.onInsert(publishState);
            active.db.player.onDelete(publishState);
            active.db.session.onUpdate?.(publishState);

            active.reducers
              .joinSession({
                room: options.room,
                clientId: options.clientId,
                role: options.role,
                build: options.build,
              })
              .then(() => {
                if (closed) return;
                joined = true;
                hooks.onJoined(readState(active), readTuning(active));
              })
              .catch((error: unknown) => {
                hooks.onError(String(error));
                hooks.onClosed(String(error));
              });
          })
          .subscribe(QUERIES);
      })
      .onConnectError((_ctx, error) => {
        hooks.onError(error.message);
        hooks.onClosed(error.message);
      })
      .onDisconnect((_ctx, error) => {
        if (closed) return;
        hooks.onClosed(error?.message);
      });

    if (options.token) builder.withToken(options.token);
    builder.build();

    return {
      publish(data: string): boolean {
        if (!conn || !joined || closed) return false;
        // Fire and forget: a rejected publish is reported, never thrown into
        // the caller's send path, which has no way to recover mid-frame.
        conn.reducers.publishFrame({ room: options.room, data }).catch((error: unknown) => {
          hooks.onError(String(error));
        });
        return true;
      },
      publishTuning(data: string, changes: TuningChange[]): boolean {
        if (!conn || !joined || closed) return false;
        conn.reducers
          .applyTuning({
            room: options.room,
            data,
            changes: changes.map((c) => ({ path: c.path, value: toStdbValue(c.value) })),
          })
          .catch((error: unknown) => {
            // A strict room refuses out-of-range paths; surfacing it as a
            // transport error puts the reason in the status pill instead of
            // leaving the dial looking like it moved.
            hooks.onError(String(error));
          });
        return true;
      },
      close(): void {
        if (closed) return;
        closed = true;
        const active = conn;
        conn = null;
        if (!active) return;
        // Leave explicitly so the room migrates the host immediately rather
        // than waiting for the server to notice a dead socket.
        if (joined) active.reducers.leaveSession().catch(() => undefined);
        active.disconnect();
      },
    };
  };
}

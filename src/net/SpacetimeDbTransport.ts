import {
  AUTHORLINK_PROTOCOL,
  type AuthorLinkMessage,
  type AuthorLinkRole,
} from '@/net/authorLinkProtocol';
import type { SessionTransport, TransportHandlers, TransportState } from '@/net/SessionTransport';

/**
 * AuthorLink over SpacetimeDB.
 *
 * WHY THIS ONE TRANSLATES AND `WebSocketTransport` DOES NOT. The relay is a
 * dumb pipe: the client's `hello` goes out as bytes and a `welcome` comes back
 * as bytes, so that transport can stay perfectly ignorant of the protocol.
 * SpacetimeDB is not a pipe — it is a database. Membership is a reducer call,
 * presence is a table, and nothing on the server writes an envelope. Something
 * has to map between "a row changed" and "a message arrived", and pretending
 * otherwise would only push the translation somewhere it fits worse.
 *
 * So this is the ONE place the session protocol and SpacetimeDB meet, and the
 * mapping is deliberately tiny:
 *
 *   hello  (out) -> already joined during `open`; answered with a synthesized
 *                   `welcome` carrying the live peer count and revision
 *   ping   (out) -> swallowed. The SDK owns its own liveness; a second
 *                   heartbeat would bill a reducer call to learn nothing.
 *   *      (out) -> `publishFrame`, opaque
 *   frame  (in)  -> delivered verbatim as a message
 *   player (in)  -> synthesized `presence` when the room's roster changes
 *
 * Everything else — reconnect, echo suppression, revision tracking — stays in
 * `AuthorLinkClient`, unchanged and untouched. That is the whole point of the
 * split: swapping the backend must not fork the session semantics.
 *
 * SELF-ECHO. A SpacetimeDB event-table insert reaches every subscriber
 * including the sender, so this transport delivers a client its own frames
 * back. That is already handled: `AuthorLinkClient` drops self-echo by
 * `clientId`, by design, so a client reconnecting under a new id cannot
 * deadlock itself out of its own updates. No filtering belongs here.
 *
 * KNOWN GAP before this can replace the relay: the relay's `welcome` carries
 * accumulated room tuning so a late window catches up, and this one sends an
 * empty list because the module has no `tuning` table yet. A window joining
 * mid-session will not inherit tuning already applied. Closing it means a
 * `(room, path) -> value` table and folding it into the synthesized welcome —
 * at which point the tuning also survives a server restart, which the relay's
 * in-memory accumulation does not. See docs/MULTIPLAYER-ARCHITECTURE.md.
 */

/** What the transport needs a live SpacetimeDB room to do. */
export interface SpacetimeRoomHandle {
  /** Call `publishFrame`. Returns false when the connection is not usable. */
  publish(data: string): boolean;
  /** Leave and disconnect. No hook may fire afterwards. */
  close(): void;
}

/** Room state the transport turns back into protocol messages. */
export interface SpacetimeRoomState {
  /** Members OTHER than this client, matching the relay's `peers` semantics. */
  peers: number;
  roles: AuthorLinkRole[];
  revision: number;
}

export interface SpacetimeRoomHooks {
  /** Joined AND subscribed. Anything earlier would race the first frame. */
  onJoined(state: SpacetimeRoomState): void;
  /** One `frame` row, delivered verbatim. */
  onFrame(data: string): void;
  /** The roster or revision moved. */
  onState(state: SpacetimeRoomState): void;
  onClosed(reason?: string): void;
  onError(detail: string): void;
}

export interface SpacetimeConnectOptions {
  /** e.g. `ws://127.0.0.1:3000` */
  uri: string;
  /** Published database name, e.g. `alchemists-descent`. */
  moduleName: string;
  room: string;
  clientId: string;
  role: AuthorLinkRole;
  build: string;
  /** OIDC token when the deployment authenticates; anonymous locally. */
  token?: string;
}

/**
 * Opens a room. Injected rather than imported so this file stays free of the
 * SpacetimeDB SDK: the default connector is loaded on demand by whoever
 * selects this transport, and the game bundle never pays for a backend it is
 * not using. Tests pass a fake.
 */
export type SpacetimeConnector = (
  options: SpacetimeConnectOptions,
  hooks: SpacetimeRoomHooks,
) => SpacetimeRoomHandle;

export interface SpacetimeDbTransportOptions extends SpacetimeConnectOptions {
  connector: SpacetimeConnector;
  now?: () => number;
}

export class SpacetimeDbTransport implements SessionTransport {
  private handlers: TransportHandlers | null = null;
  private room: SpacetimeRoomHandle | null = null;
  private status: TransportState = 'connecting';
  private roomState: SpacetimeRoomState = { peers: 0, roles: [], revision: 0 };
  private readonly now: () => number;

  constructor(private readonly options: SpacetimeDbTransportOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  get describe(): string {
    return `spacetimedb ${this.options.uri}/${this.options.moduleName}#${this.options.room}`;
  }

  get state(): TransportState {
    return this.status;
  }

  open(handlers: TransportHandlers): void {
    if (this.status === 'closed' || this.room) return;
    this.handlers = handlers;
    let room: SpacetimeRoomHandle;
    try {
      room = this.options.connector(this.options, {
        onJoined: (state) => {
          this.roomState = state;
          this.status = 'open';
          this.handlers?.onOpen();
        },
        onFrame: (data) => this.handlers?.onMessage(data),
        onState: (state) => {
          this.roomState = state;
          // The roster is the only thing the client learns from `presence`,
          // so a change in it is exactly when one should be delivered.
          this.deliver('presence', { peers: state.peers, roles: state.roles });
        },
        onClosed: (reason) => {
          if (this.status === 'closed') return;
          this.status = 'closed';
          this.handlers?.onClose(reason);
        },
        onError: (detail) => this.handlers?.onError(detail),
      });
    } catch (error) {
      // A connector throw is a failed link, not a special case — the client's
      // reconnect path handles it identically to a close.
      handlers.onError(String(error));
      handlers.onClose(String(error));
      this.status = 'closed';
      return;
    }
    this.room = room;
  }

  send(data: string): boolean {
    if (this.status !== 'open' || !this.room) return false;

    // The only inspection this transport does: enough to route three message
    // types that are not frames. Payloads are never read.
    let type = '';
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed === 'object' && parsed !== null) {
        type = String((parsed as { type?: unknown }).type ?? '');
      }
    } catch {
      return false;
    }

    if (type === 'hello') {
      // The join already happened in `open`; answer the way the relay would so
      // the client's connected-state handling is identical on both backends.
      this.deliver('welcome', {
        clientId: this.options.clientId,
        revision: this.roomState.revision,
        peers: this.roomState.peers,
        tuning: [],
      });
      return true;
    }
    // The SDK maintains its own liveness. Forwarding these would spend a
    // transaction per heartbeat to discover something already known.
    if (type === 'ping' || type === 'pong') return true;

    return this.room.publish(data);
  }

  close(): void {
    this.status = 'closed';
    const room = this.room;
    this.room = null;
    this.handlers = null;
    room?.close();
  }

  /** Hand the client a synthesized envelope as though it arrived on the wire. */
  private deliver<T extends 'welcome' | 'presence'>(
    type: T,
    payload: Extract<AuthorLinkMessage, { type: T }>['payload'],
  ): void {
    const message = {
      type,
      protocol: AUTHORLINK_PROTOCOL,
      room: this.options.room,
      // Synthesized envelopes must NOT carry this client's id: the client
      // drops its own id as self-echo, and a `presence` it dropped would leave
      // the peer count frozen.
      clientId: 'spacetimedb',
      revision: this.roomState.revision,
      sentAt: this.now(),
      payload,
    };
    this.handlers?.onMessage(JSON.stringify(message));
  }
}

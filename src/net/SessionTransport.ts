/**
 * The link between this client and a session, independent of how that session
 * is carried.
 *
 * WHY THIS EXISTS. AuthorLink (the two-window editor link) and multiplayer are
 * the same shape: peers join a named room, announce presence, and exchange
 * patches against shared state. They differ only in what carries the bytes and
 * in how much of the state is durable. If the editor stays welded to a raw
 * `WebSocket`, multiplayer grows a second, parallel stack — two reconnect
 * policies, two presence models, two sets of echo bugs — and the debugger
 * stops working the moment the game moves to a different backend.
 *
 * So the client owns the SEMANTICS (reconnect, heartbeat, echo suppression,
 * revision tracking) and a transport owns the BYTES. Today there is one
 * implementation, `WebSocketTransport`, pointed at the dev relay. The planned
 * second is SpacetimeDB, where a "message" is a row in a session table and
 * `send` is a reducer call — see docs/MULTIPLAYER-ARCHITECTURE.md.
 *
 * DELIBERATELY NOT IN THIS INTERFACE:
 *
 * - Reconnect and backoff. Every transport would reimplement it slightly
 *   differently; the client does it once, on top.
 * - Room membership. That is session semantics, not delivery.
 * - Anything typed to the AuthorLink protocol. A transport moves opaque
 *   strings, so the same plumbing can carry gameplay frames later without
 *   learning the editor's vocabulary.
 */

export type TransportState = 'connecting' | 'open' | 'closed';

export interface TransportHandlers {
  /** The link came up. The client sends its `hello` from here. */
  onOpen(): void;
  /** One inbound frame, already decoded to text. */
  onMessage(data: string): void;
  /**
   * One inbound BINARY frame (the stream plane — packed cell columns).
   *
   * Optional: a transport that cannot carry binary simply never calls it, and
   * senders fall back to JSON via `supportsBinary`.
   */
  onBinary?(data: Uint8Array): void;
  /** The link went down for any reason; the client owns retrying. */
  onClose(reason?: string): void;
  /** Non-fatal transport trouble, for status display only. */
  onError(detail: string): void;
}

export interface SessionTransport {
  /** Human-readable, for status and logs (e.g. `ws://host/__authorlink`). */
  readonly describe: string;
  readonly state: TransportState;
  /**
   * Begin connecting. Must be safe to call only once per instance; the client
   * constructs a fresh transport for each reconnect attempt so implementations
   * never need their own retry state.
   */
  open(handlers: TransportHandlers): void;
  /** Deliver one frame. Returns false when the link is not up. */
  send(data: string): boolean;
  /**
   * Whether `sendBinary` is usable on this link.
   *
   * A CAPABILITY rather than an assumption: the packed cell encoding is worth
   * ~2x, but a backend that cannot carry bytes must degrade to JSON instead of
   * silently dropping terrain. Callers branch on this, so adding a
   * binary-incapable transport later cannot break authoring.
   */
  readonly supportsBinary?: boolean;
  /** Deliver one packed frame. Returns false when unsupported or not up. */
  sendBinary?(data: Uint8Array): boolean;
  /** Tear down; no handler may fire afterwards. */
  close(): void;
}

/** Builds a fresh transport per connection attempt. */
export type SessionTransportFactory = () => SessionTransport;

/** `readyState` values, spelled out — Node 20 has no global `WebSocket`. */
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

export interface WebSocketTransportOptions {
  url: string;
  /** Injectable for tests and for runtimes without a global WebSocket. */
  socketFactory?: (url: string) => WebSocket;
}

/** The dev-relay transport: one WebSocket, one session. */
export class WebSocketTransport implements SessionTransport {
  private socket: WebSocket | null = null;
  private handlers: TransportHandlers | null = null;
  private closed = false;
  private readonly factory: (url: string) => WebSocket;

  constructor(private readonly options: WebSocketTransportOptions) {
    this.factory = options.socketFactory ?? ((url) => new WebSocket(url));
  }

  get describe(): string {
    return this.options.url;
  }

  get state(): TransportState {
    if (this.closed) return 'closed';
    if (!this.socket) return 'connecting';
    return this.socket.readyState === SOCKET_OPEN ? 'open' : 'connecting';
  }

  readonly supportsBinary = true;

  open(handlers: TransportHandlers): void {
    if (this.closed || this.socket) return;
    this.handlers = handlers;
    let socket: WebSocket;
    try {
      socket = this.factory(this.options.url);
      // Without this a binary frame arrives as a Blob, which cannot be read
      // synchronously — the handler would have to go async and reorder frames.
      socket.binaryType = 'arraybuffer';
    } catch (error) {
      // A constructor throw (bad URL, blocked scheme) is a closed link, not a
      // special case — the client's reconnect path handles both identically.
      handlers.onError(String(error));
      handlers.onClose(String(error));
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', this.onOpen);
    socket.addEventListener('message', this.onMessage);
    socket.addEventListener('close', this.onClose);
    socket.addEventListener('error', this.onError);
  }

  send(data: string): boolean {
    if (this.closed || !this.socket || this.socket.readyState !== SOCKET_OPEN) return false;
    this.socket.send(data);
    return true;
  }

  sendBinary(data: Uint8Array): boolean {
    if (this.closed || !this.socket || this.socket.readyState !== SOCKET_OPEN) return false;
    this.socket.send(data);
    return true;
  }

  close(): void {
    this.closed = true;
    const socket = this.socket;
    this.socket = null;
    this.handlers = null;
    if (!socket) return;
    socket.removeEventListener('open', this.onOpen);
    socket.removeEventListener('message', this.onMessage);
    socket.removeEventListener('close', this.onClose);
    socket.removeEventListener('error', this.onError);
    if (socket.readyState === SOCKET_OPEN || socket.readyState === SOCKET_CONNECTING) socket.close();
  }

  private readonly onOpen = (): void => {
    this.handlers?.onOpen();
  };

  private readonly onMessage = (event: MessageEvent): void => {
    if (typeof event.data === 'string') {
      this.handlers?.onMessage(event.data);
      return;
    }
    // The stream plane: packed cell columns. `binaryType` is set to
    // 'arraybuffer' at open so this stays synchronous and frames keep order.
    if (event.data instanceof ArrayBuffer) {
      this.handlers?.onBinary?.(new Uint8Array(event.data));
    }
  };

  private readonly onClose = (): void => {
    this.handlers?.onClose();
  };

  private readonly onError = (): void => {
    // 'error' is always followed by 'close'; report it for status only and let
    // onClose own the lifecycle, so one failure cannot trigger two reconnects.
    this.handlers?.onError('socket error');
  };
}

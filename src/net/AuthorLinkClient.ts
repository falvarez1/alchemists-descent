import {
  AUTHORLINK_PROTOCOL,
  isAuthorLinkMessage,
  MAX_MESSAGE_BYTES,
  MAX_SNAPSHOT_BYTES,
  type AuthorLinkMessage,
  type AuthorLinkMessageType,
  type AuthorLinkRole,
  type AuthorLinkStatus,
} from '@/net/authorLinkProtocol';
import { WebSocketTransport } from '@/net/SessionTransport';
import type { SessionTransport, SessionTransportFactory } from '@/net/SessionTransport';

/**
 * AuthorLink session semantics: connection lifecycle, reconnect, heartbeat,
 * echo suppression, revision tracking, and typed fan-out. It knows nothing
 * about the game — no `Ctx`, no `World` — and, since the transport was
 * extracted, nothing about WebSockets either. `src/app/AuthorLink.ts` binds it
 * to the runtime; a `SessionTransport` carries the bytes.
 *
 * That split is what lets the editor and multiplayer share one substrate
 * instead of growing two: swapping in a SpacetimeDB transport changes where
 * the frames go, not how presence, reconnect, or echo control behave. See
 * docs/MULTIPLAYER-ARCHITECTURE.md.
 *
 * Behavior worth knowing:
 *
 * - Self-echo is dropped here, by `clientId`, so subscribers never see their
 *   own publish come back and cannot build a feedback loop by accident.
 * - Reconnect is exponential with jitter and never gives up. A dev tool that
 *   quietly stops reconnecting after the server restarts is worse than one
 *   that never connected: you keep authoring into a dead socket.
 * - Sends while disconnected are DROPPED, not queued. Queued tuning would
 *   replay a stale drag on reconnect, and queued cell patches would stamp
 *   terrain into a world that has since regenerated. Reconnect re-publishes a
 *   fresh tuning snapshot instead, which is both smaller and correct.
 */

export type AuthorLinkHandler<T extends AuthorLinkMessageType> = (
  message: Extract<AuthorLinkMessage, { type: T }>,
) => void;

export interface AuthorLinkClientOptions {
  url: string;
  room: string;
  role: AuthorLinkRole;
  build: string;
  clientId: string;
  /** Room token for hosted rooms; omitted locally. */
  token?: string;
  /**
   * Builds a fresh transport per connection attempt. Defaults to a WebSocket
   * against `url`; a SpacetimeDB transport slots in here unchanged.
   */
  transportFactory?: SessionTransportFactory;
  /** Injectable for tests; ignored when `transportFactory` is supplied. */
  socketFactory?: (url: string) => WebSocket;
  now?: () => number;
}

const HEARTBEAT_MS = 15_000;
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8_000;

export class AuthorLinkClient {
  readonly clientId: string;
  readonly room: string;

  private transport: SessionTransport | null = null;
  private readonly handlers = new Map<AuthorLinkMessageType, Set<(m: AuthorLinkMessage) => void>>();
  private readonly statusHandlers = new Set<(s: AuthorLinkStatus) => void>();
  private status: AuthorLinkStatus;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly now: () => number;
  private readonly transportFactory: SessionTransportFactory;
  /**
   * Per-type message counters. Feedback loops on this socket are silent and
   * only show up as a rate-limit much later, so being able to ask "who is
   * talking" is worth the two counters. Read by the probe.
   */
  private readonly sentCounts = new Map<AuthorLinkMessageType, number>();
  private readonly recvCounts = new Map<AuthorLinkMessageType, number>();

  constructor(private readonly options: AuthorLinkClientOptions) {
    this.clientId = options.clientId;
    this.room = options.room;
    this.now = options.now ?? (() => Date.now());
    this.transportFactory =
      options.transportFactory ??
      (() => new WebSocketTransport({ url: options.url, socketFactory: options.socketFactory }));
    this.status = { kind: 'connecting', room: options.room, peers: 0, revision: 0 };
  }

  connect(): void {
    if (this.disposed || this.transport) return;
    this.setStatus({ kind: this.status.revision > 0 ? 'reconnecting' : 'connecting' });
    const transport = this.transportFactory();
    this.transport = transport;
    transport.open({
      onOpen: this.onOpen,
      onMessage: this.onMessage,
      onClose: this.onClose,
      onError: (detail) => this.onError(detail),
    });
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.teardownSocket();
    this.handlers.clear();
    this.statusHandlers.clear();
  }

  getStatus(): AuthorLinkStatus {
    return { ...this.status };
  }

  /** Message traffic by type — diagnostic for feedback loops. */
  getStats(): { sent: Record<string, number>; received: Record<string, number> } {
    return {
      sent: Object.fromEntries(this.sentCounts),
      received: Object.fromEntries(this.recvCounts),
    };
  }

  get connected(): boolean {
    return this.transport?.state === 'open';
  }

  on<T extends AuthorLinkMessageType>(type: T, handler: AuthorLinkHandler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const erased = handler as (m: AuthorLinkMessage) => void;
    set.add(erased);
    return () => set.delete(erased);
  }

  onStatus(handler: (status: AuthorLinkStatus) => void): () => void {
    this.statusHandlers.add(handler);
    handler(this.getStatus());
    return () => this.statusHandlers.delete(handler);
  }

  /** Publish to the room. Returns false when the socket is not open or the payload is oversized. */
  send<T extends AuthorLinkMessageType>(
    type: T,
    payload: Extract<AuthorLinkMessage, { type: T }>['payload'],
  ): boolean {
    if (!this.connected || !this.transport) return false;
    const message = {
      type,
      protocol: AUTHORLINK_PROTOCOL,
      room: this.room,
      clientId: this.clientId,
      revision: this.status.revision,
      sentAt: this.now(),
      payload,
    };
    let encoded: string;
    try {
      encoded = JSON.stringify(message);
    } catch {
      return false;
    }
    // A whole-world transfer is legitimately large; an incremental patch is not.
    const cap = type === 'world.snapshot' ? MAX_SNAPSHOT_BYTES : MAX_MESSAGE_BYTES;
    if (encoded.length > cap) {
      this.setStatus({ detail: `dropped oversized ${type} (${encoded.length}B)` });
      return false;
    }
    if (!this.transport.send(encoded)) return false;
    this.sentCounts.set(type, (this.sentCounts.get(type) ?? 0) + 1);
    return true;
  }

  private readonly onOpen = (): void => {
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.setStatus({ kind: 'connected', detail: undefined });
    this.send('hello', {
      role: this.options.role,
      build: this.options.build,
      ...(this.options.token ? { token: this.options.token } : {}),
    });
    this.startHeartbeat();
  };

  private readonly onMessage = (data: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (!isAuthorLinkMessage(parsed)) return;
    this.recvCounts.set(parsed.type, (this.recvCounts.get(parsed.type) ?? 0) + 1);
    // Never deliver our own publish back to our own subscribers.
    if (parsed.clientId === this.clientId && parsed.type !== 'welcome') return;
    if (parsed.revision > this.status.revision) this.setStatus({ revision: parsed.revision });
    if (parsed.type === 'ping') {
      this.send('pong', {});
      return;
    }
    if (parsed.type === 'welcome') this.setStatus({ peers: parsed.payload.peers, kind: 'connected' });
    if (parsed.type === 'presence') this.setStatus({ peers: parsed.payload.peers });
    if (parsed.type === 'error') this.setStatus({ detail: `${parsed.payload.code}: ${parsed.payload.detail}` });
    const set = this.handlers.get(parsed.type);
    if (!set) return;
    for (const handler of [...set]) handler(parsed);
  };

  private readonly onClose = (): void => {
    this.teardownSocket();
    if (this.disposed) return;
    this.setStatus({ kind: 'reconnecting', peers: 0 });
    this.scheduleReconnect();
  };

  private readonly onError = (detail: string): void => {
    // Transport errors are status only; the transport always follows with a
    // close, and letting onClose own the reconnect keeps one failure from
    // scheduling two timers.
    this.setStatus({ detail });
  };

  private teardownSocket(): void {
    const transport = this.transport;
    this.transport = null;
    this.stopHeartbeat();
    transport?.close();
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    // Jitter so two windows reloaded together do not retry in lockstep.
    const jitter = this.reconnectDelay * 0.25 * Math.random();
    const delay = this.reconnectDelay + jitter;
    this.reconnectDelay = Math.min(RECONNECT_MAX_MS, this.reconnectDelay * 2);
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = globalThis.setInterval(() => {
      if (!this.connected) return;
      this.send('ping', {});
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === null) return;
    globalThis.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      globalThis.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
  }

  private setStatus(patch: Partial<AuthorLinkStatus>): void {
    const next = { ...this.status, ...patch };
    const same =
      next.kind === this.status.kind &&
      next.peers === this.status.peers &&
      next.revision === this.status.revision &&
      next.detail === this.status.detail;
    this.status = next;
    if (same) return;
    for (const handler of [...this.statusHandlers]) handler(this.getStatus());
  }
}

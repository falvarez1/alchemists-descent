import { AUTHORLINK_PATH, MAX_SNAPSHOT_BYTES, createRoom } from './room.mjs';
import { tuningRangeFor } from './tuningRanges.generated.mjs';

/**
 * AuthorLink relay — Cloudflare Durable Object host.
 *
 * One Durable Object per room: the DO is the single point that owns a room's
 * revision counter and tuning snapshot, which is exactly the coordination a
 * relay needs and exactly what a stateless Worker cannot give you.
 *
 * The room BEHAVIOR is `room.mjs`, shared verbatim with the Node host, so a
 * hosted room and `npm run dev` cannot disagree about what is legal. This file
 * owns three things Workers do differently: routing, hibernation, and secrets.
 *
 * HIBERNATION. `acceptWebSocket` (not `server.accept()`) lets Cloudflare evict
 * the DO from memory while sockets stay open, which is what makes an idle room
 * nearly free. The catch is that in-memory state does not survive, so the room
 * snapshot is persisted on change and restored on wake. A relay that lost its
 * tuning snapshot on hibernation would silently stop catching up late joiners
 * — working perfectly right up until the room went quiet for a minute.
 *
 * STRICT BY DEFAULT. A hosted room is reachable by anyone who learns the URL,
 * so this host always runs the room in strict mode: origin allowlist, room
 * token for writes, and per-path range validation from the generated schema.
 * The local dev relay stays permissive; the difference is configuration.
 *
 * Deploy: see README.md in this directory. Requires `wrangler` and a
 * Cloudflare account; nothing here runs or bills without an explicit deploy.
 */

export class AuthorLinkRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
    /** Sockets are keyed by the DO; we map them back to room clients. */
    this.persistQueued = false;
  }

  async ensureRoom(roomId) {
    if (this.room) return this.room;
    const allowedOrigins = (this.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    this.room = createRoom({
      id: roomId,
      strict: true,
      allowedOrigins,
      token: this.env.ROOM_TOKEN ?? null,
      rangeFor: tuningRangeFor,
      persist: (snapshot) => this.schedulePersist(snapshot),
    });
    const saved = await this.state.storage.get('room');
    this.room.restore(saved);
    return this.room;
  }

  /**
   * Coalesce writes: a slider drag produces many patches a second and
   * `storage.put` on each one would dominate both latency and billing.
   */
  schedulePersist(snapshot) {
    this.pendingSnapshot = snapshot;
    if (this.persistQueued) return;
    this.persistQueued = true;
    this.state.waitUntil(
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        this.persistQueued = false;
        const pending = this.pendingSnapshot;
        this.pendingSnapshot = null;
        if (pending) await this.state.storage.put('room', pending);
      })(),
    );
  }

  async fetch(request) {
    const url = new URL(request.url);
    const roomId = url.searchParams.get('room') || 'local';
    const room = await this.ensureRoom(roomId);

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const origin = room.checkOrigin(request.headers.get('Origin'));
    if (!origin.ok) return new Response(origin.reason, { status: 403 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Hibernation-aware accept: the DO may be evicted while this stays open.
    this.state.acceptWebSocket(server);
    room.join(server);
    // No presence broadcast here: the room emits it from `hello`, once the
    // client has actually identified itself. Announcing an anonymous socket
    // would show a peer that cannot yet be addressed.
    return new Response(null, { status: 101, webSocket: client });
  }

  deliver(room, sender, deliveries) {
    for (const { to, message } of deliveries) {
      const encoded = JSON.stringify(message);
      for (const target of room.resolve(sender, to)) {
        try {
          target.send(encoded);
        } catch {
          // A socket that died between resolve and send is not an error here;
          // the close handler will drop it from the room.
        }
      }
    }
  }

  async webSocketMessage(socket, message) {
    const room = await this.ensureRoom(this.roomIdFallback());
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    if (text.length > MAX_SNAPSHOT_BYTES) {
      socket.close(1009, 'message too large');
      return;
    }
    // A hibernated DO comes back with sockets it has no room record for.
    // Re-admitting is correct: the client is still connected and will re-send
    // `hello`, so presence and identity converge without a reconnect.
    if (room.resolve(socket, 'all').indexOf(socket) < 0) room.join(socket);
    this.deliver(room, socket, room.handle(socket, text));
  }

  async webSocketClose(socket) {
    const room = await this.ensureRoom(this.roomIdFallback());
    this.deliver(room, socket, room.leave(socket));
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }

  /** The room id is in the DO name; recover it for post-hibernation wakeups. */
  roomIdFallback() {
    return this.state.id.name ?? 'local';
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== AUTHORLINK_PATH) {
      return new Response('authorlink relay\n', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    const roomId = url.searchParams.get('room') || 'local';
    // One Durable Object per room id: idFromName is stable, so every client
    // naming the same room lands on the same coordinator worldwide.
    const id = env.AUTHORLINK_ROOM.idFromName(roomId);
    return env.AUTHORLINK_ROOM.get(id).fetch(request);
  },
};

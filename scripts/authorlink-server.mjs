// No shebang on purpose: `vite.config.ts` imports this module, and esbuild
// refuses to bundle a `#!` line. Run it standalone with `node scripts/...`.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import {
  AUTHORLINK_PATH,
  AUTHORLINK_PROTOCOL,
  MAX_MESSAGE_BYTES,
  MAX_SNAPSHOT_BYTES,
  checkOrigin,
  createRoom,
} from '../servers/authorlink/room.mjs';

/**
 * AuthorLink relay — Node host.
 *
 * Two ways to run:
 *
 *   1. Attached to the Vite dev server (the normal path) — see
 *      `scripts/vite-plugin-authorlink.mjs`. `npm run dev` is then the only
 *      command you need for two-window authoring, and any browser that can
 *      reach the dev server can join the room, which is the whole point.
 *   2. Standalone: `node scripts/authorlink-server.mjs [--port 8787]`, for a
 *      production build or two machines on a LAN.
 *
 * The room BEHAVIOR lives in `servers/authorlink/room.mjs`, shared with the
 * Cloudflare Durable Object host, so a hosted room and a local room cannot
 * drift. This file owns sockets and nothing else.
 */

export { AUTHORLINK_PROTOCOL, AUTHORLINK_PATH, MAX_MESSAGE_BYTES, MAX_SNAPSHOT_BYTES };

/**
 * @param {import('node:http').Server} httpServer
 * @param {{ path?: string, log?: (msg: string) => void, strict?: boolean,
 *           allowedOrigins?: string[], token?: string,
 *           rangeFor?: (path: string) => {min:number,max:number}|null }} [options]
 */
/** Header line ending, built without escapes so it survives any tooling. */
const CRLF = String.fromCharCode(13, 10);

export function attachAuthorLink(httpServer, options = {}) {
  const path = options.path ?? AUTHORLINK_PATH;
  const log = options.log ?? (() => {});
  const rooms = new Map();
  // noServer + manual upgrade: Vite owns its own HMR WebSocket on the same
  // port, so we must only claim our path and leave every other upgrade alone.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_SNAPSHOT_BYTES });

  const onUpgrade = (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    } catch {
      return;
    }
    if (pathname !== path) return;
    // Origin is checked BEFORE the handshake completes. Accepting the upgrade
    // and then calling `socket.close()` still hands the client a working
    // `onopen` — it is a disconnect, not a refusal, and anything the client
    // pushed in that window was already delivered.
    const originCheck = checkOrigin(request.headers?.origin, options.allowedOrigins ?? []);
    if (!originCheck.ok) {
      log(`refused upgrade: ${originCheck.reason}`);
      socket.write(`HTTP/1.1 403 Forbidden${CRLF}Connection: close${CRLF}${CRLF}`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  };
  httpServer.on('upgrade', onUpgrade);

  wss.on('connection', (socket, request) => {
    let roomId = 'local';
    try {
      roomId = new URL(request.url ?? '/', 'http://localhost').searchParams.get('room') || 'local';
    } catch {
      // keep the default
    }
    let room = rooms.get(roomId);
    if (!room) {
      room = createRoom({
        id: roomId,
        strict: options.strict,
        allowedOrigins: options.allowedOrigins,
        token: options.token,
        rangeFor: options.rangeFor,
      });
      rooms.set(roomId, room);
    }

    room.join(socket);
    log(`join ${roomId} (${room.size} in room)`);

    const deliver = (deliveries) => {
      for (const { to, message } of deliveries) {
        const encoded = JSON.stringify(message);
        for (const target of room.resolve(socket, to)) {
          if (target.readyState !== target.OPEN) continue;
          target.send(encoded);
        }
      }
    };

    socket.on('message', (raw) => {
      deliver(room.handle(socket, typeof raw === 'string' ? raw : raw.toString('utf8')));
    });

    let dropped = false;
    const drop = () => {
      if (dropped) return;
      dropped = true;
      deliver(room.leave(socket));
      log(`leave ${roomId} (${room.size} in room)`);
      if (room.size === 0) rooms.delete(roomId);
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });

  return {
    close() {
      httpServer.off('upgrade', onUpgrade);
      for (const room of rooms.values()) {
        for (const client of room.resolve(null, 'all')) client.terminate();
      }
      rooms.clear();
      wss.close();
    },
    get rooms() {
      return rooms;
    },
  };
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  const arg = (name, fallback) => {
    const at = process.argv.indexOf(name);
    return at >= 0 ? process.argv[at + 1] : fallback;
  };
  const port = Number(arg('--port', 8787));
  const strict = process.argv.includes('--strict');
  const token = arg('--token', undefined);
  const origins = arg('--origin', '');

  let rangeFor;
  if (strict) {
    // Only needed in strict mode, so the dev path never depends on the
    // generated schema being present.
    const mod = await import('../servers/authorlink/tuningRanges.generated.mjs').catch(() => null);
    if (!mod) {
      console.error('[authorlink] --strict needs servers/authorlink/tuningRanges.generated.mjs');
      console.error('[authorlink] run: node scripts/gen-tuning-ranges.mjs');
      process.exit(1);
    }
    rangeFor = mod.tuningRangeFor;
  }

  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('authorlink relay\n');
  });
  attachAuthorLink(server, {
    log: (msg) => console.log(`[authorlink] ${msg}`),
    strict,
    token,
    allowedOrigins: origins
      ? origins
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : [],
    rangeFor,
  });
  server.listen(port, () => {
    console.log(
      `[authorlink] relay on ws://localhost:${port}${AUTHORLINK_PATH}` +
        `${strict ? ' [strict]' : ''}${token ? ' [token]' : ''}`,
    );
  });
}

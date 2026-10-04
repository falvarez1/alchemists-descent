import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { HttpServer } from 'vite';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { DuelRoom } from './Room.ts';
import { DUEL_PATH, DUEL_PROTOCOL, MAX_SNAPSHOT_BYTES, parseClientMessage } from '../../src/net/duel/protocol.ts';
import type { DuelServerMessage } from '../../src/net/duel/protocol.ts';

interface Seat {
  socket: WebSocket | null;
  token: string;
  disconnectedAt: number;
}
interface HostedRoom {
  room: DuelRoom;
  seats: [Seat, Seat];
}
const seat = (): Seat => ({ socket: null, token: randomBytes(24).toString('hex'), disconnectedAt: 0 });
const LEASE_MS = 60_000;

/** LAN adapter. The room service has no dependency on WebSocket or Vite. */
export function attachDuelServer(server: HttpServer): { close(): void } {
  const rooms = new Map<string, HostedRoom>();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_SNAPSHOT_BYTES,
    perMessageDeflate: { threshold: 1024, serverNoContextTakeover: true, clientNoContextTakeover: true },
  });
  const send = (socket: WebSocket | null, message: DuelServerMessage): void => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const end = (hosted: HostedRoom, message: string): void => {
    rooms.delete(hosted.room.id);
    for (const s of hosted.seats) {
      send(s.socket, { type: 'ended', message });
      s.socket?.close(1000);
      s.socket = null;
    }
  };
  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (request.url?.split('?')[0] !== DUEL_PATH) return;
    // Same-origin browsers only. No wildcard origin exemption for LAN addresses.
    let allowed = false;
    try {
      allowed = new URL(request.headers.origin ?? '').host === request.headers.host;
    } catch {
      /* refuse */
    }
    if (!allowed) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client));
  };
  server.on('upgrade', onUpgrade);
  wss.on('connection', (socket) => {
    let membership: { hosted: HostedRoom; slot: 0 | 1 } | null = null;
    let lastPong = Date.now(),
      windowAt = Date.now(),
      messages = 0;
    const helloTimer = setTimeout(() => {
      if (!membership) socket.close(1008, 'Join required');
    }, 5000);
    socket.on('pong', () => {
      lastPong = Date.now();
    });
    const heartbeat = setInterval(() => {
      if (Date.now() - lastPong > 12_000) socket.terminate();
      else socket.ping();
    }, 4000);
    socket.on('error', () => {
      /* close owns cleanup */
    });
    socket.on('message', (bytes, binary) => {
      const now = Date.now();
      if (now - windowAt >= 1000) {
        windowAt = now;
        messages = 0;
      }
      if (++messages > 240) {
        socket.close(1008, 'Message rate exceeded');
        return;
      }
      if (binary) {
        if (!membership || !membership.hosted.room.canPublish(membership.slot)) {
          socket.close(1008, 'Authority required');
          return;
        }
        const guest = membership.hosted.seats[1].socket;
        if (guest?.readyState === WebSocket.OPEN) {
          // Never drop an incremental terrain patch. Disconnect/rejoin forces a baseline.
          if (guest.bufferedAmount > MAX_SNAPSHOT_BYTES) guest.close(1013, 'Receiver is too slow');
          else guest.send(bytes, { binary: true });
        }
        return;
      }
      const command = parseClientMessage(bytes.toString());
      if (!command) {
        socket.close(1008, 'Invalid message');
        return;
      }
      if (command.type === 'hello') {
        if (membership) {
          socket.close(1008, 'Already joined');
          return;
        }
        if (command.protocol !== DUEL_PROTOCOL) {
          send(socket, { type: 'error', message: 'Different network version. Reload both computers.' });
          socket.close();
          return;
        }
        let hosted = rooms.get(command.room);
        const slot = command.role === 'host' ? 0 : 1;
        const creating = slot === 0 && !command.token;
        if (creating) {
          if (rooms.size >= 16) {
            send(socket, { type: 'error', message: 'This LAN server is full.' });
            socket.close();
            return;
          }
          let id: string;
          do {
            id = randomBytes(3).toString('hex').toUpperCase();
          } while (rooms.has(id));
          const seats: [Seat, Seat] = [seat(), seat()];
          const room = new DuelRoom(id, command.build, (target, message) => send(seats[target].socket, message));
          hosted = { room, seats };
          rooms.set(id, hosted);
        }
        if (!hosted) {
          send(socket, { type: 'error', message: 'Room not found. Check the code and host address.' });
          socket.close();
          return;
        }
        if (hosted.room.build !== command.build) {
          send(socket, { type: 'error', message: 'Different game builds. Reload both computers from this server.' });
          socket.close();
          return;
        }
        const member = hosted.seats[slot];
        const requiresLease = !creating && (member.disconnectedAt > 0 || slot === 0);
        if (member.socket || (requiresLease && command.token !== member.token)) {
          send(socket, { type: 'error', message: 'That seat is already reserved. Ask the host to create a new room.' });
          socket.close();
          return;
        }
        member.socket = socket;
        member.disconnectedAt = 0;
        membership = { hosted, slot };
        clearTimeout(helloTimer);
        send(socket, {
          type: 'welcome',
          slot,
          token: member.token,
          state: {
            ...hosted.room.state,
            seats: hosted.room.state.seats.map((s, i) => ({ ...s, connected: i === slot || s.connected })) as [
              (typeof hosted.room.state.seats)[0],
              (typeof hosted.room.state.seats)[1],
            ],
          },
        });
        hosted.room.connect(slot);
        return;
      }
      if (!membership) {
        socket.close(1008, 'Join required');
        return;
      }
      if (command.type === 'leave') {
        end(membership.hosted, membership.slot === 0 ? 'The host ended the room.' : 'Player 2 left the room.');
        return;
      }
      membership.hosted.room.command(membership.slot, command);
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(heartbeat);
      if (!membership || !rooms.has(membership.hosted.room.id)) return;
      const { hosted, slot } = membership;
      if (hosted.seats[slot].socket !== socket) return;
      hosted.seats[slot].socket = null;
      hosted.seats[slot].disconnectedAt = Date.now();
      hosted.room.disconnect(slot);
    });
  });
  const leases = setInterval(() => {
    for (const hosted of rooms.values())
      if (hosted.seats.some((s) => s.disconnectedAt > 0 && Date.now() - s.disconnectedAt > LEASE_MS))
        end(hosted, 'The disconnected player did not return. Create a new room.');
  }, 5000);
  return {
    close() {
      clearInterval(leases);
      server.off('upgrade', onUpgrade);
      for (const room of rooms.values()) end(room, 'LAN server stopped.');
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}

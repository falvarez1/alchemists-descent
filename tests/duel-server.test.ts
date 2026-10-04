import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { attachDuelServer } from '../servers/duel/server';
import type { DuelHello, DuelServerMessage } from '@/net/duel/protocol';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function server() {
  const http = createServer(), relay = attachDuelServer(http), sockets: WebSocket[] = [];
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  const address = http.address(); if (!address || typeof address === 'string') throw new Error('No address');
  const origin = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => { sockets.forEach(s => s.terminate()); relay.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  return {
    async connect(hello: Partial<DuelHello> = {}, otherOrigin = origin) {
      const socket = new WebSocket(origin.replace('http', 'ws') + '/__duel', { origin: otherOrigin }); sockets.push(socket);
      const messages: DuelServerMessage[] = [], binary: Buffer[] = [];
      socket.on('message', (data, isBinary) => { if (isBinary) binary.push(Buffer.from(data as Buffer)); else messages.push(JSON.parse(data.toString()) as DuelServerMessage); });
      socket.on('error', () => {});
      await once(socket, 'open');
      socket.send(JSON.stringify({ type: 'hello', protocol: 1, build: 'test', role: 'host', room: '', ...hello }));
      return { socket, messages, binary };
    },
  };
}
async function welcome(client: Awaited<ReturnType<Awaited<ReturnType<typeof server>>['connect']>>) {
  await expect.poll(() => client.messages.some(m => m.type === 'welcome')).toBe(true);
  const message = client.messages.find(m => m.type === 'welcome');
  if (message?.type !== 'welcome') throw new Error('Missing welcome'); return message;
}
describe('real LAN WebSocket adapter', () => {
  it('joins two seats, rejects a third seat and mismatched builds, and resumes only with the lease', async () => {
    const service = await server(), host = await service.connect(), hostWelcome = await welcome(host);
    const guest = await service.connect({ role: 'guest', room: hostWelcome.state.room });
    const guestWelcome = await welcome(guest); expect(guestWelcome.slot).toBe(1);
    const third = await service.connect({ role: 'guest', room: hostWelcome.state.room });
    await expect.poll(() => third.messages.some(m => m.type === 'error')).toBe(true);
    const wrongBuild = await service.connect({ role: 'guest', room: hostWelcome.state.room, build: 'wrong' });
    await expect.poll(() => wrongBuild.messages.some(m => m.type === 'error' && m.message.includes('builds'))).toBe(true);
    guest.socket.close(); await once(guest.socket, 'close');
    const impostor = await service.connect({ role: 'guest', room: hostWelcome.state.room });
    await expect.poll(() => impostor.messages.some(m => m.type === 'error')).toBe(true);
    const resumed = await service.connect({ role: 'guest', room: hostWelcome.state.room, token: guestWelcome.token });
    expect((await welcome(resumed)).slot).toBe(1);
  });
  it('rejects cross-origin connections and guest binary authority', async () => {
    const service = await server();
    await expect(service.connect({}, 'http://unrelated.invalid')).rejects.toThrow('403');
    const host = await service.connect(), h = await welcome(host);
    const guest = await service.connect({ role: 'guest', room: h.state.room }); await welcome(guest);
    const closed = once(guest.socket, 'close'); guest.socket.send(new Uint8Array([1, 2, 3]));
    expect((await closed)[0]).toBe(1008);
  });
  it('keeps rooms isolated and ends both seats when a player leaves', async () => {
    const service = await server(), host = await service.connect(), h = await welcome(host);
    const guest = await service.connect({ role: 'guest', room: h.state.room }); await welcome(guest);
    const other = await service.connect(); await welcome(other);
    guest.socket.send(JSON.stringify({ type: 'leave' }));
    await expect.poll(() => host.messages.some(m => m.type === 'ended')).toBe(true);
    expect(other.messages.some(m => m.type === 'ended')).toBe(false);
    expect(other.socket.readyState).toBe(WebSocket.OPEN);
  });
});

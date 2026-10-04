import { describe, expect, it, vi } from 'vitest';
import { DuelSession, type DuelRuntime } from '@/net/duel/DuelSession';
import type { SessionTransport, TransportHandlers } from '@/net/SessionTransport';
import type { DuelRoomState, DuelServerMessage } from '@/net/duel/protocol';
import { encodeDuelSnapshot } from '@/net/duel/snapshot';
import { createCellPatch } from '@/authoring/cellPatch';
import { snapshotFixture } from './fixtures/duelSnapshot';

class MemoryTransport implements SessionTransport {
  describe = 'memory'; state = 'open' as const; supportsBinary = true; bufferedBytes = 0;
  handlers!: TransportHandlers;
  messages: string[] = [];
  binary: Uint8Array[] = [];
  open(handlers: TransportHandlers) { this.handlers = handlers; handlers.onOpen(); }
  send(data: string) { this.messages.push(data); return true; }
  sendBinary(data: Uint8Array) { this.binary.push(data); return true; }
  close() {}
  receive(message: DuelServerMessage) { this.handlers.onMessage(JSON.stringify(message)); }
}
const lobby = (): DuelRoomState => ({ room: 'ABCDEF', epoch: 0, phase: 'lobby', seats: [
  { fighter: 'ilyra-voss', ready: true, connected: true }, { fighter: 'brann-rook', ready: true, connected: true },
] });
function setup(prepare: DuelRuntime['prepare'] = async () => true) {
  const links: MemoryTransport[] = [];
  const runtime: DuelRuntime = { prepare, stop: vi.fn(), pause: vi.fn(), sample: () => ({ buttons: 0, aim: 0 }), clearInput: vi.fn(), input: vi.fn(), capture: vi.fn(), receive: vi.fn(), present: vi.fn() };
  let now = 0;
  const session = new DuelSession(() => { const link = new MemoryTransport(); links.push(link); return link; }, runtime, 'test', vi.fn(), () => now);
  return { session, runtime, links, time: (value: number) => { now = value; session.frame(value); } };
}
describe('transport-independent Duel lifecycle', () => {
  it('accepts a new guest starting at sequence one after the host creates another room', async () => {
    const { session, links, runtime } = setup();
    for (const sequence of [1000, 1]) {
      session.host(); const link = links[links.length - 1];
      const state = { ...lobby(), epoch: 1, phase: 'loading' as const };
      link.receive({ type: 'welcome', slot: 0, token: 'a'.repeat(48), state });
      await Promise.resolve(); await Promise.resolve();
      link.receive({ type: 'room', state: { ...state, phase: 'playing' } });
      link.receive({ type: 'input', epoch: 1, seq: sequence, buttons: 64, aim: 0 });
      session.beforeTick();
      expect(runtime.input).toHaveBeenLastCalledWith(1, expect.objectContaining({ pressed: 64, seq: sequence }));
      session.leave();
    }
  });
  it('rejects duplicates and missing predecessors, then recovers with a baseline', async () => {
    const { session, runtime, links } = setup(); session.join('ABCDEF');
    const link = links[0], state = { ...lobby(), epoch: 1, phase: 'loading' as const };
    link.receive({ type: 'welcome', slot: 1, token: 'a'.repeat(48), state });
    await Promise.resolve(); await Promise.resolve();
    link.receive({ type: 'room', state: { ...state, phase: 'playing' } });
    runtime.receive = vi.fn(() => true);
    const packet = snapshotFixture();
    const deliver = () => link.handlers.onBinary?.(encodeDuelSnapshot(packet, createCellPatch()));
    deliver(); deliver(); expect(runtime.receive).toHaveBeenCalledTimes(1);
    packet.seq = 3; packet.base = 2; packet.baseline = false; deliver();
    expect(runtime.receive).toHaveBeenCalledTimes(1);
    expect(link.messages.map(s => JSON.parse(s))).toContainEqual({ type: 'resync' });
    packet.seq = 4; packet.base = 3; packet.baseline = true; deliver();
    expect(runtime.receive).toHaveBeenCalledTimes(2);
    packet.epoch = 2; packet.seq = 5; deliver();
    expect(runtime.receive).toHaveBeenCalledTimes(2);
  });
  it('publishes the final authoritative tick when both players pause', async () => {
    const { session, runtime, links } = setup(); session.host();
    const link = links[0], state = { ...lobby(), epoch: 1, phase: 'loading' as const };
    link.receive({ type: 'welcome', slot: 0, token: 'a'.repeat(48), state });
    await Promise.resolve(); await Promise.resolve();
    runtime.capture = vi.fn(meta => ({ snapshot: { ...snapshotFixture(), ...meta }, cells: createCellPatch() }));
    link.receive({ type: 'room', state: { ...state, phase: 'playing' } });
    link.receive({ type: 'room', state: { ...state, phase: 'paused' } });
    expect(link.binary).toHaveLength(1); expect(runtime.pause).toHaveBeenLastCalledWith(true);
  });
  it('stops a pending preparation when the server returns to the lobby', async () => {
    let finish!: (value: boolean) => void;
    const { session, runtime, links } = setup(() => new Promise(resolve => { finish = resolve; }));
    session.host();
    links[0].receive({ type: 'welcome', slot: 0, token: 'a'.repeat(48), state: lobby() });
    links[0].receive({ type: 'prepare', state: { ...lobby(), epoch: 1, phase: 'loading' } });
    links[0].receive({ type: 'room', state: { ...lobby(), epoch: 1 } });
    expect(runtime.stop).toHaveBeenCalled();
    finish(true); await Promise.resolve(); await Promise.resolve();
    expect(links[0].messages.map(s => JSON.parse(s).type)).not.toContain('loaded');
  });
  it('prepares both seats through the runtime adapter and never ticks guest input locally', async () => {
    const { session, links, runtime, time } = setup(); session.join('abcdef');
    const link = links[0]; link.receive({ type: 'welcome', slot: 1, token: 'a'.repeat(48), state: lobby() });
    const state = { ...lobby(), epoch: 1, phase: 'loading' as const };
    link.receive({ type: 'prepare', state }); await Promise.resolve(); await Promise.resolve();
    expect(link.messages.map(s => JSON.parse(s))).toContainEqual({ type: 'loaded', epoch: 1 });
    link.receive({ type: 'room', state: { ...state, phase: 'playing' } });
    time(100); session.beforeTick(); session.afterTick();
    expect(runtime.input).not.toHaveBeenCalled(); expect(runtime.capture).not.toHaveBeenCalled();
    expect(link.messages.map(s => JSON.parse(s))).toContainEqual({ type: 'input', epoch: 1, seq: 1, buttons: 0, aim: 0 });
  });
  it('invalidates a pending match load when the player leaves', async () => {
    let finish!: (value: boolean) => void;
    const { session, links } = setup(() => new Promise(resolve => { finish = resolve; })); session.host();
    links[0].receive({ type: 'welcome', slot: 0, token: 'a'.repeat(48), state: lobby() });
    links[0].receive({ type: 'prepare', state: { ...lobby(), epoch: 1, phase: 'loading' } });
    session.leave(); finish(true); await Promise.resolve(); await Promise.resolve();
    expect(links[0].messages.map(s => JSON.parse(s).type)).not.toContain('loaded');
    expect(session.active).toBe(false);
  });
  it('pauses immediately on transport loss and retries with the same seat lease', () => {
    const { session, links, runtime, time } = setup(); session.host();
    links[0].receive({ type: 'welcome', slot: 0, token: 'a'.repeat(48), state: lobby() });
    links[0].handlers.onClose(); expect(runtime.pause).toHaveBeenLastCalledWith(true);
    expect(session.connected).toBe(false); time(501);
    expect(links).toHaveLength(2);
    expect(JSON.parse(links[1].messages[0])).toMatchObject({ type: 'hello', token: 'a'.repeat(48), room: 'ABCDEF' });
  });
});

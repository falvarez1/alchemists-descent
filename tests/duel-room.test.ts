import { describe, expect, it } from 'vitest';
import { DuelRoom } from '../servers/duel/Room';
import type { DuelServerMessage } from '@/net/duel/protocol';

function setup() {
  const output: Array<{ slot: number; message: DuelServerMessage }> = [];
  const room = new DuelRoom('ABCDEF', 'test-build', (slot, message) => output.push({ slot, message }));
  room.connect(0); room.connect(1);
  return { room, output };
}
describe('Duel room authority', () => {
  it('returns an interrupted load to the lobby so neither player gets stuck', () => {
    const { room } = setup();
    for (const slot of [0, 1]) room.command(slot, { type: 'ready', ready: true });
    room.command(0, { type: 'start' });
    const oldEpoch = room.state.epoch;
    room.disconnect(1); room.connect(1);
    expect(room.state.phase).toBe('lobby');
    expect(room.state.seats.every(s => !s.ready)).toBe(true);
    room.command(1, { type: 'loaded', epoch: oldEpoch });
    expect(room.state.phase).toBe('lobby');
    for (const slot of [0, 1]) room.command(slot, { type: 'ready', ready: true });
    room.command(0, { type: 'start' });
    expect(room.state.epoch).toBe(oldEpoch + 1);
  });
  it('requires both players ready and lets only the host start', () => {
    const { room } = setup();
    room.command(0, { type: 'start' }); expect(room.state.phase).toBe('lobby');
    room.command(0, { type: 'ready', ready: true }); room.command(1, { type: 'ready', ready: true });
    room.command(1, { type: 'start' }); expect(room.state.phase).toBe('lobby');
    room.command(0, { type: 'start' }); expect(room.state.phase).toBe('loading');
    const epoch = room.state.epoch;
    room.command(0, { type: 'loaded', epoch }); expect(room.state.phase).toBe('loading');
    room.command(1, { type: 'loaded', epoch }); expect(room.state.phase).toBe('playing');
  });
  it('freezes on disconnect, requires explicit resume, and rejects stale match input', () => {
    const { room, output } = setup();
    for (const slot of [0, 1]) room.command(slot, { type: 'ready', ready: true });
    room.command(0, { type: 'start' }); const epoch = room.state.epoch;
    for (const slot of [0, 1]) room.command(slot, { type: 'loaded', epoch });
    output.length = 0;
    room.command(1, { type: 'input', epoch: epoch - 1, seq: 1, buttons: 1, aim: 0 });
    expect(output).toHaveLength(0);
    room.disconnect(1); expect(room.state.phase).toBe('paused');
    room.command(0, { type: 'resume' }); expect(room.state.phase).toBe('paused');
    room.connect(1); expect(room.state.phase).toBe('paused');
    room.command(0, { type: 'resume' }); expect(room.state.phase).toBe('playing');
  });
  it('routes guest controls to the authority and never accepts a guest snapshot', () => {
    const { room } = setup();
    expect(room.canPublish(1)).toBe(false);
    expect(room.canPublish(0)).toBe(false);
  });
});

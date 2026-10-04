import { describe, expect, it } from 'vitest';
import { TerrainReplicator } from '@/net/duel/TerrainReplicator';
import { World } from '@/sim/World';
import { applyCellPatch } from '@/authoring/cellPatch';
import { encodeCellPatch, decodeCellPatch } from '@/authoring/cellPatchCodec';
import { parseClientMessage, DUEL_PROTOCOL } from '@/net/duel/protocol';

describe('Duel terrain and trust boundaries', () => {
  it('replicates a baseline, destruction, colors, and charged cells losslessly', () => {
    const host = new World(), guest = new World(), writer = new TerrainReplicator();
    host.types[22] = 13; host.colors[22] = 0xabc123; host.life[22] = -7; host.setChargeAt(22, 900);
    const baseline = decodeCellPatch(encodeCellPatch(writer.capture(host, true)), guest.types.length)!;
    guest.clear(); applyCellPatch(guest, baseline);
    expect([guest.types[22], guest.colors[22], guest.life[22], guest.charge[22]]).toEqual([13, 0xabc123, -7, 900]);
    host.types[22] = 0; host.colors[22] = 0; host.life[22] = 0; host.setChargeAt(22, 0);
    applyCellPatch(guest, writer.capture(host, false)); expect(guest.types[22]).toBe(0); expect(guest.charge[22]).toBe(0);
    expect(writer.capture(host, false).idxs).toHaveLength(0);
  });
  it('validates input ranges and protocol negotiation without accepting outcomes from clients', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'hello', protocol: DUEL_PROTOCOL, build: 'test', role: 'host', room: '' }))).not.toBeNull();
    for (const value of [
      { type: 'input', epoch: 1, seq: -1, buttons: 0, aim: 0 },
      { type: 'input', epoch: 1, seq: 1, buttons: 65535, aim: 0 },
      { type: 'input', epoch: 1, seq: 1, buttons: 1, aim: 9 },
      { type: 'damage', slot: 0, amount: 900 }, { type: 'choose', fighter: 'invented' },
    ]) expect(parseClientMessage(JSON.stringify(value))).toBeNull();
  });
  it('captures raw plane writes immediately and retains empty-cell shadows across a new baseline', () => {
    const host = new World(67, 65), guest = new World(67, 65), writer = new TerrainReplicator();
    const index = host.types.length - 1;
    writer.capture(host, true);
    host.types[index] = 13; host.colors[index] = 0x123456; host.life[index] = 17; host.charge[index] = 8;
    applyCellPatch(guest, writer.capture(host, false));
    expect([guest.types[index], guest.colors[index], guest.life[index], guest.charge[index]]).toEqual([13, 0x123456, 17, 8]);
    host.clear(); writer.capture(host, true);
    expect(writer.capture(host, false).idxs).toHaveLength(0);
    host.colors[index] = 0xabcdef;
    expect(writer.capture(host, false).idxs).toEqual([index]);
  });
});

import { snapshotFixture } from './fixtures/duelSnapshot';
import { describe, expect, it } from 'vitest';
import { createCellPatch } from '@/authoring/cellPatch';
import { decodeDuelSnapshot, encodeDuelSnapshot, type DuelSnapshot } from '@/net/duel/snapshot';

describe('atomic Duel snapshot codec', () => {
  it('round-trips authoritative presentation with its terrain in one packet', () => {
    const snapshot = snapshotFixture(), cells = { idxs: [2], types: [13], colors: [0xc0c0c0], life: [12], charge: [0] };
    expect(decodeDuelSnapshot(encodeDuelSnapshot(snapshot, cells))).toEqual({ snapshot: JSON.parse(JSON.stringify(snapshot)), cells });
  });
  it('rejects truncated terrain and mismatched packet headers', () => {
    const packet = encodeDuelSnapshot(snapshotFixture(), createCellPatch());
    expect(decodeDuelSnapshot(packet.subarray(0, packet.length - 1))).toBeNull();
    packet[0] = 0; expect(decodeDuelSnapshot(packet)).toBeNull();
  });
  it.each([
    ['missing ability view', (s: DuelSnapshot) => { Reflect.deleteProperty(s.fighters[0].fighter, 'tactical'); }],
    ['invalid lightning points', (s: DuelSnapshot) => { s.arcs = [{ pts: null, life: 2, intensity: 1 }] as unknown as DuelSnapshot['arcs']; }],
    ['missing stock fighter', (s: DuelSnapshot) => { s.arena.match = { ...s.arena.match, fighters: [null, null] } as unknown as DuelSnapshot['arena']['match']; }],
    ['zero view scale', (s: DuelSnapshot) => { s.camera.viewScale = 0; }],
    ['broken costume', (s: DuelSnapshot) => { s.fighters[0].player.costume = {} as NonNullable<DuelSnapshot['fighters'][0]['player']['costume']>; }],
  ])('rejects %s before it reaches a renderer', (_label, mutate) => {
    const snapshot = snapshotFixture(); mutate(snapshot);
    expect(decodeDuelSnapshot(encodeDuelSnapshot(snapshot, createCellPatch()))).toBeNull();
  });
});

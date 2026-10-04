import { snapshotFixture } from './fixtures/duelSnapshot';
import { describe, expect, it } from 'vitest';
import { createCellPatch } from '@/authoring/cellPatch';
import { decodeDuelSnapshot, encodeDuelSnapshot, type DuelSnapshot } from '@/net/duel/snapshot';
import { stockMoveset } from '@/config/stockAttacks';

describe('atomic Duel snapshot codec', () => {
  it.each(['neutral_air', 'back_air', 'up_air', 'down_air', 'up_smash', 'down_smash'] as const)('carries Brann %s and its signed volume to the replica', kind => {
    const snapshot = snapshotFixture();
    snapshot.arena.slots[0].attack = { kind, phase: 'active', busy: true, facing: -1, age: 20, id: 2, spec: stockMoveset('brann-rook')[kind] };
    snapshot.fighters[0].player.stockAirJumpT = 8;
    const result = decodeDuelSnapshot(encodeDuelSnapshot(snapshot, createCellPatch()));
    expect(result?.snapshot.arena.slots[0].attack).toEqual(snapshot.arena.slots[0].attack);
    expect(result?.snapshot.fighters[0].player.stockAirJumpT).toBe(8);
  });
  it('round-trips authoritative presentation with its terrain in one packet', () => {
    const snapshot = snapshotFixture(), cells = { idxs: [2], types: [13], colors: [0xc0c0c0], life: [12], charge: [0] };
    expect(decodeDuelSnapshot(encodeDuelSnapshot(snapshot, cells))).toEqual({ snapshot: JSON.parse(JSON.stringify(snapshot)), cells });
  });
  it("carries the host's match moments and each sound's shaping, in order (a replica re-raises them)", () => {
    const snapshot = snapshotFixture();
    snapshot.moments = [
      { type: 'stockMatchBeat', data: { state: 'countdown', count: 3, winner: null, reason: null } },
      { type: 'fighterDown', data: { slot: 1, by: 0, source: 'ring-out', x: 1390, y: 500 } },
      { type: 'stockUltimate', data: { slot: 0, fighter: 'rusk-emberjaw', name: 'Redline' } },
      { type: 'stockShieldBreak', data: { slot: 1 } },
      { type: 'stockMatchBeat', data: { state: 'finished', count: 0, winner: 0, reason: 'stocks' } },
    ];
    snapshot.sounds = [{ id: 'arena.hit.heavy', x: 800, y: 600, gain: 0.8, delay: 0.95 }];
    const decoded = decodeDuelSnapshot(encodeDuelSnapshot(snapshot, createCellPatch()));
    expect(decoded?.snapshot.moments.map(m => m.type)).toEqual(['stockMatchBeat', 'fighterDown', 'stockUltimate', 'stockShieldBreak', 'stockMatchBeat']);
    expect(decoded?.snapshot.sounds[0]).toEqual({ id: 'arena.hit.heavy', x: 800, y: 600, gain: 0.8, delay: 0.95 });
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
    ['a moment of an unknown kind', (s: DuelSnapshot) => { s.moments = [{ type: 'playerDied', data: {} }] as unknown as DuelSnapshot['moments']; }],
    ['a ring-out without a slot', (s: DuelSnapshot) => { s.moments = [{ type: 'fighterDown', data: { by: 0, source: 'ring-out', x: 1, y: 2 } }] as unknown as DuelSnapshot['moments']; }],
    ['an ultimate by no fighter', (s: DuelSnapshot) => { s.moments = [{ type: 'stockUltimate', data: { slot: 0, fighter: 'nobody', name: 'X' } }] as unknown as DuelSnapshot['moments']; }],
  ])('rejects %s before it reaches a renderer', (_label, mutate) => {
    const snapshot = snapshotFixture(); mutate(snapshot);
    expect(decodeDuelSnapshot(encodeDuelSnapshot(snapshot, createCellPatch()))).toBeNull();
  });
});

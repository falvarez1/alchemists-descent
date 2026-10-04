import { describe, expect, it } from 'vitest';
import { DuelRuntime } from '@/game/DuelRuntime';
import { snapshotFixture } from './fixtures/duelSnapshot';

// Exercise the presentation boundary without constructing DOM controls or gameplay systems.
function presentation() {
  const previous = snapshotFixture(), latest = snapshotFixture();
  previous.tick = 3; latest.tick = 6;
  previous.fighters.forEach(f => { f.player.x = 100; f.player.y = 80; });
  latest.fighters.forEach(f => { f.player.x = 130; f.player.y = 80; });
  const players = latest.fighters.map(f => structuredClone(f.player));
  const runtime = Object.assign(Object.create(DuelRuntime.prototype) as DuelRuntime, {
    previous, latest, receivedAt: 100, presentationDirty: true,
    ctx: { duel: { slot: 1 }, arena: { bundle: (slot: number) => ({ player: players[slot] }) } },
  });
  return { runtime, players, latest };
}

describe('Duel replica presentation', () => {
  it('shows the local fighter at the latest authority position without an interpolation delay', () => {
    const { runtime, players } = presentation();
    runtime.present(100);
    expect(players[1].x).toBe(130);
    expect(players[0].x).toBe(100);
    runtime.present(125);
    expect(players[1].x).toBe(130);
    expect(players[0].x).toBe(115);
  });
  it('stops requesting composition once the new snapshot and remote interpolation are presented', () => {
    const { runtime } = presentation();
    expect(runtime.present(100)).toBe(true);
    expect(runtime.present(125)).toBe(true);
    expect(runtime.present(150)).toBe(true);
    expect(runtime.present(170)).toBe(false);
  });
  it('does not interpolate a remote respawn across the arena', () => {
    const { runtime, players, latest } = presentation();
    latest.fighters[0].player.x = players[0].x = 400;
    runtime.present(100);
    expect(players[0].x).toBe(400);
  });
});

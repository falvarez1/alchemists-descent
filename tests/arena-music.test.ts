import { describe, expect, it } from 'vitest';
import { arenaCueFor, chooseCue, cueLevel, dipFor, fadeSeconds, loopFadeSeconds, type DirectorInput } from '@/audio/musicRules';

const input: DirectorInput = { gestured: true, soundOn: true, verdict: null, verdictPending: false, builderOpen: false, entryActive: false, ledgerOpen: false, sanctumOpen: false, mode: 'play', runOver: false, teaActive: false, boss: null, floor: 'd1', tension: false, preview: false };
describe('Arena score routing', () => {
  it('replaces the borrowed campaign cue in solo Arena and Duel, and recognizes a rival in another level', () => {
    for (const level of ['fighter-test', 'fighter-duel']) expect(arenaCueFor({ mode: 'play', level })).toBe('arena-battle');
    expect(arenaCueFor({ mode: 'play', level: 'd1', rival: true })).toBe('arena-battle');
    expect(arenaCueFor({ mode: 'play', level: 'd1' })).toBeNull();
    expect(arenaCueFor({ mode: 'build', level: 'fighter-test' })).toBeNull();
  });
  it('uses select music in the lobby and results once, then returns to rematch music', () => {
    expect(arenaCueFor({ mode: 'build', phase: 'lobby' })).toBe('arena-lobby');
    expect(arenaCueFor({ mode: 'play', phase: 'loading' })).toBe('arena-lobby');
    expect(arenaCueFor({ mode: 'play', phase: 'reconnect' })).toBe('arena-battle');
    expect(arenaCueFor({ mode: 'play', level: 'fighter-duel', finished: true })).toBe('arena-results');
    expect(arenaCueFor({ mode: 'play', level: 'fighter-duel', finished: true, resultsDone: true })).toBe('arena-lobby');
  });
  it('does not allow a stale campaign death, story, sanctum, or entry layer to select campaign music in a match', () => {
    expect(chooseCue({ ...input, arenaCue: 'arena-battle', verdict: 'fallen', story: 'escape', sanctumOpen: true, entryActive: true })).toBe('arena-battle');
    expect(chooseCue({ ...input, arenaCue: 'arena-lobby', entryActive: true, verdictPending: true })).toBe('arena-lobby');
    expect(chooseCue({ ...input, arenaCue: 'arena-battle', gestured: false })).toBeNull();
  });
  it('keeps battle energy through an individual stock loss, while pause still ducks it', () => {
    const d = { hidden: false, paused: false, playerDead: true, ledgerOpen: false, mode: 'play' as const, cue: 'arena-battle', sincePhaseMs: 0 };
    expect(dipFor(d)).toBe(1);
    expect(dipFor({ ...d, paused: true })).toBe(0.6);
    expect(dipFor({ ...d, hidden: true })).toBe(0);
    expect(cueLevel('arena-battle')).toBeLessThanOrEqual(1);
    expect(fadeSeconds('bellows', 'arena-battle')).toBeLessThan(1);
    expect(loopFadeSeconds('arena-battle')).toBeLessThan(1);
  });
});

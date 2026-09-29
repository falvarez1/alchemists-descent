import { describe, expect, it } from 'vitest';

import { drawCounts, resetDrawCounts } from '@/core/simRandom';
import { hashActivity, hashSimColors, hashSimState, runLargeScene } from './fixtures/largeSimScene';

/**
 * MULTI-CHUNK GOLDEN FRAMES. sim-golden-frame.test.ts pins a 96x96 scene that
 * lives inside one activity-chunk corner; this pins a 320x256 scene (5x4
 * chunks) so the activity grid's bookkeeping — cross-chunk contact halos,
 * sleeping and coarse (15 Hz) scheduling, the render-damage planes — and the
 * electrical tracker are locked too. Performance work on that bookkeeping
 * must leave every hash and draw count here unchanged.
 *
 * Re-record ONLY for a deliberate, commit-flagged simulation change.
 */
const GOLDEN: Record<number, { state: string; colors: string; simDraws: number; activity: string }> = {
  3: { state: 'b37b7a44', colors: 'b27b59cb', simDraws: 4821387, activity: '51aa6069' },
  99: { state: '1a2548f1', colors: '8b13201d', simDraws: 4948333, activity: 'a272195f' },
};

describe('sim golden frames (multi-chunk)', () => {
  it('replays identically from the same seed', () => {
    const a = runLargeScene(424242, 60);
    const b = runLargeScene(424242, 60);
    expect(hashSimState(b.world)).toBe(hashSimState(a.world));
  });

  it('matches the recorded golden hashes', () => {
    for (const seed of Object.keys(GOLDEN).map(Number)) {
      resetDrawCounts();
      const { world } = runLargeScene(seed, 150);
      expect.soft({
        seed,
        state: hashSimState(world),
        colors: hashSimColors(world),
        simDraws: drawCounts().sim,
        activity: hashActivity(world),
      }).toEqual({ seed, ...GOLDEN[seed] });
    }
  });
});

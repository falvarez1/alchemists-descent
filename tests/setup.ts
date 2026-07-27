import { afterEach } from 'vitest';
import { reseedAllStreams, setRandomOverrideForTests } from '@/core/simRandom';

/**
 * Gameplay randomness is global module state now (core/simRandom.ts), so it
 * needs the same hygiene `vi.spyOn` used to give us for free: a forced roll
 * must not survive into the next test, and one test's draws must not shift
 * another's stream position. Both are cleared here rather than left to each
 * test to remember.
 */
afterEach(() => {
  setRandomOverrideForTests(null);
  reseedAllStreams(0);
});

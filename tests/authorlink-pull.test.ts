import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PendingWorldPull, type PullOutcome } from '@/app/authorLinkPull';

const timings = { answerMs: 20_000, receiveCeilingMs: 600_000 };

describe('PendingWorldPull', () => {
  let outcomes: PullOutcome[];
  const start = (target = 'play-abc'): PendingWorldPull =>
    new PendingWorldPull(target, (outcome) => outcomes.push(outcome), timings);

  beforeEach(() => {
    vi.useFakeTimers();
    outcomes = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails fast when the target never answers', () => {
    start();
    vi.advanceTimersByTime(timings.answerMs - 1);
    expect(outcomes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(outcomes).toEqual(['no-answer']);
  });

  // The CI failure: a ~9 MB snapshot reaching a window that renders a few
  // frames a second takes far longer than the answer window. Once the target
  // has answered, the clock that mattered for "is anyone there" stops.
  it('waits out a slow transfer once the target has answered', () => {
    const pull = start();
    vi.advanceTimersByTime(1_000);
    expect(pull.heardFrom('play-abc')).toBe(true);
    vi.advanceTimersByTime(3 * 60_000);
    expect(outcomes).toEqual([]);
    pull.complete();
    expect(outcomes).toEqual(['pulled']);
    expect(pull.settled).toBe(true);
  });

  it('only the target counts as an answer, and only once', () => {
    const pull = start();
    expect(pull.heardFrom('builder-xyz')).toBe(false);
    expect(pull.receiving).toBe(false);
    expect(pull.heardFrom('play-abc')).toBe(true);
    expect(pull.heardFrom('play-abc')).toBe(false);
    expect(pull.receiving).toBe(true);
  });

  it('a snapshot that beats the answer still completes the pull', () => {
    const pull = start();
    pull.complete();
    vi.advanceTimersByTime(timings.answerMs * 2);
    expect(outcomes).toEqual(['pulled']);
  });

  it('a peer that answered and then never sends hits the ceiling', () => {
    const pull = start();
    pull.heardFrom('play-abc');
    vi.advanceTimersByTime(timings.receiveCeilingMs);
    expect(outcomes).toEqual(['stalled']);
  });

  it('settles exactly once, whatever arrives afterwards', () => {
    const pull = start();
    pull.heardFrom('play-abc');
    pull.fail('link-lost');
    pull.complete();
    pull.fail('peer-left');
    vi.advanceTimersByTime(timings.receiveCeilingMs * 2);
    expect(outcomes).toEqual(['link-lost']);
  });
});

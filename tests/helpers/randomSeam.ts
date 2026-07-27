import { vi } from 'vitest';
import { setRandomOverrideForTests } from '@/core/simRandom';

/**
 * Pin gameplay randomness for a test.
 *
 * Replaces the old `vi.spyOn(Math, 'random')`: gameplay draws from the seeded
 * streams in `core/simRandom.ts` now, so spying on the global would silently
 * pin nothing at all. Returns a `vi.fn` so every existing idiom still works —
 * `.mockReturnValue(0)`, `.mockReturnValueOnce(...)`, call assertions.
 *
 * `tests/setup.ts` clears the override after every test; call `restoreRandom()`
 * only when a test needs real randomness back partway through.
 */
export function mockRandom(): ReturnType<typeof vi.fn<() => number>> {
  const fn = vi.fn<() => number>();
  setRandomOverrideForTests(fn);
  return fn;
}

/** Hand control back to the real seeded streams mid-test. */
export function restoreRandom(): void {
  setRandomOverrideForTests(null);
}

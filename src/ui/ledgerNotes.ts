import type { RunSummary } from '@/core/run';

/** A run shorter than this (a fall or a change of heart) is worth a remark. */
const QUICK_EXIT_MS = 30_000;
/** Deaths are four on any fallen run; six means the phials were refilled and spent again. */
const MANY_DEATHS = 6;

/**
 * One small remark under the ledger's counters, for the runs whose numbers are strange and never for the
 * routine ones (a normal fall is four deaths; a normal win has a few dozen kills). At most one, in this order.
 */
export function ledgerNote(s: Pick<RunSummary, 'outcome' | 'kills' | 'timeMs' | 'deaths'>): string | null {
  // The Colossus counts as a kill, so a win with one is a win with nothing else.
  if (s.outcome === 'victory' && s.kills <= 1) return 'One kill, and it was the Kiln. The Works would like to know how.';
  if (s.outcome !== 'victory' && s.timeMs < QUICK_EXIT_MS) return 'Under half a minute. A personal best, for something.';
  if (s.deaths >= MANY_DEATHS) return 'The Guild has stopped sending flowers.';
  return null;
}

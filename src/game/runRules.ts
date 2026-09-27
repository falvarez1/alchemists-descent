import { GAME_TITLE } from '@/config/brand';
import type { KitId, RunOutcome, RunSummary } from '@/core/run';
import { fnv1aString } from '@/core/rng';

/**
 * The run's pure rules (Breathing Works): return phials, the daily seed, the
 * summary a finished run hands the ledger screen, and the share line. No DOM,
 * no Ctx — RunDirector owns the state and the timing, these own the arithmetic
 * so it can be tested on its own.
 */

/** Return phials a run starts with, and the most it can hold. */
export const PHIALS_PER_RUN = 3;

/**
 * A death spends a phial. With one to spend, the alchemist returns to the
 * last checkpoint (`final: false`); dying with none left ends the run.
 */
export function spendPhial(phials: number): { phials: number; final: boolean } {
  const held = clampPhials(phials);
  if (held <= 0) return { phials: 0, final: true };
  return { phials: held - 1, final: false };
}

/** A refuge rest or a Sanctum pours one back, never past the maximum. */
export function restorePhial(phials: number, max = PHIALS_PER_RUN): { phials: number; restored: boolean } {
  const held = clampPhials(phials, max);
  if (held >= max) return { phials: max, restored: false };
  return { phials: held + 1, restored: true };
}

export function clampPhials(phials: number, max = PHIALS_PER_RUN): number {
  if (!Number.isFinite(phials)) return max;
  return Math.max(0, Math.min(max, Math.floor(phials)));
}

/* ---------------- the daily descent ---------------- */

/** YYYY-MM-DD of `date` in UTC — every player on Earth shares one daily. */
export function utcDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** The expedition seed for a date. Pure: the same date is the same descent. */
export function dailySeed(dateKey: string): number {
  const seed = fnv1aString(`breathing-works:daily:${dateKey}`) >>> 0;
  return seed === 0 ? 0x9e3779b9 : seed;
}

/* ---------------- the ledger ---------------- */

export interface RunStatsInput {
  outcome: RunOutcome;
  seed: number;
  daily: string | null;
  kit: KitId;
  floor: number;
  floorName: string;
  floorsTotal: number;
  timeMs: number;
  kills: number;
  alchemicalKills: number;
  bestChain: number;
  deaths: number;
  gold: number;
  cardsFound: number;
  /** Death cause line for a fall; ignored for victory and abandonment. */
  causeLine?: string;
}

export const VICTORY_EPITAPH = 'The Colossus is scrap, the Kiln is cooling, and somewhere a kettle is finally allowed to boil.';

/** Assemble the RunSummary contract from a finished run's counters. */
export function buildRunSummary(input: RunStatsInput): RunSummary {
  const whole = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
  return {
    outcome: input.outcome,
    seed: input.seed >>> 0,
    daily: input.daily,
    kit: input.kit,
    floor: Math.max(1, Math.min(input.floorsTotal, whole(input.floor) || 1)),
    floorName: input.floorName,
    floorsTotal: input.floorsTotal,
    timeMs: whole(input.timeMs),
    kills: whole(input.kills),
    alchemicalKills: whole(input.alchemicalKills),
    bestChain: whole(input.bestChain),
    deaths: whole(input.deaths),
    gold: whole(input.gold),
    cardsFound: whole(input.cardsFound),
    epitaph: runEpitaph(input),
  };
}

function runEpitaph(input: RunStatsInput): string {
  if (input.outcome === 'victory') return VICTORY_EPITAPH;
  if (input.outcome === 'abandoned') {
    return input.deaths > 0
      ? 'Left the descent with the ledger open and the kettle still warm.'
      : 'Left the descent unharmed, which the Works will count as a draw.';
  }
  return input.causeLine && input.causeLine.trim() ? input.causeLine.trim() : 'The Works decline to specify.';
}

/** The ledger's headline: what happened, in one line. */
export function runHeadline(summary: Pick<RunSummary, 'outcome' | 'floorName'>): string {
  if (summary.outcome === 'victory') return 'The Kiln is quiet.';
  const place = midSentence(summary.floorName);
  if (summary.outcome === 'abandoned') return `You left ${place} early.`;
  return `You fell in ${place}.`;
}

/** 'The Rot Gardens' reads 'the Rot Gardens' inside a sentence. */
export function midSentence(placeName: string): string {
  return placeName.startsWith('The ') ? 'the ' + placeName.slice(4) : placeName;
}

/** 14:02 / 1:04:09 — play time the way a stopwatch reads it. */
export function formatRunTime(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * A best chain as the ledger and the share line both print it: `×3`, or an
 * em dash when no chain was ever strung together. One formatter, so the two
 * can never disagree.
 */
export function formatChain(chain: number): string {
  const n = Math.round(Number.isFinite(chain) ? chain : 0);
  return n <= 0 ? '—' : `×${n}`;
}

/**
 * The one line a player pastes to a friend:
 * `Breathing Works — daily 2026-09-26 — Floor 3/4 in 14:02 · 9 alchemical kills · best chain ×3`
 * (a run without a chain leaves the chain out rather than boasting of zero).
 */
export function shareLine(summary: RunSummary, title = GAME_TITLE): string {
  const parts = [title];
  if (summary.daily) parts.push(`daily ${summary.daily}`);
  const reach = summary.outcome === 'victory'
    ? `the Kiln quieted in ${formatRunTime(summary.timeMs)}`
    : `Floor ${summary.floor}/${summary.floorsTotal} in ${formatRunTime(summary.timeMs)}`;
  const tail = [
    reach,
    `${summary.alchemicalKills} alchemical kill${summary.alchemicalKills === 1 ? '' : 's'}`,
    ...(Math.round(summary.bestChain) > 0 ? [`best chain ${formatChain(summary.bestChain)}`] : []),
  ].join(' · ');
  parts.push(tail);
  return parts.join(' — ');
}

/**
 * Is run `a` a better daily result than `b`? Deeper wins; on the same floor a
 * victory beats a fall, and between victories the faster one wins. Two falls
 * on the same floor keep the first: dying sooner is not an improvement.
 */
export function betterDailyResult(
  a: { floor: number; timeMs: number; victory: boolean },
  b: { floor: number; timeMs: number; victory: boolean } | null | undefined,
): boolean {
  if (!b) return true;
  if (a.floor !== b.floor) return a.floor > b.floor;
  if (a.victory !== b.victory) return a.victory;
  return a.victory && a.timeMs < b.timeMs;
}

/**
 * The narrator's manners, pure (tests/narrator.test.ts). The narrator is
 * sparing: one line at a time, a cooldown after each, and never the same
 * words twice in a session.
 *
 * - `low`: running commentary (a Tea Engine act, an objective). Dropped if
 *   anything is speaking or the cooldown is running.
 * - `normal`: something happened (a toast worth saying, the Sanctum's look
 *   below). Same rules as low, but it interrupts a low line.
 * - `high`: a beat that names itself (a floor's arrival, a death, the ledger,
 *   a boss waking). Ignores the cooldown, interrupts anything lower, and waits
 *   its turn behind another high line rather than talking over it.
 */
export type NarrationPriority = 'low' | 'normal' | 'high';

const RANK: Readonly<Record<NarrationPriority, number>> = { low: 0, normal: 1, high: 2 };

/** Quiet after a line before another low or normal one may speak. */
export const NARRATION_COOLDOWN_MS = 8000;
/** Gap between the lines of one utterance (a death's title, then its cause). */
export const NARRATION_LINE_GAP_MS = 280;
/** High lines waiting behind a high line; anything beyond is dropped. */
export const NARRATION_QUEUE_MAX = 2;

export type NarrationDecision = 'play' | 'interrupt' | 'queue' | 'drop';

export class NarrationGate {
  private readonly heard = new Set<string>();
  private cooldownUntil = -Infinity;

  /** Keys not yet heard this session, in order and without repeats. */
  unheard(keys: readonly string[]): string[] {
    const out: string[] = [];
    for (const k of keys) if (!this.heard.has(k) && !out.includes(k)) out.push(k);
    return out;
  }

  decide(priority: NarrationPriority, nowMs: number, speaking: NarrationPriority | null, queued: number): NarrationDecision {
    const rank = RANK[priority];
    if (speaking !== null) {
      if (rank > RANK[speaking]) return 'interrupt';
      if (priority === 'high') return queued < NARRATION_QUEUE_MAX ? 'queue' : 'drop';
      return 'drop';
    }
    if (priority !== 'high' && nowMs < this.cooldownUntil) return 'drop';
    return 'play';
  }

  /** A line actually started: it will not be said again this session. */
  markHeard(key: string): void { this.heard.add(key); }

  /** An utterance finished (or was cut): the cooldown runs from now. */
  finished(nowMs: number): void { this.cooldownUntil = nowMs + NARRATION_COOLDOWN_MS; }

  cooldownLeft(nowMs: number): number { return Math.max(0, this.cooldownUntil - nowMs); }

  heardCount(): number { return this.heard.size; }
}

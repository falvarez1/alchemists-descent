import type { StockRules } from '@/core/arenaMatch';

/** First playable defaults. Separate from the health duel's existing balance dials. */
export const STOCK_RULES: Readonly<StockRules> = Object.freeze({
  stocks: 3, timeTicks: 6 * 60 * 60, countdownTicks: 120, respawnTicks: 60, protectionTicks: 120,
});

export const STOCK_LAUNCH = Object.freeze({
  base: 2.5, damage: 0.16, growth: 0.045, maxSpeed: 22, stunPerSpeed: 2, maxStun: 42,
});

/**
 * Impact hitstop for a landed stock blow: the whole game holds for a beat that grows with the damage (a jab 3 ticks, a
 * finisher 5, Brann's slam 6). A fixed-step freeze, so it never changes an outcome, only how hard it reads.
 */
export function stockHitstopTicks(damage: number): number {
  return Math.max(3, Math.min(7, Math.round(1 + damage / 11)));
}

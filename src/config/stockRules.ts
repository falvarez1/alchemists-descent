import type { StockRules } from '@/core/arenaMatch';

/** First playable defaults. Separate from the health duel's existing balance dials. */
export const STOCK_RULES: Readonly<StockRules> = Object.freeze({
  stocks: 3, timeTicks: 6 * 60 * 60, countdownTicks: 120, respawnTicks: 60, protectionTicks: 120,
});

export const STOCK_LAUNCH = Object.freeze({
  base: 2.5, damage: 0.16, growth: 0.045, maxSpeed: 22, stunPerSpeed: 2, maxStun: 42,
});

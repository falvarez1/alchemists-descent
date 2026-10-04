import type { StockRules } from '@/core/arenaMatch';

/** First playable defaults. Separate from the health duel's existing balance dials. */
export const STOCK_RULES: Readonly<StockRules> = Object.freeze({
  stocks: 3, timeTicks: 6 * 60 * 60, countdownTicks: 120, respawnTicks: 60, protectionTicks: 120,
});

export const STOCK_LAUNCH = Object.freeze({
  base: 2.5, damage: 0.16, growth: 0.045, maxSpeed: 22, stunPerSpeed: 2, maxStun: 42,
});

/**
 * A projectile's (or spell's, or the world's) push grows with the victim's percent, as a platform fighter's does: its
 * fixed part (base, the blow's own knock, the damage term) is scaled from `floor` at 0% to full at `full` percent;
 * the percent growth term is unchanged. Melee and throws keep their own tuned specs. A push slower than `tumbleSpeed`
 * is a flinch (a short stun, control kept), not a launch.
 */
export const STOCK_PROJECTILE_LAUNCH = Object.freeze({ floor: 0.15, full: 150, tumbleSpeed: 4 });

/** The fixed-push scale for a non-melee blow at this (post-hit) percent. */
export function stockProjectileScale(volatility: number): number {
  const k = STOCK_PROJECTILE_LAUNCH;
  return k.floor + (1 - k.floor) * Math.min(1, Math.max(0, volatility) / k.full);
}

/**
 * Impact hitstop for a landed stock blow: the whole game holds for a beat that grows with the damage (a jab 3 ticks, a
 * finisher 5, Brann's slam 6). A fixed-step freeze, so it never changes an outcome, only how hard it reads.
 */
export function stockHitstopTicks(damage: number): number {
  return Math.max(3, Math.min(7, Math.round(1 + damage / 11)));
}

/**
 * The countdown's call (3, 2, 1) for the ticks left: the arcade "Three! Two! One!" in three equal beats over
 * `countdownTicks`, so the HUD, the announcer and the match-beat event always agree. 0 once the countdown is spent.
 */
export function stockCountdownBeat(countdown: number): number {
  return countdown > 0 ? Math.min(3, Math.ceil(countdown / (STOCK_RULES.countdownTicks / 3))) : 0;
}

import type { FighterId } from '@/content/fighters';

/**
 * THE DUEL'S BALANCE LEVERS (docs/arena/STOCK-TELEMETRY.md): per fighter, in stock matches only. Intentionally mutable
 * live-tuning data (like config/params): the duel harness registers them as `stockBalance.<id>.<lever>`, and
 * `scripts/duel-tune.mjs --apply` writes a measured pass back into this table.
 *
 *   dealt   every percent this fighter deals (blows, throws, spells, abilities). It REPLACES the body's `dealt` in a stock
 *           match: that number was tuned for the health duel, where Edda's and Thorne's loadouts were too strong and were cut
 *           to 0.375 and 0.522, and it made their blows a third of Rusk's in the Duel.
 *   launch  how far this fighter flies when hit (its KO resistance), on top of its body's mass (which is also its feel).
 *
 * Keep each line `'<id>': { dealt: N, launch: N },` (the tuner reads and writes them by that shape).
 *
 * Pass 1 (2026-10-04): from all 1 (Rusk 94%, Brann 67% ... Mara 19% with one personality on both sides), seven tuner rounds
 * of 270 CPU matches, then confirmation on fresh seeds the tuner never saw (docs/arena/STOCK-TELEMETRY.md, "Measured").
 * Rusk's finisher and weight carried him: he hits a quarter softer and flies a third further; light, floaty Mara the reverse.
 */
export interface StockBalance {
  dealt: number;
  launch: number;
}

export const STOCK_BALANCE: Record<FighterId, StockBalance> = {
  'ilyra-voss': { dealt: 0.968, launch: 1.033 },
  'brann-rook': { dealt: 0.94, launch: 1.064 },
  'sable-fen': { dealt: 1.12, launch: 0.893 },
  'mara-quell': { dealt: 1.225, launch: 0.816 },
  'kest-rel': { dealt: 0.975, launch: 1.026 },
  'nox-calder': { dealt: 1.04, launch: 0.962 },
  'edda-morrow': { dealt: 1.088, launch: 0.919 },
  'selene-wraith': { dealt: 1.06, launch: 0.943 },
  'rusk-emberjaw': { dealt: 0.731, launch: 1.367 },
  'father-thorne': { dealt: 0.996, launch: 1.004 },
};

/** Guardrails for the tuner, not targets: outside them a fighter needs a moveset or kit change, not a multiplier. */
export const STOCK_BALANCE_RANGES: Readonly<Record<keyof StockBalance, { min: number; max: number; step: number }>> = {
  dealt: { min: 0.5, max: 2, step: 0.01 },
  launch: { min: 0.6, max: 1.5, step: 0.01 },
};

/** The percent multiplier of a fighter's hits in a stock match (1 for an unknown or classic fighter). */
export function stockDealt(id: FighterId | null | undefined): number {
  return (id ? STOCK_BALANCE[id]?.dealt : undefined) ?? 1;
}

/** How far a fighter flies when hit in a stock match, relative to what its mass alone gives (1 for an unknown one). */
export function stockLaunchTaken(id: FighterId | null | undefined): number {
  return (id ? STOCK_BALANCE[id]?.launch : undefined) ?? 1;
}

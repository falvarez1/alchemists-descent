/**
 * Fighter tuning that is not any one kit's: how the ultimate charges, and the HUD's grace windows.
 * Live-tunable like `config/params` (docs/FIGHTERS.md); per-ability numbers live beside the ability.
 * All times are fixed ticks (60 Hz).
 */
export const FIGHTER_TUNING = {
  /** Ultimate charge (0..1 of the bar) per point of damage the fighter deals to a foe. */
  chargeDealt: 0.0015,
  /** ... per point of damage the fighter takes (after armor). */
  chargeTaken: 0.002,
  /** ... per kill. */
  chargeKill: 0.03,
  /** ... per tick, just for being in the fight (1% per 10 s). */
  chargeTrickle: 0.01 / 600,
  /** The harm the world does on the player's behalf (fire, a blast it set, a kill chain) counts for this much of a direct blow. */
  chargeWorldShare: 0.5,
  /** A press older than this many ticks is a stale one (paused, a menu) and is dropped. */
  pressWindow: 8,
};

export type FighterTuning = typeof FIGHTER_TUNING;

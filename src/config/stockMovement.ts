/** Fixed-tick hypotheses. The active movement outlasts the protected window by two ticks. */
export const STOCK_FAST_FALL = 6.4;
export const STOCK_DODGE = {
  startup: 3, active: 10, invulnerable: 8, recovery: 12, cooldown: 10,
  groundSpeed: 5.4, airSpeed: 4.4,
} as const;

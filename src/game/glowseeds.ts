import type { LivingExpeditionState } from '@/core/types';

/** The glowseed pouch (the Bellows' lure) holds this many to begin with. */
export const GLOWSEED_POUCH = 3;
/** ...and never more than this, however generous Pell is. */
export const GLOWSEED_POUCH_MAX = 6;

/** How many glowseeds the pouch holds this run (Pell's gift can enlarge it). */
export function glowseedCap(living: Pick<LivingExpeditionState, 'glowseedCap'>): number {
  return Math.max(GLOWSEED_POUCH, Math.min(GLOWSEED_POUCH_MAX, Math.floor(living.glowseedCap ?? GLOWSEED_POUCH)));
}

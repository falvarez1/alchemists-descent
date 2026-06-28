import type { EntityStatus, Pickup, PickupKind } from '@/core/types';
export { PICKUP_KINDS } from '@/core/types';
import { packRGB } from '@/sim/colors';

/** Instant potions: drinking applies a timed status; gameplay handles collection. */
export const POTION_DEFS: Record<string, { name: string; status: keyof EntityStatus; frames: number }> = {
  vigor: { name: 'POTION OF VIGOR', status: 'regen', frames: 600 },
  levity: { name: 'POTION OF LEVITY', status: 'levity', frames: 700 },
  stoneskin: { name: 'POTION OF STONESKIN', status: 'stoneskin', frames: 700 },
  swift: { name: 'POTION OF SWIFTNESS', status: 'swift', frames: 700 },
  torch: { name: 'TORCHBEARER TONIC', status: 'torch', frames: 900 },
};

export const POTION_KINDS = Object.keys(POTION_DEFS);

export function makePickup(kind: PickupKind, x: number, y: number, data: Pickup['data'] = {}): Pickup {
  return { kind, x, y, vx: 0, vy: 0, taken: false, data };
}

/** Display colors for rendering + minimap dots. */
export const PICKUP_COLOR: Record<PickupKind, number> = {
  goldpile: packRGB(255, 210, 60),
  heart: packRGB(255, 80, 110),
  tome: packRGB(140, 200, 255),
  chest: packRGB(210, 150, 70),
  potion: packRGB(220, 120, 255),
  key: packRGB(255, 230, 90),
};

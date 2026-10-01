import type { FighterId } from '@/content/fighters';
import type { FighterKitDef } from '@/fighters/kit';

/**
 * The ten kits, by id. A fighter with no kit still equips (it has its look and no abilities), which is
 * how the roster lands before every kit does; tests/fighters-roster.test.ts requires all ten.
 */
const KITS: Partial<Record<FighterId, FighterKitDef>> = {};

export function kitFor(id: FighterId): FighterKitDef | undefined {
  return KITS[id];
}

export const KIT_IDS = (): FighterId[] => Object.keys(KITS) as FighterId[];

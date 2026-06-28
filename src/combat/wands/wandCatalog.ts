import type { CardId, WandFrame } from '@/core/types';

/**
 * Wand frames available at launch. Only 'oak' and 'bone' exist as actual
 * wands today; 'brass' and 'void' are listed for the bench's future upgrade
 * path.
 */
export const WAND_FRAMES: Record<string, WandFrame> = {
  oak: { id: 'oak', name: 'Oak Sprig', capacity: 3, castDelay: 14, recharge: 30, manaMax: 90, manaRegen: 0.5, spread: 0.02 },
  bone: { id: 'bone', name: 'Bone Crook', capacity: 4, castDelay: 9, recharge: 45, manaMax: 120, manaRegen: 0.65, spread: 0.05 },
  brass: { id: 'brass', name: 'Brass Injector', capacity: 5, castDelay: 6, recharge: 60, manaMax: 160, manaRegen: 0.8, spread: 0.08 },
  void: { id: 'void', name: 'Void Lattice', capacity: 5, castDelay: 16, recharge: 20, manaMax: 220, manaRegen: 1.1, spread: 0 },
};

export interface BuiltInWandLoadout {
  id: string;
  name: string;
  frameId: string;
  cards: CardId[];
  status: 'live' | 'review';
}

export const STARTING_WAND_LOADOUTS: BuiltInWandLoadout[] = [
  { id: 'starter-oak', name: 'Starter Oak Sprig', frameId: 'oak', cards: ['spark'], status: 'live' },
  { id: 'starter-bone', name: 'Starter Bone Crook', frameId: 'bone', cards: ['dig'], status: 'live' },
];

export const REVIEW_WAND_LOADOUTS: BuiltInWandLoadout[] = [
  { id: 'review-brass-injector', name: 'Review Brass Injector', frameId: 'brass', cards: ['watertrail', 'electriccharge', 'critwet', 'shorthoming', 'spark'], status: 'review' },
  { id: 'review-void-lattice', name: 'Review Void Lattice', frameId: 'void', cards: ['oiltrail', 'spark', 'flame', 'dig', 'warp'], status: 'review' },
  { id: 'wet-crit-primer', name: 'Wet Crit Primer', frameId: 'brass', cards: ['watertrail', 'critwet', 'spark'], status: 'review' },
  { id: 'fuse-primer', name: 'Fuse Primer', frameId: 'brass', cards: ['oiltrail', 'spark', 'flame'], status: 'review' },
  { id: 'trigger-primer', name: 'Trigger Primer', frameId: 'brass', cards: ['trigger', 'spark', 'bomb'], status: 'review' },
  { id: 'frost-shatter-primer', name: 'Frost Shatter Primer', frameId: 'brass', cards: ['frostcharge', 'spark', 'shattercrit', 'spark'], status: 'review' },
];

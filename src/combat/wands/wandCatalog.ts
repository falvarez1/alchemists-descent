import type { CardId, WandFrame } from '@/core/types';

/**
 * Wand frames. 'oak' and 'bone' are the launch wands; 'brass' and 'void' are the Wandwright's paid
 * upgrades; the four archetypes (quill, pepperpot, mortar, samovar) are FOUND — a boss's wreckage, one in
 * three waystone altars, the Wandwright's rack — each a specialist with a price in some other stat
 * (combat/wands/wandFinds; the balance numbers are in docs/FEEL.md §5).
 */
export const WAND_FRAMES: Record<string, WandFrame> = {
  // Oak recharge 30 -> 22 (2026-09-27, deliberate balance change): the starting
  // Spark cycle drops from 44 ticks (0.73 s) to 36 (0.60 s), +22% sustained
  // Spark DPS (18 dmg: 24.5 -> 30 dps). QA found the starter "plinky"; 10 mana
  // per 36 ticks (16.7/s) still sits well under the 30/s regen. See FEEL.md §5.
  oak: { id: 'oak', name: 'Oak Sprig', capacity: 3, castDelay: 14, recharge: 22, manaMax: 90, manaRegen: 0.5, spread: 0.02, blurb: 'Three slots and a steady hand.' },
  bone: { id: 'bone', name: 'Bone Crook', capacity: 4, castDelay: 9, recharge: 45, manaMax: 120, manaRegen: 0.65, spread: 0.05, blurb: 'Four slots and a quicker draw.' },
  brass: { id: 'brass', name: 'Brass Injector', capacity: 5, castDelay: 6, recharge: 60, manaMax: 160, manaRegen: 0.8, spread: 0.08, blurb: 'Five slots, a fast draw, a deep tank.' },
  void: { id: 'void', name: 'Void Lattice', capacity: 5, castDelay: 16, recharge: 20, manaMax: 220, manaRegen: 1.1, spread: 0, blurb: 'Five slots, perfect aim, a vast tank.' },
  // The found archetypes. Each buys one thing with another: rate for tank, aim for a fan, slots for pace, stamina for slots.
  quill: { id: 'quill', name: 'Hornet Needle', capacity: 3, castDelay: 5, recharge: 20, manaMax: 80, manaRegen: 0.42, spread: 0.06, blurb: 'Rapid. A cheap card cycles nearly twice as fast; a dear one drains the small tank at once.' },
  pepperpot: { id: 'pepperpot', name: 'Pepperpot Rod', capacity: 4, castDelay: 5, recharge: 26, manaMax: 130, manaRegen: 0.62, spread: 0.2, blurb: 'Wide. Quick and loose: a fan of shots up close, a scatter of apologies at range.' },
  mortar: { id: 'mortar', name: 'Cast-Iron Mortar', capacity: 6, castDelay: 20, recharge: 44, manaMax: 260, manaRegen: 0.9, spread: 0, blurb: 'Heavy. Six slots and a deep tank; the hand is slow, so make each cast count.' },
  samovar: { id: 'samovar', name: 'Samovar Staff', capacity: 4, castDelay: 12, recharge: 36, manaMax: 280, manaRegen: 1.2, spread: 0.03, blurb: 'Marathon. Dear spells all day at a stately pace; only four slots to put them in.' },
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

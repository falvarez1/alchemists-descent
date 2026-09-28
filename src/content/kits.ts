import type { CardId } from '@/core/types';
import type { KitId } from '@/core/run';
import { Cell } from '@/sim/CellType';

/**
 * Starting kits (Breathing Works run structure). A fresh run starts with its
 * kit and nothing else: the two wands' cards, a small satchel, and three
 * flasks. Every kit keeps the Excavate Ray on wand II — digging is the
 * fail-open verb the whole descent assumes (sand plugs, collapsed routes).
 *
 * Unlocks are milestones recorded by the meta profile; the spark kit is
 * always open.
 */
export interface KitDef {
  id: KitId;
  /** Player-facing name, house tone. */
  name: string;
  /** Short label for compact pickers. */
  short: string;
  /** One line under the name on the kit picker. */
  blurb: string;
  /** Cards on wand I (Oak Sprig) and wand II (Bone Crook), left to right. */
  wands: readonly [readonly CardId[], readonly CardId[]];
  /** Loose cards in the satchel, ready for the bench. */
  collection: readonly CardId[];
  /** Flask belt, slot by slot. */
  flasks: ReadonlyArray<{ material: number; count: number }>;
  /** How the kit is earned, phrased for a locked tile. Empty for the default. */
  unlockHint: string;
}

export const KIT_ORDER: readonly KitId[] = ['spark', 'frost', 'ember', 'storm'];

export const DEFAULT_KIT: KitId = 'spark';

export const KIT_DEFS: Record<KitId, KitDef> = {
  spark: {
    id: 'spark',
    short: 'Sparkwright',
    name: 'The Sparkwright’s Case',
    blurb: 'Spark bolt, excavation ray; water, nitrogen and oil. The regulation issue.',
    wands: [['spark'], ['dig']],
    collection: ['double', 'speed'],
    flasks: [
      { material: Cell.Water, count: 300 },
      { material: Cell.Nitrogen, count: 180 },
      { material: Cell.Oil, count: 180 },
    ],
    unlockHint: '',
  },
  frost: {
    id: 'frost',
    short: 'Rime',
    name: 'The Rime Case',
    blurb: 'Frost shard and a shatter charm; nitrogen, water and snow. Everything keeps longer cold.',
    wands: [['frostshard'], ['dig']],
    collection: ['spark', 'shattercrit'],
    flasks: [
      { material: Cell.Nitrogen, count: 300 },
      { material: Cell.Water, count: 300 },
      { material: Cell.Snow, count: 200 },
    ],
    unlockHint: 'Reach floor 2, by either door.',
  },
  ember: {
    id: 'ember',
    short: 'Ember',
    name: 'The Ember Case',
    blurb: 'Flame jet and an oil wick; oil, gunpowder and a little water, for afterwards.',
    wands: [['flame'], ['dig']],
    collection: ['spark', 'oiltrail'],
    flasks: [
      { material: Cell.Oil, count: 300 },
      { material: Cell.Gunpowder, count: 160 },
      { material: Cell.Water, count: 240 },
    ],
    unlockHint: 'Slay a warden of floor 3: the Sunken Leviathan or the Lenswright.',
  },
  storm: {
    id: 'storm',
    short: 'Storm',
    name: 'The Storm Case',
    blurb: 'Chain lightning and a water trail; a great deal of water. Stand somewhere dry.',
    wands: [['lightning'], ['dig']],
    collection: ['spark', 'watertrail'],
    flasks: [
      { material: Cell.Water, count: 400 },
      { material: Cell.Nitrogen, count: 160 },
      { material: Cell.Oil, count: 160 },
    ],
    unlockHint: 'Quiet the Kiln: win a run.',
  },
};

export function isKitId(value: unknown): value is KitId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KIT_DEFS, value);
}

import type { CardId } from '@/core/types';

export const STARTER_GRAMMAR_POOL: readonly CardId[] = ['speed', 'heavy', 'spread', 'double', 'flame'];

export const TERRAIN_VERB_POOL: readonly CardId[] = ['dig', 'conjure', 'vitriol', 'cryojet', 'aquajet', 'frostshard'];

export const COMBO_SETUP_POOL: readonly CardId[] = [
  'watertrail',
  'electriccharge',
  'critwet',
  'oiltrail',
  'shorthoming',
  'pyrecrit',
];

export const WAYSTONE_MOD_POOL: readonly CardId[] = [
  'speed',
  'heavy',
  'spread',
  'bounce',
  'double',
  'triple',
  'trigger',
  ...COMBO_SETUP_POOL,
];

export const DEPTH_PROJECTILE_POOL: readonly CardId[] = [
  'bomb',
  'lightning',
  'flame',
  'warp',
  'blackhole',
  'vitriol',
  'cryojet',
  'frostshard',
  'icelance',
  'wisp',
  'meteor',
  'conjure',
  'emberstorm',
];

export const TOME_REWARD_POOL: readonly CardId[] = [
  ...STARTER_GRAMMAR_POOL,
  ...TERRAIN_VERB_POOL,
  'bomb',
  'lightning',
  'wisp',
  'bounce',
  'trigger',
  'triple',
  ...COMBO_SETUP_POOL,
];

export const LEVIATHAN_REWARD_POOL: readonly CardId[] = ['icelance', 'meteor', 'blackhole', 'triple', 'trigger'];

export const SANCTUM_LOST_PAGES_POOL: readonly CardId[] = [
  ...STARTER_GRAMMAR_POOL,
  ...TERRAIN_VERB_POOL,
  'bomb',
  'lightning',
  'warp',
  'blackhole',
  'icelance',
  'wisp',
  'meteor',
  'emberstorm',
  'bounce',
  'trigger',
  'triple',
  ...COMBO_SETUP_POOL,
];

export function randomCard(pool: readonly CardId[], rng: () => number = Math.random): CardId {
  return pool[Math.floor(rng() * pool.length)] ?? 'spark';
}

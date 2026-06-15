import type { CardId, Ctx, WandsApi } from '@/core/types';

export const STARTER_GRAMMAR_POOL: readonly CardId[] = ['speed', 'heavy', 'spread', 'double', 'flame'];

export const TERRAIN_VERB_POOL: readonly CardId[] = ['dig', 'conjure', 'vitriol', 'frostshard'];

export const WAYSTONE_MOD_POOL: readonly CardId[] = [
  'speed',
  'heavy',
  'spread',
  'bounce',
  'double',
  'triple',
  'trigger',
];

export const DEPTH_PROJECTILE_POOL: readonly CardId[] = [
  'bomb',
  'lightning',
  'flame',
  'warp',
  'blackhole',
  'vitriol',
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
];

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
];

export function collectOwnedCards(wands: WandsApi): Set<CardId> {
  const owned = new Set<CardId>(wands.collection);
  for (const wand of wands.wands) {
    for (const card of wand.cards) {
      if (card) owned.add(card);
    }
  }
  return owned;
}

export function randomCard(pool: readonly CardId[], rng: () => number = Math.random): CardId {
  return pool[Math.floor(rng() * pool.length)] ?? 'spark';
}

export function buildCardOffer(
  pool: readonly CardId[],
  owned: ReadonlySet<CardId>,
  options: { count?: number; preferred?: readonly CardId[]; rng?: () => number } = {},
): CardId[] {
  const count = Math.max(1, Math.floor(options.count ?? 3));
  const rng = options.rng ?? Math.random;
  const result: CardId[] = [];
  const add = (id: CardId): void => {
    if (result.length < count && pool.includes(id) && !result.includes(id)) result.push(id);
  };

  for (const id of options.preferred ?? []) {
    if (!owned.has(id)) add(id);
  }

  const unknown = pool.filter((id) => !owned.has(id) && !result.includes(id));
  drawFrom(unknown, result, count, rng);

  if (result.length < count) {
    const fallback = pool.filter((id) => !result.includes(id));
    drawFrom(fallback, result, count, rng);
  }

  if (result.length === 0) result.push('spark');
  return result;
}

export function requestCardOffer(
  ctx: Ctx,
  offer: {
    source: 'tome' | 'sanctum';
    title: string;
    prompt?: string;
    cards: CardId[];
    onChoose(card: CardId): void;
  },
): boolean {
  const cards: CardId[] = offer.cards.length > 0 ? [...offer.cards] : ['spark'];
  const request = { ...offer, cards, handled: false };
  ctx.events.emit('cardOfferRequested', request);
  if (!request.handled) {
    offer.onChoose(cards[0]);
    return false;
  }
  return true;
}

function drawFrom(pool: CardId[], result: CardId[], count: number, rng: () => number): void {
  while (result.length < count && pool.length > 0) {
    const index = Math.floor(rng() * pool.length);
    result.push(pool.splice(index, 1)[0]);
  }
}

import type { CardId, CardKind, Ctx, WandsApi } from '@/core/types';
import { CARD_DEFS } from './cards';

export const STARTER_GRAMMAR_POOL: readonly CardId[] = ['speed', 'heavy', 'spread', 'double', 'flame'];

export const TERRAIN_VERB_POOL: readonly CardId[] = ['dig', 'conjure', 'vitriol', 'frostshard'];

export const COMBO_SETUP_POOL: readonly CardId[] = [
  'watertrail',
  'electriccharge',
  'critwet',
  'oiltrail',
  'shorthoming',
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
  options: { count?: number; preferred?: readonly CardId[]; rng?: () => number; ensureKind?: CardKind | readonly CardKind[] } = {},
): CardId[] {
  const count = Math.max(1, Math.floor(options.count ?? 3));
  const rng = options.rng ?? Math.random;
  const result: CardId[] = [];
  const preferredSet = new Set(options.preferred ?? []);
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

  ensureOfferKind(pool, owned, result, preferredSet, options.ensureKind, rng);
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
  const hadListener = ctx.events.emit('cardOfferRequested', request);
  if (!request.handled) {
    if (!hadListener) offer.onChoose(cards[0]);
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

function ensureOfferKind(
  pool: readonly CardId[],
  owned: ReadonlySet<CardId>,
  result: CardId[],
  preferred: ReadonlySet<CardId>,
  ensureKind: CardKind | readonly CardKind[] | undefined,
  rng: () => number,
): void {
  if (!ensureKind || result.length === 0) return;
  const kinds = new Set(Array.isArray(ensureKind) ? ensureKind : [ensureKind]);
  if (result.some((id) => kinds.has(CARD_DEFS[id].kind))) return;

  const candidates = pool.filter((id) =>
    !owned.has(id) &&
    !result.includes(id) &&
    kinds.has(CARD_DEFS[id].kind));
  if (candidates.length === 0) return;

  const replacement = candidates[Math.floor(rng() * candidates.length)] ?? candidates[0];
  let replaceAt = -1;
  for (let i = result.length - 1; i >= 0; i--) {
    if (preferred.has(result[i])) continue;
    replaceAt = i;
    break;
  }
  if (replaceAt < 0) return;
  result[replaceAt] = replacement;
}

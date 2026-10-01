import type { CardId } from '@/core/types';
import { entityRandom } from '@/core/simRandom';
import { BARGAIN_POOL, DEPTH_PROJECTILE_POOL, LEVIATHAN_REWARD_POOL, WAYSTONE_MOD_POOL } from '@/content/cardRewardPools';
import { CARD_DEFS } from './cards';
import { makeFitter, type FitHoldings } from './cardFit';
import { withDiscoveredCards } from './rewardPools';

/**
 * Composing the three cards of a choice that sits ON the route: a lit waystone's altar and a floor's
 * arrival gift. The three must differ on purpose (an altar offers a HOST, a SYNERGY that works with the
 * hosts you carry, and a WILD bargain with a price), and none may be dead in the player's hands while a
 * live one exists (combat/wands/cardFit). Pure of Ctx: the caller supplies the holdings, the discoveries
 * and the rng, so the whole thing is unit-testable.
 *
 * The old waystone gift rolled 75% modifier / 25% projectile; as three cards that intent is kept as
 * two modifier-side cards (the synergy and the bargain) to one projectile.
 */

export type AltarRole = 'host' | 'synergy' | 'wild';

export interface ComposedOffer {
  cards: CardId[];
  /** One short kicker per card, in order. */
  labels: string[];
}

export interface ComposeInput {
  holdings: FitHoldings;
  owned: ReadonlySet<CardId>;
  /** Cards discovered in earlier runs: they widen the pools, never the starting hand. */
  discovered?: readonly CardId[];
  rng?: () => number;
}

const ROLE_LABEL: Record<AltarRole, string> = { host: 'Host', synergy: 'Synergy', wild: 'Wild · a bargain' };

/** Weighted pick; zero weights are never chosen unless nothing else is. */
function pickWeighted<T>(items: readonly T[], weight: (item: T) => number, rng: () => number): T | null {
  if (items.length === 0) return null;
  const weights = items.map((item) => Math.max(0, weight(item)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)] ?? items[0];
  let roll = rng() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * A waystone's altar: [host, synergy, wild].
 *  - HOST: a projectile you do not own; hosts that can carry the modifiers you already hold weigh double.
 *  - SYNERGY: a modifier or multicast that WORKS with the hosts you carry; one whose pair is whole in your
 *    hands (a payoff beside its setter) weighs most; a card you own weighs little.
 *  - WILD: one of the five devil's bargains you do not own (a strong card with a real price); with all five
 *    in hand, a Leviathan-grade card instead.
 */
export function composeAltarOffer(input: ComposeInput): ComposedOffer {
  const rng = input.rng ?? entityRandom;
  const fitter = makeFitter(input.holdings);
  const discovered = input.discovered ?? [];
  const owned = input.owned;

  const modPool = withDiscoveredCards(WAYSTONE_MOD_POOL, discovered).filter((id) => CARD_DEFS[id].kind !== 'projectile');
  const hostPool = withDiscoveredCards(DEPTH_PROJECTILE_POOL, discovered).filter((id) => CARD_DEFS[id].kind === 'projectile');

  // SYNERGY first: it is the card the player's current hands decide.
  const live = modPool.filter((id) => !fitter.dead(id));
  const synergy = pickWeighted(
    live.length > 0 ? live : modPool,
    (id) => [0.2, 1, 2, 4][fitter.score(id)] * (owned.has(id) ? 0.3 : 1),
    rng,
  ) ?? 'speed';

  const hostCandidates = hostPool.filter((id) => !owned.has(id));
  const host = pickWeighted(
    hostCandidates.length > 0 ? hostCandidates : hostPool,
    // A host that carries what you already hold is worth more than one that ignores it.
    (id) => (fitter.fit(id).verdict === 'works' ? 2 : 1),
    rng,
  ) ?? 'bomb';

  const bargains = BARGAIN_POOL.filter((id) => !owned.has(id));
  let wild: CardId;
  if (bargains.length > 0) {
    // A bargain that would be wasted on everything you carry is a poor temptation.
    wild = pickWeighted(bargains, (id) => (fitter.dead(id) ? 0.1 : 1), rng) ?? bargains[0];
  } else {
    const grade = LEVIATHAN_REWARD_POOL.filter((id) => !owned.has(id) && id !== host && id !== synergy);
    wild = pickWeighted(grade.length > 0 ? grade : BARGAIN_POOL, () => 1, rng) ?? BARGAIN_POOL[0];
  }

  const cards = [host, synergy, wild];
  const roles: AltarRole[] = ['host', 'synergy', 'wild'];
  // Distinct by construction, but a Leviathan-grade fallback can collide with a pool pick: keep three different cards.
  for (let i = 0; i < cards.length; i++) {
    if (cards.indexOf(cards[i]) === i) continue;
    const spare = (i === 0 ? hostPool : i === 1 ? modPool : BARGAIN_POOL).find((id) => !cards.includes(id));
    if (spare) cards[i] = spare;
  }
  return { cards, labels: roles.map((r, i) => (r === 'wild' && !CARD_DEFS[cards[i]].bargain ? 'Wild' : ROLE_LABEL[r])) };
}

/* ---------------- the arrival gift ---------------- */

/** The three kinds of answer a floor's gift offers: a big hit, a clean one, and a way to change the ground. */
const GIFT_FAMILIES: ReadonlyArray<{ label: string; cards: readonly CardId[] }> = [
  { label: 'Burst', cards: ['bomb', 'meteor', 'blackhole'] },
  { label: 'Precision', cards: ['lightning', 'icelance', 'wisp', 'frostshard'] },
  { label: 'Utility', cards: ['flame', 'emberstorm', 'cryojet', 'vitriol', 'conjure', 'warp'] },
];

/**
 * A floor's arrival gift: one projectile from each family, so the three are three different answers.
 * Cards outside the families (a discovered Vitric Seal) join Utility. Unowned and live cards first; with a
 * family out of cards the pick falls back to what you own (a duplicate projectile is the least bad filler).
 */
export function composeDepthOffer(input: ComposeInput): ComposedOffer {
  const rng = input.rng ?? entityRandom;
  const fitter = makeFitter(input.holdings);
  const owned = input.owned;
  const pool = withDiscoveredCards(DEPTH_PROJECTILE_POOL, input.discovered ?? []).filter((id) => CARD_DEFS[id].kind === 'projectile');
  const known = new Set(GIFT_FAMILIES.flatMap((f) => f.cards));
  const strays = pool.filter((id) => !known.has(id));
  const cards: CardId[] = [];
  const labels: string[] = [];
  for (const family of GIFT_FAMILIES) {
    const members = [...family.cards.filter((id) => pool.includes(id)), ...(family.label === 'Utility' ? strays : [])]
      .filter((id) => !cards.includes(id));
    const fresh = members.filter((id) => !owned.has(id));
    const pick = pickWeighted(fresh.length > 0 ? fresh : members, (id) => (fitter.fit(id).verdict === 'works' ? 2 : 1), rng);
    if (pick) {
      cards.push(pick);
      labels.push(family.label);
    }
  }
  // A family with nothing in the pool leaves the offer short: top up from whatever is left.
  while (cards.length < 3) {
    const rest = pool.filter((id) => !cards.includes(id));
    const pick = pickWeighted(rest.filter((id) => !owned.has(id)).length > 0 ? rest.filter((id) => !owned.has(id)) : rest, () => 1, rng);
    if (!pick) break;
    cards.push(pick);
    labels.push('Spare');
  }
  return { cards, labels };
}

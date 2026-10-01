import type { CardId } from '@/core/types';
import { CARD_DEFS, PROJECTILE_MOD_HOST_CARDS } from './cards';

/**
 * Which card works on which, as DATA — one truth for the compiler's host rules,
 * the bench's sentence warnings (sentenceView), the in-play dead-card caption
 * (WandSystem) and the fit tells on offer tiles (cardFit). Pure; no Ctx.
 */

/** Cards whose damage multiplier does something (heavy = more bolts / a bigger blast / a wider ray). */
export const DAMAGE_EFFECT_CARDS: ReadonlySet<CardId> = new Set<CardId>([
  'spark', 'bomb', 'lightning', 'flame', 'dig', 'vitriol', 'cryojet', 'frostshard', 'icelance', 'wisp', 'meteor', 'emberstorm', 'vitrify',
]);

/** Cards that fly (or spray) at the speed a modifier sets. */
export const SPEED_EFFECT_CARDS: ReadonlySet<CardId> = new Set<CardId>([
  'spark', 'bomb', 'flame', 'warp', 'vitriol', 'cryojet', 'frostshard', 'icelance', 'wisp', 'meteor', 'emberstorm',
]);

/** Cards whose aim jitter shows. */
export const SPREAD_EFFECT_CARDS: ReadonlySet<CardId> = new Set<CardId>([
  'spark', 'bomb', 'lightning', 'flame', 'dig', 'warp', 'vitriol', 'cryojet', 'frostshard', 'icelance', 'wisp', 'meteor',
]);

/** The eight modifiers that live on the projectile's body (a trail, a charge, a crit mark, a homing nudge). */
export const BODY_MODIFIERS: ReadonlySet<CardId> = new Set<CardId>([
  'watertrail', 'oiltrail', 'electriccharge', 'critwet', 'shorthoming', 'frostcharge', 'shattercrit', 'pyrecrit',
]);

/**
 * Modifiers that only land on a projectile BODY (the cards in PROJECTILE_MOD_HOST_CARDS): the body mods, and
 * the three whose marks are written onto the spawned projectile (bounce, infuser, trigger). A jet, a ray, an
 * arc or a placed spell has no body to carry them.
 */
export const HOST_BOUND_MODIFIERS: ReadonlySet<CardId> = new Set<CardId>([...BODY_MODIFIERS, 'bounce', 'infuser', 'trigger']);

/** A bounce needs something that travels: a black hole sits where it is cast. */
const BOUNCE_HOSTS: ReadonlySet<CardId> = new Set<CardId>([...PROJECTILE_MOD_HOST_CARDS].filter((id) => id !== 'blackhole'));

function intersect(a: ReadonlySet<CardId>, b: ReadonlySet<CardId>): ReadonlySet<CardId> {
  return new Set<CardId>([...a].filter((id) => b.has(id)));
}

/**
 * A devil's bargain: strong, with a price that is paid in the COMPILER (damage inside the x4 clamp, a
 * wandering aim, a short life, a slow flight, a kick). Benefit and cost land together on the hosts in
 * `appliesTo` and nowhere else: on any other host the card is a dud (its mana is still charged), so a price
 * can never be dodged by pointing the bargain at a card the cost does not reach. Tuning: docs/FEEL.md.
 */
export interface BargainRule {
  dmgMul?: number;
  speedMul?: number;
  spreadAdd?: number;
  lifeMul?: number;
  recoil?: number;
  appliesTo: ReadonlySet<CardId>;
}

export const BARGAIN_RULES: Partial<Record<CardId, BargainRule>> = {
  // x3 for a heavy bill: the card itself costs 26 mana (36 with a Spark Bolt), so a small tank is dry in three casts.
  overcharge: { dmgMul: 3, appliesTo: DAMAGE_EFFECT_CARDS },
  // The clamp's full x4 and an aim like a handful of gravel (+0.5 rad of jitter, about 29 degrees): a shotgun.
  loosecannon: { dmgMul: 4, spreadAdd: 0.5, appliesTo: intersect(DAMAGE_EFFECT_CARDS, SPREAD_EFFECT_CARDS) },
  // x3, but the shot lives a thirtieth as long: a bolt dies inside ~50 cells, a bomb's fuse is a held breath.
  shortfuse: { dmgMul: 3, lifeMul: 0.03, appliesTo: intersect(DAMAGE_EFFECT_CARDS, PROJECTILE_MOD_HOST_CARDS) },
  // x2.5 at under a third of the speed: a thrown anvil, easy to step around.
  millstone: { dmgMul: 2.5, speedMul: 0.3, appliesTo: intersect(DAMAGE_EFFECT_CARDS, SPEED_EFFECT_CARDS) },
  // x2 and every cast kicks the alchemist back (and a downward one pops him off the floor).
  kickback: { dmgMul: 2, recoil: 7, appliesTo: DAMAGE_EFFECT_CARDS },
};

/** Is this card one of the devil's bargains? */
export function isBargain(id: CardId): boolean {
  return BARGAIN_RULES[id] !== undefined;
}

/**
 * Does modifier `modifier` do anything to a cast of `host`? The same rule the sentence view warns by and
 * the in-play caption speaks from. A multicast or a projectile is never "carried": true.
 */
export function modifierWorksOn(modifier: CardId, host: CardId): boolean {
  const bargain = BARGAIN_RULES[modifier];
  if (bargain) return bargain.appliesTo.has(host);
  if (modifier === 'bounce') return BOUNCE_HOSTS.has(host);
  if (HOST_BOUND_MODIFIERS.has(modifier)) return PROJECTILE_MOD_HOST_CARDS.has(host);
  if (modifier === 'speed') return SPEED_EFFECT_CARDS.has(host);
  if (modifier === 'heavy') return DAMAGE_EFFECT_CARDS.has(host);
  if (modifier === 'spread') return SPREAD_EFFECT_CARDS.has(host);
  return true;
}

/* ---------------- the three states a hit reads or sets ---------------- */

/** What a conditional crit reads off the TARGET (never off slot adjacency): see combat/Projectiles. */
export type CardState = 'wet' | 'frozen' | 'burning';

/** Cards that leave a target in a state. Crits read the state on a LATER cast; self-priming is blocked. */
export const STATE_SETTERS: Partial<Record<CardId, readonly CardState[]>> = {
  aquajet: ['wet'],
  watertrail: ['wet'],
  frostcharge: ['frozen'],
  frostshard: ['frozen'],
  icelance: ['frozen'],
  cryojet: ['frozen'],
  flame: ['burning'],
  emberstorm: ['burning'],
  meteor: ['burning'],
};

/** The payoff cards: a crit that needs the target to be in a state. */
export const STATE_READERS: Partial<Record<CardId, CardState>> = {
  critwet: 'wet',
  shattercrit: 'frozen',
  pyrecrit: 'burning',
};

/** A card that works either way but better in a state (Electric Charge runs through water). */
export const STATE_AMPLIFIERS: Partial<Record<CardId, CardState>> = {
  electriccharge: 'wet',
};

/** The setters worth naming to a player who has none, best first. */
export const SETTER_SUGGESTIONS: Record<CardState, readonly CardId[]> = {
  wet: ['aquajet', 'watertrail'],
  frozen: ['frostcharge', 'frostshard', 'icelance', 'cryojet'],
  burning: ['flame', 'emberstorm', 'meteor'],
};

/** Every card in the catalogue that sets `state`. */
export function settersOf(state: CardState): CardId[] {
  return (Object.keys(STATE_SETTERS) as CardId[]).filter((id) => STATE_SETTERS[id]?.includes(state));
}

/** Every payoff card that reads `state`. */
export function readersOf(state: CardState): CardId[] {
  return (Object.keys(STATE_READERS) as CardId[]).filter((id) => STATE_READERS[id] === state);
}

/* ---------------- dead modifiers on a slot list ---------------- */

/** One modifier in a wand that does nothing to the projectile it will be consumed by. */
export interface DeadModifier {
  slot: number;
  modifier: CardId;
  hostSlot: number;
  host: CardId;
}

/**
 * Walk a wand's slots the way the compiler does (a modifier is consumed by the NEXT projectile card) and
 * name every modifier that is wasted on its host. Multicast and trigger-structure faults are not "dead
 * mods" (the sentence view reports those); this is only the modifier-versus-host rule.
 */
export function deadModifiers(cards: ReadonlyArray<CardId | null>): DeadModifier[] {
  const out: DeadModifier[] = [];
  for (let slot = 0; slot < cards.length; slot++) {
    const id = cards[slot];
    if (!id || CARD_DEFS[id]?.kind !== 'modifier') continue;
    let hostSlot = -1;
    for (let s = slot + 1; s < cards.length; s++) {
      const c = cards[s];
      if (c && CARD_DEFS[c]?.kind === 'projectile') { hostSlot = s; break; }
    }
    if (hostSlot < 0) continue;
    const host = cards[hostSlot] as CardId;
    if (!modifierWorksOn(id, host)) out.push({ slot, modifier: id, hostSlot, host });
  }
  return out;
}

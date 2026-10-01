import type { CardId } from '@/core/types';
import { CARD_DEFS, MULTICAST_SIZE, PROJECTILE_MOD_HOST_CARDS } from './cards';
import {
  HOST_BOUND_MODIFIERS,
  SETTER_SUGGESTIONS,
  STATE_AMPLIFIERS,
  STATE_READERS,
  STATE_SETTERS,
  modifierWorksOn,
  readersOf,
  type CardState,
} from './cardRules';

/**
 * What a card would do for THIS player: a pure read of the wands and the satchel, never of a slot's
 * neighbours (a crit reads the TARGET's state, set by an earlier cast). It drives the fit lines on offer
 * tiles ("Works with your Spark Bolt" / "Does nothing on your Chain Lightning" / "Primes: frozen"), the
 * bench, the offer composer's refusal to hand over a dead card, and the in-play "this does nothing" caption.
 * Host rules are the compiler's (cardRules.modifierWorksOn): there is no second opinion here.
 */

export type FitVerdict = 'works' | 'dead' | 'open';

export interface CardFit {
  /** works: something you carry takes it; dead: everything you carry ignores it; open: nothing to judge yet. */
  verdict: FitVerdict;
  /** The headline for a tile ("" when there is nothing worth saying). */
  line: string;
  /** The second line: the state it sets or pays off, and what it pairs with. */
  note: string | null;
  /** Your projectile cards this one acts on (works) or is wasted on (dead). */
  hosts: CardId[];
  /** States this card leaves a target in. */
  primes: CardState[];
  /** The state this card pays off on (a crit), if it is one. */
  reads: CardState | null;
  /** Your cards on the other side of the pair (the readers of a state it sets; the setters of one it reads). */
  partners: CardId[];
  /** True once the pair is whole in your hands; false when you hold one half; null when it is not a pair card. */
  primed: boolean | null;
}

export interface FitHoldings {
  wands: ReadonlyArray<{ cards: ReadonlyArray<CardId | null> }>;
  collection: readonly CardId[];
}

interface Held {
  slotted: CardId[];
  spare: CardId[];
  /** Every held card, once each. */
  all: Set<CardId>;
  /** Held projectile cards, once each (slotted first). */
  projectiles: CardId[];
  /** How many projectile cards are held, counting copies. */
  projectileCount: number;
}

function heldOf(h: FitHoldings): Held {
  const slotted: CardId[] = [];
  for (const wand of h.wands) for (const c of wand.cards) if (c) slotted.push(c);
  const spare = [...h.collection];
  const all = new Set<CardId>([...slotted, ...spare]);
  const projectiles: CardId[] = [];
  let projectileCount = 0;
  for (const c of [...slotted, ...spare]) {
    if (CARD_DEFS[c]?.kind !== 'projectile') continue;
    projectileCount++;
    if (!projectiles.includes(c)) projectiles.push(c);
  }
  return { slotted, spare, all, projectiles, projectileCount };
}

function name(id: CardId): string {
  return CARD_DEFS[id].name;
}

/** "A", "A and B", "A, B and 2 more". */
export function nameList(ids: readonly CardId[], max = 2): string {
  const names = [...new Set(ids)].map(name);
  if (names.length <= 1) return names.join('');
  // One name over the limit is cheaper to print than "and 1 more".
  if (names.length <= max + 1) return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  return names.slice(0, max).join(', ') + ' and ' + (names.length - max) + ' more';
}

const STATE_WORD: Record<CardState, string> = { wet: 'wet', frozen: 'frozen', burning: 'burning' };

function pairNote(card: CardId, held: Held): { note: string | null; primes: CardState[]; reads: CardState | null; partners: CardId[]; primed: boolean | null } {
  const primes = [...(STATE_SETTERS[card] ?? [])];
  const reads = STATE_READERS[card] ?? null;
  const soft = STATE_AMPLIFIERS[card] ?? null;
  const own = (ids: readonly CardId[]): CardId[] => ids.filter((id) => id !== card && held.all.has(id));

  if (reads) {
    const setters = SETTER_SUGGESTIONS[reads];
    const partners = own(setters);
    const note = partners.length > 0
      ? `Pays off on ${STATE_WORD[reads]} foes. You carry ${nameList(partners)}.`
      : `Pays off on ${STATE_WORD[reads]} foes. Needs ${nameList(setters.slice(0, 2)).replace(' and ', ' or ')} to set that.`;
    return { note, primes, reads, partners, primed: partners.length > 0 };
  }
  if (primes.length > 0) {
    const readers = primes.flatMap((state) => readersOf(state));
    const partners = own(readers);
    const states = primes.map((s) => STATE_WORD[s]).join(', ');
    const note = partners.length > 0
      ? `Primes: ${states}. Pairs with your ${nameList(partners)}.`
      : `Primes: ${states}. Pairs with ${nameList(readers)}.`;
    return { note, primes, reads: null, partners, primed: partners.length > 0 };
  }
  if (soft) {
    const setters = SETTER_SUGGESTIONS[soft];
    const partners = own(setters);
    const note = partners.length > 0
      ? `Hits harder through ${soft} foes. You carry ${nameList(partners)}.`
      : `Hits harder through ${soft} foes: ${nameList(setters.slice(0, 2)).replace(' and ', ' or ')} help.`;
    return { note, primes, reads: null, partners, primed: partners.length > 0 };
  }
  return { note: null, primes, reads: null, partners: [], primed: null };
}

function fitOfProjectile(card: CardId, held: Held): CardFit {
  const body = PROJECTILE_MOD_HOST_CARDS.has(card);
  const mods = [...held.all].filter((id) => HOST_BOUND_MODIFIERS.has(id) && id !== 'infuser');
  const pair = pairNote(card, held);
  let verdict: FitVerdict = 'open';
  let line = '';
  let hosts: CardId[] = [];
  if (mods.length > 0) {
    if (body) {
      hosts = mods.filter((m) => modifierWorksOn(m, card));
      if (hosts.length > 0) { verdict = 'works'; line = `Carries your ${nameList(hosts)}`; }
    } else {
      hosts = mods;
      line = `Can’t carry your ${nameList(mods)}`;
    }
  }
  return { verdict, line, note: pair.note, hosts, primes: pair.primes, reads: pair.reads, partners: pair.partners, primed: pair.primed };
}

function fitOfModifier(card: CardId, held: Held): CardFit {
  const pair = pairNote(card, held);
  const candidates = held.projectiles.filter((id) => id !== card);
  const works = candidates.filter((id) => modifierWorksOn(card, id));
  const deadOn = candidates.filter((id) => !modifierWorksOn(card, id));
  const base = { note: pair.note, primes: pair.primes, reads: pair.reads, partners: pair.partners, primed: pair.primed };

  if (card === 'trigger') {
    // A host AND a payload: two projectiles, and the host must be a body.
    if (works.length === 0 && candidates.length > 0) {
      return { ...base, verdict: 'dead', line: `Does nothing on your ${nameList(deadOn)}`, hosts: deadOn };
    }
    if (works.length > 0 && held.projectileCount < 2) {
      return { ...base, verdict: 'dead', line: 'Needs a second projectile to fire where the first lands', hosts: works };
    }
  }
  if (candidates.length === 0) {
    return { ...base, verdict: 'open', line: 'Wants a projectile to ride on', hosts: [] };
  }
  if (works.length === 0) {
    return { ...base, verdict: 'dead', line: `Does nothing on your ${nameList(deadOn)}`, hosts: deadOn };
  }
  const slottedHost = works.some((id) => held.slotted.includes(id));
  return {
    ...base,
    verdict: 'works',
    line: `Works with your ${nameList(works)}${slottedHost ? '' : ' (in the satchel)'}`,
    hosts: works,
  };
}

function fitOfMulticast(card: CardId, held: Held): CardFit {
  const want = MULTICAST_SIZE[card] ?? 2;
  const have = held.projectileCount;
  const base = { note: null, primes: [], reads: null, partners: [], primed: null };
  if (have < want) {
    return { ...base, verdict: 'dead', line: `Wants ${want} projectiles in one wand; you carry ${have}`, hosts: [] };
  }
  return { ...base, verdict: 'works', line: `Fires ${want} of your ${have} projectiles in one click`, hosts: held.projectiles.slice(0, 2) };
}

/** What `card` would do in the hands described by `holdings`. */
export function cardFit(holdings: FitHoldings, card: CardId): CardFit {
  const held = heldOf(holdings);
  const def = CARD_DEFS[card];
  if (!def) return { verdict: 'open', line: '', note: null, hosts: [], primes: [], reads: null, partners: [], primed: null };
  if (def.kind === 'projectile') return fitOfProjectile(card, held);
  if (def.kind === 'multicast') return fitOfMulticast(card, held);
  return fitOfModifier(card, held);
}

/** A fitter built once for a batch of cards (an offer composes many). */
export function makeFitter(holdings: FitHoldings): {
  fit(card: CardId): CardFit;
  dead(card: CardId): boolean;
  /** 0 dead · 1 nothing to judge · 2 works · 3 works and its pair is whole in your hands. */
  score(card: CardId): number;
} {
  const held = heldOf(holdings);
  const cache = new Map<CardId, CardFit>();
  const fit = (card: CardId): CardFit => {
    let f = cache.get(card);
    if (!f) {
      const def = CARD_DEFS[card];
      f = !def ? { verdict: 'open', line: '', note: null, hosts: [], primes: [], reads: null, partners: [], primed: null }
        : def.kind === 'projectile' ? fitOfProjectile(card, held)
        : def.kind === 'multicast' ? fitOfMulticast(card, held)
        : fitOfModifier(card, held);
      cache.set(card, f);
    }
    return f;
  };
  return {
    fit,
    dead: (card) => fit(card).verdict === 'dead',
    score: (card) => {
      const f = fit(card);
      return f.verdict === 'dead' ? 0 : f.verdict === 'open' ? 1 : f.primed === true ? 3 : 2;
    },
  };
}

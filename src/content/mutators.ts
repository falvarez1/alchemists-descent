import type { DifficultyMods } from '@/config/difficulty';
import { Rng, hashSeed } from '@/core/rng';

/**
 * COMPLICATIONS (run mutators): one set of floors, many different runs.
 *
 * A complication is a standing regulation the Guild has issued for the whole of
 * a descent. It is runtime-only (it never touches a floor's generated output, so
 * no GEN_VERSION churn), deterministic per seed, and never hard-locks a run: the
 * world dressing it adds is real cells and real emitters, checked against the
 * route like everything else. It is NOT a boon: `player.perks` is the Sanctum's
 * and Pell and the pause menu read it, so a complication lives on the run
 * (`RunSaveState.mutators`) and on `ctx.state.mutators`, never on the player.
 *
 * This file is pure data and pure arithmetic (no Ctx, no DOM, no cells): the
 * registry, the multipliers each complication folds into the game's dials, the
 * rules for what a set of them means for the ladder, and the daily table. The
 * runtime that applies them is `game/MutatorDirector`; the dressing is
 * `game/mutatorDressing`.
 */

/** The most complications a descent may carry at once. */
export const MAX_MUTATORS = 3;

/**
 * Every dial a complication can turn, as a multiplier on what is already there
 * (1 = untouched). The first group is folded into `difficultyMods` (the one
 * funnel the enemy count, HP, damage, speed and sense, and the alchemist's HP
 * already read); the second is read through `mutatorMods`.
 */
export interface MutatorMods {
  enemyCount: number;
  enemyHp: number;
  enemyDamage: number;
  enemySpeed: number;
  enemySense: number;
  /** The alchemist's maximum (and starting) health. */
  playerHp: number;
  /**
   * Damage the alchemist's own blows deal, applied where a blow lands on a
   * creature (`EnemyControl.damage`, for 'direct' and 'bowled' blows), i.e. AFTER
   * the wand compiler's x4 damage clamp: a wand still compiles to at most x4, and
   * this is a separate multiplier on top of whatever it compiled to.
   */
  playerDamage: number;
  /** Healing the alchemist receives (potions, springs, regeneration, kills). */
  healing: number;
  /** The bounty a fallen creature pays. */
  gold: number;
  /** Gravity: the player's fall, a thrown body's arc, a knocked-back creature. 1 is today's. */
  gravity: number;
  /** The cave's ambient light floor. */
  ambient: number;
  /**
   * A floor under the DESIGNED darkness of every campaign floor (0 = the floors as designed, 1 = black): the base
   * darkness (config/darkness) is raised to at least this, so the lantern, a fire and the eyeshine are what light
   * the way, and a creature's sight and the lantern's reach read it too. Unlike the others it composes by max, not
   * by product, and 0 (not 1) is untouched. Read by core/darkness through `darkMapFor`.
   */
  darkness: number;
  /** How readily fuel catches (the fixed fuel list: wood, vines, leaves, grass, oil, coal...). */
  flammability: number;
}

export const NEUTRAL_MODS: Readonly<MutatorMods> = Object.freeze({
  enemyCount: 1,
  enemyHp: 1,
  enemyDamage: 1,
  enemySpeed: 1,
  enemySense: 1,
  playerHp: 1,
  playerDamage: 1,
  healing: 1,
  gold: 1,
  gravity: 1,
  ambient: 1,
  darkness: 0,
  flammability: 1,
});

/** What a complication adds to the floors, besides turning dials. */
export type MutatorDressing = 'puddles' | 'drips' | 'slime' | 'gas';

export interface MutatorDef {
  id: string;
  /** The name on the chip, the ledger and the share line. */
  name: string;
  /** The Clerk of Works' one-line regulation: what it does first, the dryness second. */
  regulation: string;
  /**
   * The load it puts on the descent: +1 makes it harder, +2 much harder, 0 trades
   * one danger for another, -1 eases it. The title's total is the sum.
   */
  weight: -1 | 0 | 1 | 2;
  /**
   * Whether a victory with this complication counts toward opening the next
   * difficulty tier. A complication that EASES the descent never does (an easy
   * mutator on Adept must not open Conjurer); the harder ones do, as any win would.
   * (config/difficultyLadder owns the tiers; game/MetaProfile applies this.)
   */
  ladder: boolean;
  /** Multipliers on the game's dials (missing = untouched). */
  mods?: Partial<MutatorMods>;
  /** The real cells and emitters it adds to a floor (game/mutatorDressing). */
  dressing?: readonly MutatorDressing[];
  /** A creature that falls bursts into fireworks (game/MutatorDirector). */
  fireworks?: true;
}

export const MUTATOR_DEFS = {
  'wet-floors': {
    id: 'wet-floors',
    name: 'Wet Floors',
    regulation: 'Puddles at the low points and a drip overhead. Water carries current; damp fuel barely burns.',
    weight: 0,
    ladder: true,
    mods: { flammability: 0.55 },
    dressing: ['puddles', 'drips'],
  },
  tinderbox: {
    id: 'tinderbox',
    name: 'Tinderbox',
    regulation: 'Every fuel in the Works is bone dry. Fire spreads where it is invited, and a few places it is not.',
    weight: 1,
    ladder: true,
    mods: { flammability: 2.4 },
  },
  'slime-rain': {
    id: 'slime-rain',
    name: 'Slime Rain',
    regulation: 'Slime drips from the ceilings along the route. Fire turns it to acid. Mind your hat.',
    weight: 1,
    ladder: true,
    dressing: ['slime'],
  },
  'gas-leak': {
    id: 'gas-leak',
    name: 'Gas Leak',
    regulation: 'Marsh gas seeps from vents along the route. A flame lights it, and it lights the rest.',
    weight: 1,
    ladder: true,
    dressing: ['gas'],
  },
  'glass-cannon': {
    id: 'glass-cannon',
    name: 'Glass Cannon',
    regulation: 'Half the health, and your spells strike half again as hard.',
    weight: 1,
    ladder: true,
    mods: { playerHp: 0.5, playerDamage: 1.5 },
  },
  'low-gravity': {
    id: 'low-gravity',
    name: 'Low Gravity',
    regulation: 'The Works have been lightened by order: you jump higher, fall slower and throw things farther.',
    weight: -1,
    ladder: false,
    mods: { gravity: 0.55 },
  },
  'crowded-house': {
    id: 'crowded-house',
    name: 'Crowded House',
    regulation: 'Half again as many creatures, and each pays forty percent more.',
    weight: 1,
    ladder: true,
    mods: { enemyCount: 1.5, gold: 1.4 },
  },
  'dark-works': {
    id: 'dark-works',
    name: 'Dark Works',
    regulation: 'The Guild has economised on lighting. Your lantern, your spells and whatever is on fire will have to do.',
    weight: 1,
    ladder: true,
    mods: { ambient: 0.6, darkness: 0.7 },
  },
  famine: {
    id: 'famine',
    name: 'Short Rations',
    regulation: 'Healing is issued at half strength: potions, springs and spoils alike.',
    weight: 1,
    ladder: true,
    mods: { healing: 0.5 },
  },
  fireworks: {
    id: 'fireworks',
    name: 'Fireworks',
    regulation: 'Creatures burst into fireworks when they fall. The burst hurts whatever is near it, you included.',
    weight: 0,
    ladder: true,
    fireworks: true,
  },
  hush: {
    id: 'hush',
    name: 'Hush',
    regulation: 'Creatures notice you from about half the usual distance. Tread softly; it works.',
    weight: -1,
    ladder: false,
    mods: { enemySense: 0.5 },
  },
  'nosy-neighbours': {
    id: 'nosy-neighbours',
    name: 'Nosy Neighbours',
    regulation: 'Creatures notice you from half again as far. Most of them mean well.',
    weight: 1,
    ladder: true,
    mods: { enemySense: 1.5 },
  },
} as const satisfies Record<string, MutatorDef>;

export type MutatorId = keyof typeof MUTATOR_DEFS;

/** The canonical order: the chips, the ledger and the share line always list them like this, whatever order they were picked in. */
export const MUTATOR_ORDER: readonly MutatorId[] = [
  'wet-floors',
  'tinderbox',
  'slime-rain',
  'gas-leak',
  'glass-cannon',
  'low-gravity',
  'crowded-house',
  'dark-works',
  'famine',
  'fireworks',
  'hush',
  'nosy-neighbours',
];

/**
 * Complications that undo each other: a creature cannot be made to notice from half as far AND half again
 * as far. A set never holds both (`cleanMutators` keeps the first in canonical order, the title swaps one for
 * the other, a bargain is never offered one that conflicts with what is in force).
 */
const CONFLICTS: ReadonlyArray<readonly [MutatorId, MutatorId]> = [['hush', 'nosy-neighbours']];

export function conflictsWith(a: string, b: string): boolean {
  return CONFLICTS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

export function isMutatorId(value: unknown): value is MutatorId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MUTATOR_DEFS, value);
}

export function mutatorDef(id: string): MutatorDef | null {
  return isMutatorId(id) ? MUTATOR_DEFS[id] : null;
}

/**
 * A set of complication ids, cleaned: only known ones, each once, in the
 * canonical order, no more than `max`. Anything else a save, a hand edit or a
 * stale selection might carry is dropped. Pure.
 */
export function cleanMutators(input: readonly unknown[] | null | undefined, max = MAX_MUTATORS): MutatorId[] {
  if (!Array.isArray(input)) return [];
  const wanted = new Set<string>();
  for (const id of input) if (isMutatorId(id)) wanted.add(id);
  const kept: MutatorId[] = [];
  for (const id of MUTATOR_ORDER) if (wanted.has(id) && !kept.some((k) => conflictsWith(k, id))) kept.push(id);
  return kept.slice(0, Math.max(0, max));
}

/** 'Wet Floors', 'Wet Floors and Low Gravity', 'A, B and C': the complications by name. */
export function mutatorNames(ids: readonly string[] | null | undefined): string {
  const names = cleanMutators(ids ?? []).map((id) => MUTATOR_DEFS[id].name);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The share line's piece: 'Wet Floors + Low Gravity'. */
export function mutatorTag(ids: readonly string[] | null | undefined): string {
  return cleanMutators(ids ?? []).map((id) => MUTATOR_DEFS[id].name).join(' + ');
}

/** The sum of the weights: what the title shows as the total. */
export function mutatorLoad(ids: readonly string[] | null | undefined): number {
  return cleanMutators(ids ?? []).reduce((sum, id) => sum + MUTATOR_DEFS[id].weight, 0);
}

/** '+2 pressure', 'even', '1 easier': the total in words. */
export function mutatorLoadText(ids: readonly string[] | null | undefined): string {
  const load = mutatorLoad(ids);
  if (cleanMutators(ids ?? []).length === 0) return '';
  if (load > 0) return `+${load} pressure`;
  if (load < 0) return `${-load} easier`;
  return 'an even trade';
}

/**
 * Does a victory with these complications count toward opening the next tier?
 * Only when none of them eases the descent. (A run with none is an ordinary run.)
 */
export function mutatorsCountForLadder(ids: readonly string[] | null | undefined): boolean {
  return cleanMutators(ids ?? []).every((id) => MUTATOR_DEFS[id].ladder);
}

/* ---------------- the bargain ---------------- */

/** A bargain struck at the Sanctum below `floor`: the complication accepted for the rest of the descent. */
export interface Bargain {
  floor: number;
  id: string;
}

/**
 * THE SANCTUM'S BARGAIN: between floors the old ones offer one complication for the rest of the
 * descent, and a second boon in return (take two of the three). Only a complication that HARDENS
 * the descent (weight 1 or more) is ever offered, so the trade is a real one; one that is already in
 * force, one that conflicts with one in force, and any offer past the most a descent may carry are not.
 */
export function canBargain(active: readonly string[] | null | undefined, id: string): id is MutatorId {
  if (!isMutatorId(id) || MUTATOR_DEFS[id].weight < 1) return false;
  const now = cleanMutators(active ?? []);
  return now.length < MAX_MUTATORS && !now.includes(id) && !now.some((n) => conflictsWith(n, id));
}

/**
 * The complication on offer at the Sanctum below `floor`: a pure function of the run's seed, the floor
 * and what is already in force, so a reload cannot reroll it. Null when there is none to offer.
 */
export function bargainOffer(active: readonly string[] | null | undefined, expeditionSeed: number, floor: number): MutatorId | null {
  const pool = MUTATOR_ORDER.filter((id) => canBargain(active, id));
  if (pool.length === 0) return null;
  return pool[new Rng(hashSeed(expeditionSeed >>> 0, `bargain:${floor}`)).int(pool.length)];
}

/**
 * The alchemist's health after the HP dial (a tier's, or Glass Cannon's) moves from `before` to `after`:
 * in proportion, so a hurt alchemist stays hurt in proportion, and never below one. Pure.
 */
export function rescaleHealth(hp: number, maxHp: number, before: number, after: number): { hp: number; maxHp: number } {
  if (before === after || before <= 0) return { hp, maxHp };
  const ratio = after / before;
  const nextMax = Math.max(1, Math.round(maxHp * ratio));
  return { hp: Math.max(1, Math.min(nextMax, Math.round(hp * ratio))), maxHp: nextMax };
}

/* ---------------- the arithmetic ---------------- */

const modCache = new WeakMap<readonly string[], MutatorMods>();

/** The dials a set of complications turns, composed (multiplied) in one object. Cached per array. */
export function composeMutatorMods(ids: readonly string[] | null | undefined): Readonly<MutatorMods> {
  if (!ids || ids.length === 0) return NEUTRAL_MODS;
  const hit = modCache.get(ids);
  if (hit) return hit;
  const out: MutatorMods = { ...NEUTRAL_MODS };
  for (const id of ids) {
    const mods = mutatorDef(id)?.mods;
    if (!mods) continue;
    for (const key of Object.keys(mods) as Array<keyof MutatorMods>) {
      // A darkness floor composes by max (0 is untouched); every other dial is a multiplier on what is there.
      if (key === 'darkness') out.darkness = Math.max(out.darkness, mods.darkness ?? 0);
      else out[key] *= mods[key] ?? 1;
    }
  }
  const frozen = Object.freeze(out);
  modCache.set(ids, frozen);
  return frozen;
}

/** The active run's complication dials (all 1 when it carries none). The read every system uses. */
export function mutatorMods(state: { mutators?: readonly string[] } | null | undefined): Readonly<MutatorMods> {
  return composeMutatorMods(state?.mutators);
}

const tierCache = new WeakMap<readonly string[], Map<DifficultyMods, DifficultyMods>>();

/**
 * A tier's multipliers with the complications' folded in: the effective-mods
 * layer composed over `difficultyMods`. With no complications it returns the
 * tier object ITSELF, so an ordinary run reads exactly what it always read.
 */
export function composeTierMods(base: DifficultyMods, ids: readonly string[] | null | undefined): DifficultyMods {
  if (!ids || ids.length === 0) return base;
  let perBase = tierCache.get(ids);
  if (!perBase) tierCache.set(ids, (perBase = new Map()));
  const hit = perBase.get(base);
  if (hit) return hit;
  const m = composeMutatorMods(ids);
  const composed: DifficultyMods = Object.freeze({
    ...base,
    enemyCount: base.enemyCount * m.enemyCount,
    enemyDamage: base.enemyDamage * m.enemyDamage,
    enemyHp: base.enemyHp * m.enemyHp,
    enemySpeed: base.enemySpeed * m.enemySpeed,
    enemySense: base.enemySense * m.enemySense,
    playerHp: base.playerHp * m.playerHp,
  });
  perBase.set(base, composed);
  return composed;
}

/* ---------------- the daily ---------------- */

/**
 * THE DAILY'S COMPLICATIONS.
 *
 * Today's descent is one seed, one case and one tier for everyone, and from the
 * first era below it carries the complications the DATE names: a pure function of
 * the date and this table, so every player on Earth gets the same ones, and a
 * daily best stays comparable. The player's own choices never apply to it (the
 * same rule as the kit and the tier).
 *
 * THE RULE, which keeps old dates stable: this table is APPEND-ONLY. An era is a
 * date from which a rotation applies, until a later era's date. Never edit, reorder
 * or remove an era or an entry in a rotation, and never insert one before the end:
 * that would change what a date that has already been played was. To change the
 * rotation, append a NEW era with a later `from` date. A date before the first era
 * has none. Within an era the day number picks the entry in order, cycling.
 */
export interface DailyEra {
  /** YYYY-MM-DD (UTC): the first date this rotation applies to. */
  from: string;
  /** One entry per day, in order, cycling. Each is one to three complication ids. */
  rotation: ReadonlyArray<readonly MutatorId[]>;
}

export const DAILY_ERAS: readonly DailyEra[] = [
  {
    from: '2026-10-01',
    rotation: [
      ['wet-floors'],
      ['tinderbox'],
      ['low-gravity', 'crowded-house'],
      ['gas-leak'],
      ['glass-cannon'],
      ['dark-works'],
      ['slime-rain', 'famine'],
      ['fireworks'],
      ['hush', 'tinderbox'],
      ['crowded-house'],
      ['wet-floors', 'fireworks'],
      ['famine'],
      ['gas-leak', 'dark-works'],
      ['low-gravity'],
    ],
  },
];

/** Whole UTC days since 1970-01-01 for a YYYY-MM-DD key, or null when it is not one. */
export function dayNumber(dateKey: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}

/** The complications of a date's daily descent (see DAILY_ERAS for the rule). Pure. */
export function dailyMutators(dateKey: string, eras: readonly DailyEra[] = DAILY_ERAS): MutatorId[] {
  const day = dayNumber(dateKey);
  if (day === null) return [];
  let era: DailyEra | null = null;
  for (const candidate of eras) if (candidate.from <= dateKey && (era === null || candidate.from >= era.from)) era = candidate;
  if (!era || era.rotation.length === 0) return [];
  const start = dayNumber(era.from);
  if (start === null) return [];
  const at = (((day - start) % era.rotation.length) + era.rotation.length) % era.rotation.length;
  return cleanMutators(era.rotation[at]);
}

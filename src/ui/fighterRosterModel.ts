import {
  FIGHTER_DEFS,
  FIGHTER_ORDER,
  type FighterDef,
  type FighterId,
  type FighterRole,
  type FighterStatName,
} from '@/content/fighters';

/**
 * The Fighter Roster's logic with the DOM taken out (ui/FighterRoster draws it): which fighters a role filter
 * and a search leave standing, how many each role has, how full a stat bar is, and where an arrow key goes
 * on the grid. Pure, so tests/fighter-roster-model.test.ts pins it without a browser.
 */

/** The filter bar's order, as the design document lays it out (data order is FIGHTER_ROLES). */
export type RoleFilter = 'All' | FighterRole;
export const ROLE_FILTERS: readonly RoleFilter[] = ['All', 'Duelist', 'Hunter', 'Controller', 'Bulwark', 'Support'];

export const STAT_ORDER: readonly FighterStatName[] = ['Offense', 'Mobility', 'Survival', 'Utility'];
export const STAT_MAX = 10;

/**
 * The first option: the classic descent. It is not one of the ten (no portrait, no kit, no number) and not a
 * FighterId; the roster hands the caller `null` for it.
 */
export const CLASSIC_ENTRY = 'classic';
export type RosterEntry = FighterId | typeof CLASSIC_ENTRY;

export const CLASSIC_COPY = {
  name: 'The Alchemist',
  tag: 'No fighter',
  blurb: 'The classic descent: the Alchemist, no passive and no abilities.',
  accent: '#d5b982',
} as const;

/** The design document's roster note, split where the screen wants each half. */
export const ROSTER_NOTE = {
  headline: 'Different instincts. Shared arsenal.',
  /** The dossier footer's line: a fighter does not choose the arsenal. */
  weapons: 'Weapons come from your kit and from loot.',
  edge: 'Your fighter brings the edge: movement, information, survival, or control. Every kit includes a passive, a tactical ability, and an ultimate.',
} as const;

/** Lower-case, accents and curly quotes flattened, whitespace collapsed: what search compares. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A query's terms: every one has to match somewhere (so "smoke duelist" narrows, not widens). */
export function searchTerms(query: string): string[] {
  const text = normalizeText(query);
  return text === '' ? [] : text.split(' ');
}

const searchTextCache = new Map<FighterId, string>();

/** Everything a player might type to find a fighter: who, what role, the lore, the tags and the whole kit. */
export function fighterSearchText(def: FighterDef): string {
  const cached = searchTextCache.get(def.id);
  if (cached !== undefined) return cached;
  const text = normalizeText(
    [
      def.name, def.title, def.role, def.lore, ...def.tags,
      def.passive.name, def.passive.description,
      def.tactical.name, def.tactical.description,
      def.ultimate.name, def.ultimate.description,
    ].join(' '),
  );
  searchTextCache.set(def.id, text);
  return text;
}

const CLASSIC_SEARCH_TEXT = normalizeText(
  `${CLASSIC_COPY.name} ${CLASSIC_COPY.tag} classic default hero original ${CLASSIC_COPY.blurb}`,
);

export function fighterMatches(def: FighterDef, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const text = fighterSearchText(def);
  return terms.every((term) => text.includes(term));
}

export function classicMatches(terms: readonly string[]): boolean {
  return terms.every((term) => CLASSIC_SEARCH_TEXT.includes(term));
}

/** The fighters a filter and a search leave standing, in roster order. */
export function filterFighters(
  role: RoleFilter,
  query: string,
  order: readonly FighterId[] = FIGHTER_ORDER,
): FighterId[] {
  const terms = searchTerms(query);
  return order.filter((id) => {
    const def = FIGHTER_DEFS[id];
    return (role === 'All' || def.role === role) && fighterMatches(def, terms);
  });
}

/**
 * What the grid shows: the classic option first (only under "All", because a role filter is about the
 * ten), then the surviving fighters. This list IS the keyboard order.
 */
export function rosterEntries(
  role: RoleFilter,
  query: string,
  order: readonly FighterId[] = FIGHTER_ORDER,
): RosterEntry[] {
  const entries: RosterEntry[] = filterFighters(role, query, order);
  if (role === 'All' && classicMatches(searchTerms(query))) entries.unshift(CLASSIC_ENTRY);
  return entries;
}

/**
 * How many fighters each filter button would show: the design document's counts with no query, and the
 * matches per role while one is typed (so a button reads 0 before the player clicks it for nothing).
 */
export function roleCounts(query = '', order: readonly FighterId[] = FIGHTER_ORDER): Record<RoleFilter, number> {
  const terms = searchTerms(query);
  const counts: Record<RoleFilter, number> = { All: 0, Duelist: 0, Hunter: 0, Controller: 0, Bulwark: 0, Support: 0 };
  for (const id of order) {
    const def = FIGHTER_DEFS[id];
    if (!fighterMatches(def, terms)) continue;
    counts.All += 1;
    counts[def.role] += 1;
  }
  return counts;
}

/** The compact grid's caption: the surname ("Thorne", "Emberjaw"), because a 60 px tile has no room for the rest. */
export function shortName(entry: RosterEntry): string {
  const full = entry === CLASSIC_ENTRY ? CLASSIC_COPY.name : FIGHTER_DEFS[entry].name;
  const words = full.split(' ');
  return words[words.length - 1] ?? full;
}

export interface StatBar {
  /** The rating, clamped to a whole 0..STAT_MAX. */
  value: number;
  /** Lit ticks of STAT_MAX. */
  filled: number;
  /** Width of a continuous bar, 0..100. */
  percent: number;
  label: string;
}

export function statBar(name: FighterStatName, raw: number): StatBar {
  const value = Number.isFinite(raw) ? Math.min(STAT_MAX, Math.max(0, Math.round(raw))) : 0;
  return { value, filled: value, percent: (value / STAT_MAX) * 100, label: `${name}: ${value} out of ${STAT_MAX}` };
}

export type GridKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';
const GRID_KEYS: ReadonlySet<string> = new Set<GridKey>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

export function isGridKey(key: string): key is GridKey {
  return GRID_KEYS.has(key);
}

/**
 * Where an arrow key moves the focus on a grid of `count` cells laid out `columns` wide. Left and Right walk
 * the reading order and wrap; Up and Down keep the column and wrap top to bottom (a short last row clamps to
 * its last cell rather than skipping); on a single row (the compact strip) Up and Down stay put.
 */
export function stepGridIndex(index: number, key: GridKey, count: number, columns: number): number {
  if (count <= 0) return -1;
  const at = Math.min(Math.max(index, 0), count - 1);
  const cols = Math.min(Math.max(Math.floor(columns) || 1, 1), count);
  const rows = Math.ceil(count / cols);
  const row = Math.floor(at / cols);
  const col = at % cols;
  switch (key) {
    case 'ArrowRight': return (at + 1) % count;
    case 'ArrowLeft': return (at - 1 + count) % count;
    case 'ArrowDown': return rows === 1 ? at : Math.min(((row + 1) % rows) * cols + col, count - 1);
    case 'ArrowUp': return rows === 1 ? at : Math.min(((row - 1 + rows) % rows) * cols + col, count - 1);
    case 'Home': return 0;
    case 'End': return count - 1;
  }
}

/** Left/Right on a roving radio row (the role filters): wrap, no vertical. */
export function stepRadioIndex(index: number, key: string, count: number): number {
  if (count <= 0) return -1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return index;
}

export function padNumber(n: number): string {
  return String(n).padStart(2, '0');
}

/** The live-region line for a filter or search: "6 of 10 fighters shown in Duelist." */
export function resultSummary(shown: number, total: number, role: RoleFilter, query: string): string {
  const noun = shown === 1 ? 'fighter' : 'fighters';
  const scope = role === 'All' ? '' : ` in ${role}`;
  const search = query.trim() === '' ? '' : ` matching “${query.trim()}”`;
  return `${shown} of ${total} ${noun} shown${scope}${search}.`;
}

/** The empty state's second line: names what is narrowing the roster and how to widen it. */
export function emptyMessage(role: RoleFilter, query: string): string {
  const q = query.trim();
  if (q === '') return role === 'All' ? 'Nobody is on the roster.' : `No ${role.toLowerCase()} is on the roster. Clear the filter to see everyone.`;
  const who = role === 'All' ? 'fighter' : `${role.toLowerCase()}`;
  return `No ${who} matches “${q}”. Try a name, a role, or what an ability does.`;
}

/** The Choose button's words: what pressing it will do. */
export function chooseLabel(entry: RosterEntry, state: { current: RosterEntry; locked: boolean }): string {
  const name = entry === CLASSIC_ENTRY ? 'the Alchemist' : FIGHTER_DEFS[entry].name;
  if (state.locked) return 'Locked';
  return entry === state.current ? `Keep ${name}` : `Choose ${name}`;
}

/** The ability row's key chip: Tactical and Ultimate carry the player's binding, the passive none. */
export interface KeyLabels {
  tactical: string;
  ultimate: string;
}
export const DEFAULT_KEY_LABELS: Readonly<KeyLabels> = { tactical: 'Z', ultimate: 'T' };

export type AbilityKind = 'passive' | 'tactical' | 'ultimate';
export const ABILITY_KINDS: readonly AbilityKind[] = ['passive', 'tactical', 'ultimate'];

export function abilityKeyLabel(kind: AbilityKind, keys: KeyLabels): string | null {
  if (kind === 'tactical') return keys.tactical;
  if (kind === 'ultimate') return keys.ultimate;
  return null;
}

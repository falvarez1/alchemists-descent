import type { Difficulty } from '@/core/types';
import type { KitId } from '@/core/run';
import { KIT_DEFS, KIT_ORDER } from '@/content/kits';
import { FIGHTER_DEFS, FIGHTER_ORDER, fighterPortraitUrl, type FighterId } from '@/content/fighters';
import { DIFFICULTY, DIFFICULTY_ORDER } from '@/config/difficulty';
import { DIFFICULTY_BLURBS, difficultyUnlockHint, isDifficultyOpen } from '@/config/difficultyLadder';
import {
  MAX_MUTATORS,
  MUTATOR_DEFS,
  conflictsWith,
  mutatorLoadText,
  mutatorNames,
  mutatorsCountForLadder,
  type MutatorId,
} from '@/content/mutators';
import { CLASSIC_COPY } from '@/ui/fighterRosterModel';

/**
 * The title screen as a game menu: pure data and rules, no DOM (ui/title/TitleMenu draws it, ui/ExpeditionEntry
 * fills it). A menu is a stack of PAGES; a page is a list of ITEMS; the focused item may explain itself in a
 * DETAIL card. Nothing is shown until you drill into it: the main page lists a handful of doors, and each door
 * opens the choices that belong to it.
 */

/**
 * action: does something (Today's descent). drill: opens a page. choice: a row with a current value that
 * Left / Right change in place and Enter opens the full list. option: one entry of such a list (radio).
 * toggle: one of several that may be on at once (a complication). back: leaves the page.
 */
export type ItemKind = 'action' | 'drill' | 'choice' | 'option' | 'toggle' | 'back';

export type ItemIcon =
  | { kind: 'kit'; kit: KitId }
  | { kind: 'portrait'; src: string; accent: string }
  | { kind: 'text'; text: string };

/** What the detail card shows for the focused item. */
export interface DetailSpec {
  /** A small label above the heading ("Case", "Duelist"). */
  eyebrow?: string;
  heading: string;
  /** An italic line under the heading ("The Cinder Alchemist"). */
  sub?: string;
  body?: string;
  /** Labelled lines (the three abilities, a wand). */
  lines?: ReadonlyArray<{ label: string; name: string; text: string }>;
  icon?: ItemIcon;
  /** The item is locked: the card says how to earn it instead. */
  locked?: boolean;
}

export interface MenuItem {
  /** Also the `data-entry` the probes click. */
  id: string;
  label: string;
  kind: ItemKind;
  /** The call to action (Continue, Descend): the brass one. */
  primary?: boolean;
  /** A dimmed second line under the label. */
  sub?: string;
  /** A choice row's current value, right-aligned. */
  value?: string;
  /** An option row: this is the current choice. */
  checked?: boolean;
  /** Focusable and explained, but it refuses (a locked kit, a seed field that is still empty). */
  locked?: boolean;
  icon?: ItemIcon;
  /** One line under the list while the item is focused. */
  hint?: string;
  detail?: DetailSpec | null;
  /** Extra attributes for the element (`data-kit`, `data-difficulty`): the probes and the styles read them. */
  attrs?: Readonly<Record<string, string>>;
  activate(): void;
  /** Left (-1) / Right (+1) on a choice row. */
  step?(dir: -1 | 1): void;
}

export interface MenuPage {
  id: string;
  /** The page's name ("New descent"); empty on the main page. */
  title: string;
  /** What this page belongs to, in small letters above the title. */
  eyebrow?: string;
  /** Rebuilt on every render, so state changes show without bookkeeping. */
  items(): MenuItem[];
  /** A line under the list that belongs to the whole page (the complications' total), not to the focused row. */
  note?(): string;
  /** The item that takes focus when the page opens (a list opens on the current choice); the first item by default. */
  focus?: string | (() => string | undefined);
  /** Built once, kept between renders (the seed field must not lose what is typed). */
  body?(): HTMLElement;
  /** An element before the items that Up from the first item reaches (the seed field). */
  lead?(): HTMLElement | null;
}

/** The next OPEN option in `dir`, wrapping; `current` when nothing else is open. */
export function cycleOpen<T>(order: readonly T[], isOpen: (option: T) => boolean, current: T, dir: -1 | 1): T {
  const at = order.indexOf(current);
  // A current value that is not in the list (a stale save) steps onto the first option going forward, the last going back.
  const from = at < 0 ? (dir === 1 ? -1 : order.length) : at;
  for (let n = 1; n <= order.length; n++) {
    const next = order[((from + dir * n) % order.length + order.length) % order.length];
    if (next !== current && isOpen(next)) return next;
  }
  return current;
}

/** Every fighter the title offers, the classic Alchemist (null) first. */
export const FIGHTER_CYCLE: ReadonlyArray<FighterId | null> = [null, ...FIGHTER_ORDER];

export function cycleFighter(current: FighterId | null, dir: -1 | 1): FighterId | null {
  return cycleOpen(FIGHTER_CYCLE, () => true, current, dir);
}

export function cycleKit(unlocked: ReadonlySet<KitId>, current: KitId, dir: -1 | 1): KitId {
  return cycleOpen(KIT_ORDER, (kit) => unlocked.has(kit), current, dir);
}

export function cycleDifficulty(bestVictory: number, current: Difficulty, dir: -1 | 1): Difficulty {
  return cycleOpen(DIFFICULTY_ORDER, (tier) => isDifficultyOpen(tier, bestVictory), current, dir);
}

/** Up / Down / Home / End over `count` items: Up and Down wrap, like every game menu. */
export function moveFocusIndex(index: number, count: number, key: string): number {
  if (count <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const from = index < 0 ? (key === 'ArrowUp' ? 0 : -1) : index;
  return (from + (key === 'ArrowUp' ? -1 : 1) + count) % count;
}

export interface ContinueFacts {
  maxFloor: number;
  kit: KitId;
  fighter?: FighterId | null;
  timeMs: number;
}

/** "Floor 2 of 4 · The Sparkwright · Ilyra Voss · 12:41": what Continue returns you to. */
export function continueLine(save: ContinueFacts | null, floorsTotal: number, time: string): string {
  if (!save) return '';
  const parts = [`Floor ${Math.max(1, save.maxFloor)} of ${floorsTotal}`, KIT_DEFS[save.kit].short];
  if (save.fighter) parts.push(FIGHTER_DEFS[save.fighter].name);
  parts.push(time);
  return parts.join(' · ');
}

export interface DailyFacts {
  today: string;
  best: { victory: boolean; floor: number; timeMs: number } | null;
  /** The names of the complications today's descent carries, set by the date ('' = none). */
  carries?: string;
}

/** The daily's two lines: the short one under its name, and the full sentence for the hint line. */
export function dailyLines(daily: DailyFacts, floorsTotal: number, time: (ms: number) => string): { sub: string; hint: string } {
  const best = daily.best
    ? daily.best.victory ? `Best: the Kiln quieted in ${time(daily.best.timeMs)}` : `Best: Floor ${daily.best.floor} of ${floorsTotal} in ${time(daily.best.timeMs)}`
    : '';
  const carries = daily.carries ? ` · ${daily.carries}` : '';
  return {
    sub: best || `${daily.today}${carries}`,
    hint: `${daily.today} · one seed for everyone · the Alchemist with the Sparkwright’s case, on Adept${carries}`,
  };
}

export function kitDetail(kit: KitId, open: boolean): DetailSpec {
  const def = KIT_DEFS[kit];
  return {
    eyebrow: 'Case',
    heading: def.name,
    body: open ? def.blurb : `Locked. ${def.unlockHint}`,
    icon: { kind: 'kit', kit },
    locked: !open,
  };
}

export interface KeyLabels { tactical: string; ultimate: string }

export function fighterDetail(id: FighterId | null, keys: KeyLabels): DetailSpec {
  if (!id) {
    return { eyebrow: 'No fighter', heading: CLASSIC_COPY.name, body: CLASSIC_COPY.blurb, icon: { kind: 'text', text: '⚗' } };
  }
  const def = FIGHTER_DEFS[id];
  return {
    eyebrow: def.role,
    heading: def.name,
    sub: def.title,
    body: def.playstyle,
    lines: [
      { label: 'Passive', name: def.passive.name, text: def.passive.description },
      { label: keys.tactical, name: def.tactical.name, text: def.tactical.description },
      { label: keys.ultimate, name: def.ultimate.name, text: def.ultimate.description },
    ],
    icon: { kind: 'portrait', src: fighterPortraitUrl(id), accent: def.accent },
  };
}

export function difficultyDetail(tier: Difficulty, bestVictory: number): DetailSpec {
  const open = isDifficultyOpen(tier, bestVictory);
  const def = DIFFICULTY[tier];
  return {
    eyebrow: `Difficulty ${def.roman}`,
    heading: def.name,
    body: open ? DIFFICULTY_BLURBS[tier] : `Locked. ${difficultyUnlockHint(tier)}`,
    icon: { kind: 'text', text: def.roman },
    locked: !open,
  };
}

/* ---------------- complications ---------------- */

/** The weight's mark: '+1', '±0', '−1' (a real minus, not a hyphen). */
export function loadMark(weight: number): string {
  if (weight > 0) return `+${weight}`;
  if (weight < 0) return `−${-weight}`;
  return '±0';
}

export const COMPLICATIONS_LEAD = `Standing regulations for one descent: up to ${MAX_MUTATORS}. Each changes how the floors behave, not what they are.`;

export interface ComplicationToggle {
  chosen: MutatorId[];
  /** The set was full: nothing changed. */
  refused: boolean;
  /** What happened, when it is worth saying (a swap, a refusal); '' otherwise. */
  note: string;
}

/**
 * Turn `id` on or off in `chosen` (kept in the caller's order; the caller cleans). Three at a time; two that cancel
 * (Hush and Nosy Neighbours) never share a descent, the new one takes the old one's place and the note says so.
 */
export function toggleComplication(chosen: readonly MutatorId[], id: MutatorId): ComplicationToggle {
  if (chosen.includes(id)) return { chosen: chosen.filter((c) => c !== id), refused: false, note: '' };
  if (chosen.length >= MAX_MUTATORS) return { chosen: [...chosen], refused: true, note: `${MAX_MUTATORS} at a time. Put one back to take another.` };
  const displaced = chosen.find((c) => conflictsWith(c, id));
  if (displaced) {
    return {
      chosen: [...chosen.filter((c) => c !== displaced), id],
      refused: false,
      note: `${MUTATOR_DEFS[id].name} takes the place of ${MUTATOR_DEFS[displaced].name}: the two cancel out.`,
    };
  }
  return { chosen: [...chosen, id], refused: false, note: '' };
}

/** The Complications row's value on the loadout page. */
export function complicationsValue(chosen: readonly MutatorId[]): string {
  return chosen.length === 0 ? 'None' : `${chosen.length} in force`;
}

/** The card for the Complications row: what is in force, or what the page is for. */
export function complicationsDetail(chosen: readonly MutatorId[]): DetailSpec {
  if (chosen.length === 0) {
    return { eyebrow: 'Complications', heading: 'The Works as issued', body: COMPLICATIONS_LEAD, icon: { kind: 'text', text: '±' } };
  }
  return {
    eyebrow: 'Complications',
    heading: mutatorNames(chosen),
    body: complicationsTotal(chosen),
    lines: chosen.map((id) => ({ label: loadMark(MUTATOR_DEFS[id].weight), name: MUTATOR_DEFS[id].name, text: MUTATOR_DEFS[id].regulation })),
    icon: { kind: 'text', text: '±' },
  };
}

/** "None in force. The Works as issued." / "2 in force: +2 pressure. A win counts toward the next tier." */
export function complicationsTotal(chosen: readonly MutatorId[]): string {
  if (chosen.length === 0) return 'None in force. The Works as issued.';
  return `${chosen.length} in force: ${mutatorLoadText(chosen)}. ${
    mutatorsCountForLadder(chosen) ? 'A win counts toward the next tier.' : 'A win under these will not open a harder tier.'
  }`;
}

/** The card for one complication on its page; a full set says why the others refuse. */
export function complicationDetail(id: MutatorId, chosen: readonly MutatorId[]): DetailSpec {
  const def = MUTATOR_DEFS[id];
  const full = !chosen.includes(id) && chosen.length >= MAX_MUTATORS;
  const ladder = def.ladder ? '' : ' A win under it will not open a harder tier.';
  return {
    eyebrow: `Complication · ${loadMark(def.weight)}`,
    heading: def.name,
    body: `${def.regulation}${ladder}${full ? ` Full: ${MAX_MUTATORS} at a time. Put one back to take this.` : ''}`,
    icon: { kind: 'text', text: loadMark(def.weight) },
    locked: full,
  };
}

export const SEED_NOTE = 'Same seed, same case, same Works. The ledger and share line print it for a friend. Leave it random for a fresh descent.';

export function seedValue(chosen: { seed: number } | null): string {
  return chosen ? String(chosen.seed >>> 0) : 'Random';
}

export function seedDetail(chosen: { seed: number; phrase: boolean } | null): DetailSpec {
  return {
    eyebrow: 'Seed',
    heading: chosen ? `Seed ${chosen.seed >>> 0}` : 'A random descent',
    body: SEED_NOTE,
    icon: { kind: 'text', text: '#' },
  };
}

export interface KeyHint { keys: readonly string[]; label: string }

/** The footer's key legend for the page and the item in focus. */
export function keyHints(kind: ItemKind | null, depth: number, pad: boolean): KeyHint[] {
  const move: KeyHint = pad ? { keys: ['D-pad'], label: 'Select' } : { keys: ['↑', '↓'], label: 'Select' };
  const change: KeyHint = pad ? { keys: ['◂', '▸'], label: 'Change' } : { keys: ['←', '→'], label: 'Change' };
  const confirm: KeyHint = { keys: [pad ? 'A' : 'Enter'], label: kind === 'drill' || kind === 'choice' ? 'Open' : kind === 'toggle' ? 'Toggle' : 'Confirm' };
  const hints = [move];
  if (kind === 'choice') hints.push(change);
  hints.push(confirm);
  if (depth > 0) hints.push({ keys: [pad ? 'B' : 'Esc'], label: 'Back' });
  return hints;
}

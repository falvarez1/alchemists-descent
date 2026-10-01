import type { Difficulty } from '@/core/types';
import type { KitId } from '@/core/run';
import { KIT_DEFS, KIT_ORDER } from '@/content/kits';
import { FIGHTER_DEFS, FIGHTER_ORDER, fighterPortraitUrl, type FighterId } from '@/content/fighters';
import { DIFFICULTY, DIFFICULTY_ORDER } from '@/config/difficulty';
import { DIFFICULTY_BLURBS, difficultyUnlockHint, isDifficultyOpen } from '@/config/difficultyLadder';
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
 * back: leaves the page.
 */
export type ItemKind = 'action' | 'drill' | 'choice' | 'option' | 'back';

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
}

/** The daily's two lines: the short one under its name, and the full sentence for the hint line. */
export function dailyLines(daily: DailyFacts, floorsTotal: number, time: (ms: number) => string): { sub: string; hint: string } {
  const best = daily.best
    ? daily.best.victory ? `Best: the Kiln quieted in ${time(daily.best.timeMs)}` : `Best: Floor ${daily.best.floor} of ${floorsTotal} in ${time(daily.best.timeMs)}`
    : '';
  return {
    sub: best || daily.today,
    hint: `${daily.today} · one seed for everyone · the Alchemist with the Sparkwright’s case, on Adept`,
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
  const confirm: KeyHint = { keys: [pad ? 'A' : 'Enter'], label: kind === 'drill' || kind === 'choice' ? 'Open' : 'Confirm' };
  const hints = [move];
  if (kind === 'choice') hints.push(change);
  hints.push(confirm);
  if (depth > 0) hints.push({ keys: [pad ? 'B' : 'Esc'], label: 'Back' });
  return hints;
}

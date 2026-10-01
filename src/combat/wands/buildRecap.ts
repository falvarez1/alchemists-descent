import type { CardId, WandFrame } from '@/core/types';
import { buildWandSentenceView } from './sentenceView';

/**
 * The build, as sentences a player can read back (the Sanctum, the pause menu, the ledger, the share line).
 * The bench's own sentence view does the compiling and the naming — "Frost-Charged Spark Bolt",
 * "2 casts: Spark Bolt + Cast Bomb" — this only trims its "Next:/Then:" labels and joins them.
 */

export interface RecapWand {
  frame: Pick<WandFrame, 'name' | 'capacity'>;
  cards: ReadonlyArray<CardId | null>;
}

export interface WandRecapRow {
  numeral: 'I' | 'II';
  frameName: string;
  capacity: number;
  /** The cast groups, each as the bench says it ("Frost-Charged Spark Bolt"); empty when nothing is castable. */
  groups: string[];
  /** "Frost-Charged Spark Bolt, then Heavy Cast Bomb" — or why there is nothing to say. */
  sentence: string;
}

const strip = (label: string): string => label.replace(/^(Next|Then): /, '');

/** Cast groups of one wand, in the order the cycle runs them, as phrases. */
export function wandGroups(cards: ReadonlyArray<CardId | null>): string[] {
  const view = buildWandSentenceView([...cards], 0);
  // An empty program says so in its own words; that is not a group.
  if (view.lines.length === 1 && view.lines[0].manaCost === 0 && view.lines[0].slots.length === 0) return [];
  return view.lines.map((line) => strip(line.label));
}

function joinGroups(groups: readonly string[], max: number): string {
  if (groups.length === 0) return 'Nothing castable yet';
  const shown = groups.slice(0, max);
  const more = groups.length - shown.length;
  return shown.join(', then ') + (more > 0 ? `, then ${more} more` : '');
}

export function recapRows(wands: readonly RecapWand[]): WandRecapRow[] {
  return wands.map((wand, i) => {
    const groups = wandGroups(wand.cards);
    return {
      numeral: i === 0 ? 'I' : 'II',
      frameName: wand.frame.name,
      capacity: wand.frame.capacity,
      groups,
      sentence: joinGroups(groups, 3),
    };
  });
}

const cap = (text: string, n: number): string => (text.length <= n ? text : text.slice(0, Math.max(1, n - 1)).trimEnd() + '…');

/**
 * The one-line build for the ledger and the share line: each wand's opening cast, joined —
 * "Frost-Charged Spark Bolt & Excavate Ray". Empty when neither wand can cast.
 */
export function buildLine(wands: readonly RecapWand[]): string {
  const firsts = wands.map((wand) => wandGroups(wand.cards)[0]).filter((g): g is string => typeof g === 'string' && g !== '');
  if (firsts.length === 0) return '';
  // Two identical openers are one build, not a stutter.
  const unique = firsts.filter((g, i) => firsts.indexOf(g) === i);
  return unique.map((g) => cap(g, 44)).join(' & ');
}

import type { Difficulty } from '@/core/types';
import { DEFAULT_DIFFICULTY, DIFFICULTY, DIFFICULTY_ORDER, asDifficulty } from '@/config/difficulty';

/**
 * THE LADDER — how a player climbs the four difficulty tiers (config/difficulty
 * owns what each tier does to the balance; this owns who may pick which).
 *
 * A descent is Adept (II) unless the player says otherwise. Apprentice (I) is
 * always open — an easier road is never a reward to be earned. Every tier above
 * Adept opens when the Kiln is quieted on the tier below it or harder: a win on
 * Adept opens Conjurer, a win on Conjurer opens Archmage. The daily descent is
 * always Adept, because it is one seed for everyone.
 *
 * `bestVictory` is the hardest tier the player has quieted the Kiln on (0 = never).
 */

/** The tier a descent runs at unless the player chose another (and the daily's, always). */
export const BASE_DIFFICULTY: Difficulty = DEFAULT_DIFFICULTY;

/** The hardest tier a player may pick, given the hardest they have won on. */
export function unlockedDifficulty(bestVictory: number): Difficulty {
  const won = Number.isFinite(bestVictory) ? Math.max(0, Math.floor(bestVictory)) : 0;
  return asDifficulty(Math.min(4, Math.max(BASE_DIFFICULTY, won + 1)), BASE_DIFFICULTY);
}

export function isDifficultyOpen(difficulty: Difficulty, bestVictory: number): boolean {
  return difficulty <= unlockedDifficulty(bestVictory);
}

/** `wanted` if it is open to this player, else the base tier. */
export function openDifficulty(wanted: unknown, bestVictory: number): Difficulty {
  const tier = asDifficulty(wanted, BASE_DIFFICULTY);
  return isDifficultyOpen(tier, bestVictory) ? tier : BASE_DIFFICULTY;
}

/** The tier a victory on `difficulty` newly opens for a player whose best was `previousBest`, or null. */
export function tierOpenedByVictory(previousBest: number, difficulty: Difficulty): Difficulty | null {
  const before = unlockedDifficulty(previousBest);
  const after = unlockedDifficulty(Math.max(previousBest, difficulty));
  return after > before ? after : null;
}

/** The hardest tier won on, after one more victory on `difficulty`. */
export function bestVictoryAfter(previousBest: number, difficulty: Difficulty): number {
  const before = Number.isFinite(previousBest) ? Math.max(0, Math.floor(previousBest)) : 0;
  return Math.max(before, difficulty);
}

/** How a locked tier is earned, for its chip: 'Quiet the Kiln on Adept or harder.' */
export function difficultyUnlockHint(difficulty: Difficulty): string {
  if (difficulty <= BASE_DIFFICULTY) return '';
  const needed = DIFFICULTY[(difficulty - 1) as Difficulty];
  return `Quiet the Kiln on ${needed.name} or harder.`;
}

/**
 * One line under the picker for each tier, in the house voice. Short on purpose:
 * on the title screen the whole line shares a row of a 720p window with the rest
 * of the column, and `tests/difficulty-ladder` holds it to one row.
 */
export const DIFFICULTY_BLURBS: Record<Difficulty, string> = {
  1: 'Gentler creatures, a sturdier alchemist.',
  2: 'The Works as intended.',
  3: 'Full crowds, full teeth. Guild regulation.',
  4: 'Crueller and faster. The Guild is not liable.',
};

export { DIFFICULTY_ORDER };

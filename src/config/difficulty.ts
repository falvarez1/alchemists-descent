import type { Difficulty } from '@/core/types';

/**
 * Difficulty tuning. Every field is a MULTIPLIER on the shipped balance except
 * `deathPenalty`, which is the absolute fraction of gold lost on death. The user
 * classed the shipped game as a "3 of 4", so **Level 3 = 1.0 across the board
 * (today's game, unchanged)**; 1–2 ease off, 4 turns the screws. Read in the hot
 * paths (enemy spawn/AI, player death) via DIFFICULTY[ctx.state.difficulty].
 */
export interface DifficultyMods {
  /** Display name + roman numeral for the Start Run menu. */
  name: string;
  roman: string;
  /** Foes spawned per level. */
  enemyCount: number;
  /** Enemy contact/attack damage (folded into each enemy's dmgK at spawn). */
  enemyDamage: number;
  /** Enemy HP (folded into hpMul at spawn). */
  enemyHp: number;
  /** Enemy movement speed (scales the velocity integration step). */
  enemySpeed: number;
  /** How far a foe can clock you (scales the alert/notice range). */
  enemySense: number;
  /** Player max HP (and starting HP). */
  playerHp: number;
  /** Fraction of purse lost on death (3 = the shipped 0.15). */
  deathPenalty: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyMods> = {
  1: { name: 'Apprentice', roman: 'I', enemyCount: 0.45, enemyDamage: 0.6, enemyHp: 0.8, enemySpeed: 0.8, enemySense: 0.65, playerHp: 1.25, deathPenalty: 0.08 },
  2: { name: 'Adept', roman: 'II', enemyCount: 0.7, enemyDamage: 0.8, enemyHp: 0.9, enemySpeed: 0.9, enemySense: 0.82, playerHp: 1.1, deathPenalty: 0.12 },
  3: { name: 'Conjurer', roman: 'III', enemyCount: 1.0, enemyDamage: 1.0, enemyHp: 1.0, enemySpeed: 1.0, enemySense: 1.0, playerHp: 1.0, deathPenalty: 0.15 },
  4: { name: 'Archmage', roman: 'IV', enemyCount: 1.35, enemyDamage: 1.25, enemyHp: 1.15, enemySpeed: 1.12, enemySense: 1.22, playerHp: 0.85, deathPenalty: 0.2 },
};

/** The active run's difficulty mods, defaulting to the shipped balance (3) for
 *  any state that hasn't picked one (test harnesses, legacy saves). */
export function difficultyMods(state: { difficulty?: Difficulty }): DifficultyMods {
  return DIFFICULTY[state.difficulty ?? 3] ?? DIFFICULTY[3];
}

/** Menu default (the user found "3" too hard, so open on the gentler Adept). */
export const DEFAULT_DIFFICULTY: Difficulty = 2;

export const DIFFICULTY_ORDER: Difficulty[] = [1, 2, 3, 4];

export function isDifficulty(v: unknown): v is Difficulty {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

/** Resolve any value (e.g. from a save or menu) to a valid difficulty level. */
export function asDifficulty(v: unknown, fallback: Difficulty = 3): Difficulty {
  const n = typeof v === 'string' ? Number(v) : v;
  return isDifficulty(n) ? n : fallback;
}

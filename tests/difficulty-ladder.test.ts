import { describe, expect, it } from 'vitest';
import {
  BASE_DIFFICULTY,
  DIFFICULTY_BLURBS,
  DIFFICULTY_ORDER,
  bestVictoryAfter,
  difficultyUnlockHint,
  isDifficultyOpen,
  openDifficulty,
  tierOpenedByVictory,
  unlockedDifficulty,
} from '@/config/difficultyLadder';
import { DIFFICULTY } from '@/config/difficulty';

describe('the difficulty ladder', () => {
  it('opens on Adept, with the easier road never locked', () => {
    expect(BASE_DIFFICULTY).toBe(2);
    expect(unlockedDifficulty(0)).toBe(2);
    expect(isDifficultyOpen(1, 0)).toBe(true);
    expect(isDifficultyOpen(2, 0)).toBe(true);
    expect(isDifficultyOpen(3, 0)).toBe(false);
    expect(isDifficultyOpen(4, 0)).toBe(false);
  });

  it('a win opens the tier above the one it was won on', () => {
    // A win on Apprentice earns nothing above Adept: the easier road is not a route to the harder.
    expect(unlockedDifficulty(1)).toBe(2);
    expect(unlockedDifficulty(2)).toBe(3);
    expect(unlockedDifficulty(3)).toBe(4);
    expect(unlockedDifficulty(4)).toBe(4);
    expect(isDifficultyOpen(3, 2)).toBe(true);
    expect(isDifficultyOpen(4, 2)).toBe(false);
    expect(isDifficultyOpen(4, 3)).toBe(true);
  });

  it('reads garbage as nothing won', () => {
    expect(unlockedDifficulty(Number.NaN)).toBe(2);
    expect(unlockedDifficulty(-5)).toBe(2);
    expect(unlockedDifficulty(99)).toBe(4);
  });

  it('holds a chosen tier only while it is open, else falls back to Adept', () => {
    expect(openDifficulty(1, 0)).toBe(1);
    expect(openDifficulty(4, 0)).toBe(2);
    expect(openDifficulty(4, 3)).toBe(4);
    expect(openDifficulty('3', 2)).toBe(3);
    expect(openDifficulty('nonsense', 4)).toBe(2);
    expect(openDifficulty(undefined, 4)).toBe(2);
  });

  it('reports the tier a victory newly opens, once', () => {
    expect(tierOpenedByVictory(0, 2)).toBe(3);
    expect(tierOpenedByVictory(0, 3)).toBe(4);
    expect(tierOpenedByVictory(0, 4)).toBe(4);
    expect(tierOpenedByVictory(0, 1)).toBeNull();
    expect(tierOpenedByVictory(2, 2)).toBeNull();
    expect(tierOpenedByVictory(2, 3)).toBe(4);
    expect(tierOpenedByVictory(3, 4)).toBeNull();
    expect(tierOpenedByVictory(4, 4)).toBeNull();
  });

  it('keeps the hardest tier won on', () => {
    expect(bestVictoryAfter(0, 2)).toBe(2);
    expect(bestVictoryAfter(3, 1)).toBe(3);
    expect(bestVictoryAfter(2, 4)).toBe(4);
    expect(bestVictoryAfter(Number.NaN, 1)).toBe(1);
  });

  it('says how each locked tier is earned, in the tiers’ own names', () => {
    expect(difficultyUnlockHint(1)).toBe('');
    expect(difficultyUnlockHint(2)).toBe('');
    expect(difficultyUnlockHint(3)).toBe(`Quiet the Kiln on ${DIFFICULTY[2].name} or harder.`);
    expect(difficultyUnlockHint(4)).toBe(`Quiet the Kiln on ${DIFFICULTY[3].name} or harder.`);
  });

  it('has a line for every tier, and the tiers still run easy to hard', () => {
    // One row of the title screen's column (~60 characters at the note's size, with the tier's name before it).
    for (const tier of DIFFICULTY_ORDER) {
      expect(DIFFICULTY_BLURBS[tier].length, String(tier)).toBeGreaterThan(15);
      expect(DIFFICULTY_BLURBS[tier].length + DIFFICULTY[tier].name.length, String(tier)).toBeLessThanOrEqual(58);
    }
    for (let i = 1; i < DIFFICULTY_ORDER.length; i++) {
      const easier = DIFFICULTY[DIFFICULTY_ORDER[i - 1]];
      const harder = DIFFICULTY[DIFFICULTY_ORDER[i]];
      expect(harder.enemyDamage).toBeGreaterThan(easier.enemyDamage);
      expect(harder.enemyCount).toBeGreaterThan(easier.enemyCount);
      expect(harder.playerHp).toBeLessThan(easier.playerHp);
    }
  });
});

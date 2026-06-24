import { describe, expect, it } from 'vitest';

import {
  INTRO_OBJECTIVE,
  INTRO_PRE_KEY_OBJECTIVES,
  INTRO_REWARD_CARD,
  introControlHintForObjective,
} from '@/game/introObjectives';
import { ALL_CARD_IDS } from '@/combat/wands/cards';

/**
 * The D1 onboarding objective strings are a producer/consumer contract:
 * IntroProgression emits them, the HUD passes them through and decorates them
 * with control hints. These tests lock the contract so a stale string on either
 * side fails loudly instead of silently collapsing to FIND THE GOLDEN KEY.
 */
describe('intro objective contract', () => {
  it('points the gate card at a real card id', () => {
    expect(ALL_CARD_IDS).toContain(INTRO_REWARD_CARD);
  });

  it('gives every pre-key objective a non-empty control hint', () => {
    for (const objective of INTRO_PRE_KEY_OBJECTIVES) {
      const hint = introControlHintForObjective(objective);
      expect(hint, objective).not.toBeNull();
      expect(hint!.length, objective).toBeGreaterThan(0);
    }
  });

  it('keeps every staged onboarding line in the pre-key passthrough set', () => {
    const staged = [
      INTRO_OBJECTIVE.surface,
      INTRO_OBJECTIVE.movement,
      INTRO_OBJECTIVE.spark,
      INTRO_OBJECTIVE.dig,
      INTRO_OBJECTIVE.flask,
      INTRO_OBJECTIVE.spellLab,
      INTRO_OBJECTIVE.labDig,
      INTRO_OBJECTIVE.labWater,
      INTRO_OBJECTIVE.labSpark,
      INTRO_OBJECTIVE.labTome,
      INTRO_OBJECTIVE.bench,
    ];
    for (const objective of staged) {
      expect(INTRO_PRE_KEY_OBJECTIVES.has(objective), objective).toBe(true);
    }
  });

  it('keeps post-key lines out of the pre-key passthrough', () => {
    expect(INTRO_PRE_KEY_OBJECTIVES.has(INTRO_OBJECTIVE.findKey)).toBe(false);
    expect(INTRO_PRE_KEY_OBJECTIVES.has(INTRO_OBJECTIVE.returnPortal)).toBe(false);
    expect(introControlHintForObjective(INTRO_OBJECTIVE.findKey)).toBeNull();
  });

  it('returns independent hint copies (no shared mutable arrays)', () => {
    const a = introControlHintForObjective(INTRO_OBJECTIVE.movement)!;
    const b = introControlHintForObjective(INTRO_OBJECTIVE.movement)!;
    expect(a).not.toBe(b);
    a[0].key = 'MUTATED';
    expect(b[0].key).not.toBe('MUTATED');
  });
});

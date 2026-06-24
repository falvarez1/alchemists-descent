import { describe, expect, it } from 'vitest';

import { ENEMY_KINDS } from '@/core/types';
import { ENEMY_ENTITY_PROFILES, PLAYER_ENTITY_PROFILE, type EntityTraitProfile } from '@/content/entityProfiles';

const TRAIT_KEYS = ['behaviors', 'emotions', 'strengths', 'weaknesses'] as const;

function expectCompleteTraits(traits: EntityTraitProfile): void {
  for (const key of TRAIT_KEYS) {
    expect(traits[key].length, key).toBeGreaterThanOrEqual(1);
    for (const value of traits[key]) expect(value.trim().length, key).toBeGreaterThan(0);
  }
}

describe('entityProfiles', () => {
  it('keeps one complete profile for every Builder Gallery entity', () => {
    expect(PLAYER_ENTITY_PROFILE.description.trim().length).toBeGreaterThan(0);
    expectCompleteTraits(PLAYER_ENTITY_PROFILE.traits);

    expect(Object.keys(ENEMY_ENTITY_PROFILES).sort()).toEqual([...ENEMY_KINDS].sort());
    for (const kind of ENEMY_KINDS) {
      const profile = ENEMY_ENTITY_PROFILES[kind];
      expect(profile.description.trim().length, kind).toBeGreaterThan(0);
      expectCompleteTraits(profile.traits);
    }
  });
});

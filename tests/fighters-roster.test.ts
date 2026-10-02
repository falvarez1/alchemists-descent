import { describe, expect, it } from 'vitest';

import { FIGHTER_DEFS, FIGHTER_ORDER, FIGHTER_ROLES, isFighterId } from '@/content/fighters';
import type { FighterId } from '@/content/fighters';
import { kitFor, kitIds } from '@/fighters/kits';
import { lookFor, lookIds } from '@/render/player/looks';
import { ABILITY_ICON_KEYS, abilityIcon } from '@/ui/fighterIcons';

/**
 * The roster is whole or it is not shipped: every one of the ten has an identity, a kit, a look and its three
 * icons, and the three agree on who they are. (A fighter that equipped without a kit would be a hero with no
 * verbs; one without a look would wear the alchemist's coat.)
 */

describe('the ten fighters', () => {
  it('are ten, in a fixed order, across the five roles', () => {
    expect(FIGHTER_ORDER).toHaveLength(10);
    expect(new Set(FIGHTER_ORDER).size).toBe(10);
    expect(Object.keys(FIGHTER_DEFS).sort()).toEqual([...FIGHTER_ORDER].sort());
    expect(new Set(FIGHTER_ORDER.map((id) => FIGHTER_DEFS[id].role))).toEqual(new Set(FIGHTER_ROLES));
    FIGHTER_ORDER.forEach((id, i) => expect(FIGHTER_DEFS[id].number).toBe(i + 1));
    expect(isFighterId('ilyra-voss')).toBe(true);
    expect(isFighterId('alchemist')).toBe(false);
  });

  it('each have a kit module, and no stray kit files', () => {
    expect(kitIds().sort()).toEqual([...FIGHTER_ORDER].sort());
  });

  it('each kit loads, names its own fighter, and has real cooldowns', async () => {
    for (const id of FIGHTER_ORDER) {
      const def = await kitFor(id);
      expect(def, id).toBeDefined();
      expect(def!.id).toBe(id);
      expect(def!.tacticalCooldown, `${id} tactical cooldown`).toBeGreaterThanOrEqual(60);
      expect(def!.tacticalCooldown, `${id} tactical cooldown`).toBeLessThanOrEqual(60 * 30);
      expect(def!.ultimateDuration, `${id} ultimate duration`).toBeGreaterThanOrEqual(0);
      expect(typeof def!.create).toBe('function');
    }
  });

  it('each have a look, drawn for its own id and recoloured (no one wears the alchemist\'s palette)', () => {
    expect(lookIds().sort()).toEqual([...FIGHTER_ORDER].sort());
    const coats = new Set<string>();
    for (const id of FIGHTER_ORDER) {
      const look = lookFor(id as FighterId);
      expect(look, id).toBeDefined();
      expect(look!.id).toBe(id);
      expect(look!.mats.length).toBeGreaterThanOrEqual(21);
      coats.add(JSON.stringify(look!.mats[0]?.ramp));
    }
    expect(coats.size).toBe(10); // ten different coats
  });

  it('each have all three ability icons', () => {
    expect(ABILITY_ICON_KEYS).toHaveLength(30);
    for (const id of FIGHTER_ORDER) for (const slot of ['passive', 'tactical', 'ultimate'] as const) {
      expect(abilityIcon(id, slot), `${id}.${slot}`).toMatch(/^<svg/);
    }
  });
});

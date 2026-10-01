import { describe, expect, it } from 'vitest';

import { DIFFICULTY, difficultyMods } from '@/config/difficulty';
import {
  DAILY_ERAS,
  MAX_MUTATORS,
  MUTATOR_DEFS,
  MUTATOR_ORDER,
  NEUTRAL_MODS,
  cleanMutators,
  composeMutatorMods,
  dailyMutators,
  dayNumber,
  isMutatorId,
  mutatorDef,
  mutatorLoad,
  mutatorLoadText,
  mutatorNames,
  mutatorTag,
  mutatorMods,
  mutatorsCountForLadder,
  type DailyEra,
} from '@/content/mutators';

/**
 * The complication registry (content/mutators): its integrity, the arithmetic that folds it into the
 * game's dials, and the daily table's append-only rule.
 */
describe('the registry', () => {
  it('lists every definition once, in a canonical order, each under its own id', () => {
    expect([...MUTATOR_ORDER].sort()).toEqual(Object.keys(MUTATOR_DEFS).sort());
    expect(new Set(MUTATOR_ORDER).size).toBe(MUTATOR_ORDER.length);
    for (const id of MUTATOR_ORDER) expect(MUTATOR_DEFS[id].id).toBe(id);
  });

  it('gives every complication a name, a regulation, and a coherent weight and ladder flag', () => {
    const names = new Set<string>();
    for (const id of MUTATOR_ORDER) {
      const def = MUTATOR_DEFS[id];
      expect(def.name.trim().length).toBeGreaterThan(2);
      expect(names.has(def.name)).toBe(false);
      names.add(def.name);
      // One line, instruction first: a sentence long enough to say something, short enough for a chip tooltip.
      expect(def.regulation.length).toBeGreaterThan(30);
      expect(def.regulation.length).toBeLessThan(150);
      expect(def.regulation.endsWith('.')).toBe(true);
      // An easing complication never opens a tier; a neutral or harder one may. (The two flags may not disagree.)
      expect(def.ladder).toBe(def.weight >= 0);
      // It must DO something: a dial, a dressing, or a fireworks hook.
      const acts = Object.keys(def.mods ?? {}).length > 0 || (def.dressing?.length ?? 0) > 0 || ('fireworks' in def && def.fireworks === true);
      expect(acts).toBe(true);
    }
  });

  it('keeps every multiplier finite, positive, and a known dial', () => {
    for (const id of MUTATOR_ORDER) {
      const mods: Record<string, number> = { ...(mutatorDef(id)?.mods ?? {}) };
      for (const [key, value] of Object.entries(mods)) {
        expect(key in NEUTRAL_MODS).toBe(true);
        expect(Number.isFinite(value) && value > 0).toBe(true);
      }
    }
  });

  it('knows an id only if it is in the registry (never a prototype key)', () => {
    expect(isMutatorId('wet-floors')).toBe(true);
    for (const bad of ['constructor', 'toString', '__proto__', 'Wet Floors', '', 7, null, undefined]) expect(isMutatorId(bad)).toBe(false);
    expect(mutatorDef('nonsense')).toBeNull();
  });
});

describe('cleaning a selection', () => {
  it('keeps known ids once each, in the canonical order, at most the maximum', () => {
    expect(cleanMutators(['low-gravity', 'wet-floors', 'wet-floors', 'nonsense', 4])).toEqual(['wet-floors', 'low-gravity']);
    expect(cleanMutators(['hush', 'famine', 'dark-works', 'fireworks'])).toHaveLength(MAX_MUTATORS);
    expect(cleanMutators(['hush', 'famine', 'dark-works', 'fireworks'])).toEqual(['dark-works', 'famine', 'fireworks']);
    expect(cleanMutators(undefined)).toEqual([]);
    expect(cleanMutators('wet-floors' as unknown as string[])).toEqual([]);
    expect(cleanMutators(['wet-floors', 'tinderbox'], 1)).toEqual(['wet-floors']);
  });

  it('names a selection the way the ledger and the share line print it', () => {
    expect(mutatorNames([])).toBe('');
    expect(mutatorNames(['wet-floors'])).toBe('Wet Floors');
    expect(mutatorNames(['low-gravity', 'wet-floors'])).toBe('Wet Floors and Low Gravity');
    expect(mutatorNames(['famine', 'wet-floors', 'hush'])).toBe('Wet Floors, Short Rations and Hush');
    expect(mutatorTag(['low-gravity', 'wet-floors'])).toBe('Wet Floors + Low Gravity');
    expect(mutatorTag([])).toBe('');
  });

  it('totals the load, and says it in words', () => {
    expect(mutatorLoad([])).toBe(0);
    expect(mutatorLoad(['tinderbox', 'gas-leak'])).toBe(2);
    expect(mutatorLoad(['tinderbox', 'low-gravity'])).toBe(0);
    expect(mutatorLoadText([])).toBe('');
    expect(mutatorLoadText(['tinderbox', 'gas-leak'])).toBe('+2 pressure');
    expect(mutatorLoadText(['hush'])).toBe('1 easier');
    expect(mutatorLoadText(['wet-floors'])).toBe('an even trade');
  });
});

describe('the ladder flag', () => {
  it('lets a victory count unless some complication eases the descent', () => {
    expect(mutatorsCountForLadder([])).toBe(true);
    expect(mutatorsCountForLadder(undefined)).toBe(true);
    expect(mutatorsCountForLadder(['tinderbox', 'glass-cannon'])).toBe(true);
    expect(mutatorsCountForLadder(['low-gravity'])).toBe(false);
    expect(mutatorsCountForLadder(['tinderbox', 'hush'])).toBe(false);
  });
});

describe('the dials', () => {
  it('leaves an ordinary run exactly as it was: the tier object itself, and neutral extras', () => {
    for (const tier of [1, 2, 3, 4] as const) {
      expect(difficultyMods({ difficulty: tier })).toBe(DIFFICULTY[tier]);
      expect(difficultyMods({ difficulty: tier, mutators: [] })).toBe(DIFFICULTY[tier]);
    }
    expect(difficultyMods({})).toBe(DIFFICULTY[3]);
    expect(mutatorMods({})).toBe(NEUTRAL_MODS);
    expect(mutatorMods({ mutators: [] })).toBe(NEUTRAL_MODS);
    expect(mutatorMods(null)).toBe(NEUTRAL_MODS);
    // The gravity dial's default is exactly today's: x1, so 0.28 * 1 is 0.28 to the last bit.
    expect(NEUTRAL_MODS.gravity).toBe(1);
    expect(0.28 * NEUTRAL_MODS.gravity).toBe(0.28);
    expect(0.12 * NEUTRAL_MODS.gravity).toBe(0.12);
  });

  it('folds a complication into the tier it rides on, and leaves the tier alone', () => {
    const mods = difficultyMods({ difficulty: 3, mutators: ['crowded-house'] });
    expect(mods.enemyCount).toBeCloseTo(1.5);
    expect(mods.enemyHp).toBe(DIFFICULTY[3].enemyHp);
    expect(mods.name).toBe('Conjurer');
    expect(DIFFICULTY[3].enemyCount).toBe(1);
    // Layered over a harder tier it multiplies, it does not replace.
    expect(difficultyMods({ difficulty: 4, mutators: ['crowded-house'] }).enemyCount).toBeCloseTo(1.35 * 1.5);
    expect(difficultyMods({ difficulty: 2, mutators: ['glass-cannon'] }).playerHp).toBeCloseTo(1.1 * 0.5);
    expect(difficultyMods({ difficulty: 3, mutators: ['hush'] }).enemySense).toBeCloseTo(0.5);
  });

  it('composes several complications by multiplying, and hands back the same object each time', () => {
    const ids = ['tinderbox', 'wet-floors'];
    const m = composeMutatorMods(ids);
    expect(m.flammability).toBeCloseTo(2.4 * 0.55);
    expect(composeMutatorMods(ids)).toBe(m);
    const state = { difficulty: 3 as const, mutators: ['crowded-house', 'hush'] };
    expect(difficultyMods(state)).toBe(difficultyMods(state));
    expect(difficultyMods(state).enemyCount).toBeCloseTo(1.5);
    expect(difficultyMods(state).enemySense).toBeCloseTo(0.5);
    expect(composeMutatorMods(['crowded-house']).gold).toBeCloseTo(1.4);
  });

  it('puts Glass Cannon outside the wand compiler: a separate multiplier on blows, not on the compiled damage', () => {
    expect(mutatorMods({ mutators: ['glass-cannon'] }).playerDamage).toBeCloseTo(1.5);
    expect(mutatorMods({ mutators: ['glass-cannon'] }).playerHp).toBeCloseTo(0.5);
    expect(mutatorMods({ mutators: ['low-gravity'] }).gravity).toBeLessThan(1);
    expect(mutatorMods({ mutators: ['famine'] }).healing).toBeCloseTo(0.5);
    expect(mutatorMods({ mutators: ['dark-works'] }).ambient).toBeLessThan(1);
  });

  it('Dark Works raises the designed-darkness floor, which composes by max and is 0 (not 1) when untouched', () => {
    expect(NEUTRAL_MODS.darkness).toBe(0);
    expect(mutatorMods({ mutators: ['dark-works'] }).darkness).toBeGreaterThan(0.5);
    expect(mutatorMods({ mutators: ['tinderbox', 'wet-floors'] }).darkness).toBe(0);
    // Two floors of darkness would not stack to black: the deeper one stands.
    const deeper = composeMutatorMods(['dark-works', 'dark-works']);
    expect(deeper.darkness).toBe(mutatorMods({ mutators: ['dark-works'] }).darkness);
  });
});

describe('the daily table', () => {
  it('reads dates as day numbers, and refuses anything else', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('2026-10-01')! - dayNumber('2026-09-30')!).toBe(1);
    for (const bad of ['', '2026-1-1', 'today', '2026-10-01T00:00']) expect(dayNumber(bad)).toBeNull();
  });

  it('gives a date before the first era no complications, and the first era its rotation in order', () => {
    const era = DAILY_ERAS[0];
    expect(dailyMutators('2026-09-30')).toEqual([]);
    expect(dailyMutators('2000-01-01')).toEqual([]);
    expect(dailyMutators(era.from)).toEqual(cleanMutators(era.rotation[0]));
    const start = dayNumber(era.from)!;
    for (let k = 0; k < era.rotation.length * 2 + 3; k++) {
      const date = new Date((start + k) * 86_400_000).toISOString().slice(0, 10);
      expect(dailyMutators(date)).toEqual(cleanMutators(era.rotation[k % era.rotation.length]));
    }
  });

  it('is a pure function of the date, and a malformed date is nothing', () => {
    expect(dailyMutators('2026-10-05')).toEqual(dailyMutators('2026-10-05'));
    expect(dailyMutators('garbage')).toEqual([]);
  });

  it('only names real complications, one to three a day, with no repeats in a day', () => {
    for (const era of DAILY_ERAS) {
      expect(era.rotation.length).toBeGreaterThan(0);
      for (const entry of era.rotation) {
        expect(entry.length).toBeGreaterThanOrEqual(1);
        expect(entry.length).toBeLessThanOrEqual(MAX_MUTATORS);
        expect(new Set(entry).size).toBe(entry.length);
        expect(cleanMutators(entry)).toHaveLength(entry.length);
      }
    }
  });

  it('is append-only: a later era never changes what an earlier date was', () => {
    const first = DAILY_ERAS[0];
    const later: DailyEra = { from: '2027-03-01', rotation: [['hush'], ['famine'], ['fireworks']] };
    const eras = [first, later];
    // Every date before the new era reads exactly as it did without it...
    const start = dayNumber(first.from)!;
    for (let k = 0; k < 120; k++) {
      const date = new Date((start + k) * 86_400_000).toISOString().slice(0, 10);
      if (date >= later.from) continue;
      expect(dailyMutators(date, eras)).toEqual(dailyMutators(date, [first]));
    }
    // ...and the new era governs from its own date on, counting from that date.
    expect(dailyMutators('2027-03-01', eras)).toEqual(['hush']);
    expect(dailyMutators('2027-03-02', eras)).toEqual(['famine']);
    expect(dailyMutators('2027-03-04', eras)).toEqual(['hush']);
  });

  it('pins the shipped rotation: editing an entry would change a date that has already been played', () => {
    // If this fails you edited the table. Append a new era instead (see DAILY_ERAS).
    expect(DAILY_ERAS[0].from).toBe('2026-10-01');
    expect(DAILY_ERAS[0].rotation.slice(0, 3)).toEqual([['wet-floors'], ['tinderbox'], ['low-gravity', 'crowded-house']]);
    expect(DAILY_ERAS[0].rotation).toHaveLength(14);
    expect(dailyMutators('2026-10-01')).toEqual(['wet-floors']);
    expect(dailyMutators('2026-10-03')).toEqual(['low-gravity', 'crowded-house']);
  });
});

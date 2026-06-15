import { describe, expect, it } from 'vitest';

import { prepareLauncherPrefsForStorage, sanitizeLauncherPrefs } from '@/ui/RunLauncher';
import { Cell } from '@/sim/CellType';

describe('RunLauncher preference sanitizer', () => {
  it('drops invalid persisted launcher preference shapes', () => {
    expect(sanitizeLauncherPrefs(null)).toBeNull();
    expect(sanitizeLauncherPrefs({ mode: 'bogus' })).toBeNull();
    expect(sanitizeLauncherPrefs({ test: [] })).toBeNull();
  });

  it('keeps only known launcher options and clamps flask prefs', () => {
    const prefs = sanitizeLauncherPrefs({
      mode: 'test',
      normal: { seed: '12345' },
      test: {
        world: 'campaign-level',
        level: 'd3',
        seed: '9001',
        loadout: 'review',
        gold: '250',
        maxHp: '140',
        hp: '100',
        maxLevit: '125',
        flasks: [
          { material: Cell.Water, count: 700 },
          { material: 9999, count: 50 },
          { material: Cell.Empty, count: 50 },
          { material: Cell.Acid, count: 'abc' },
          { material: Cell.Gold, count: 12.8 },
        ],
        activeFlaskIndex: 99,
        cards: ['spark', 'bogus', 'spark', 'blackhole'],
        perks: ['might', 'bogus', 'torchbearer'],
        cardFilter: 'projectile',
        cardSearch: 'x'.repeat(100),
        kitTab: 'flask',
      },
    });

    expect(prefs).toMatchObject({
      mode: 'test',
      normal: { seed: '12345' },
      test: {
        world: 'campaign-level',
        level: 'd3',
        seed: '9001',
        loadout: 'review',
        gold: '250',
        maxHp: '140',
        hp: '100',
        maxLevit: '125',
        cards: ['spark', 'blackhole'],
        perks: ['might', 'torchbearer'],
        cardFilter: 'projectile',
        kitTab: 'flask',
      },
    });
    expect(prefs?.test?.activeFlaskIndex).toBeUndefined();
    expect(prefs?.test?.cardSearch).toHaveLength(80);
    expect(prefs?.test?.flasks).toEqual([
      { material: Cell.Water, count: 600 },
      { material: null, count: 0 },
      { material: null, count: 0 },
      { material: null, count: 0 },
    ]);
  });

  it('sanitizes the exact preference object before writing to storage', () => {
    const prefs = prepareLauncherPrefsForStorage(
      {
        normal: { seed: '42' },
        test: {
          cards: ['spark'],
          perks: ['might'],
        },
      },
      'test',
      '9'.repeat(200),
      {
        world: 'campaign-level',
        level: 'd2',
        seed: '8'.repeat(200),
        loadout: 'review',
        gold: '7'.repeat(200),
        maxHp: Number.POSITIVE_INFINITY as unknown as string,
        hp: 'abc',
        maxLevit: '120',
        flasks: Array.from({ length: 12 }, () => ({ material: Cell.Water, count: 999 })),
        activeFlaskIndex: 2,
        cards: ['spark', 'spark', 'bogus' as never, 'blackhole'],
        perks: ['might', 'bogus' as never, 'goldmagnet'],
        cardFilter: 'projectile',
        cardSearch: 'query'.repeat(40),
        kitTab: 'cards',
      },
    );

    expect(prefs).toMatchObject({
      mode: 'test',
      normal: { seed: '42' },
      test: {
        world: 'campaign-level',
        level: 'd2',
        seed: '8'.repeat(32),
        loadout: 'review',
        gold: '7'.repeat(32),
        maxLevit: '120',
        activeFlaskIndex: 2,
        cards: ['spark', 'blackhole'],
        perks: ['might', 'goldmagnet'],
        cardFilter: 'projectile',
        kitTab: 'cards',
      },
    });
    expect(prefs?.test?.maxHp).toBeUndefined();
    expect(prefs?.test?.hp).toBeUndefined();
    expect(prefs?.test?.cardSearch).toHaveLength(80);
    expect(prefs?.test?.flasks).toHaveLength(4);
    expect(JSON.stringify(prefs)).not.toContain('bogus');
  });

  it('does not keep invalid legacy flask material fields', () => {
    const invalid = sanitizeLauncherPrefs({
      mode: 'test',
      test: {
        flaskMaterial: '9999',
        flaskCount: '500',
      },
    });
    const valid = sanitizeLauncherPrefs({
      mode: 'test',
      test: {
        flaskMaterial: String(Cell.Water),
        flaskCount: '700',
      },
    });

    expect(invalid?.test?.flaskMaterial).toBeUndefined();
    expect(invalid?.test?.flaskCount).toBeUndefined();
    expect(valid?.test).toMatchObject({
      flaskMaterial: String(Cell.Water),
      flaskCount: '600',
    });
  });
});

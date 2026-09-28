import { describe, expect, it } from 'vitest';

import {
  META_KEY,
  META_VERSION,
  MetaProfileStore,
  defaultMetaProfile,
  earnedKits,
  migrateMetaProfile,
  parseMetaProfile,
  recordFloorReached,
  recordLeviathanSlain,
  recordRunEnded,
  recordRunStarted,
} from '@/game/MetaProfile';
import { buildRunSummary } from '@/game/runRules';
import type { RunSummary } from '@/core/run';

function memoryStorage(initial: Record<string, string> = {}): Storage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => { data.delete(key); },
    setItem: (key: string, value: string) => { data.set(key, String(value)); },
  };
}

function summary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    ...buildRunSummary({
      outcome: 'fallen',
      seed: 7,
      daily: null,
      kit: 'spark',
      floor: 2,
      floorName: 'The Rot Gardens',
      floorsTotal: 4,
      timeMs: 600_000,
      kills: 10,
      alchemicalKills: 3,
      bestChain: 2,
      deaths: 4,
      gold: 120,
      cardsFound: 2,
      causeLine: 'Gunpowder remembered it was gunpowder.',
    }),
    ...overrides,
  };
}

describe('meta profile parsing', () => {
  it('starts fresh when nothing is stored', () => {
    const parsed = parseMetaProfile(null);
    expect(parsed.status).toBe('fresh');
    expect(parsed.profile).toEqual(defaultMetaProfile());
    expect(parsed.profile.version).toBe(META_VERSION);
    expect(parsed.profile.unlockedKits).toEqual(['spark']);
  });

  it('survives corrupt JSON and wrong shapes', () => {
    for (const text of ['{not json', '[]', '"a string"', '42', 'null']) {
      const parsed = parseMetaProfile(text);
      expect(parsed.status).toBe('corrupt');
      expect(parsed.profile).toEqual(defaultMetaProfile());
    }
    expect(parseMetaProfile(JSON.stringify({ version: 'one' })).status).toBe('corrupt');
    expect(parseMetaProfile(JSON.stringify({ version: -2 })).status).toBe('corrupt');
  });

  it('sanitizes every field it keeps', () => {
    const parsed = parseMetaProfile(JSON.stringify({
      version: 1,
      runsStarted: -5,
      runsEnded: 3.9,
      victories: 'lots',
      bestFloor: 3,
      leviathansSlain: 2,
      fastestVictoryMs: -1,
      unlockedKits: ['storm', 'frost', 'mud', 42, 'frost'],
      lastKit: 'ember',
      workshopUnlocked: 'yes',
      dailyBests: {
        '2026-09-26': { floor: 3, timeMs: 840000, victory: false },
        'yesterday': { floor: 4, timeMs: 1, victory: true },
        '2026-09-25': { floor: 0, timeMs: 5 },
        '2026-09-24': 'bad',
      },
    }));
    expect(parsed.status).toBe('ok');
    const p = parsed.profile;
    expect(p.runsStarted).toBe(0);
    expect(p.runsEnded).toBe(3);
    expect(p.victories).toBe(0);
    expect(p.fastestVictoryMs).toBeNull();
    // Spark is always open; known kits keep catalogue order; the unknown drop.
    expect(p.unlockedKits).toEqual(['spark', 'frost', 'storm']);
    // A remembered kit that is not unlocked falls back to spark.
    expect(p.lastKit).toBe('spark');
    // runsEnded > 0 opens the Workshop even if the flag was mangled.
    expect(p.workshopUnlocked).toBe(true);
    expect(p.dailyBests).toEqual({ '2026-09-26': { floor: 3, timeMs: 840000, victory: false } });
  });

  it('migrates an unversioned document', () => {
    const migrated = migrateMetaProfile({ runsStarted: 4, bestFloor: 2, unlockedKits: ['frost'] });
    expect(migrated.status).toBe('migrated');
    expect(migrated.profile.version).toBe(META_VERSION);
    expect(migrated.profile.runsStarted).toBe(4);
    expect(migrated.profile.unlockedKits).toEqual(['spark', 'frost']);
  });

  it('refuses to reinterpret a newer version', () => {
    const parsed = parseMetaProfile(JSON.stringify({ version: META_VERSION + 1, runsStarted: 99 }));
    expect(parsed.status).toBe('future');
    expect(parsed.profile.runsStarted).toBe(0);
  });
});

describe('milestones unlock kits', () => {
  it('frost at floor 2, ember for the Leviathan, storm for a win', () => {
    expect(earnedKits({ bestFloor: 1, leviathansSlain: 0, victories: 0 })).toEqual(['spark']);
    expect(earnedKits({ bestFloor: 2, leviathansSlain: 0, victories: 0 })).toEqual(['spark', 'frost']);
    expect(earnedKits({ bestFloor: 3, leviathansSlain: 1, victories: 0 })).toEqual(['spark', 'frost', 'ember']);
    expect(earnedKits({ bestFloor: 4, leviathansSlain: 1, victories: 1 })).toEqual(['spark', 'frost', 'ember', 'storm']);
  });

  it('reports each unlock once, when it happens', () => {
    let p = defaultMetaProfile();
    let step = recordFloorReached(p, 1);
    expect(step.unlocked).toEqual([]);
    p = step.profile;
    step = recordFloorReached(p, 2);
    expect(step.unlocked).toEqual(['frost']);
    expect(step.profile.bestFloor).toBe(2);
    p = step.profile;
    expect(recordFloorReached(p, 2).unlocked).toEqual([]);
    step = recordLeviathanSlain(p);
    expect(step.unlocked).toEqual(['ember']);
    p = step.profile;
    expect(recordLeviathanSlain(p).unlocked).toEqual([]);
    expect(recordLeviathanSlain(p).profile.leviathansSlain).toBe(2);
  });

  it('a victory ends the run with the Storm case', () => {
    const p = { ...defaultMetaProfile(), bestFloor: 3, leviathansSlain: 1, unlockedKits: ['spark' as const, 'frost' as const, 'ember' as const] };
    const end = recordRunEnded(p, summary({ outcome: 'victory', floor: 4, timeMs: 1_100_000 }));
    expect(end.unlocked).toEqual(['storm']);
    expect(end.profile.victories).toBe(1);
    expect(end.profile.fastestVictoryMs).toBe(1_100_000);
    expect(end.newBestFloor).toBe(true);
    expect(end.profile.bestFloor).toBe(4);
  });
});

describe('run bookkeeping', () => {
  it('counts starts and remembers only unlocked kits', () => {
    let p = recordRunStarted(defaultMetaProfile(), 'storm');
    expect(p.runsStarted).toBe(1);
    expect(p.lastKit).toBe('spark');
    p = recordRunStarted({ ...p, unlockedKits: ['spark', 'storm'] }, 'storm');
    expect(p.lastKit).toBe('storm');
  });

  it('opens the Workshop after the first run ends, whatever the outcome', () => {
    const end = recordRunEnded(defaultMetaProfile(), summary({ outcome: 'abandoned', floor: 1 }));
    expect(end.profile.runsEnded).toBe(1);
    expect(end.profile.workshopUnlocked).toBe(true);
    expect(end.dailyBest).toBeNull();
  });

  it('keeps the best result per daily date', () => {
    let p = defaultMetaProfile();
    let end = recordRunEnded(p, summary({ daily: '2026-09-26', floor: 2, timeMs: 500_000 }));
    expect(end.newDailyBest).toBe(true);
    expect(end.dailyBest).toEqual({ floor: 2, timeMs: 500_000, victory: false });
    p = end.profile;
    end = recordRunEnded(p, summary({ daily: '2026-09-26', floor: 1, timeMs: 100_000 }));
    expect(end.newDailyBest).toBe(false);
    expect(end.dailyBest).toEqual({ floor: 2, timeMs: 500_000, victory: false });
    p = end.profile;
    end = recordRunEnded(p, summary({ daily: '2026-09-26', outcome: 'victory', floor: 4, timeMs: 900_000 }));
    expect(end.newDailyBest).toBe(true);
    expect(end.profile.dailyBests['2026-09-26']).toEqual({ floor: 4, timeMs: 900_000, victory: true });
  });

  it('records daily bests only for runs that ended by death or victory (QA: abandoned daily said "New best")', () => {
    // An abandoned daily on a fresh date sets nothing and claims nothing.
    let end = recordRunEnded(defaultMetaProfile(), summary({ daily: '2026-09-27', outcome: 'abandoned', floor: 1, timeMs: 20_000 }));
    expect(end.newDailyBest).toBe(false);
    expect(end.dailyBest).toBeNull();
    expect(end.profile.dailyBests).toEqual({});
    // A fallen run sets the date's best...
    end = recordRunEnded(end.profile, summary({ daily: '2026-09-27', outcome: 'fallen', floor: 2, timeMs: 400_000 }));
    expect(end.newDailyBest).toBe(true);
    // ...and a DEEPER abandoned run still cannot beat it; it reports the standing best.
    const standing = end.profile.dailyBests['2026-09-27'];
    end = recordRunEnded(end.profile, summary({ daily: '2026-09-27', outcome: 'abandoned', floor: 3, timeMs: 300_000 }));
    expect(end.newDailyBest).toBe(false);
    expect(end.dailyBest).toEqual(standing);
    expect(end.profile.dailyBests['2026-09-27']).toEqual(standing);
    // Victory still counts.
    end = recordRunEnded(end.profile, summary({ daily: '2026-09-27', outcome: 'victory', floor: 4, timeMs: 900_000 }));
    expect(end.newDailyBest).toBe(true);
    expect(end.profile.dailyBests['2026-09-27']).toEqual({ floor: 4, timeMs: 900_000, victory: true });
  });

  it('keeps only the most recent sixty daily dates', () => {
    let p = defaultMetaProfile();
    for (let day = 0; day < 70; day++) {
      const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
      p = recordRunEnded(p, summary({ daily: date })).profile;
    }
    const dates = Object.keys(p.dailyBests).sort();
    expect(dates).toHaveLength(60);
    expect(dates[0]).toBe('2026-01-11');
    expect(dates[59]).toBe('2026-03-11');
  });
});

describe('the store', () => {
  it('persists commits and reads them back', () => {
    const storage = memoryStorage();
    const store = new MetaProfileStore(storage);
    expect(store.status).toBe('fresh');
    store.commit(recordFloorReached(store.profile, 2).profile);
    store.setLastKit('frost');
    const again = new MetaProfileStore(storage);
    expect(again.status).toBe('ok');
    expect(again.isKitUnlocked('frost')).toBe(true);
    expect(again.profile.lastKit).toBe('frost');
  });

  it('rewrites a corrupt document with a clean one', () => {
    const storage = memoryStorage({ [META_KEY]: '{oops' });
    const store = new MetaProfileStore(storage);
    expect(store.status).toBe('corrupt');
    expect(JSON.parse(storage.data.get(META_KEY) ?? 'null')).toEqual(defaultMetaProfile());
  });

  it('never overwrites a profile from a newer build', () => {
    const future = JSON.stringify({ version: META_VERSION + 1, runsStarted: 99 });
    const storage = memoryStorage({ [META_KEY]: future });
    const store = new MetaProfileStore(storage);
    store.commit(recordRunStarted(store.profile, 'spark'));
    expect(storage.data.get(META_KEY)).toBe(future);
  });

  it('keeps working when storage throws', () => {
    const hostile = {
      ...memoryStorage(),
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('full'); },
    } as unknown as Storage;
    const store = new MetaProfileStore(hostile);
    expect(() => store.commit(recordRunStarted(store.profile, 'spark'))).not.toThrow();
    expect(store.profile.runsStarted).toBe(1);
  });
});

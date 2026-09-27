import { describe, expect, it } from 'vitest';

import {
  PHIALS_PER_RUN,
  betterDailyResult,
  buildRunSummary,
  clampPhials,
  dailySeed,
  formatChain,
  formatRunTime,
  isDateKey,
  midSentence,
  restorePhial,
  runHeadline,
  shareLine,
  spendPhial,
  utcDateKey,
  VICTORY_EPITAPH,
  type RunStatsInput,
} from '@/game/runRules';
import { withDiscoveredCards } from '@/combat/wands/rewardPools';
import { TOME_REWARD_POOL } from '@/content/cardRewardPools';
import { CAMPAIGN_FLOORS, FLOORS_TOTAL, LEVELS, floorDisplayName, floorLabel, floorOf } from '@/config/worldgraph';
import { DEFAULT_KIT, KIT_DEFS, KIT_ORDER, isKitId } from '@/content/kits';
import { isCardId } from '@/combat/wands/cards';
import { FLOOR_LORE } from '@/content/floorLore';

function stats(overrides: Partial<RunStatsInput> = {}): RunStatsInput {
  return {
    outcome: 'fallen',
    seed: 1234,
    daily: null,
    kit: 'spark',
    floor: 3,
    floorName: 'The Drowned Cisterns',
    floorsTotal: 4,
    timeMs: 842_000,
    kills: 21,
    alchemicalKills: 9,
    bestChain: 3,
    deaths: 4,
    gold: 312,
    cardsFound: 5,
    causeLine: 'The Leviathan threw the pool at you.',
    ...overrides,
  };
}

describe('return phials', () => {
  it('a run holds three', () => {
    expect(PHIALS_PER_RUN).toBe(3);
  });

  it('each death spends one and returns; dying with none ends the run', () => {
    let phials = PHIALS_PER_RUN;
    const deaths: Array<{ phials: number; final: boolean }> = [];
    for (let i = 0; i < 4; i++) {
      const step = spendPhial(phials);
      deaths.push(step);
      phials = step.phials;
    }
    expect(deaths).toEqual([
      { phials: 2, final: false },
      { phials: 1, final: false },
      { phials: 0, final: false },
      { phials: 0, final: true },
    ]);
  });

  it('a refuge or the Sanctum restores one, never past three', () => {
    expect(restorePhial(0)).toEqual({ phials: 1, restored: true });
    expect(restorePhial(2)).toEqual({ phials: 3, restored: true });
    expect(restorePhial(3)).toEqual({ phials: 3, restored: false });
  });

  it('clamps nonsense counts from a save', () => {
    expect(clampPhials(Number.NaN)).toBe(3);
    expect(clampPhials(-4)).toBe(0);
    expect(clampPhials(9)).toBe(3);
    expect(clampPhials(1.7)).toBe(1);
    expect(spendPhial(-1)).toEqual({ phials: 0, final: true });
  });
});

describe('the daily descent', () => {
  it('keys days in UTC', () => {
    expect(utcDateKey(new Date(Date.UTC(2026, 8, 26, 23, 59, 59)))).toBe('2026-09-26');
    expect(utcDateKey(new Date(Date.UTC(2026, 8, 27, 0, 0, 1)))).toBe('2026-09-27');
    expect(utcDateKey(new Date(Date.UTC(2027, 0, 5)))).toBe('2027-01-05');
    expect(isDateKey('2026-09-26')).toBe(true);
    expect(isDateKey('26-09-2026')).toBe(false);
    expect(isDateKey(20260926)).toBe(false);
  });

  it('seeds deterministically from the date: same day, same descent', () => {
    expect(dailySeed('2026-09-26')).toBe(dailySeed('2026-09-26'));
    expect(dailySeed('2026-09-26')).not.toBe(dailySeed('2026-09-27'));
    expect(dailySeed('2026-09-26')).toBeGreaterThan(0);
    expect(Number.isInteger(dailySeed('2026-09-26'))).toBe(true);
    expect(dailySeed('2026-09-26')).toBeLessThanOrEqual(0xffffffff);
  });

  it('ranks daily results: deeper, then victory, then the faster victory', () => {
    const fall3 = { floor: 3, timeMs: 900_000, victory: false };
    expect(betterDailyResult(fall3, null)).toBe(true);
    expect(betterDailyResult({ floor: 4, timeMs: 2_000_000, victory: false }, fall3)).toBe(true);
    expect(betterDailyResult({ floor: 2, timeMs: 1_000, victory: false }, fall3)).toBe(false);
    expect(betterDailyResult({ floor: 4, timeMs: 1_300_000, victory: true }, { floor: 4, timeMs: 900_000, victory: false })).toBe(true);
    expect(betterDailyResult({ floor: 4, timeMs: 1_100_000, victory: true }, { floor: 4, timeMs: 1_300_000, victory: true })).toBe(true);
    expect(betterDailyResult({ floor: 4, timeMs: 1_400_000, victory: true }, { floor: 4, timeMs: 1_300_000, victory: true })).toBe(false);
    // Dying sooner on the same floor is not an improvement.
    expect(betterDailyResult({ floor: 3, timeMs: 400_000, victory: false }, fall3)).toBe(false);
  });
});

describe('the run ledger', () => {
  it('builds the RunSummary contract from the counters', () => {
    const summary = buildRunSummary(stats({ daily: '2026-09-26' }));
    expect(summary).toEqual({
      outcome: 'fallen',
      seed: 1234,
      daily: '2026-09-26',
      kit: 'spark',
      floor: 3,
      floorName: 'The Drowned Cisterns',
      floorsTotal: 4,
      timeMs: 842_000,
      kills: 21,
      alchemicalKills: 9,
      bestChain: 3,
      deaths: 4,
      gold: 312,
      cardsFound: 5,
      epitaph: 'The Leviathan threw the pool at you.',
    });
  });

  it('sanitizes counters and clamps the floor to the descent', () => {
    const summary = buildRunSummary(stats({ floor: 9, kills: -3, gold: Number.NaN, timeMs: 1.9, seed: -1 }));
    expect(summary.floor).toBe(4);
    expect(summary.kills).toBe(0);
    expect(summary.gold).toBe(0);
    expect(summary.timeMs).toBe(1);
    expect(summary.seed).toBe(0xffffffff);
    expect(buildRunSummary(stats({ floor: 0 })).floor).toBe(1);
  });

  it('writes the epitaph by outcome', () => {
    expect(buildRunSummary(stats({ outcome: 'victory' })).epitaph).toBe(VICTORY_EPITAPH);
    expect(buildRunSummary(stats({ outcome: 'abandoned', deaths: 0 })).epitaph).toMatch(/unharmed/);
    expect(buildRunSummary(stats({ outcome: 'abandoned', deaths: 2 })).epitaph).toMatch(/ledger open/);
    expect(buildRunSummary(stats({ causeLine: '   ' })).epitaph).toBe('The Works decline to specify.');
  });

  it('headlines the outcome in the house voice', () => {
    expect(runHeadline({ outcome: 'victory', floorName: 'The Kiln Heart' })).toBe('The Kiln is quiet.');
    expect(runHeadline({ outcome: 'fallen', floorName: 'The Rot Gardens' })).toBe('You fell in the Rot Gardens.');
    expect(runHeadline({ outcome: 'abandoned', floorName: 'The Bellows' })).toBe('You left the Bellows early.');
    expect(midSentence('Somewhere Else')).toBe('Somewhere Else');
  });

  it('formats play time like a stopwatch', () => {
    expect(formatRunTime(0)).toBe('0:00');
    expect(formatRunTime(59_999)).toBe('0:59');
    expect(formatRunTime(842_000)).toBe('14:02');
    expect(formatRunTime(3_849_000)).toBe('1:04:09');
    expect(formatRunTime(Number.NaN)).toBe('0:00');
  });

  it('writes the share line a player pastes to a friend', () => {
    const daily = buildRunSummary(stats({ daily: '2026-09-26' }));
    expect(shareLine(daily)).toBe('Breathing Works — daily 2026-09-26 — Floor 3/4 in 14:02 · 9 alchemical kills · best chain ×3');
    const normal = buildRunSummary(stats({ alchemicalKills: 1 }));
    expect(shareLine(normal)).toBe('Breathing Works — Floor 3/4 in 14:02 · 1 alchemical kill · best chain ×3');
    const won = buildRunSummary(stats({ outcome: 'victory', floor: 4, floorName: 'The Kiln Heart', timeMs: 1_120_000 }));
    expect(shareLine(won)).toBe('Breathing Works — the Kiln quieted in 18:40 · 9 alchemical kills · best chain ×3');
    // No chain: the ledger shows a dash, and the share line leaves it out.
    const chainless = buildRunSummary(stats({ bestChain: 0, alchemicalKills: 0 }));
    expect(shareLine(chainless)).toBe('Breathing Works — Floor 3/4 in 14:02 · 0 alchemical kills');
    expect(formatChain(0)).toBe('—');
    expect(formatChain(3)).toBe('×3');
  });
});

describe('the card reward pool', () => {
  it('discovered cards join the pool once each, after the base order', () => {
    const pool = withDiscoveredCards(['spark', 'bomb'], ['bomb', 'vitrify', 'meteor', 'vitrify']);
    expect(pool).toEqual(['spark', 'bomb', 'vitrify', 'meteor']);
  });

  it('never feeds the Infuser (it has its own grant) to random rewards', () => {
    expect(withDiscoveredCards(['spark'], ['infuser', 'triple'])).toEqual(['spark', 'triple']);
  });

  it('leaves the shared base pool untouched', () => {
    const before = [...TOME_REWARD_POOL];
    withDiscoveredCards(TOME_REWARD_POOL, ['vitrify', 'meteor']);
    expect([...TOME_REWARD_POOL]).toEqual(before);
  });
});

describe('four floors', () => {
  it('names the spine and keys its bosses', () => {
    expect(CAMPAIGN_FLOORS).toEqual(['d1', 'd2', 'd3', 'd4']);
    expect(FLOORS_TOTAL).toBe(4);
    expect(CAMPAIGN_FLOORS.map((id) => LEVELS[id].name)).toEqual([
      'THE BELLOWS', 'THE ROT GARDENS', 'THE DROWNED CISTERNS', 'THE KILN HEART',
    ]);
    expect(CAMPAIGN_FLOORS.map((id) => LEVELS[id].biome)).toEqual(['earthen', 'fungal', 'flooded', 'volcanic']);
    expect(LEVELS.d3.boss).toBe('leviathan');
    expect(LEVELS.d4.boss).toBe('colossus');
    expect(LEVELS.d4.nextLevelId).toBeNull();
    expect(Object.values(LEVELS).filter((def) => def.boss).map((def) => def.id)).toEqual(['d3', 'd4']);
    expect(LEVELS.vault).toBeUndefined();
    expect(LEVELS.d5).toBeUndefined();
  });

  it('labels floors for the curtain, the Sanctum and the ledger', () => {
    expect(floorOf('d3')).toBe(3);
    expect(floorOf('weaver-test')).toBe(0);
    expect(floorOf(null)).toBe(0);
    expect(floorLabel('d2')).toBe('Floor 2 of 4');
    expect(floorLabel('physics-test')).toBe('');
    expect(floorDisplayName('d2')).toBe('The Rot Gardens');
    expect(floorDisplayName('d4')).toBe('The Kiln Heart');
    for (const id of CAMPAIGN_FLOORS) expect(FLOOR_LORE[id]?.line.length).toBeGreaterThan(20);
  });
});

describe('starting kits', () => {
  it('defines four kits with real cards, the dig ray, and three flasks', () => {
    expect(KIT_ORDER).toEqual(['spark', 'frost', 'ember', 'storm']);
    expect(DEFAULT_KIT).toBe('spark');
    for (const id of KIT_ORDER) {
      const kit = KIT_DEFS[id];
      expect(isKitId(id)).toBe(true);
      expect(kit.id).toBe(id);
      for (const card of [...kit.wands[0], ...kit.wands[1], ...kit.collection]) expect(isCardId(card)).toBe(true);
      expect(kit.wands[1]).toContain('dig');
      expect(kit.flasks).toHaveLength(3);
      for (const flask of kit.flasks) expect(flask.count).toBeGreaterThan(0);
      if (id !== 'spark') expect(kit.unlockHint.length).toBeGreaterThan(5);
    }
    expect(isKitId('mud')).toBe(false);
  });

  it('keeps the spark kit as today’s regulation issue', () => {
    expect(KIT_DEFS.spark.wands).toEqual([['spark'], ['dig']]);
    expect(KIT_DEFS.spark.collection).toEqual(['double', 'speed']);
  });
});

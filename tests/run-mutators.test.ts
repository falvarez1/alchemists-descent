import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy, LevelRuntime, MutatorApi } from '@/core/types';
import type { RunSummary } from '@/core/run';
import { LEVELS } from '@/config/worldgraph';
import { RunDirector } from '@/game/RunDirector';
import { buildRunSummary, shareLine } from '@/game/runRules';
import { dailyMutators } from '@/content/mutators';

/**
 * Complications on a run (content/mutators -> RunDirector): chosen on the title, carried by the run
 * through its save, resumed, shown on the ledger and the share line, and put in force and taken out
 * again through the MutatorApi. The daily takes the date's own and never the player's. Modelled on
 * tests/run-seed.test.ts (the chosen seed), which this feature is the second user of.
 */
function harness(): {
  ctx: Ctx;
  run: RunDirector;
  ended: RunSummary[];
  started: Array<{ seed?: number; daily?: string | null; mutators?: readonly string[] }>;
  calls: string[];
} {
  const events = new EventBus();
  let current: Partial<LevelRuntime> | null = null;
  const started: Array<{ seed?: number; daily?: string | null; mutators?: readonly string[] }> = [];
  const calls: string[] = [];
  const mutators = {
    ids: [] as readonly string[],
    has: () => false,
    activate: (_c: Ctx, ids: readonly string[]) => { calls.push(`activate:${ids.join(',')}`); },
    deactivate: () => { calls.push('deactivate'); },
    planLevel: () => undefined,
    dressLevel: () => undefined,
    update: () => undefined,
  } satisfies MutatorApi;
  const ctx = {
    events,
    state: { mode: 'play', score: 0, debugGodMode: false, debugTainted: false, paused: false, difficulty: 2 },
    player: { x: 0, y: 0, dead: false },
    enemies: [] as Enemy[],
    waves: { kills: 0 },
    audio: new Proxy({}, { get: () => () => undefined }),
    telemetry: { count: () => undefined },
    mutators,
    levels: {
      get current() { return current; },
      transitioning: false,
      saveDeathCheckpoint: () => undefined,
      saveExpedition: () => undefined,
      abandonExpedition: () => undefined,
      runStatus: () => ({ worldSeed: 99 }),
      // What Levels.startRun does: begin the tracked run on the seed it was given, then report success.
      startRun: (c: Ctx, cfg: { seed?: number; daily?: string | null; starterKit?: 'spark'; mutators?: readonly string[] }) => {
        started.push({ seed: cfg.seed, daily: cfg.daily, mutators: cfg.mutators });
        c.run?.beginRun(c, { seed: cfg.seed ?? 0, kit: cfg.starterKit ?? 'spark', daily: cfg.daily ?? null, tracked: true, mutators: cfg.mutators });
        return { ok: true, message: '', mode: 'normal', worldSource: 'campaign' };
      },
    },
  } as unknown as Ctx;
  const run = new RunDirector(ctx);
  ctx.run = run;
  const ended: RunSummary[] = [];
  events.on('runEnded', (s) => ended.push(s));
  current = { def: LEVELS.d1, living: undefined, refuge: undefined } as Partial<LevelRuntime>;
  return { ctx, run, ended, started, calls };
}

afterEach(() => vi.useRealTimers());

describe('choosing complications', () => {
  it('hands the descent the cleaned selection and the run remembers it, in the canonical order', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, mutators: ['low-gravity', 'nonsense', 'wet-floors', 'wet-floors'] });
    expect(h.started[0].mutators).toEqual(['wet-floors', 'low-gravity']);
    expect(h.run.snapshotForSave()?.mutators).toEqual(['wet-floors', 'low-gravity']);
    expect(h.run.mutators).toEqual(['wet-floors', 'low-gravity']);
  });

  it('caps a selection at three', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, mutators: ['wet-floors', 'tinderbox', 'slime-rain', 'gas-leak', 'hush'] });
    expect(h.run.snapshotForSave()?.mutators).toHaveLength(3);
  });

  it('leaves an ordinary Begin exactly as it was: no field, no remark, no complications in force', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false });
    expect(h.run.snapshotForSave() && 'mutators' in h.run.snapshotForSave()!).toBe(false);
    expect(h.run.mutators).toEqual([]);
    expect(h.calls.at(-1)).toBe('activate:');
    h.run.abandon(h.ctx);
    expect('mutators' in h.ended[0]).toBe(false);
    expect(shareLine(h.ended[0])).not.toMatch(/Wet|Gravity|Rations|Hush|\+/);
  });

  it('remembers the choice for the next descent (the title and "Descend again" start from it) and the daily does not disturb it', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, mutators: ['tinderbox'] });
    expect(h.run.metaView().lastMutators).toEqual(['tinderbox']);
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: true, mutators: ['hush'] });
    expect(h.run.metaView().lastMutators).toEqual(['tinderbox']);
    h.run.chooseMutators(['hush', 'famine', 'nonsense']);
    expect(h.run.metaView().lastMutators).toEqual(['famine', 'hush']);
  });

  it('does not leak a selection into a later ordinary run', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, mutators: ['glass-cannon'] });
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false });
    expect(h.run.snapshotForSave()?.mutators).toBeUndefined();
    expect(h.run.mutators).toEqual([]);
  });
});

describe('putting them in force', () => {
  it('activates the set when a run begins, and again after a replaced run ended (the new run is the authority)', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, mutators: ['hush'] });
    expect(h.calls.at(-1)).toBe('activate:hush');
    h.calls.length = 0;
    // A second Begin over a live run ends the first (deactivating) and must leave the new one's in force.
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, mutators: ['famine'] });
    expect(h.calls).toContain('deactivate');
    expect(h.calls.at(-1)).toBe('activate:famine');
  });

  it('takes them out when the run ends, and the ledger still names them', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, mutators: ['wet-floors', 'hush'] });
    h.calls.length = 0;
    h.run.abandon(h.ctx);
    expect(h.calls.at(-1)).toBe('deactivate');
    expect(h.ended[0].mutators).toEqual(['wet-floors', 'hush']);
  });
});

describe('saving and resuming', () => {
  it('keeps them through a save and a resume, and puts them back in force', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, mutators: ['gas-leak', 'dark-works'] });
    const save = h.run.snapshotForSave()!;
    const g = harness();
    g.run.restoreFromSave(g.ctx, JSON.parse(JSON.stringify(save)));
    expect(g.run.snapshotForSave()?.mutators).toEqual(['gas-leak', 'dark-works']);
    expect(g.calls.at(-1)).toBe('activate:gas-leak,dark-works');
  });

  it('cleans what a save carries: unknown ids, junk, duplicates and an oversize set', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, mutators: ['hush'] });
    const save = h.run.snapshotForSave()!;
    const g = harness();
    g.run.restoreFromSave(g.ctx, { ...save, mutators: ['hush', 'hush', 'bogus', 7 as unknown as string, 'famine', 'tinderbox', 'wet-floors'] });
    expect(g.run.snapshotForSave()?.mutators).toEqual(['wet-floors', 'tinderbox', 'famine']);
    const junk = harness();
    junk.run.restoreFromSave(junk.ctx, { ...save, mutators: 'wet-floors' as unknown as string[] });
    expect(junk.run.snapshotForSave()?.mutators).toBeUndefined();
  });

  it('resumes a save from before complications as an ordinary run', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false });
    const old = { ...h.run.snapshotForSave()! };
    delete (old as { mutators?: string[] }).mutators;
    const g = harness();
    g.run.restoreFromSave(g.ctx, old);
    expect(g.run.mutators).toEqual([]);
    expect(g.calls.at(-1)).toBe('activate:');
  });

  it('rejects a forged choice on the daily: a save that names a date carries that date\'s complications, whatever it says', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, mutators: ['glass-cannon'] });
    const save = h.run.snapshotForSave()!;
    const forged = harness();
    forged.run.restoreFromSave(forged.ctx, { ...save, daily: '2026-10-03', mutators: ['glass-cannon'] });
    expect(forged.run.snapshotForSave()?.mutators).toEqual(dailyMutators('2026-10-03'));
    // A date before the table's first era names none, so a choice smuggled in under it is dropped.
    const before = harness();
    before.run.restoreFromSave(before.ctx, { ...save, daily: '2026-09-30', mutators: ['glass-cannon'] });
    expect(before.run.snapshotForSave()?.mutators).toBeUndefined();
  });
});

describe('the daily', () => {
  it('takes the complications its date names and ignores the ones offered', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: true, mutators: ['hush'] });
    expect(h.started[0].mutators).toEqual(['low-gravity', 'crowded-house']);
    expect(h.run.snapshotForSave()?.mutators).toEqual(['low-gravity', 'crowded-house']);
    expect(h.run.metaView().todayMutators).toEqual(['low-gravity', 'crowded-house']);
  });

  it('is plain on a date before the first era', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: true, mutators: ['hush'] });
    expect(h.started[0].mutators).toEqual([]);
    expect(h.run.snapshotForSave()?.mutators).toBeUndefined();
    expect(h.run.metaView().todayMutators).toEqual([]);
  });
});

describe('the ledger and the share line', () => {
  const base = {
    outcome: 'fallen' as const, seed: 1234, daily: null, kit: 'spark' as const, floor: 3, floorName: 'The Drowned Cisterns', floorsTotal: 4,
    timeMs: 842_000, kills: 41, alchemicalKills: 9, bestChain: 3, deaths: 1, gold: 120, cardsFound: 4,
  };

  it('names them after the tier, and a run without them keeps its line byte for byte', () => {
    expect(shareLine(buildRunSummary(base))).toBe('Breathing Works — Floor 3/4 in 14:02 · 9 alchemical kills · best chain ×3');
    const wet = buildRunSummary({ ...base, mutators: ['low-gravity', 'wet-floors'] });
    expect(wet.mutators).toEqual(['wet-floors', 'low-gravity']);
    expect(shareLine(wet)).toBe('Breathing Works — Wet Floors + Low Gravity — Floor 3/4 in 14:02 · 9 alchemical kills · best chain ×3');
    const hard = buildRunSummary({ ...base, difficulty: 4, daily: '2026-10-03', mutators: ['crowded-house'] });
    expect(shareLine(hard)).toBe('Breathing Works — daily 2026-10-03 — Archmage — Crowded House — Floor 3/4 in 14:02 · 9 alchemical kills · best chain ×3');
  });

  it('carries nothing for an empty or nonsense set', () => {
    expect('mutators' in buildRunSummary({ ...base, mutators: [] })).toBe(false);
    expect('mutators' in buildRunSummary({ ...base, mutators: ['bogus'] })).toBe(false);
    expect('mutators' in buildRunSummary(base)).toBe(false);
  });
});

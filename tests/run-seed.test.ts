import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy, LevelRuntime } from '@/core/types';
import type { RunSummary } from '@/core/run';
import { LEVELS } from '@/config/worldgraph';
import { RunDirector } from '@/game/RunDirector';
import { dailySeed, shareLine, utcDateKey } from '@/game/runRules';

/**
 * A chosen seed on the title (ui/title/SeedPage -> RunDirector.startNewRun opts.seed): the
 * descent runs on it, the run remembers it was chosen (through a save and a resume), and only
 * then do the ledger and the share line print it. The daily and an ordinary Begin are unchanged.
 */
function harness(): { ctx: Ctx; run: RunDirector; ended: RunSummary[]; started: Array<{ seed?: number; daily?: string | null }> } {
  const events = new EventBus();
  let current: Partial<LevelRuntime> | null = null;
  const started: Array<{ seed?: number; daily?: string | null }> = [];
  const ctx = {
    events,
    state: { mode: 'play', score: 0, debugGodMode: false, debugTainted: false, paused: false, difficulty: 2 },
    player: { x: 0, y: 0, dead: false },
    enemies: [] as Enemy[],
    waves: { kills: 0 },
    audio: new Proxy({}, { get: () => () => undefined }),
    telemetry: { count: () => undefined },
    levels: {
      get current() { return current; },
      transitioning: false,
      saveDeathCheckpoint: () => undefined,
      saveExpedition: () => undefined,
      abandonExpedition: () => undefined,
      runStatus: () => ({ worldSeed: 99 }),
      // What Levels.startRun does: begin the tracked run on the seed it was given, then report success.
      startRun: (c: Ctx, cfg: { seed?: number; daily?: string | null; starterKit?: 'spark' }) => {
        started.push({ seed: cfg.seed, daily: cfg.daily });
        c.run?.beginRun(c, { seed: cfg.seed ?? 0, kit: cfg.starterKit ?? 'spark', daily: cfg.daily ?? null, tracked: true });
        return { ok: true, message: '', mode: 'normal', worldSource: 'campaign' };
      },
    },
  } as unknown as Ctx;
  const run = new RunDirector(ctx);
  ctx.run = run;
  const ended: RunSummary[] = [];
  events.on('runEnded', (s) => ended.push(s));
  current = { def: LEVELS.d1, living: undefined, refuge: undefined } as Partial<LevelRuntime>;
  return { ctx, run, ended, started };
}

describe('a chosen seed', () => {
  it('runs the descent on it and remembers that it was chosen', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, seed: 1234567 });
    expect(h.started[0].seed).toBe(1234567);
    expect(h.run.snapshotForSave()).toMatchObject({ seed: 1234567, seedChosen: true });
  });

  it('keeps the flag through a save and a resume, and rejects a forged one on the daily', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, seed: 77 });
    const save = h.run.snapshotForSave()!;
    const g = harness();
    g.run.restoreFromSave(g.ctx, JSON.parse(JSON.stringify(save)));
    expect(g.run.snapshotForSave()).toMatchObject({ seed: 77, seedChosen: true });
    const forged = harness();
    forged.run.restoreFromSave(forged.ctx, { ...save, daily: '2026-09-30' });
    expect(forged.run.snapshotForSave()?.seedChosen).toBeUndefined();
    const junk = harness();
    junk.run.restoreFromSave(junk.ctx, { ...save, seedChosen: 'yes' as unknown as boolean });
    expect(junk.run.snapshotForSave()?.seedChosen).toBeUndefined();
  });

  it('names the seed on the ledger and the share line, only for a chosen one', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, seed: 4242 });
    h.run.abandon(h.ctx);
    expect(h.ended).toHaveLength(1);
    expect(h.ended[0]).toMatchObject({ seed: 4242, seedChosen: true });
    expect(shareLine(h.ended[0])).toContain('seed 4242');
  });

  it('leaves an ordinary Begin exactly as it was', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false });
    const seed = h.started[0].seed!;
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(h.run.snapshotForSave()?.seedChosen).toBeUndefined();
    h.run.abandon(h.ctx);
    expect(h.ended[0].seedChosen).toBeUndefined();
    expect(shareLine(h.ended[0])).not.toMatch(/seed/i);
  });

  it('leaves the daily alone: its seed, however one is offered', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: true, seed: 999 });
    expect(h.started[0].seed).toBe(dailySeed(utcDateKey(new Date())));
    expect(h.run.snapshotForSave()?.seedChosen).toBeUndefined();
  });

  it('ignores a seed that cannot be one (zero, NaN, negative) and rolls its own', () => {
    for (const bad of [0, NaN, -5, Infinity]) {
      const h = harness();
      h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, seed: bad });
      expect(h.run.snapshotForSave()?.seedChosen).toBeUndefined();
      expect(Number.isFinite(h.started[0].seed)).toBe(true);
    }
  });

  it('does not leak the flag into a later ordinary run', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, seed: 5 });
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false });
    expect(h.run.snapshotForSave()?.seedChosen).toBeUndefined();
  });
});

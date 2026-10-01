import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy, LevelRuntime, RunStartConfig } from '@/core/types';
import type { RunSummary } from '@/core/run';
import { LEVELS } from '@/config/worldgraph';
import { MetaProfileStore, META_KEY, defaultMetaProfile, migrateMetaProfile } from '@/game/MetaProfile';
import { RunDirector } from '@/game/RunDirector';
import { buildRunSummary } from '@/game/runRules';

/**
 * The fighter threaded through a run exactly the way the starting kit is: chosen on the title, handed to
 * Levels.startRun, kept in the run's save slice, remembered by the meta profile, named in the ledger, and
 * dropped on the daily. Every field is optional, so a save, a profile or a summary from before fighters
 * reads back unchanged.
 */

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
  };
}

function harness() {
  const events = new EventBus();
  const started: RunStartConfig[] = [];
  let current: Partial<LevelRuntime> | null = null;
  const ctx = {
    events,
    state: { mode: 'play', score: 0, debugGodMode: false, debugTainted: false, paused: false },
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
      startRun: (_ctx: Ctx, config: RunStartConfig) => { started.push(config); return { ok: true, message: '', mode: 'normal', worldSource: 'campaign' }; },
    },
  } as unknown as Ctx;
  const run = new RunDirector(ctx);
  ctx.run = run;
  const ended: RunSummary[] = [];
  events.on('runEnded', (s) => ended.push(s));
  const enter = (id: string): void => {
    current = { def: LEVELS[id] } as Partial<LevelRuntime>;
    events.emit('levelChanged', { depth: LEVELS[id].depth, name: LEVELS[id].name });
  };
  return { ctx, run, started, ended, enter };
}

describe('a fighter through the run', () => {
  it('hands the chosen fighter to the run start, and only for a normal descent', () => {
    const h = harness();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, fighter: 'brann-rook' });
    expect(h.started.at(-1)).toMatchObject({ starterKit: 'spark', fighter: 'brann-rook' });
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false });
    expect(h.started.at(-1)?.fighter).toBeNull();
    // Today's descent is one seed for everyone: the classic Alchemist, whatever was chosen.
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: true, fighter: 'brann-rook' });
    expect(h.started.at(-1)?.fighter).toBeNull();
    // An id that is not a fighter is ignored rather than trusted.
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, fighter: 'not-a-fighter' as never });
    expect(h.started.at(-1)?.fighter).toBeNull();
  });

  it('remembers the choice (the title and the ledger seed their pickers from it), not on the daily', () => {
    const h = harness();
    expect(h.run.metaView().lastFighter).toBeNull();
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: false, fighter: 'sable-fen' });
    expect(h.run.metaView().lastFighter).toBe('sable-fen');
    h.run.startNewRun(h.ctx, { kit: 'spark', daily: true, fighter: 'mara-quell' });
    expect(h.run.metaView().lastFighter).toBe('sable-fen');
    h.run.chooseFighter('nox-calder');
    expect(h.run.metaView().lastFighter).toBe('nox-calder');
    h.run.chooseFighter(null);
    expect(h.run.metaView().lastFighter).toBeNull();
  });

  it('keeps the fighter in the run state, the save slice and the ledger', () => {
    const h = harness();
    h.run.beginRun(h.ctx, { seed: 5, kit: 'spark', fighter: 'kest-rel', daily: null, tracked: true });
    h.enter('d1');
    expect(h.run.fighter).toBe('kest-rel');
    const snap = h.run.snapshotForSave();
    expect(snap?.fighter).toBe('kest-rel');
    // A resume brings the same fighter back; a hand-edited id is dropped, not trusted.
    const g = harness();
    g.run.restoreFromSave(g.ctx, { ...snap! });
    expect(g.run.fighter).toBe('kest-rel');
    const bad = harness();
    bad.run.restoreFromSave(bad.ctx, { ...snap!, fighter: 'nope' as never });
    expect(bad.run.fighter).toBeNull();
    // A death with no phials left puts it in the ledger.
    for (let i = 0; i < 4; i++) {
      h.ctx.player.dead = true;
      h.ctx.events.emit('playerDied', { depth: 1, level: 'THE BELLOWS', gold: 0, cause: 'lava' });
      h.ctx.player.dead = false;
    }
    expect(h.ended[0].fighter).toBe('kest-rel');
  });

  it('leaves a classic run byte-identical: no fighter field anywhere', () => {
    const h = harness();
    h.run.beginRun(h.ctx, { seed: 5, kit: 'spark', daily: null, tracked: true });
    h.enter('d1');
    expect(h.run.fighter).toBeNull();
    expect('fighter' in (h.run.snapshotForSave() ?? {})).toBe(false);
    const summary = buildRunSummary({
      outcome: 'fallen', seed: 1, daily: null, kit: 'spark', floor: 1, floorName: 'x', floorsTotal: 4, timeMs: 1, kills: 0,
      alchemicalKills: 0, bestChain: 0, deaths: 0, cardsFound: 0, leviathanSlain: false, recorded: true, boons: [], path: [],
    } as never);
    expect('fighter' in summary).toBe(false);
  });
});

describe('the meta profile and fighters', () => {
  it('migrates a profile from before fighters to "no fighter" and sanitizes what it keeps', () => {
    expect(defaultMetaProfile().lastFighter).toBeNull();
    const old = migrateMetaProfile({ version: 1, runsStarted: 3, lastKit: 'spark' });
    expect(old.profile.lastFighter).toBeNull();
    const kept = migrateMetaProfile({ version: 1, lastFighter: 'edda-morrow' });
    expect(kept.profile.lastFighter).toBe('edda-morrow');
    const junk = migrateMetaProfile({ version: 1, lastFighter: 'not-a-fighter' });
    expect(junk.profile.lastFighter).toBeNull();
  });

  it('persists the last fighter through the store', () => {
    const storage = memoryStorage();
    const a = new MetaProfileStore(storage);
    a.setLastFighter('rusk-emberjaw');
    expect(JSON.parse(storage.getItem(META_KEY) ?? '{}').lastFighter).toBe('rusk-emberjaw');
    expect(new MetaProfileStore(storage).profile.lastFighter).toBe('rusk-emberjaw');
    a.setLastFighter(null);
    expect(new MetaProfileStore(storage).profile.lastFighter).toBeNull();
  });
});

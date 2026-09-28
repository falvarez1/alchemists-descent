import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy, LevelRuntime } from '@/core/types';
import type { RunSummary } from '@/core/run';
import { LEVELS } from '@/config/worldgraph';
import { RunDirector } from '@/game/RunDirector';

interface Harness {
  ctx: Ctx;
  run: RunDirector;
  ended: RunSummary[];
  phialEvents: Array<{ phials: number; reason: string }>;
  calls: { deathSaves: number; abandoned: number; saves: number };
  enter(id: string): void;
}

function harness(): Harness {
  const events = new EventBus();
  const calls = { deathSaves: 0, abandoned: 0, saves: 0 };
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
      saveDeathCheckpoint: () => { calls.deathSaves++; },
      saveExpedition: () => { calls.saves++; },
      abandonExpedition: () => { calls.abandoned++; },
      runStatus: () => ({ worldSeed: 99 }),
      startRun: () => ({ ok: true, message: '', mode: 'normal', worldSource: 'campaign' }),
    },
  } as unknown as Ctx;
  const run = new RunDirector(ctx);
  ctx.run = run;
  const ended: RunSummary[] = [];
  const phialEvents: Array<{ phials: number; reason: string }> = [];
  events.on('runEnded', (s) => ended.push(s));
  events.on('phialsChanged', ({ phials, reason }) => phialEvents.push({ phials, reason }));
  return {
    ctx, run, ended, phialEvents, calls,
    enter(id: string) {
      current = { def: LEVELS[id], living: undefined, refuge: undefined } as Partial<LevelRuntime>;
      events.emit('levelChanged', { depth: LEVELS[id].depth, name: LEVELS[id].name });
    },
  };
}

function die(h: Harness, cause = 'lava'): void {
  h.ctx.player.dead = true;
  h.ctx.events.emit('playerDied', { depth: 1, level: 'THE BELLOWS', gold: 0, cause });
  h.ctx.player.dead = false;
}

describe('RunDirector', () => {
  it('spends a phial per death and ends the run on the death with none left', () => {
    const h = harness();
    h.run.beginRun(h.ctx, { seed: 5, kit: 'spark', daily: null, tracked: true });
    h.enter('d1');
    expect(h.run.active).toBe(true);
    expect(h.run.phials).toBe(3);
    die(h);
    die(h);
    die(h);
    expect(h.run.phials).toBe(0);
    expect(h.run.active).toBe(true);
    // Each survivable death re-writes the checkpoint with the phial spent.
    expect(h.calls.deathSaves).toBe(3);
    expect(h.ended).toHaveLength(0);
    die(h, 'gunpowder');
    expect(h.run.over).toBe(true);
    expect(h.run.active).toBe(false);
    expect(h.calls.abandoned).toBe(1);
    expect(h.ended).toHaveLength(1);
    expect(h.ended[0]).toMatchObject({ outcome: 'fallen', deaths: 4, floor: 1, floorName: 'The Bellows', kit: 'spark', seed: 5 });
    // The epitaph is one of the cause's own death lines.
    expect(['Gunpowder remembered it was gunpowder.', 'Powder line became a full stop.']).toContain(h.ended[0].epitaph);
    expect(h.phialEvents.map((e) => `${e.reason}:${e.phials}`)).toEqual(['start:3', 'death:2', 'death:1', 'death:0']);
    expect(h.run.snapshotForSave()).toBeNull();
  });

  it('restores phials up to three and snapshots them into the save', () => {
    const h = harness();
    h.run.beginRun(h.ctx, { seed: 5, kit: 'frost', daily: '2026-09-26', tracked: true });
    h.enter('d1');
    die(h);
    expect(h.run.restorePhial(h.ctx, 'sanctum')).toBe(true);
    expect(h.run.restorePhial(h.ctx, 'refuge')).toBe(false);
    const snap = h.run.snapshotForSave();
    expect(snap).toMatchObject({ v: 1, phials: 3, kit: 'frost', daily: '2026-09-26', deaths: 1, maxFloor: 1 });
    // Resume: a second director picks the run up where the save left it.
    const g = harness();
    g.run.restoreFromSave(g.ctx, { ...snap!, phials: 1 });
    expect(g.run.active).toBe(true);
    expect(g.run.phials).toBe(1);
    expect(g.run.kit).toBe('frost');
    expect(g.phialEvents.at(-1)).toEqual({ phials: 1, reason: 'restore' });
  });

  it('resumes a save from before runs existed as a fresh spark run', () => {
    const h = harness();
    h.run.restoreFromSave(h.ctx, undefined);
    expect(h.run.active).toBe(true);
    expect(h.run.phials).toBe(3);
    expect(h.run.kit).toBe('spark');
    expect(h.run.snapshotForSave()?.seed).toBe(99);
  });

  it('ends in victory on the Colossus and in abandonment by choice', () => {
    const h = harness();
    h.run.beginRun(h.ctx, { seed: 1, kit: 'spark', daily: null, tracked: true });
    h.enter('d4');
    h.ctx.events.emit('alchemyKill', { kind: 'weaver', cause: 'burned', x: 0, y: 0, chain: 1, bonusGold: 5 });
    h.ctx.events.emit('alchemyKill', { kind: 'weaver', cause: 'shorted', x: 0, y: 0, chain: 3, bonusGold: 5 });
    h.ctx.events.emit('cardGranted', { id: 'bomb', name: 'Cast Bomb' });
    h.ctx.events.emit('runComplete', { gold: 0 });
    expect(h.ended.at(-1)).toMatchObject({ outcome: 'victory', floor: 4, alchemicalKills: 2, bestChain: 3, cardsFound: 1 });
    expect(h.run.lastResult?.present).toBe(true);

    const a = harness();
    a.run.beginRun(a.ctx, { seed: 1, kit: 'spark', daily: null, tracked: true });
    a.enter('d2');
    a.run.abandon(a.ctx);
    expect(a.ended.at(-1)).toMatchObject({ outcome: 'abandoned', floor: 2, floorName: 'The Rot Gardens' });
    expect(a.run.over).toBe(true);
  });

  it('an abandoned daily never reports a new best; a finished one does', () => {
    const h = harness();
    h.run.beginRun(h.ctx, { seed: 3, kit: 'spark', daily: '2031-02-03', tracked: true });
    h.enter('d1');
    h.run.abandon(h.ctx);
    expect(h.ended.at(-1)).toMatchObject({ outcome: 'abandoned', daily: '2031-02-03' });
    expect(h.run.lastResult?.newDailyBest).toBe(false);
    h.run.beginRun(h.ctx, { seed: 3, kit: 'spark', daily: '2031-02-03', tracked: true });
    h.enter('d1');
    for (let i = 0; i < 4; i++) die(h);
    expect(h.ended.at(-1)).toMatchObject({ outcome: 'fallen', daily: '2031-02-03' });
    expect(h.run.lastResult?.newDailyBest).toBe(true);
  });

  it('records a run replaced by a new one without presenting its ledger', () => {
    const h = harness();
    h.run.beginRun(h.ctx, { seed: 1, kit: 'spark', daily: null, tracked: true });
    h.enter('d2');
    let presentOnEnd: boolean | undefined;
    h.ctx.events.on('runEnded', () => { presentOnEnd = h.run.lastResult?.present; });
    h.run.beginRun(h.ctx, { seed: 2, kit: 'spark', daily: null, tracked: true });
    expect(h.ended.at(-1)).toMatchObject({ outcome: 'abandoned', seed: 1, floor: 2 });
    expect(presentOnEnd).toBe(false);
    expect(h.run.active).toBe(true);
    expect(h.run.over).toBe(false);
    expect(h.run.phials).toBe(3);
  });

  it('leaves untracked (test) runs to the old infinite returns', () => {
    const h = harness();
    h.run.beginRun(h.ctx, { seed: 1, kit: 'spark', daily: null, tracked: false });
    die(h);
    die(h);
    die(h);
    die(h);
    expect(h.run.active).toBe(false);
    expect(h.run.over).toBe(false);
    expect(h.ended).toHaveLength(0);
    expect(h.calls.deathSaves).toBe(0);
  });

  it('counts kills as they happen and spots the Leviathan falling', () => {
    const h = harness();
    h.run.beginRun(h.ctx, { seed: 1, kit: 'spark', daily: null, tracked: true });
    h.enter('d3');
    const leviathan = { kind: 'leviathan' } as Enemy;
    h.ctx.enemies.push(leviathan);
    h.run.update(h.ctx);
    h.ctx.enemies.length = 0;
    h.ctx.events.emit('enemyKilled', { kind: 'slime', x: 0, y: 0 });
    h.ctx.events.emit('enemyKilled', { kind: 'leviathan', x: 0, y: 0 });
    // a counter reset between floors (Levels zeroes waves.kills) cannot hide them
    h.ctx.waves.kills = 0;
    h.run.update(h.ctx);
    expect(h.run.snapshotForSave()).toMatchObject({ kills: 2, leviathanSlain: true });
  });

  it('counts the Colossus kill before the victory ledger is written', () => {
    const h = harness();
    h.run.beginRun(h.ctx, { seed: 1, kit: 'spark', daily: null, tracked: true });
    h.enter('d3');
    h.ctx.events.emit('enemyKilled', { kind: 'leviathan', x: 0, y: 0 });
    h.run.update(h.ctx);
    h.enter('d4');
    // Enemies.finishKill: the death is a fact first, then the run ends inside the same call.
    h.ctx.events.emit('enemyKilled', { kind: 'colossus', x: 0, y: 0 });
    h.ctx.events.emit('runComplete', { gold: 0 });
    expect(h.ended.at(-1)).toMatchObject({ outcome: 'victory', kills: 2 });
  });

  it('does not count deaths in a Builder playtest or outside play', () => {
    const h = harness();
    h.run.beginRun(h.ctx, { seed: 1, kit: 'spark', daily: null, tracked: true });
    h.enter('d1');
    (h.ctx.state as { playtestSource?: string | null }).playtestSource = 'builder';
    h.ctx.events.emit('enemyKilled', { kind: 'slime', x: 0, y: 0 });
    (h.ctx.state as { playtestSource?: string | null }).playtestSource = null;
    h.ctx.state.mode = 'build';
    h.ctx.events.emit('enemyKilled', { kind: 'slime', x: 0, y: 0 });
    h.ctx.state.mode = 'play';
    h.ctx.events.emit('enemyKilled', { kind: 'slime', x: 0, y: 0 });
    expect(h.run.snapshotForSave()).toMatchObject({ kills: 1 });
  });
});

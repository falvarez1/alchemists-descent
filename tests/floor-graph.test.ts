import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy, LevelRuntime, RunSaveState } from '@/core/types';
import type { RunSummary } from '@/core/run';
import {
  CAMPAIGN_FLOORS,
  CAMPAIGN_LEVELS,
  FLOOR_DOORS,
  FLOORS_TOTAL,
  LEVELS,
  doorTaken,
  floorDisplayName,
  floorLabel,
  floorOf,
  levelSeedFor,
  nextDoors,
} from '@/config/worldgraph';
import { FLOOR_LOOKS } from '@/config/floorLooks';
import { FLOOR_LORE, TWO_DOORS_LINE } from '@/content/floorLore';
import { fnv1aString } from '@/core/rng';
import { buildRunSummary, cleanRunPath, dailySeed, routeNames, shareLine } from '@/game/runRules';
import { defaultMetaProfile, migrateMetaProfile, recordLevelSeen } from '@/game/MetaProfile';
import { RunDirector } from '@/game/RunDirector';

/**
 * THE BRANCHING DESCENT (wave 3): floors 2 and 3 each offer two doors at the
 * Sanctum; floor 4 is always the Kiln Heart. These lock the graph, the
 * per-door seeds (the daily's two doors are everyone's two doors), the run's
 * route through saves and the ledger, and the meta profile's memory of doors.
 */

describe('the floor graph', () => {
  it('offers two doors on floors 2 and 3 and one on 1 and 4', () => {
    expect(FLOOR_DOORS).toEqual([['d1'], ['d2', 'd2b'], ['d3', 'd3b'], ['d4']]);
    expect(FLOORS_TOTAL).toBe(4);
    expect(CAMPAIGN_FLOORS).toEqual(['d1', 'd2', 'd3', 'd4']);
    expect(CAMPAIGN_LEVELS).toEqual(['d1', 'd2', 'd2b', 'd3', 'd3b', 'd4']);
    expect(LEVELS.d2b).toMatchObject({ name: 'THE COLD STORE', biome: 'frozen', depth: 2, boss: 'rimewarden' });
    expect(LEVELS.d3b).toMatchObject({ name: 'THE GLASS GALLERIES', biome: 'crystal', depth: 3, boss: 'lenswright' });
  });

  it('numbers either door as its floor', () => {
    expect(floorOf('d2b')).toBe(2);
    expect(floorOf('d3b')).toBe(3);
    expect(floorLabel('d2b')).toBe('Floor 2 of 4');
    expect(floorLabel('d3b')).toBe('Floor 3 of 4');
    expect(floorDisplayName('d2b')).toBe('The Cold Store');
    expect(floorDisplayName('d3b')).toBe('The Glass Galleries');
  });

  it('leads every door of a floor to both doors of the next', () => {
    expect(nextDoors('d1')).toEqual(['d2', 'd2b']);
    expect(nextDoors('d2')).toEqual(['d3', 'd3b']);
    expect(nextDoors('d2b')).toEqual(['d3', 'd3b']);
    expect(nextDoors('d3')).toEqual(['d4']);
    expect(nextDoors('d3b')).toEqual(['d4']);
    expect(nextDoors('d4')).toEqual([]);
    expect(nextDoors('physics-test')).toEqual([]);
    // nextLevelId stays each floor's first door below (single-door callers).
    for (const id of CAMPAIGN_LEVELS) {
      const doors = nextDoors(id);
      expect(LEVELS[id].nextLevelId).toBe(doors[0] ?? null);
    }
  });

  it('gives every door a teaser: its lore, its epigraph', () => {
    for (const id of CAMPAIGN_LEVELS) {
      const lore = FLOOR_LORE[id];
      expect(lore?.line.length, id).toBeGreaterThan(20);
      expect(lore?.signature.length, id).toBeGreaterThan(10);
      expect(lore?.resident.length, id).toBeGreaterThan(10);
      expect(FLOOR_LOOKS[LEVELS[id].biome].epigraph.length, id).toBeGreaterThan(10);
    }
    // The two new floors read differently from the doors beside them.
    expect(FLOOR_LOOKS.frozen.epigraph).not.toBe(FLOOR_LOOKS.fungal.epigraph);
    expect(FLOOR_LOOKS.crystal.epigraph).not.toBe(FLOOR_LOOKS.flooded.epigraph);
    expect(TWO_DOORS_LINE.length).toBeGreaterThan(20);
  });
});

describe('door seeds', () => {
  it('salts the expedition seed with the level id (the Levels contract)', () => {
    for (const id of CAMPAIGN_LEVELS) expect(levelSeedFor(0xdeadbeef, id)).toBe((0xdeadbeef ^ fnv1aString(id)) >>> 0);
  });

  it('makes both doors of a daily deterministic and different', () => {
    const today = dailySeed('2026-09-27');
    expect(dailySeed('2026-09-27')).toBe(today);
    const doors2 = FLOOR_DOORS[1].map((id) => levelSeedFor(today, id));
    const doors3 = FLOOR_DOORS[2].map((id) => levelSeedFor(today, id));
    expect(new Set([...doors2, ...doors3]).size).toBe(4);
    expect(FLOOR_DOORS[1].map((id) => levelSeedFor(dailySeed('2026-09-27'), id))).toEqual(doors2);
    // A different day is a different pair of doors.
    expect(levelSeedFor(dailySeed('2026-09-28'), 'd2b')).not.toBe(doors2[1]);
  });
});

describe('the route', () => {
  it('keeps one door per floor, in floor order, and nothing off the spine', () => {
    expect(cleanRunPath(['d1', 'd2b', 'd1', 'd2', 'physics-test', 'd3b', 7, 'd4'])).toEqual(['d1', 'd2b', 'd3b', 'd4']);
    expect(cleanRunPath(undefined)).toEqual([]);
    expect(doorTaken(['d1', 'd2b'], 2)).toBe('d2b');
    expect(doorTaken(['d1'], 2)).toBe('d2');
    expect(routeNames(['d1', 'd2b', 'd3'])).toEqual(['The Cold Store', 'The Drowned Cisterns']);
  });

  it('names the branch doors on the share line', () => {
    const summary = buildRunSummary({
      outcome: 'fallen', seed: 1, daily: '2026-09-27', kit: 'spark', floor: 3, floorName: 'The Glass Galleries', floorsTotal: 4,
      timeMs: 600_000, kills: 3, alchemicalKills: 2, bestChain: 0, deaths: 3, gold: 10, cardsFound: 1, path: ['d1', 'd2b', 'd3b'],
    });
    expect(summary.path).toEqual(['d1', 'd2b', 'd3b']);
    expect(shareLine(summary)).toBe('Breathing Works — daily 2026-09-27 — Floor 3/4 in 10:00 · via the Cold Store and the Glass Galleries · 2 alchemical kills');
  });
});

interface Harness {
  ctx: Ctx;
  run: RunDirector;
  ended: RunSummary[];
  enter(id: string): void;
}

function harness(): Harness {
  const events = new EventBus();
  let current: Partial<LevelRuntime> | null = null;
  const ctx = {
    events,
    state: { mode: 'play', score: 0, debugGodMode: false, debugTainted: false, paused: false },
    player: { x: 0, y: 0, dead: false },
    enemies: [] as Enemy[],
    audio: new Proxy({}, { get: () => () => undefined }),
    telemetry: { count: () => undefined },
    levels: {
      get current() { return current; },
      transitioning: false,
      saveDeathCheckpoint: () => undefined,
      saveExpedition: () => undefined,
      abandonExpedition: () => undefined,
      runStatus: () => ({ worldSeed: 99 }),
    },
  } as unknown as Ctx;
  const run = new RunDirector(ctx);
  ctx.run = run;
  const ended: RunSummary[] = [];
  events.on('runEnded', (s) => ended.push(s));
  return {
    ctx, run, ended,
    enter(id: string) {
      current = { def: LEVELS[id], living: undefined, refuge: undefined } as Partial<LevelRuntime>;
      events.emit('levelChanged', { depth: LEVELS[id].depth, name: LEVELS[id].name });
    },
  };
}

describe('a run through the second doors', () => {
  it('records its route, carries it through a save, and hands it to the ledger', () => {
    const h = harness();
    h.run.beginRun(h.ctx, { seed: 7, kit: 'spark', daily: null, tracked: true });
    h.enter('d1');
    h.enter('d2b');
    const snap = h.run.snapshotForSave() as RunSaveState;
    expect(snap.path).toEqual(['d1', 'd2b']);
    expect(snap.maxFloor).toBe(2);

    // Resume mid-branch: the route and the floor come back.
    const g = harness();
    g.run.restoreFromSave(g.ctx, JSON.parse(JSON.stringify(snap)) as RunSaveState);
    g.enter('d2b');
    g.enter('d3b');
    // Walking back up never rewrites the door a floor took.
    g.enter('d2');
    g.enter('d3b');
    expect(g.run.snapshotForSave()?.path).toEqual(['d1', 'd2b', 'd3b']);
    g.run.abandon(g.ctx);
    expect(g.ended).toHaveLength(1);
    expect(g.ended[0].path).toEqual(['d1', 'd2b', 'd3b']);
    expect(g.ended[0].floor).toBe(3);
    expect(g.ended[0].floorName).toBe('The Glass Galleries');
  });

  it('resumes a save from before the branch on the first doors', () => {
    const h = harness();
    const legacy = {
      v: 1, phials: 2, kit: 'spark', daily: null, seed: 4, timeMs: 0, kills: 0, alchemicalKills: 0, bestChain: 0, deaths: 1,
      cardsFound: 0, maxFloor: 2, leviathanSlain: false, recorded: false,
    } as RunSaveState;
    h.run.restoreFromSave(h.ctx, legacy);
    h.enter('d2');
    expect(h.run.snapshotForSave()?.path).toEqual(['d2']);
  });

  it('counts the Lenswright as a floor-3 warden', () => {
    const h = harness();
    h.run.beginRun(h.ctx, { seed: 3, kit: 'spark', daily: null, tracked: true });
    h.enter('d3b');
    const warden = { kind: 'lenswright', x: 0, y: 0, hp: 1 } as unknown as Enemy;
    h.ctx.enemies.push(warden);
    h.run.update(h.ctx);
    h.ctx.enemies.length = 0;
    h.ctx.events.emit('enemyKilled', { kind: 'lenswright', x: 0, y: 0 } as never);
    h.run.update(h.ctx);
    expect(h.run.snapshotForSave()?.leviathanSlain).toBe(true);
  });
});

describe('the meta profile remembers doors', () => {
  it('records each campaign level once, and nothing else', () => {
    let p = defaultMetaProfile();
    expect(p.levelsSeen).toEqual([]);
    p = recordLevelSeen(p, 'd2b');
    p = recordLevelSeen(p, 'd2b');
    p = recordLevelSeen(p, 'physics-test');
    expect(p.levelsSeen).toEqual(['d2b']);
  });

  it('migrates a profile from before the branch, and cleans a bad list', () => {
    const { profile } = migrateMetaProfile({ version: 1, runsStarted: 2, bestFloor: 3 });
    expect(profile.levelsSeen).toEqual([]);
    expect(migrateMetaProfile({ version: 1, levelsSeen: ['d1', 'bogus', 'd3b', 'd1', 4] }).profile.levelsSeen).toEqual(['d1', 'd3b']);
  });
});

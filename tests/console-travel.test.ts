import { describe, expect, it, vi } from 'vitest';

import { createGameParams } from '@/config/params';
import { EventBus } from '@/core/events';
import { isRunTainted, taintRun } from '@/core/runTaint';
import type { Ctx, DebugFinishResult, DebugTravelResult, Enemy, LevelRuntime } from '@/core/types';
import { createPlayer } from '@/entities/Player';
import { createConsoleApi } from '@/game/console/commands';
import { splitCommandSequence } from '@/game/console/registry';
import { AT_SPOTS, allLevelIds, formatLevelTable, levelRows, parseFlags, resolveTravelTarget } from '@/game/console/travelTargets';
import { LEVELS, FLOORS_TOTAL } from '@/config/worldgraph';
import { World } from '@/sim/World';

/** Floor row of the mock world: feet may stand on row 100 (everything below is rock). */
const FLOOR = 100;

function runtimeFor(id: string): LevelRuntime {
  return {
    def: LEVELS[id],
    world: new World(),
    enemies: [],
    waystones: [{ x: 200, y: FLOOR, lit: false }, { x: 260, y: FLOOR, lit: false }],
    exit: null,
    explored: new Uint8Array(1),
    spawn: { x: 100, y: FLOOR },
    regions: null,
    cauldron: null,
    pickups: [{ kind: 'key', x: 220, y: FLOOR - 1, vx: 0, vy: 0, taken: false, data: {} }],
    portal: LEVELS[id].nextLevelId ? { x: 300, y: FLOOR - 6, open: false } : null,
    keyTaken: false,
    mechanisms: [],
    runeVaults: [],
    boss: LEVELS[id].boss ? { x: 400, y: FLOOR - 4, kind: LEVELS[id].boss } : null,
    weaverLairWebs: [],
    story: {
      pipes: [],
      camp: { x: 150, floorY: FLOOR, facing: 1, x0: 140, x1: 160 },
      valve: { x: 250, floorY: FLOOR, stageX: 250, stageHalfW: 20 },
      flue: null,
    },
  } as unknown as LevelRuntime;
}

interface Harness {
  ctx: Ctx;
  travels: Array<{ id: string; opts: unknown }>;
  finishes: Array<unknown>;
  emitted: string[];
  story: { untrack: ReturnType<typeof vi.fn> };
  run: { active: boolean; over: boolean; phials: number; kit: string };
}

function harness(opts: { mode?: 'play' | 'build'; level?: string; path?: string[]; tracked?: boolean } = {}): Harness {
  const events = new EventBus();
  const emitted: string[] = [];
  events.on('runComplete', () => emitted.push('runComplete'));
  events.on('levelCurtain', () => emitted.push('levelCurtain'));
  const player = createPlayer();
  player.x = 100;
  player.y = FLOOR;
  let current: LevelRuntime | null = runtimeFor(opts.level ?? 'd2');
  const story = { untrack: vi.fn() };
  const travels: Harness['travels'] = [];
  const finishes: unknown[] = [];
  const built = new Set<string>(['d1', opts.level ?? 'd2']);
  const run = {
    active: opts.tracked !== false,
    over: false,
    phials: 3,
    maxPhials: 3,
    kit: 'spark',
    snapshotForSave: () => (opts.path ? { path: opts.path } : null),
    debugSetPhials(_ctx: Ctx, n: number) {
      run.phials = n;
      return true;
    },
    debugSetKit(kit: string) {
      run.kit = kit;
      return true;
    },
    lastResult: { summary: { outcome: 'victory' }, recorded: false },
  };
  const ctx = {
    world: new World(),
    events,
    params: createGameParams(),
    state: { mode: opts.mode ?? 'play', playtestSource: null, debugGodMode: false, debugTainted: false, score: 7, frameCount: 10, difficulty: 3, arrivalGraceUntil: 400 },
    player,
    enemies: [] as Enemy[],
    camera: { x: 0, y: 0, snapTo(x: number, y: number) { this.x = x; this.y = y; } },
    physics: { entityFree: (_x: number, y: number) => y <= FLOOR },
    playerCtl: {
      respawn: vi.fn(() => { player.dead = false; }),
      kill: vi.fn(() => {
        player.dead = true;
        if (run.phials === 0) run.over = true;
      }),
    },
    enemyCtl: { kill: vi.fn() },
    story,
    run,
    sanctum: { isOpen: false, dismiss: vi.fn(), applyBoon: vi.fn(() => true), quickDescend: vi.fn(() => true) },
    pickups: { grantKey: vi.fn(() => 'granted' as const) },
    levels: {
      get current() { return current; },
      get transitioning() { return false; },
      findabilityReady: false,
      runStatus: () => ({ worldSeed: 424242, expeditionSeed: 424242 }),
      generatedLevels: () => [...built],
      levelSeed: (_c: Ctx, id: string) => id.length * 1000,
      debugTravel: (_c: Ctx, id: string, o: unknown): DebugTravelResult => {
        travels.push({ id, opts: o });
        const generated = !built.has(id);
        built.add(id);
        current = runtimeFor(id);
        return { ok: true, from: 'd2', to: id, generated, ms: 12 };
      },
      debugFinishFloor: (_c: Ctx, o: unknown): DebugFinishResult => {
        finishes.push(o);
        const from = current?.def.id ?? null;
        const door = (o as { door?: string }).door;
        if ((o as { sanctum?: boolean }).sanctum === false) current = runtimeFor(door ?? 'd3');
        return { ok: true, from, next: 'd3', doors: ['d3', 'd3b'] };
      },
      debugLightWaystone: vi.fn(() => true),
      debugApplyKit: vi.fn(() => true),
    },
  } as unknown as Ctx;
  ctx.console = createConsoleApi(ctx);
  return { ctx, travels, finishes, emitted, story, run };
}

describe('resolving a typed level', () => {
  it('takes ids, floors, next and prev, and lists the levels on a bad word', () => {
    expect(resolveTravelTarget('D3B', 'd2', null)).toEqual({ ok: true, id: 'd3b' });
    expect(resolveTravelTarget('3', 'd1', null)).toEqual({ ok: true, id: 'd3' });
    expect(resolveTravelTarget('2', 'd1', ['d1', 'd2b'])).toEqual({ ok: true, id: 'd2b' });
    expect(resolveTravelTarget('next', 'd2', ['d1', 'd2b', 'd3b'])).toEqual({ ok: true, id: 'd3b' });
    expect(resolveTravelTarget('prev', 'd3', ['d1', 'd2b'])).toEqual({ ok: true, id: 'd2b' });
    expect(resolveTravelTarget('physics-test', 'd1', null)).toEqual({ ok: true, id: 'physics-test' });
    const bad = resolveTravelTarget('dd3', 'd1', null);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.text).toContain('Unknown level "dd3"');
      for (const id of allLevelIds()) expect(bad.text).toContain(id);
      expect(bad.data.code).toBe('parse-level');
    }
    expect(resolveTravelTarget('5', 'd1', null).ok).toBe(false);
    expect(resolveTravelTarget('prev', 'd1', null).ok).toBe(false);
    expect(resolveTravelTarget('next', 'd4', null).ok).toBe(false);
    expect(resolveTravelTarget('next', 'physics-test', null).ok).toBe(false);
  });

  it('lists every level with floor, biome, boss and its doors, marking here and built', () => {
    const table = formatLevelTable(levelRows('d2', ['d1', 'd2']));
    for (const id of allLevelIds()) expect(table).toContain(id);
    expect(table).toMatch(/> d2 \*/);
    expect(table).toMatch(/d1 \*/);
    expect(table).toMatch(/d2b\s+2 of 4\s+The Cold Store\s+frozen\s+rimewarden\s+d3, d3b/);
    expect(table).toMatch(/d4\s+4 of 4\s+The Kiln Heart\s+volcanic\s+colossus\s+-/);
    expect(table).toContain('Test arenas');
  });

  it('parses --name value, --name=value and switches, and refuses the unknown', () => {
    const ok = parseFlags(['d3', '--at', 'boss', '--seed=9', '--fresh'], { values: ['at', 'seed'], switches: ['fresh'] });
    expect(ok).toMatchObject({ positional: ['d3'], values: { at: 'boss', seed: '9' } });
    expect(ok.switches.has('fresh')).toBe(true);
    expect(parseFlags(['--nope'], { values: [], switches: [] }).error?.text).toContain('Unknown option --nope');
    expect(parseFlags(['--at'], { values: ['at'], switches: [] }).error?.text).toContain('needs a value');
    expect(parseFlags(['--at', '--fresh'], { values: ['at'], switches: ['fresh'] }).error?.text).toContain('needs a value');
  });

  it('splits a sequence on unquoted semicolons', () => {
    expect(splitCommandSequence('goto d3; key;  portal ;')).toEqual(['goto d3', 'key', 'portal']);
    expect(splitCommandSequence('cell "a;b" 3; boss')).toEqual(['cell "a;b" 3', 'boss']);
    expect(splitCommandSequence('say a\\;b; c')).toEqual(['say a\\;b', 'c']);
    expect(splitCommandSequence('  ')).toEqual([]);
  });
});

describe('taint', () => {
  it('marks a run tainted once, and tells the story to stop writing', () => {
    const story = { untrack: vi.fn() };
    const ctx = { state: { debugGodMode: false, debugTainted: false }, story };
    expect(isRunTainted(ctx.state)).toBe(false);
    expect(taintRun(ctx)).toBe(true);
    expect(taintRun(ctx)).toBe(false);
    expect(isRunTainted(ctx.state)).toBe(true);
    expect(story.untrack).toHaveBeenCalledTimes(2);
    expect(isRunTainted({ debugGodMode: true })).toBe(true);
  });
});

describe('goto and levels', () => {
  it('needs a run, and says which command starts one', async () => {
    const h = harness({ mode: 'build' });
    const res = await h.ctx.console.exec('goto d3');
    expect(res.ok).toBe(false);
    expect(res.text).toContain('needs a run in progress');
    expect(res.text).toContain('run new');
    expect(res.text).toContain('run test --level d3');
    expect(h.travels).toHaveLength(0);
    expect(h.ctx.state.debugTainted).toBe(false);
  });

  it('refuses a Builder playtest and a finished run', async () => {
    const builder = harness();
    builder.ctx.state.playtestSource = 'builder';
    expect((await builder.ctx.console.exec('goto d3')).text).toContain('not in a Builder playtest');
    const over = harness();
    over.run.over = true;
    expect((await over.ctx.console.exec('goto d3')).text).toContain('The run has ended');
  });

  it('travels through debugTravel, taints once and says so once', async () => {
    const h = harness();
    const first = await h.ctx.console.exec('goto d3');
    expect(first.ok).toBe(true);
    expect(h.travels).toEqual([{ id: 'd3', opts: { seed: undefined, fresh: false } }]);
    expect(first.text).toContain('DEBUG TAINT');
    expect(first.text).toContain('built from the run seed');
    expect(first.data).toMatchObject({ action: 'goto', to: 'd3', floor: 3, generated: true, ms: 12, tainted: true, arrivalGraceUntil: 400 });
    expect(h.ctx.state.debugTainted).toBe(true);
    expect(h.ctx.state.debugGodMode).toBe(false);
    const second = await h.ctx.console.exec('goto d3');
    expect(second.text).not.toContain('DEBUG TAINT');
    expect(second.text).toContain('kept as you left it');
    expect(h.story.untrack).toHaveBeenCalled();
  });

  it('lists the levels when the id is wrong, and the spots when --at is', async () => {
    const h = harness();
    const bad = await h.ctx.console.exec('goto nowhere');
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain('d2b');
    expect(bad.text).toContain('frost-test');
    const at = await h.ctx.console.exec('goto d3 --at moon');
    expect(at.ok).toBe(false);
    for (const spot of AT_SPOTS) expect(at.text).toContain(spot);
    expect(h.travels).toHaveLength(0);
    expect(h.ctx.state.debugTainted).toBe(false);
  });

  it('resolves next, prev and a floor number by the doors the run walked', async () => {
    const h = harness({ path: ['d1', 'd2b'] });
    await h.ctx.console.exec('goto next');
    await h.ctx.console.exec('goto prev');
    await h.ctx.console.exec('goto 2');
    expect(h.travels.map((t) => t.id)).toEqual(['d3', 'd2b', 'd2b']);
  });

  it('passes --seed and --fresh to the rebuild, and rejects a bad seed', async () => {
    const h = harness();
    const seeded = await h.ctx.console.exec('goto d3b --seed 4242');
    expect(seeded.ok).toBe(true);
    expect(h.travels[0]).toEqual({ id: 'd3b', opts: { seed: 4242, fresh: false } });
    await h.ctx.console.exec('goto d3b --fresh');
    expect(h.travels[1].opts).toEqual({ seed: undefined, fresh: true });
    expect((await h.ctx.console.exec('goto d3 --seed nope')).ok).toBe(false);
    expect((await h.ctx.console.exec('goto d3 --seed')).text).toContain('needs a value');
    expect(h.travels).toHaveLength(2);
  });

  it('puts the alchemist at a spot on arrival, on footing, and keeps going when a spot does not exist', async () => {
    const h = harness();
    const at = await h.ctx.console.exec('goto d3 --at portal');
    expect(at.ok).toBe(true);
    expect(at.text).toContain('at the exit portal');
    expect(Math.abs(h.ctx.player.x - 300)).toBeGreaterThanOrEqual(12);
    expect(h.ctx.player.y).toBe(FLOOR);
    const d4 = await h.ctx.console.exec('goto d4 --at portal');
    expect(d4.ok).toBe(true);
    expect(d4.text).toContain('Could not place you --at portal');
    expect(d4.text).toContain('no exit portal');
  });

  it('leaves the Sanctum behind and gets a dead alchemist back on his feet', async () => {
    const h = harness();
    h.ctx.player.dead = true;
    const res = await h.ctx.console.exec('goto d3');
    expect(res.ok).toBe(true);
    expect(h.ctx.sanctum.dismiss).toHaveBeenCalled();
    expect(h.ctx.playerCtl.respawn).toHaveBeenCalled();
    expect(res.data).toMatchObject({ respawned: true });
  });

  it('answers levels without tainting', async () => {
    const h = harness();
    const res = await h.ctx.console.exec('levels');
    expect(res.ok).toBe(true);
    expect(res.text).toContain('> d2');
    expect(h.ctx.state.debugTainted).toBe(false);
  });
});

describe('skip, sanctum, win and lose', () => {
  it('skip opens the Sanctum through debugFinishFloor and taints', async () => {
    const h = harness();
    const res = await h.ctx.console.exec('skip');
    expect(res.ok).toBe(true);
    expect(h.finishes).toEqual([{ sanctum: true, door: undefined }]);
    expect(res.text).toContain('The Sanctum is open');
    expect(res.data).toMatchObject({ sanctum: true, doors: ['d3', 'd3b'] });
    expect(h.ctx.state.debugTainted).toBe(true);
  });

  it('skip --no-sanctum --door waits for the arrival and names the door', async () => {
    const h = harness();
    const res = await h.ctx.console.exec('descend --no-sanctum --door d3b');
    expect(res.ok).toBe(true);
    expect(h.finishes).toEqual([{ sanctum: false, door: 'd3b' }]);
    expect(res.data).toMatchObject({ sanctum: false, from: 'd2', to: 'd3b' });
    const bad = await harness().ctx.console.exec('skip --door d9');
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain('d3, d3b');
  });

  it('skip on the Kiln Heart ends the descent as a victory, never crediting it', async () => {
    const h = harness({ level: 'd4' });
    const res = await h.ctx.console.exec('skip');
    expect(res.ok).toBe(true);
    expect(h.emitted).toContain('runComplete');
    expect(h.finishes).toHaveLength(0);
    expect(res.text).toContain('victory');
    expect(h.ctx.state.debugTainted).toBe(true);
  });

  it('skip has nothing to take in a test arena, and waits for a living alchemist', async () => {
    const arena = harness({ level: 'physics-test' });
    expect((await arena.ctx.console.exec('skip')).text).toContain('has no exit');
    const dead = harness();
    dead.ctx.player.dead = true;
    expect((await dead.ctx.console.exec('skip')).text).toContain('respawn first');
  });

  it('sanctum [floor] goes there first, then opens', async () => {
    const h = harness({ level: 'd3' });
    const res = await h.ctx.console.exec('sanctum 2');
    expect(res.ok).toBe(true);
    expect(h.travels.map((t) => t.id)).toEqual(['d2']);
    expect(res.text).toContain('Went to d2 first');
    expect(h.finishes).toHaveLength(1);
    expect((await h.ctx.console.exec('sanctum 4')).ok).toBe(false);
  });

  it('win ends a tracked run, and says a test run has nothing to end', async () => {
    const h = harness();
    const res = await h.ctx.console.exec('win');
    expect(res.ok).toBe(true);
    expect(h.emitted).toContain('runComplete');
    expect(res.data).toMatchObject({ outcome: 'victory', recorded: false });
    const test = harness({ tracked: false });
    const none = await test.ctx.console.exec('win');
    expect(none.ok).toBe(false);
    expect(none.text).toContain('test run');
  });

  it('lose empties the phials and dies through the real path, god mode off', async () => {
    const h = harness();
    h.ctx.state.debugGodMode = true;
    const res = await h.ctx.console.exec('lose');
    expect(res.ok).toBe(true);
    expect(h.run.phials).toBe(0);
    expect(h.ctx.playerCtl.kill).toHaveBeenCalled();
    expect(h.ctx.state.debugGodMode).toBe(false);
    expect(h.ctx.state.debugTainted).toBe(true);
    expect(res.data).toMatchObject({ tracked: true, over: true });
  });

  it('respawn gets a dead alchemist up, refuses a live one and a finished run', async () => {
    const h = harness();
    expect((await h.ctx.console.exec('respawn')).text).toContain('not dead');
    h.ctx.player.dead = true;
    expect((await h.ctx.console.exec('respawn')).ok).toBe(true);
    expect(h.ctx.playerCtl.respawn).toHaveBeenCalled();
    h.run.over = true;
    h.ctx.player.dead = true;
    expect((await h.ctx.console.exec('respawn')).text).toContain('run is over');
  });
});

describe('the spots and the run state', () => {
  it('key collects through Pickups and reports the three outcomes', async () => {
    const h = harness();
    expect((await h.ctx.console.exec('key')).ok).toBe(true);
    (h.ctx.pickups.grantKey as ReturnType<typeof vi.fn>).mockReturnValueOnce('already-taken');
    expect((await h.ctx.console.exec('key')).text).toContain('already yours');
    (h.ctx.pickups.grantKey as ReturnType<typeof vi.fn>).mockReturnValueOnce('no-key');
    expect((await h.ctx.console.exec('key')).text).toContain('has no key');
  });

  it('portal, camp, echo, waystone and boss move the alchemist onto footing and taint', async () => {
    for (const [line, near] of [['portal', 300], ['camp', 150], ['echo', 250], ['waystone', 200], ['boss', 400]] as const) {
      const h = harness({ level: 'd2b' });
      const res = await h.ctx.console.exec(line);
      expect(res.ok, `${line}: ${res.text}`).toBe(true);
      expect(h.ctx.state.debugTainted, line).toBe(true);
      expect(h.ctx.player.y, line).toBe(FLOOR);
      expect(Math.abs(h.ctx.player.x - near), line).toBeLessThan(100);
    }
    const d4 = harness({ level: 'd4' });
    expect((await d4.ctx.console.exec('portal')).text).toContain('no exit portal');
  });

  it('boss kill takes the guardian down through enemyCtl.kill', async () => {
    const h = harness({ level: 'd2b' });
    expect((await h.ctx.console.exec('boss kill')).text).toContain('already down');
    h.ctx.enemies.push({ kind: 'rimewarden', hp: 100, x: 400, y: 96 } as unknown as Enemy);
    const res = await h.ctx.console.exec('boss kill');
    expect(res.ok).toBe(true);
    expect(h.ctx.enemyCtl.kill).toHaveBeenCalledTimes(1);
    expect((await harness({ level: 'd2' }).ctx.console.exec('boss')).text).toContain('no guardian');
  });

  it('waystone light goes through the real ignition', async () => {
    const h = harness();
    const res = await h.ctx.console.exec('waystone light 2');
    expect(res.ok).toBe(true);
    expect(h.ctx.levels.debugLightWaystone).toHaveBeenCalledWith(h.ctx, 1);
    expect((await h.ctx.console.exec('waystone 9')).text).toContain('1 to 2');
  });

  it('phials, boon, kit and tier read without tainting and set with it', async () => {
    const h = harness();
    expect((await h.ctx.console.exec('phials')).text).toBe('Return phials: 3 of 3.');
    expect((await h.ctx.console.exec('boon')).text).toContain('ironhide');
    expect((await h.ctx.console.exec('kit')).text).toContain('storm');
    expect((await h.ctx.console.exec('tier')).text).toContain('Conjurer');
    expect((await h.ctx.console.exec('seed')).ok).toBe(true);
    expect(h.ctx.state.debugTainted).toBe(false);
    expect(h.story.untrack).not.toHaveBeenCalled();

    expect((await h.ctx.console.exec('phials 1')).ok).toBe(true);
    expect(h.run.phials).toBe(1);
    expect(h.ctx.state.debugTainted).toBe(true);

    const boon = await h.ctx.console.exec('boon ironhide');
    expect(boon.ok).toBe(true);
    expect(h.ctx.sanctum.applyBoon).toHaveBeenCalledWith(h.ctx, 'ironhide');

    const kit = await h.ctx.console.exec('kit storm');
    expect(kit.ok).toBe(true);
    expect(h.ctx.levels.debugApplyKit).toHaveBeenCalledWith(h.ctx, 'storm');
    expect(h.run.kit).toBe('storm');

    expect((await h.ctx.console.exec('tier 4')).ok).toBe(true);
    expect(h.ctx.state.difficulty).toBe(4);
    expect((await h.ctx.console.exec('tier adept')).ok).toBe(true);
    expect(h.ctx.state.difficulty).toBe(2);
  });

  it('refuses what it cannot do, listing the valid options', async () => {
    const h = harness();
    expect((await h.ctx.console.exec('phials 9')).text).toContain('0 to 3');
    expect((await h.ctx.console.exec('boon nothing')).text).toContain('vitality');
    expect((await h.ctx.console.exec('kit nothing')).text).toContain('spark, frost, ember, storm');
    expect((await h.ctx.console.exec('tier 7')).text).toContain('Apprentice');
    expect((await h.ctx.console.exec('seed 5')).text).toContain('run new --seed n');
    expect(h.ctx.state.debugTainted).toBe(false);
  });

  it('every travel command that changes something leaves the run tainted and the story untracked', async () => {
    const lines = ['goto d3', 'skip', 'sanctum', 'portal', 'camp', 'echo', 'waystone', 'waystone light', 'boss', 'boss kill', 'key', 'phials 2', 'boon might', 'kit frost', 'tier 4', 'win', 'lose'];
    for (const line of lines) {
      const h = harness({ level: 'd2b' });
      h.ctx.enemies.push({ kind: 'rimewarden', hp: 100, x: 400, y: 96 } as unknown as Enemy);
      const res = await h.ctx.console.exec(line);
      expect(res.ok, `${line}: ${res.text}`).toBe(true);
      expect(h.ctx.state.debugTainted, line).toBe(true);
      expect(h.story.untrack, line).toHaveBeenCalled();
    }
  });

  it('keeps the older QA commands tainting the story as well', async () => {
    const h = harness();
    const res = await h.ctx.console.exec('tp ~5 ~0');
    expect(res.ok).toBe(true);
    expect(h.ctx.state.debugGodMode).toBe(true);
    expect(h.story.untrack).toHaveBeenCalled();
  });
});

describe('seq', () => {
  it('runs each command after the last and stops at the first failure', async () => {
    const h = harness();
    const ok = await h.ctx.console.exec('seq goto d3; key; portal');
    expect(ok.ok).toBe(true);
    expect(h.travels.map((t) => t.id)).toEqual(['d3']);
    expect(ok.text).toContain('seq ran 3 commands');
    expect((h.ctx.pickups.grantKey as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    const stopped = await harness().ctx.console.exec('seq goto nowhere; key');
    expect(stopped.ok).toBe(false);
    expect(stopped.text).toContain('stopped at step 1 of 2');
    expect((await h.ctx.console.exec('seq seq key')).ok).toBe(false);
    expect((await h.ctx.console.exec('seq')).text).toContain('Usage');
  });

  it('completes the command after the last semicolon', () => {
    const h = harness();
    expect(h.ctx.console.complete('seq goto d2; ke')).toContain('key');
    expect(h.ctx.console.complete('seq go')).toContain('goto');
    expect(h.ctx.console.complete('seq goto d2; goto d3b --a')).toContain('--at');
  });
});

describe('completion', () => {
  it('offers level ids, floors, next/prev, flags and their values', () => {
    const { ctx } = harness();
    const c = ctx.console.complete.bind(ctx.console);
    expect(c('goto ')).toEqual(expect.arrayContaining(['d1', 'd2b', 'd4', 'physics-test', '1', '4', 'next', 'prev']));
    expect(c('goto d')).toEqual(expect.arrayContaining(['d1', 'd2', 'd2b', 'd3', 'd3b', 'd4']));
    expect(c('goto n')).toEqual(['next']);
    expect(c('goto d3 --')).toEqual(expect.arrayContaining(['--at', '--seed', '--fresh']));
    expect(c('goto d3 --at ')).toEqual(expect.arrayContaining([...AT_SPOTS]));
    expect(c('goto d3 --at bo')).toEqual(['boss']);
    expect(c('goto d3 --at=ca')).toEqual(['--at=camp']);
    expect(c('goto d3 ')).toEqual([]);
    expect(c('skip --')).toEqual(expect.arrayContaining(['--no-sanctum', '--door']));
    expect(c('skip --door d3')).toEqual(expect.arrayContaining(['d3', 'd3b']));
    expect(c('boon iron')).toEqual(['ironhide']);
    expect(c('boon v')).toEqual(expect.arrayContaining(['vitality', 'vampirism', 'velvethood']));
    expect(c('kit s')).toEqual(expect.arrayContaining(['spark', 'storm']));
    expect(c('tier ')).toEqual(expect.arrayContaining(['1', '2', '3', '4', 'adept']));
    expect(c('phials ')).toEqual(['0', '1', '2', '3']);
    expect(c('boss k')).toEqual(['kill']);
    expect(c('waystone l')).toEqual(['light']);
    expect(c('sanctum ')).toEqual(['1', '2', '3']);
    expect(c('go')).toContain('goto');
  });

  it('knows every floor the descent has', () => {
    expect(FLOORS_TOTAL).toBe(4);
  });
});

describe('help for the travel commands', () => {
  it('files them under Run & levels, marks the taints and gives examples', async () => {
    const { ctx } = harness();
    const runs = await ctx.console.exec('help runs');
    for (const name of ['levels', 'goto', 'skip', 'sanctum', 'portal', 'boss', 'key', 'waystone', 'phials', 'boon', 'kit', 'tier', 'seed', 'win', 'lose']) {
      expect(runs.text, name).toMatch(new RegExp(`^  ${name}\\b`, 'm'));
    }
    expect(runs.text).toMatch(/goto <level\|floor\|next\|prev>.*\[taints\]/);
    expect(runs.text).not.toMatch(/levels\s.*\[taints\]/);
    const goto = await ctx.console.exec('? goto');
    expect(goto.text).toContain('Taints the run');
    expect(goto.text).toContain('goto next --at portal');
    const story = await ctx.console.exec('help story');
    expect(story.text).toMatch(/^  camp/m);
    expect(story.text).toMatch(/^  echo/m);
    expect((await ctx.console.exec('help skip')).text).toMatch(/aliases\s+descend/);
  });
});

import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import type { Ctx, Enemy, LevelRuntime } from '@/core/types';
import type { StoryRunSave } from '@/core/story';
import { LEVELS } from '@/config/worldgraph';
import { RunDirector } from '@/game/RunDirector';
import { KilnEscape } from '@/game/story/KilnEscape';
import type { StoryHost } from '@/game/story/host';
import { defaultStoryMeta, type StoryMetaData } from '@/game/story/storyMeta';
import { freshStoryRun, sanitizeStoryRun } from '@/game/story/storyRun';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { carveKilnFlue, planKilnFlue } from '@/world/kilnFlue';

/**
 * THE KILN ESCAPE, headless: the heave opens the flue, real lava rises in it,
 * a death in the climb restarts it without a phial, and victory waits for the
 * top of the flue (tests/story-world.test.ts proves the route on real seeds).
 */

function kilnWorld(): { world: World; flue: ReturnType<typeof planKilnFlue> } {
  const world = new World();
  world.types.fill(Cell.Stone);
  const cx = 700, cy = 938;
  // The Kiln's vault (a plain box is enough here) and its floor.
  for (let y = cy - 40; y <= cy + 29; y++) for (let x = cx - 58; x <= cx + 58; x++) world.types[world.idx(x, y)] = Cell.Empty;
  const flue = planKilnFlue(cx, cy, null);
  carveKilnFlue(world, flue);
  return { world, flue };
}

function escapeHarness() {
  const { world, flue } = kilnWorld();
  const events = new EventBus();
  let clock = 100;
  let run: StoryRunSave = freshStoryRun(1);
  let meta: StoryMetaData = defaultStoryMeta();
  const said: string[] = [];
  const objectives: string[] = [];
  events.on('objectiveChanged', ({ text }) => objectives.push(text));
  let respawns = 0;
  const rt = { story: { pipes: [], camp: null, valve: null, flue }, mapWaypoint: null } as unknown as LevelRuntime;
  const player = { x: flue.start.x, y: flue.start.y, vx: 0, vy: 0, dead: false, hp: 100, maxHp: 100 };
  const ctx = {
    world, events, player,
    state: { mode: 'play', frameCount: 0, reduceCameraShake: false, reduceFlashes: false },
    fx: { screenShake: 0, bloomKick: 0 },
    camera: { cineDy: 0, snapTo: () => undefined },
    audio: new Proxy({}, { get: () => () => undefined }),
    particles: new Proxy({}, { get: () => () => undefined }),
    levels: { current: rt, transitioning: false },
    playerCtl: { respawn: () => { respawns++; player.dead = false; player.x = flue.start.x; player.y = flue.start.y; } },
  } as unknown as Ctx;
  const host: StoryHost = {
    ctx, meta: () => meta, updateMeta: (fn) => { meta = fn(meta); }, run: () => run, setRun: (next) => { run = next; },
    say: (lines) => { said.push(...lines.map(l => l.text)); return true; }, lineSeconds: () => 3, unlockJournal: () => undefined,
    levelId: () => 'd4', biome: () => 'volcanic', floor: () => 4, now: () => clock,
  };
  const escape = new KilnEscape(host);
  const tick = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) { clock += 1 / 60; (ctx.state as { frameCount: number }).frameCount++; escape.update(1 / 60); }
  };
  const lavaIn = (y: number): number => {
    let n = 0;
    for (let x = flue.shaft.x0; x <= flue.shaft.x1; x++) if (world.types[world.idx(x, y)] === Cell.Lava) n++;
    return n;
  };
  return { world, flue, ctx, escape, tick, lavaIn, said, objectives, rt, player, get run() { return run; }, get respawns() { return respawns; } };
}

describe('the Kiln escape', () => {
  it('the heave blows the damper, fuses the chimney, sets the objective and the compass on the hatch', () => {
    const h = escapeHarness();
    let done = 0;
    expect(h.world.types[h.world.idx(h.flue.damper.x0, h.flue.damper.y1)]).toBe(Cell.Metal);
    expect(h.escape.begin(() => { done++; })).toBe(true);
    expect(h.escape.active).toBe(true);
    expect(h.run.escape).toBe('active');
    expect(h.world.types[h.world.idx(h.flue.damper.x0, h.flue.damper.y1)]).toBe(Cell.Empty);
    expect(h.said[0]).toMatch(/Heart is heaving/);
    expect(h.objectives.at(-1)).toMatch(/Climb the flue/);
    expect(h.rt.mapWaypoint).toMatchObject({ label: 'The Hatch' });
    // No second heave, and no escape at all without a flue.
    expect(h.escape.begin(() => undefined)).toBe(false);
    expect(done).toBe(0);
  });

  it('after a breath, real lava rises up the shaft', () => {
    const h = escapeHarness();
    h.escape.begin(() => undefined);
    h.player.y = h.flue.shaft.y0 + 30; // well up the climb, out of the way
    h.tick(2);
    expect(h.lavaIn(h.flue.lavaFrom)).toBe(0); // still the breath before
    h.tick(6);
    expect(h.lavaIn(h.flue.lavaFrom)).toBeGreaterThan(20);
    expect(h.lavaIn(h.flue.lavaFrom - 25)).toBeGreaterThan(0);
  });

  it('a death in the climb costs nothing: the flue is set back and he starts again at its foot', () => {
    const h = escapeHarness();
    h.escape.begin(() => undefined);
    h.player.y = h.flue.shaft.y0 + 30;
    h.tick(9);
    expect(h.lavaIn(h.flue.lavaFrom)).toBeGreaterThan(0);
    h.player.dead = true;
    h.tick(2);
    expect(h.respawns).toBe(1);
    expect(h.lavaIn(h.flue.lavaFrom)).toBe(0);
    expect(h.escape.respawnPoint()).toEqual(h.flue.start);
    expect(h.escape.active).toBe(true);
  });

  it('victory waits for the top of the flue', () => {
    const h = escapeHarness();
    let done = 0;
    h.escape.begin(() => { done++; });
    h.tick(4);
    expect(done).toBe(0);
    h.player.x = h.flue.exit.x; h.player.y = h.flue.exit.y;
    h.tick(0.1);
    expect(done).toBe(1);
    expect(h.run.escape).toBe('done');
    expect(h.escape.active).toBe(false);
    expect(h.escape.respawnPoint()).toBeNull();
  });

  it('a save taken mid-escape carries the escape', () => {
    expect(sanitizeStoryRun(JSON.parse(JSON.stringify({ ...freshStoryRun(2), escape: 'active' }))).escape).toBe('active');
  });
});

describe('RunDirector during the escape', () => {
  it('spends no phial for a fall in the climb, and waits for the story\'s victory', () => {
    const events = new EventBus();
    let escaping = true;
    let current: Partial<LevelRuntime> | null = null;
    const ctx = {
      events,
      state: { mode: 'play', score: 0, debugGodMode: false, debugTainted: false, paused: false, playtestSource: null },
      player: { x: 0, y: 0, dead: false },
      enemies: [] as Enemy[],
      audio: new Proxy({}, { get: () => () => undefined }),
      telemetry: { count: () => undefined },
      story: { get escapeActive() { return escaping; } },
      levels: {
        get current() { return current; }, transitioning: false, saveDeathCheckpoint: () => undefined, saveExpedition: () => undefined,
        abandonExpedition: () => undefined, runStatus: () => ({ worldSeed: 1 }),
      },
    } as unknown as Ctx;
    const run = new RunDirector(ctx);
    ctx.run = run;
    const ended: string[] = [];
    events.on('runEnded', (s) => ended.push(s.outcome));
    run.beginRun(ctx, { seed: 3, kit: 'spark', daily: null, tracked: true });
    current = { def: LEVELS.d4 } as Partial<LevelRuntime>;
    events.emit('levelChanged', { depth: 4, name: 'THE KILN HEART' });
    for (let i = 0; i < 5; i++) events.emit('playerDied', { depth: 4, level: 'THE KILN HEART', gold: 0, cause: 'lava' });
    expect(run.phials).toBe(3);
    expect(run.active).toBe(true);
    expect(ended).toEqual([]);
    escaping = false;
    events.emit('runComplete', { gold: 0 });
    expect(ended).toEqual(['victory']);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrewAttemptInfo, CauldronView } from '@/core/alchemy';
import type { Ctx } from '@/core/types';
import { Brewing } from '@/game/Brewing';
import { loadExperiments, resetGrimoireCacheForTests } from '@/game/GrimoireStore';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

/** THE EXPERIMENT at the cauldron: a heated mix that matches nothing is an attempt, judged once. */
const CAULDRON = { x: 40, y: 40 };
const BASIN: Array<[number, number]> = [];
for (let dy = -2; dy <= 0; dy++) for (let dx = -3; dx <= 3; dx++) BASIN.push([CAULDRON.x + dx, CAULDRON.y + dy]);

interface Seen {
  toasts: string[];
  attempts: BrewAttemptInfo[];
  views: CauldronView[];
  sfx: string[];
  brewed: string[];
}

function makeCtx(world: World, seen: Seen): Ctx {
  return {
    world,
    state: { mode: 'play', frameCount: 0, score: 0 },
    levels: { current: { def: { id: 'd2' }, cauldron: CAULDRON } },
    player: { x: CAULDRON.x + 12, y: CAULDRON.y },
    particles: { spawn: () => undefined, burst: () => undefined },
    audio: { sfx: (id: string) => seen.sfx.push(id), bubble: () => undefined },
    events: {
      emit: (event: string, payload: unknown) => {
        if (event === 'toast') seen.toasts.push((payload as { text: string }).text);
        else if (event === 'brewAttempt') seen.attempts.push(payload as BrewAttemptInfo);
        else if (event === 'cauldronView') seen.views.push(payload as CauldronView);
        else if (event === 'recipeBrewed') seen.brewed.push((payload as { id: string }).id);
      },
    },
    telemetry: { count: () => undefined },
  } as unknown as Ctx;
}

/** Fill the basin from the bottom row up: `fill` is [cell, n] pairs. Fire sits beside the right wall when `fire`. */
function pour(world: World, fill: Array<[Cell, number]>, fire = true): void {
  const cells: Cell[] = [];
  for (const [cell, n] of fill) for (let i = 0; i < n; i++) cells.push(cell);
  for (const [index, [x, y]] of BASIN.entries()) {
    const i = world.idx(x, y);
    world.types[i] = cells[index] ?? Cell.Empty;
    world.life[i] = 0;
    world.charge[i] = 0;
  }
  world.types[world.idx(CAULDRON.x + 5, CAULDRON.y)] = fire ? Cell.Fire : Cell.Empty;
}

function run(ctx: Ctx, brewing: Brewing, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    ctx.state.frameCount += 4;
    brewing.update(ctx);
  }
}

const fresh = (): Seen => ({ toasts: [], attempts: [], views: [], sfx: [], brewed: [] });

describe('the experiment', () => {
  beforeEach(() => resetGrimoireCacheForTests());
  afterEach(() => {
    resetGrimoireCacheForTests();
    vi.unstubAllGlobals();
  });

  it('judges a heated near-miss once: it shimmers, the log keeps it, nobody is told the recipe', () => {
    const seen = fresh();
    const world = new World();
    const ctx = makeCtx(world, seen);
    const brewing = new Brewing();
    // Water 8 + Blood 3 is Life (Water 8 + Blood 5) short two Blood.
    pour(world, [[Cell.Water, 8], [Cell.Blood, 3]]);
    run(ctx, brewing, 23);
    expect(seen.attempts).toHaveLength(0); // not yet: it has to stand a moment
    run(ctx, brewing, 3);
    expect(seen.attempts).toHaveLength(1);
    const a = seen.attempts[0];
    expect(a.verdict).toBe('close');
    expect(a.closeTo).toBe('life');
    expect(a.closeToKnown).toBe(false);
    expect(a.feel).toEqual({ [Cell.Water]: 'hot', [Cell.Blood]: 'warm' });
    expect(a.first).toBe(true);
    expect(seen.toasts).toContain('CAULDRON: THE BREW SHIMMERS. YOU ARE CLOSE TO SOMETHING');
    expect(seen.toasts.join('\n')).not.toMatch(/LIFE/i);
    expect(seen.sfx).toContain('brew.shimmer');
    expect(loadExperiments()).toMatchObject([{ sig: '2:8,18:3', verdict: 'close', closeTo: 'life', feel: { '2': 'hot', '18': 'warm' }, tries: 1 }]);
    // and it is not judged again while the bowl stands as it is
    run(ctx, brewing, 200);
    expect(seen.attempts).toHaveLength(1);
    // the bowl panel's last view carries the temperatures
    const last = seen.views[seen.views.length - 1];
    expect(last.verdict).toBe('close');
    expect(last.reagents).toEqual([
      { cell: Cell.Water, n: 8, feel: 'hot' },
      { cell: Cell.Blood, n: 3, feel: 'warm' },
    ]);
  });

  it('tries the same mix again as a second try, not a second line', () => {
    const seen = fresh();
    const world = new World();
    const ctx = makeCtx(world, seen);
    const brewing = new Brewing();
    pour(world, [[Cell.Water, 8], [Cell.Blood, 3]]);
    run(ctx, brewing, 30);
    pour(world, [[Cell.Water, 12]]); // changes the mix
    run(ctx, brewing, 70); // past the gap between judgments
    pour(world, [[Cell.Water, 8], [Cell.Blood, 3]]);
    run(ctx, brewing, 70);
    expect(seen.attempts.map((a) => [a.first, a.tries])).toEqual([[true, 1], [true, 1], [false, 2]]);
    expect(loadExperiments()).toHaveLength(2);
  });

  it('says a clouded mix clouds, and a mix that answers nothing, nothing', () => {
    const seen = fresh();
    const world = new World();
    const ctx = makeCtx(world, seen);
    const brewing = new Brewing();
    pour(world, [[Cell.Water, 8], [Cell.Blood, 5], [Cell.Oil, 1]]); // Life's amounts met, plus 1 stray: forgiven
    run(ctx, brewing, 5);
    expect(seen.attempts).toHaveLength(0);
    pour(world, [[Cell.Water, 8], [Cell.Blood, 5], [Cell.Acid, 1]]);
    run(ctx, brewing, 100);
    expect(seen.brewed).toContain('life'); // a stray cell or two never spoils a brew

    const seen2 = fresh();
    const world2 = new World();
    const ctx2 = makeCtx(world2, seen2);
    const b2 = new Brewing();
    pour(world2, [[Cell.Water, 8], [Cell.Blood, 5], [Cell.Oil, 3]]);
    run(ctx2, b2, 30);
    expect(seen2.attempts[0].verdict).toBe('muddy');
    expect(seen2.attempts[0].feel[Cell.Oil]).toBe('cold');
    expect(seen2.toasts).toContain('CAULDRON: THE BREW CLOUDS. SOMETHING DOES NOT BELONG');

    const seen3 = fresh();
    const world3 = new World();
    const ctx3 = makeCtx(world3, seen3);
    const b3 = new Brewing();
    pour(world3, [[Cell.Oil, 7], [Cell.Acid, 3]]);
    run(ctx3, b3, 30);
    expect(seen3.attempts[0].verdict).toBe('inert');
    expect(seen3.attempts[0].closeTo).toBeNull();
    expect(seen3.toasts).toContain('CAULDRON: NOTHING STIRS');
    expect(seen3.sfx).toContain('brew.fizzle');
  });

  it('never judges a cold bowl, a bowl with next to nothing in it, or one nobody is tending', () => {
    const seen = fresh();
    const world = new World();
    const ctx = makeCtx(world, seen);
    const brewing = new Brewing();
    pour(world, [[Cell.Water, 8], [Cell.Blood, 3]], false);
    run(ctx, brewing, 100);
    expect(seen.attempts).toHaveLength(0);
    expect(seen.toasts).toContain('CAULDRON: NEEDS HEAT');
    pour(world, [[Cell.Water, 3]]); // a few drips over a fire
    run(ctx, brewing, 100);
    expect(seen.attempts).toHaveLength(0);
    pour(world, [[Cell.Water, 8], [Cell.Blood, 3]]);
    ctx.player.x = CAULDRON.x + 400;
    run(ctx, brewing, 100);
    expect(seen.attempts).toHaveLength(0);
    expect(loadExperiments()).toEqual([]);
  });

  it('says only that it simmers until the recipe is written, and names it after', () => {
    const seen = fresh();
    const world = new World();
    const ctx = makeCtx(world, seen);
    const brewing = new Brewing();
    pour(world, [[Cell.Water, 9], [Cell.Slime, 4]]);
    run(ctx, brewing, 5);
    expect(seen.toasts).toEqual(['CAULDRON: SIMMERING']);
    const view = seen.views[seen.views.length - 1];
    expect(view.matched).toBe(true);
    expect(view.progress).toBeGreaterThan(0);

    const storage = new Map<string, string>([['noita-grimoire', JSON.stringify({ levity: true })]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    resetGrimoireCacheForTests();
    const seen2 = fresh();
    const world2 = new World();
    const ctx2 = makeCtx(world2, seen2);
    pour(world2, [[Cell.Water, 9], [Cell.Slime, 4]]);
    run(ctx2, new Brewing(), 5);
    expect(seen2.toasts).toEqual(['CAULDRON: BREWING ELIXIR OF LEVITY']);
  });

  it('reveals nothing in the panel before there is fire: contents and heat only', () => {
    const seen = fresh();
    const world = new World();
    const ctx = makeCtx(world, seen);
    const brewing = new Brewing();
    pour(world, [[Cell.Water, 9], [Cell.Slime, 4]], false); // a perfect Levity, but cold
    run(ctx, brewing, 3);
    const view = seen.views[seen.views.length - 1];
    expect(view.heated).toBe(false);
    expect(view.matched).toBe(false);
    expect(view.progress).toBe(0);
    expect(view.verdict).toBeNull();
    expect(view.mass).toBe(13);
    expect(brewing.view()).toBe(view);
  });

  it('hides the panel when the player walks away, once', () => {
    const seen = fresh();
    const world = new World();
    const ctx = makeCtx(world, seen);
    const brewing = new Brewing();
    pour(world, [[Cell.Water, 9], [Cell.Slime, 4]], false);
    run(ctx, brewing, 3);
    expect(brewing.view().visible).toBe(true);
    ctx.player.x = CAULDRON.x + 300;
    run(ctx, brewing, 5);
    expect(brewing.view().visible).toBe(false);
    expect(seen.views.filter((v) => !v.visible)).toHaveLength(1);
  });

  it('turns only what the recipe consumes into elixir, and leaves a finished potion alone', () => {
    const seen = fresh();
    const world = new World();
    const ctx = makeCtx(world, seen);
    const brewing = new Brewing();
    pour(world, [[Cell.ElixirLife, 2], [Cell.Water, 9], [Cell.Slime, 4]]);
    run(ctx, brewing, 95);
    expect(seen.brewed).toEqual(['levity']);
    const counts = new Map<number, number>();
    for (const [x, y] of BASIN) counts.set(world.types[world.idx(x, y)], (counts.get(world.types[world.idx(x, y)]) ?? 0) + 1);
    expect(counts.get(Cell.ElixirLife)).toBe(2); // the old potion is not re-brewed into the new one
    expect(counts.get(Cell.ElixirLevity)).toBe(13);
  });
});

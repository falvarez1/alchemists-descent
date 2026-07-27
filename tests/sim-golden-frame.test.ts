import { describe, expect, it } from 'vitest';

import { createGameParams } from '@/config/params';
import type { Ctx } from '@/core/types';
import { drawCounts, reseedAllStreams, reseedTickStreams, resetDrawCounts } from '@/core/simRandom';
import { Cell } from '@/sim/CellType';
import { Simulation } from '@/sim/Simulation';
import { World } from '@/sim/World';
import { VineStrands } from '@/entities/VineStrands';

/**
 * GOLDEN FRAMES — the payoff of stage 4 (docs/MULTIPLAYER-ARCHITECTURE.md).
 *
 * The cell simulation had no regression test of its own: `gen-golden.test.ts`
 * locks what the *generator* produces, but nothing locked what the sim then
 * DOES to it, because `Math.random()` made the answer different every run.
 * Now a seed and a tick count pin an exact grid, so an accidental change to
 * liquid flow, fire spread, or powder toppling fails here instead of being
 * noticed as "the caves feel different" three months later.
 *
 * Re-record ONLY for a deliberate, commit-flagged simulation change — the same
 * rule CLAUDE.md invariant 4 applies to the generator hashes.
 */

const W = 96;
const H = 96;

/** Same FNV-1a fold `gen-golden.test.ts` uses, over the planes that ARE state. */
function hashWorld(world: World): string {
  let h = 0x811c9dc5;
  const fold = (byte: number): void => {
    h ^= byte & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (let i = 0; i < world.types.length; i++) {
    fold(world.types[i]);
    const life = world.life[i];
    fold(life);
    fold(life >> 8);
    const charge = world.charge[i];
    fold(charge);
    fold(charge >> 8);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Colour is on the fx stream and never branched on — hashed separately so a
 *  tint change can never be mistaken for a simulation change. */
function hashColors(world: World): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < world.colors.length; i++) {
    const c = world.colors[i];
    for (let s = 0; s < 32; s += 8) {
      h ^= (c >>> s) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A scene that exercises the parts of the sim most likely to drift: powder
 * toppling, two liquids of different viscosity, fire climbing into fuel, and
 * lava meeting water. Built with plain writes so the fixture itself draws no
 * randomness — only the sim does.
 */
function buildScene(world: World): void {
  world.clear();
  for (let x = 0; x < W; x++) {
    world.types[world.idx(x, H - 1)] = Cell.Wall;
    world.types[world.idx(x, H - 2)] = Cell.Wall;
  }
  for (let y = 0; y < H; y++) {
    world.types[world.idx(0, y)] = Cell.Wall;
    world.types[world.idx(W - 1, y)] = Cell.Wall;
  }
  // A sand pile that has to topple into a basin.
  for (let y = 20; y < 34; y++) {
    for (let x = 30; x < 46; x++) world.types[world.idx(x, y)] = Cell.Sand;
  }
  // Water above a metal shelf, so it spreads before it falls.
  for (let x = 8; x < 26; x++) world.types[world.idx(x, 60)] = Cell.Metal;
  for (let y = 46; y < 58; y++) {
    for (let x = 10; x < 24; x++) world.types[world.idx(x, y)] = Cell.Water;
  }
  // Oil pool with wood over it and a flame at one end.
  for (let x = 56; x < 84; x++) {
    world.types[world.idx(x, H - 3)] = Cell.Oil;
    world.types[world.idx(x, H - 4)] = Cell.Wood;
  }
  world.types[world.idx(58, H - 5)] = Cell.Fire;
  world.life[world.idx(58, H - 5)] = 240;
  // Lava dripping toward the water shelf.
  for (let x = 14; x < 20; x++) world.types[world.idx(x, 12)] = Cell.Lava;
}

function makeCtx(world: World, worldSeed: number): Ctx {
  const ctx = {
    world,
    state: { mode: 'play', score: 0, frameCount: 0, worldSeed, currentBiome: 'earthen' },
    input: { mouse: { x: 0, y: 0 } },
    params: createGameParams(),
    events: { emit: () => undefined, on: () => undefined },
    projectileCtl: { update: () => undefined },
    shockwaves: [],
    particles: { list: [], spawn: () => undefined, burst: () => undefined },
    // The harvester field runs first in every substep and reads the wizard;
    // parked in a corner with no gold in the scene, it changes nothing.
    player: { x: 4, y: H - 6, dead: false, gold: 0, perks: {}, status: {} },
    // Every cue is a no-op: audio is an outward call that never feeds back into
    // a cell, so naming them one by one would only be a list to maintain.
    audio: new Proxy({}, { get: () => () => undefined }),
  } as unknown as Ctx;
  ctx.vineStrands = new VineStrands(ctx);
  return ctx;
}

/** Run the scene for `ticks` game ticks at one substep each, as `Game` would. */
function runScene(worldSeed: number, ticks: number): { world: World; sim: Simulation; ctx: Ctx } {
  const world = new World(W, H);
  buildScene(world);
  reseedAllStreams(worldSeed);
  const ctx = makeCtx(world, worldSeed);
  const sim = new Simulation();
  for (let t = 0; t < ticks; t++) {
    ctx.state.frameCount++;
    reseedTickStreams(worldSeed, ctx.state.frameCount);
    sim.processFrame(ctx);
  }
  return { world, sim, ctx };
}

/** Recorded from the first deterministic run. Re-record ONLY for a deliberate,
 *  commit-flagged change to simulation behaviour. */
const GOLDEN: Record<number, { state: string; colors: string }> = {
  1: { state: 'a77c924e', colors: 'ef795e22' },
  7: { state: '2f92addd', colors: 'b5185aba' },
  1337: { state: '170c3dac', colors: '8ff27392' },
};

describe('sim golden frames', () => {
  it('replays a scene identically from the same seed', () => {
    // The headline property: this test could not have been written last week.
    const a = runScene(20260727, 120);
    const b = runScene(20260727, 120);
    expect(hashWorld(b.world)).toBe(hashWorld(a.world));
    expect(hashColors(b.world)).toBe(hashColors(a.world));
  });

  it('produces a different world from a different seed', () => {
    // Guards the opposite mistake: a "deterministic" sim that stopped rolling
    // at all would also replay perfectly, and be broken.
    const a = runScene(1, 120);
    const b = runScene(2, 120);
    expect(hashWorld(b.world)).not.toBe(hashWorld(a.world));
  });

  it('is stable across a pause in the middle of a run', () => {
    // Ticks are seeded from (worldSeed, frameCount), not from stream position,
    // so stopping and resuming must not shift anything. This is what lets a
    // replay start from a snapshot rather than only from tick 0.
    const straight = runScene(555, 80);
    const world = new World(W, H);
    buildScene(world);
    reseedAllStreams(555);
    const ctx = makeCtx(world, 555);
    const sim = new Simulation();
    for (let t = 0; t < 40; t++) {
      ctx.state.frameCount++;
      reseedTickStreams(555, ctx.state.frameCount);
      sim.processFrame(ctx);
    }
    reseedAllStreams(0xdead); // an unrelated world churns the streams in between
    for (let t = 0; t < 40; t++) {
      ctx.state.frameCount++;
      reseedTickStreams(555, ctx.state.frameCount);
      sim.processFrame(ctx);
    }
    expect(hashWorld(world)).toBe(hashWorld(straight.world));
  });

  it('draws the same number of times on every replay', () => {
    // Draw counts are what turn "the hash differs" into a subsystem name, so
    // they have to be reproducible themselves.
    resetDrawCounts();
    runScene(31337, 60);
    const first = drawCounts();
    resetDrawCounts();
    runScene(31337, 60);
    expect(drawCounts()).toEqual(first);
    expect(first.sim).toBeGreaterThan(0);
  });

  it('keeps cosmetics off the simulation stream', () => {
    // sim/colors.ts draws tint from `fx`. If tint ever moved onto `sim`, a
    // palette tweak would silently change where every liquid settles — this is
    // the boundary that claim rests on.
    const before = runScene(808, 60);
    resetDrawCounts();
    runScene(808, 60);
    const counts = drawCounts();
    expect(counts.fx).toBeGreaterThan(0);
    expect(hashWorld(runScene(808, 60).world)).toBe(hashWorld(before.world));
  });

  it('matches the recorded golden hashes', () => {
    for (const seed of Object.keys(GOLDEN).map(Number)) {
      const { world } = runScene(seed, 100);
      expect({ seed, ...GOLDEN[seed] }).toEqual({
        seed,
        state: hashWorld(world),
        colors: hashColors(world),
      });
    }
  });
});

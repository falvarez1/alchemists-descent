import { describe, expect, it } from 'vitest';

import { reseedAllStreams, reseedTickStreams } from '@/core/simRandom';
import { Cell } from '@/sim/CellType';
import { Simulation } from '@/sim/Simulation';
import { World as PlainWorld, type World } from '@/sim/World';
import { ParallelSim } from '@/sim/parallel/ParallelSim';
import { createSharedWorld } from '@/sim/parallel/sharedWorld';
import { wavefrontSchedule } from '@/sim/parallel/protocol';
import { buildLargeScene, hashSimColors, hashSimState, makeSimCtx } from './fixtures/largeSimScene';

/**
 * THE PARALLEL SWEEP'S CONTRACT (sim/parallel, docs/SANDBOX-MT.md). Chunks of
 * one checkerboard pass run concurrently on worker threads in whatever order
 * the threads claim them, so the result must not depend on that order: each
 * chunk draws from its own RNG streams, and side effects replay in chunk
 * order. Here one thread plays every schedule — list order, reversed, and
 * shuffled — and every run must hash identically, down to the insertion
 * order of the sparse indexes the replay rebuilds. With no two concurrent
 * chunks ever within reach of the same cell (the REACH invariant), any real
 * thread interleaving is one of these schedules.
 */
type Order = 'list' | 'late' | 'random';

/**
 * A valid schedule = any topological order of the wavefront's dependency
 * graph (Kahn's algorithm). 'late' always takes the LAST ready position —
 * the most out-of-order schedule the dependencies allow; 'random' picks any.
 */
function topologicalOrder(kind: Order, tick: number): Int32Array {
  const { order, depStart, deps } = wavefrontSchedule(320, 256);
  const n = order.length, position = new Map<number, number>();
  order.forEach((key, i) => position.set(key, i));
  const blocking = new Int32Array(n), unblocks: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let d = depStart[i]; d < depStart[i + 1]; d++) {
      blocking[i]++;
      unblocks[position.get(deps[d])!].push(i);
    }
  }
  const ready: number[] = [], out: number[] = [];
  for (let i = 0; i < n; i++) if (blocking[i] === 0) ready.push(i);
  let s = (tick * 7919 + 17) >>> 0;
  while (ready.length > 0) {
    ready.sort((a, b) => a - b);
    let pick = 0;
    if (kind === 'late') pick = ready.length - 1;
    if (kind === 'random') { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; pick = s % ready.length; }
    const i = ready.splice(pick, 1)[0];
    out.push(i);
    for (const j of unblocks[i]) if (--blocking[j] === 0) ready.push(j);
  }
  return Int32Array.from(out);
}

function run(seed: number, ticks: number, order: Order, width = 320, height = 256): { world: World; sim: ParallelSim } {
  const world = createSharedWorld(width, height);
  buildLargeScene(world);
  world.simBounds.x0 = 0; world.simBounds.x1 = Math.floor(width * 0.6);
  world.simBounds.y0 = 0; world.simBounds.y1 = height;
  reseedAllStreams(seed);
  const ctx = makeSimCtx(world, seed);
  const parallel = new ParallelSim(world, { global: ctx.params.global, materials: ctx.params.materials }, 0);
  let tick = 0;
  if (order !== 'list') parallel.testOrder = () => topologicalOrder(order, tick);
  const simulation = new Simulation();
  simulation.parallel = parallel;
  for (let t = 0; t < ticks; t++) {
    ctx.state.frameCount++;
    tick = ctx.state.frameCount;
    reseedTickStreams(seed, ctx.state.frameCount);
    simulation.processFrame(ctx);
  }
  return { world, sim: parallel };
}

function runSerial(seed: number, ticks: number, width = 320, height = 256): World {
  const world = new PlainWorld(width, height);
  buildLargeScene(world);
  world.simBounds.x0 = 0; world.simBounds.x1 = Math.floor(width * 0.6);
  world.simBounds.y0 = 0; world.simBounds.y1 = height;
  reseedAllStreams(seed);
  const ctx = makeSimCtx(world, seed);
  const simulation = new Simulation();
  for (let t = 0; t < ticks; t++) {
    ctx.state.frameCount++;
    reseedTickStreams(seed, ctx.state.frameCount);
    simulation.processFrame(ctx);
  }
  return world;
}

function census(world: World): Record<number, number> {
  const counts: Record<number, number> = {};
  for (let i = 0; i < world.types.length; i++) counts[world.types[i]] = (counts[world.types[i]] ?? 0) + 1;
  return counts;
}

describe('parallel chunk sweep', () => {
  it('actually runs the chunked sweep', () => {
    const { sim } = run(5, 20, 'list');
    expect(sim.stats.substeps).toBe(20);
    expect(sim.stats.chunks).toBeGreaterThan(0);
  });

  it('does not depend on which valid order the chunks run in', () => {
    const results = (['list', 'late', 'random'] as Order[]).map((order) => {
      const { world } = run(11, 120, order);
      return {
        state: hashSimState(world),
        colors: hashSimColors(world),
        charges: [...world.activeCharges].join(','),
        scars: [...world.colorOverrides].join(','),
      };
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('keeps the sparse indexes in step with their planes', () => {
    const { world } = run(3, 90, 'random');
    const charged = new Set<number>();
    for (let i = 0; i < world.charge.length; i++) if (world.charge[i] > 0) charged.add(i);
    for (const i of charged) expect(world.activeCharges.has(i)).toBe(true);
    for (const i of world.colorOverrides) expect(world.colorOverrides.mask[i]).toBe(255);
  });

  it('keeps the serial sweep statistics (material populations after 150 ticks)', () => {
    // Different update order, same physics: populations over 4 seeds stay
    // within a few percent of the serial sweep's (measured: sand -0.7%,
    // water +0.1%, steam -2%, fire +5%; seed-to-seed spread is ~4%). The
    // 2x2 checkerboard this replaced ran +25% fire, +23% steam, -12% water.
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const serial: Record<number, number>[] = [], parallel: Record<number, number>[] = [];
    for (const seed of [7, 8, 9, 10]) {
      serial.push(census(runSerial(seed, 150)));
      parallel.push(census(run(seed, 150, 'list').world));
    }
    for (const cell of [Cell.Sand, Cell.Water, Cell.Fire, Cell.Steam]) {
      const a = mean(serial.map((c) => c[cell] ?? 0)), b = mean(parallel.map((c) => c[cell] ?? 0));
      expect(Math.abs(b - a) / a, `cell ${cell}: serial ${a} parallel ${b}`).toBeLessThan(0.1);
    }
  });
});

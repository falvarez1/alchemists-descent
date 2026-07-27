import { describe, expect, it } from 'vitest';

import {
  drawCounts,
  entityRandom,
  fxRandom,
  particleRandom,
  reseedAllStreams,
  reseedSimSubstep,
  reseedTickStreams,
  resetDrawCounts,
  restoreStreams,
  simRandom,
  snapshotStreams,
} from '@/core/simRandom';

/**
 * The substrate under stage 4. What matters is not that these produce "good"
 * random numbers — mulberry32's quality is not in question — but that the
 * stream boundaries hold, because those are what make a failing golden frame
 * name a subsystem instead of condemning the whole run.
 */

const draw = (fn: () => number, n: number): number[] => Array.from({ length: n }, () => fn());

describe('simRandom streams', () => {
  it('replays the same tick identically', () => {
    reseedSimSubstep(1234, 7, 0);
    const first = draw(simRandom, 16);
    reseedSimSubstep(1234, 7, 0);
    expect(draw(simRandom, 16)).toEqual(first);
  });

  it('gives every substep of a tick its own stream', () => {
    // Simulation.update runs up to six substeps per tick; if they shared a seed
    // each one would replay the last, and settling would visibly stutter.
    const perSubstep = [0, 1, 2, 3, 4, 5].map((s) => {
      reseedSimSubstep(99, 3, s);
      return draw(simRandom, 4).join(',');
    });
    expect(new Set(perSubstep).size).toBe(6);
  });

  it('gives every tick its own stream', () => {
    const perTick = [0, 1, 2, 3, 4, 5, 6, 7].map((t) => {
      reseedTickStreams(42, t);
      return draw(entityRandom, 4).join(',');
    });
    expect(new Set(perTick).size).toBe(8);
  });

  it('keeps every stream independent of the others', () => {
    // THE load-bearing property: spending draws on one stream must not move
    // another. Otherwise adding a particle changes where the water settles.
    const streams = { simRandom, entityRandom, particleRandom, fxRandom };
    for (const [name, self] of Object.entries(streams)) {
      reseedAllStreams(7);
      const alone = draw(self, 8);
      reseedAllStreams(7);
      for (const [other, fn] of Object.entries(streams)) {
        if (other !== name) draw(fn, 500);
      }
      expect(draw(self, 8), `${name} moved when the others drew`).toEqual(alone);
    }
  });

  it('does not repeat across neighbouring seeds', () => {
    // Seeds come from a counter, so weak mixing would make consecutive ticks
    // near-identical. Check the first draw of many adjacent seeds is spread.
    const firsts = new Set<number>();
    for (let t = 0; t < 512; t++) {
      reseedSimSubstep(0, t, 0);
      firsts.add(simRandom());
    }
    expect(firsts.size).toBe(512);
  });

  it('stays inside [0, 1)', () => {
    reseedAllStreams(0xdecaf);
    for (let i = 0; i < 20_000; i++) {
      const v = simRandom();
      if (v < 0 || v >= 1) throw new Error(`out of range at draw ${i}: ${v}`);
    }
    expect(true).toBe(true);
  });

  it('is roughly uniform', () => {
    reseedAllStreams(5);
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[Math.floor(simRandom() * 10)]++;
    for (const b of buckets) expect(Math.abs(b - n / 10)).toBeLessThan(n / 10 / 5);
  });

  it('snapshots and restores an exact position', () => {
    // Rollback and replay both need to resume a stream mid-flight.
    reseedAllStreams(3);
    draw(simRandom, 25);
    const snap = snapshotStreams();
    const next = draw(simRandom, 5);
    restoreStreams(snap);
    expect(draw(simRandom, 5)).toEqual(next);
  });

  it('counts draws per stream so a divergence can name its subsystem', () => {
    reseedAllStreams(1);
    resetDrawCounts();
    draw(simRandom, 3);
    draw(entityRandom, 5);
    draw(particleRandom, 11);
    draw(fxRandom, 7);
    expect(drawCounts()).toEqual({ sim: 3, entity: 5, particle: 11, fx: 7 });
    resetDrawCounts();
    expect(drawCounts()).toEqual({ sim: 0, entity: 0, particle: 0, fx: 0 });
  });

  it('anchors every stream when a world is generated', () => {
    const take = (): number[][] =>
      [simRandom, entityRandom, particleRandom, fxRandom].map((fn) => draw(fn, 3));
    reseedAllStreams(0xabcdef);
    const all = take();
    reseedAllStreams(0xabcdef);
    expect(take()).toEqual(all);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { World as PlainWorld } from '@/sim/World';
import { ParallelSim } from '@/sim/parallel/ParallelSim';
import { createSharedWorld } from '@/sim/parallel/sharedWorld';

/**
 * The sim-worker pool is lazy on the hosted game: the shared buffers are allocated at boot, the
 * workers are spawned by `start()`, which Game calls once someone is actually in the Sandbox
 * (`Game.settleSandboxPool`) — not on the Sandbox world's first tick, because the boot world ticks
 * behind the title before the title pauses it. A visit that only plays the campaign never spawns them.
 * Fake workers, so this runs in Node; tests/parallel-sweep.test.ts proves the sweep itself.
 */

interface FakeWorker {
  onmessage: ((event: { data: { type: string } }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
  terminated: boolean;
  inits: unknown[];
}

function harness(threads: number, lazy: boolean) {
  const world = createSharedWorld(128, 128);
  const workers: FakeWorker[] = [];
  const createWorker = (): Worker => {
    const worker: FakeWorker = {
      onmessage: null, onerror: null, terminated: false, inits: [],
      postMessage(message) { worker.inits.push(message); },
      terminate() { worker.terminated = true; },
    };
    workers.push(worker);
    return worker as unknown as Worker;
  };
  const params = { global: {}, materials: [] } as never;
  const pool = new ParallelSim(world, params, threads, createWorker, { lazy });
  return { world, pool, workers };
}

describe('the lazy sim-worker pool', () => {
  it('spawns no workers at construction, and asking whether it handles a world never starts it', () => {
    const { world, pool, workers } = harness(3, true);
    expect(workers).toHaveLength(0);
    expect(pool.isStarted).toBe(false);
    expect(pool.ready).toBe(false);
    // The Sandbox world ticks behind the title at boot, and the campaign's levels are other Worlds:
    // neither may start the pool.
    for (let i = 0; i < 100; i++) expect(pool.handles(world)).toBe(false);
    expect(pool.handles(new PlainWorld(128, 128))).toBe(false);
    expect(workers).toHaveLength(0);
    expect(pool.isStarted).toBe(false);
  });

  it('start() spawns them once, and the pool sweeps only when they are all ready', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const { world, pool, workers } = harness(3, true);
      pool.start();
      expect(workers).toHaveLength(3);
      expect(pool.isStarted).toBe(true);
      expect(workers.every((w) => w.inits.length === 1)).toBe(true);
      expect(info).toHaveBeenCalledWith(expect.stringContaining('starting 3 sim workers'));
      expect(pool.handles(world)).toBe(false); // spawned, not ready: this frame sweeps serial
      pool.start();
      pool.start();
      expect(workers).toHaveLength(3); // never a second pool
      workers[0].onmessage?.({ data: { type: 'ready' } });
      workers[1].onmessage?.({ data: { type: 'ready' } });
      expect(pool.handles(world)).toBe(false);
      workers[2].onmessage?.({ data: { type: 'ready' } });
      expect(pool.handles(world)).toBe(true);
      expect(pool.handles(new PlainWorld(128, 128))).toBe(false);
      // The runtime A/B switch still wins.
      pool.enabled = false;
      expect(pool.handles(world)).toBe(false);
    } finally {
      info.mockRestore();
    }
  });

  it('never starts after a dispose, or after a failure', () => {
    const gone = harness(2, true);
    gone.pool.dispose();
    gone.pool.start();
    expect(gone.workers).toHaveLength(0);
    expect(gone.pool.isStarted).toBe(false);

    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const running = harness(2, true);
      running.pool.start();
      running.workers[0].onerror?.({ message: 'boom' });
      expect(running.pool.failure).toContain('boom');
      expect(running.pool.handles(running.world)).toBe(false);
      running.pool.dispose();
      expect(running.workers.every((w) => w.terminated)).toBe(true);
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });

  it('an eager pool (the default) still spawns its workers in the constructor, and dispose ends them', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const { pool, workers } = harness(2, false);
      expect(workers).toHaveLength(2);
      expect(pool.isStarted).toBe(true);
      pool.dispose();
      expect(workers.every((w) => w.terminated)).toBe(true);
    } finally {
      info.mockRestore();
    }
  });

  it('a zero-thread pool starts nothing and says nothing', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const { pool, workers } = harness(0, true);
      pool.start();
      expect(workers).toHaveLength(0);
      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { HEIGHT, WIDTH } from '@/config/constants';
import { defaultSkeletonSpec } from '@/config/gen';
import type { SkeletonSpec } from '@/config/gen';
import { Rng, hashSeed } from '@/core/rng';
import { carveDisc, ensureConnectivity } from '@/world/carve';
import { SKELETONS } from '@/world/skeleton';
import type { SkeletonIO, SkeletonResult } from '@/world/skeleton';

/**
 * Structural contracts for every skeleton strategy (see the contract block in
 * src/world/skeleton/index.ts): determinism, open floor strip, intact
 * borders, sane open fraction, post-ensureConnectivity reachability, and
 * spawn headroom. These are loose-bound tests, NOT golden hashes — the
 * baseline's exact stream is locked separately by tests/gen-golden.test.ts.
 */

const FLOOR_BAND = HEIGHT - 52;
const MIN_Y = 2;
const SEED = 1234;

const KINDS: Array<SkeletonSpec['kind']> = [
  'baseline',
  'fungalPockets',
  'frozenCrevasses',
  'floodedGalleries',
  'timberScaffold',
  'crystalVaults',
  'volcanicTubes',
];

interface Run {
  work: Uint8Array;
  result: SkeletonResult;
}

function runSkeleton(kind: SkeletonSpec['kind'], seed: number): Run {
  const spec = defaultSkeletonSpec(kind);
  const work = new Uint8Array(WIDTH * HEIGHT);
  const io: SkeletonIO = {
    work,
    rng: new Rng(seed),
    floorBand: FLOOR_BAND,
    minY: MIN_Y,
    worldSeed: seed,
  };
  const result = SKELETONS[kind](io, spec);
  return { work, result };
}

const cache = new Map<SkeletonSpec['kind'], Run>();
function cached(kind: SkeletonSpec['kind']): Run {
  let run = cache.get(kind);
  if (!run) {
    run = runSkeleton(kind, SEED);
    cache.set(kind, run);
  }
  return run;
}

/** 1:4 downsampled flood fill (any-open rule) from a full-res start cell. */
function downsampledReach(work: Uint8Array, startX: number, startY: number): { reached: number; open: number } {
  const DS = 4;
  const dw = Math.ceil(WIDTH / DS),
    dh = Math.ceil(HEIGHT / DS);
  const open = new Uint8Array(dw * dh);
  for (let y = 0; y < HEIGHT; y++) {
    const dy = (y / DS) | 0;
    for (let x = 0; x < WIDTH; x++) {
      if (!work[x + y * WIDTH]) open[((x / DS) | 0) + dy * dw] = 1;
    }
  }
  let total = 0;
  for (let i = 0; i < open.length; i++) total += open[i];
  const start = ((startX / DS) | 0) + ((startY / DS) | 0) * dw;
  expect(open[start]).toBe(1);
  const visited = new Uint8Array(dw * dh);
  const queue = new Int32Array(dw * dh);
  let head = 0,
    tail = 0;
  queue[tail++] = start;
  visited[start] = 1;
  let reached = 0;
  while (head < tail) {
    const c = queue[head++];
    reached++;
    const cx = c % dw,
      cy = (c / dw) | 0;
    if (cx > 0 && open[c - 1] && !visited[c - 1]) {
      visited[c - 1] = 1;
      queue[tail++] = c - 1;
    }
    if (cx + 1 < dw && open[c + 1] && !visited[c + 1]) {
      visited[c + 1] = 1;
      queue[tail++] = c + 1;
    }
    if (cy > 0 && open[c - dw] && !visited[c - dw]) {
      visited[c - dw] = 1;
      queue[tail++] = c - dw;
    }
    if (cy + 1 < dh && open[c + dw] && !visited[c + dw]) {
      visited[c + dw] = 1;
      queue[tail++] = c + dw;
    }
  }
  return { reached, open: total };
}

describe('skeleton structural contracts', () => {
  for (const kind of KINDS) {
    describe(kind, () => {
      it('is deterministic for a fixed seed', () => {
        const a = cached(kind);
        const b = runSkeleton(kind, SEED);
        expect(b.result.spawnHint).toEqual(a.result.spawnHint);
        let mismatch = -1;
        for (let i = 0; i < a.work.length; i++) {
          if (a.work[i] !== b.work[i]) {
            mismatch = i;
            break;
          }
        }
        expect(mismatch).toBe(-1);
      });

      it('leaves the floor strip fully open', () => {
        const { work } = cached(kind);
        let firstBad = -1;
        for (let y = FLOOR_BAND; y < HEIGHT && firstBad < 0; y++) {
          for (let x = 0; x < WIDTH; x++) {
            if (work[x + y * WIDTH]) {
              firstBad = x + y * WIDTH;
              break;
            }
          }
        }
        expect(firstBad).toBe(-1);
      });

      if (kind !== 'baseline') {
        it('keeps the border columns solid above the floor band', () => {
          const { work } = cached(kind);
          let firstBad = -1;
          for (let y = 0; y < FLOOR_BAND && firstBad < 0; y++) {
            for (const x of [0, 1, WIDTH - 2, WIDTH - 1]) {
              if (!work[x + y * WIDTH]) {
                firstBad = x + y * WIDTH;
                break;
              }
            }
          }
          expect(firstBad).toBe(-1);
        });
      }

      it('lands in a sane open fraction above the floor band', () => {
        const { work } = cached(kind);
        let openCells = 0;
        const total = WIDTH * FLOOR_BAND;
        for (let i = 0; i < total; i++) if (!work[i]) openCells++;
        const frac = openCells / total;
        expect(frac).toBeGreaterThanOrEqual(0.25);
        expect(frac).toBeLessThanOrEqual(0.7);
      });

      if (kind !== 'baseline') {
        it('connects >= 70% of open space to the spawn', () => {
          const { work, result } = cached(kind);
          const { reached, open } = downsampledReach(work, result.spawnHint.x, result.spawnHint.y);
          expect(reached / open).toBeGreaterThanOrEqual(0.7);
        });

        it('returns null tunnelY', () => {
          expect(cached(kind).result.tunnelY).toBeNull();
        });
      } else {
        it('returns the primary artery tunnelY profile', () => {
          const { result } = cached(kind);
          expect(result.tunnelY).not.toBeNull();
          expect(result.tunnelY).toHaveLength(WIDTH);
          expect(result.tunnelY?.[Math.floor(WIDTH / 2)]).toBe(result.spawnHint.y);
        });
      }

      it('gives the spawn generous headroom (9x24 open box)', () => {
        const { work, result } = cached(kind);
        const { x: sx, y: sy } = result.spawnHint;
        let firstBad = -1;
        for (let dy = -11; dy <= 12 && firstBad < 0; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            const X = sx + dx,
              Y = sy + dy;
            if (work[X + Y * WIDTH]) {
              firstBad = X + Y * WIDTH;
              break;
            }
          }
        }
        expect(firstBad).toBe(-1);
      });
    });
  }
});

describe('hashSeed', () => {
  it('is deterministic', () => {
    expect(hashSeed(12345, 'gold-pass')).toBe(hashSeed(12345, 'gold-pass'));
  });

  it('forks distinct streams per label and per seed', () => {
    expect(hashSeed(12345, 'gold-pass')).not.toBe(hashSeed(12345, 'moss-pass'));
    expect(hashSeed(12345, 'gold-pass')).not.toBe(hashSeed(12346, 'gold-pass'));
  });

  it('returns a uint32', () => {
    for (const [seed, label] of [
      [0, ''],
      [0xffffffff, 'x'],
      [42, 'crevasse-field'],
    ] as Array<[number, string]>) {
      const h = hashSeed(seed, label);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('ensureConnectivity', () => {
  it('joins two disjoint blobs into one component', () => {
    const w = 240,
      h = 160;
    const floorBand = h; // no open strip: blobs must be joined by a tunnel
    const work = new Uint8Array(w * h).fill(1);
    carveDisc(work, w, h, 50, 60, 10, 2);
    carveDisc(work, w, h, 190, 100, 10, 2);
    const joined = ensureConnectivity(work, w, h, new Rng(7), {
      minArea: 50,
      tunnelRadius: 3,
      floorBand,
      minY: 2,
    });
    expect(joined).toBe(1);

    // Full-res flood fill from blob A must now reach blob B.
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0,
      tail = 0;
    const start = 50 + 60 * w;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % w,
        cy = (c / w) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const X = cx + dx,
          Y = cy + dy;
        if (X < 0 || X >= w || Y < 0 || Y >= h) continue;
        const i = X + Y * w;
        if (!work[i] && !visited[i]) {
          visited[i] = 1;
          queue[tail++] = i;
        }
      }
    }
    expect(visited[190 + 100 * w]).toBe(1);
  });
});

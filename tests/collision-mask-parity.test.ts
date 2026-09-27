import { describe, expect, it } from 'vitest';

import { blocksEntity, Cell } from '@/sim/CellType';
import { BLOCKS_ENTITY_LUT, computeLooseRubbleBlockingMask, LOOSE_RUBBLE_BLOCKING_CLUSTER } from '@/sim/collision';
import { computeFits, reachableMask, wizardMask } from '@/world/validate';

/** The pre-optimisation implementation, kept verbatim as the parity oracle. */
function referenceMask(grid: { width: number; height: number; types: Uint8Array }): Uint8Array {
  const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
  const W = grid.width;
  const H = grid.height;
  const len = W * H;
  const solid = new Uint8Array(len);
  const metal = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const t = grid.types[i];
    if (!blocksEntity(t)) continue;
    solid[i] = 1;
    if (t === Cell.Metal) metal[i] = 1;
  }
  const comp = new Int32Array(len);
  const areas: number[] = [0];
  const stack: number[] = [];
  for (let i0 = 0; i0 < len; i0++) {
    if (!solid[i0] || comp[i0] !== 0) continue;
    const label = areas.length;
    let area = 0;
    comp[i0] = label;
    stack.push(i0);
    while (stack.length > 0) {
      const i = stack.pop()!;
      area++;
      const x = i % W;
      const y = (i - x) / W;
      for (const [dx, dy] of DIR8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = nx + ny * W;
        if (!solid[ni] || comp[ni] !== 0) continue;
        comp[ni] = label;
        stack.push(ni);
      }
    }
    areas.push(area);
  }
  const blocks = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    if (metal[i] || (solid[i] && areas[comp[i]] >= LOOSE_RUBBLE_BLOCKING_CLUSTER)) blocks[i] = 1;
  }
  return blocks;
}

/** Deterministic xorshift so a failure names its seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

describe('computeLooseRubbleBlockingMask (typed-array component pass)', () => {
  it('matches blocksEntity for every byte in its lookup table', () => {
    for (let t = 0; t < 256; t++) expect(BLOCKS_ENTITY_LUT[t]).toBe(blocksEntity(t) ? 1 : 0);
  });

  it('is byte-identical to the reference labeling on random rubble fields', () => {
    const palette = [Cell.Empty, Cell.Empty, Cell.Empty, Cell.Stone, Cell.Wall, Cell.Metal, Cell.Sand, Cell.Vines, Cell.Water, Cell.Moss, Cell.Gold];
    for (let seed = 1; seed <= 24; seed++) {
      const r = rng(seed);
      const width = 17 + Math.floor(r() * 90);
      const height = 13 + Math.floor(r() * 70);
      const density = 0.15 + r() * 0.5;
      const types = new Uint8Array(width * height);
      for (let i = 0; i < types.length; i++) {
        types[i] = r() < density ? palette[Math.floor(r() * palette.length)] : Cell.Empty;
      }
      const grid = { width, height, types };
      expect(computeLooseRubbleBlockingMask(grid), `seed ${seed} ${width}x${height}`).toEqual(referenceMask(grid));
    }
  });

  it('stays identical when the reused scratch shrinks and grows between calls', () => {
    const r = rng(99);
    for (const [width, height] of [[200, 150], [40, 30], [200, 151], [7, 5]] as const) {
      const types = new Uint8Array(width * height);
      for (let i = 0; i < types.length; i++) types[i] = r() < 0.4 ? Cell.Stone : r() < 0.05 ? Cell.Metal : Cell.Empty;
      const grid = { width, height, types };
      expect(computeLooseRubbleBlockingMask(grid)).toEqual(referenceMask(grid));
    }
  });
});

/** Pre-optimisation fits/wizard/reachable passes, verbatim, as oracles. */
function referenceFits(w: { width: number; height: number; types: Uint8Array }): Uint8Array {
  const W = w.width, H = w.height, PW = 4, PH = 17;
  const blocks = referenceMask(w);
  const hRun = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x < W; x++) {
      run = blocks[x + y * W] ? 0 : run + 1;
      if (run >= PW * 2 + 1) hRun[x - PW + y * W] = 1;
    }
  }
  const fits = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y < H; y++) {
      run = hRun[x + y * W] ? run + 1 : 0;
      if (run >= PH) fits[x + y * W] = 1;
    }
  }
  return fits;
}

function referenceFlood(W: number, H: number, ok: (i: number) => boolean, seeds: Array<[number, number]>): Uint8Array {
  const seen = new Uint8Array(W * H);
  const qx: number[] = [], qy: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
    const i = x + y * W;
    if (seen[i] || !ok(i)) return;
    seen[i] = 1; qx.push(x); qy.push(y);
  };
  for (const [x, y] of seeds) push(x, y);
  for (let head = 0; head < qx.length; head++) {
    const x = qx[head], y = qy[head];
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return seen;
}

describe('findability masks (index-queue floods, row-major erosion)', () => {
  it('match the reference passes on random caves, spawn inside and outside the air', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = rng(seed * 7919);
      const width = 60 + Math.floor(r() * 140);
      const height = 50 + Math.floor(r() * 110);
      const types = new Uint8Array(width * height).fill(Cell.Stone);
      // carve rooms and corridors, then sprinkle rubble, metal and growth
      for (let k = 0; k < 14; k++) {
        const cx = Math.floor(r() * width), cy = Math.floor(r() * height);
        const rw = 6 + Math.floor(r() * 30), rh = 6 + Math.floor(r() * 26);
        for (let y = cy - rh; y <= cy + rh; y++) for (let x = cx - rw; x <= cx + rw; x++) {
          if (x >= 0 && y >= 0 && x < width && y < height) types[x + y * width] = Cell.Empty;
        }
      }
      for (let i = 0; i < types.length; i++) {
        if (types[i] !== Cell.Empty) continue;
        const roll = r();
        if (roll < 0.02) types[i] = Cell.Stone;
        else if (roll < 0.025) types[i] = Cell.Metal;
        else if (roll < 0.035) types[i] = Cell.Vines;
      }
      const world = { width, height, types };
      const spawn = { x: 1 + r() * (width - 2), y: 1 + r() * (height - 2) };
      const fits = referenceFits(world);
      expect(computeFits(world), `fits seed ${seed}`).toEqual(fits);
      const sx = Math.floor(spawn.x), sy = Math.floor(spawn.y);
      const wizSeeds: Array<[number, number]> = [];
      for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) wizSeeds.push([sx + dx, sy + dy]);
      expect(wizardMask({ world, spawn }), `wizard seed ${seed}`).toEqual(referenceFlood(width, height, (i) => fits[i] === 1, wizSeeds));
      expect(reachableMask({ world, spawn }), `reach seed ${seed}`).toEqual(
        referenceFlood(width, height, (i) => !blocksEntity(types[i]), [[sx, Math.floor(spawn.y - 2)]]),
      );
    }
  });
});

import { describe, expect, it } from 'vitest';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { freshId } from '@/builder/document';
import { bakeExclusionMask } from '@/builder/document';
import type { EditorObject, EditorObjectKind } from '@/builder/document';
import { setObjectRotationCmd } from '@/builder/commands';
import { PatchRecorder, stampRect } from '@/builder/terrain';
import { paintTerrainCmd } from '@/builder/commands';
import {
  cancelFloating,
  commitFloating,
  FLOAT_CELL_CAP,
  liftSelection,
  mirrorFloating,
  rotateFloating,
} from '@/builder/selection';
import { mirrorPairs, mirrorPoints, symAxes } from '@/builder/symmetry';
import { PASSES, runPass } from '@/builder/procedural';

/**
 * Builder power-editing suite (plan Phase 3): floating selections move real
 * cells with byte-identical undo, symmetry mirrors one gesture into one
 * patch, the crown passes are seeded/deterministic/mask-honest, rotation is
 * a first-class undoable fact, and the scar bake never fossilizes
 * mechanism cells.
 */

function makeObj(
  kind: EditorObjectKind,
  x: number,
  y: number,
  params: Record<string, unknown> = {},
): EditorObject {
  return { id: freshId(kind), kind, x, y, rotation: 0, locked: false, hidden: false, params };
}

/** A world with a distinctive textured block at (x0, y0): varied types,
 *  colors, life and charge so plane-travel bugs cannot hide. */
function texturedWorld(x0: number, y0: number, w: number, h: number): World {
  const world = new World();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = world.idx(x0 + x, y0 + y);
      world.types[i] = (x + y) % 2 === 0 ? Cell.Stone : Cell.Wood;
      world.colors[i] = 0x100000 + x * 256 + y; // unique hand-tints
      world.life[i] = 10 + x;
      world.charge[i] = (y % 5) as number;
    }
  }
  return world;
}

function snapshot(w: World): {
  types: Uint8Array;
  colors: Uint32Array;
  life: Int16Array;
  charge: Uint8Array;
} {
  return {
    types: w.types.slice(),
    colors: w.colors.slice(),
    life: w.life.slice(),
    charge: w.charge.slice(),
  };
}

function expectPlanesEqual(w: World, s: ReturnType<typeof snapshot>): void {
  expect(Buffer.compare(Buffer.from(w.types), Buffer.from(s.types))).toBe(0);
  expect(
    Buffer.compare(Buffer.from(new Uint8Array(w.colors.buffer)), Buffer.from(new Uint8Array(s.colors.buffer))),
  ).toBe(0);
  expect(
    Buffer.compare(Buffer.from(new Uint8Array(w.life.buffer)), Buffer.from(new Uint8Array(s.life.buffer))),
  ).toBe(0);
  expect(Buffer.compare(Buffer.from(w.charge), Buffer.from(s.charge))).toBe(0);
}

describe('floating selection', () => {
  it('lift + move + commit lands one command whose undo is byte-identical', () => {
    const w = texturedWorld(100, 100, 10, 8);
    const orig = snapshot(w);
    const f = liftSelection(w, { x0: 100, y0: 100, x1: 109, y1: 107 }, null)!;
    expect(f).not.toBeNull();
    // the source is a hole while floating
    expect(w.types[w.idx(104, 103)]).toBe(Cell.Empty);
    f.x = 300;
    f.y = 240;
    const cmd = commitFloating(w, f)!;
    expect(cmd).not.toBeNull();
    // colors travel with the block (hand-tints preserved)
    expect(w.types[w.idx(300, 240)]).toBe(orig.types[w.idx(100, 100)]);
    expect(w.colors[w.idx(304, 243)]).toBe(orig.colors[w.idx(104, 103)]);
    expect(w.life[w.idx(304, 243)]).toBe(orig.life[w.idx(104, 103)]);
    expect(w.charge[w.idx(304, 243)]).toBe(orig.charge[w.idx(104, 103)]);
    // idempotent-do: re-running do() must not change anything
    const after = snapshot(w);
    cmd.do({} as never);
    expectPlanesEqual(w, after);
    // ONE undo restores every plane exactly
    cmd.undo({} as never);
    expectPlanesEqual(w, orig);
  });

  it('overlapping destination commits and undoes correctly', () => {
    const w = texturedWorld(200, 200, 10, 10);
    const orig = snapshot(w);
    const f = liftSelection(w, { x0: 200, y0: 200, x1: 209, y1: 209 }, null)!;
    f.x = 204; // overlap the source by 6 columns
    const cmd = commitFloating(w, f)!;
    // dest carries the block; the uncovered source strip is empty
    expect(w.types[w.idx(204, 200)]).toBe(orig.types[w.idx(200, 200)]);
    expect(w.colors[w.idx(213, 209)]).toBe(orig.colors[w.idx(209, 209)]);
    expect(w.types[w.idx(200, 205)]).toBe(Cell.Empty);
    cmd.undo({} as never);
    expectPlanesEqual(w, orig);
  });

  it('rotate x4 and mirror x2 are identities on every plane', () => {
    const w = texturedWorld(100, 100, 7, 5);
    const f = liftSelection(w, { x0: 100, y0: 100, x1: 106, y1: 104 }, null)!;
    const r1 = rotateFloating(f);
    expect(r1.w).toBe(f.h);
    expect(r1.h).toBe(f.w);
    const r4 = rotateFloating(rotateFloating(rotateFloating(r1)));
    expect(Array.from(r4.cells)).toEqual(Array.from(f.cells));
    expect(Array.from(r4.colors)).toEqual(Array.from(f.colors));
    expect(Array.from(r4.life)).toEqual(Array.from(f.life));
    expect(Array.from(r4.charge)).toEqual(Array.from(f.charge));
    expect(Array.from(r4.mask)).toEqual(Array.from(f.mask));
    const m2 = mirrorFloating(mirrorFloating(f));
    expect(Array.from(m2.cells)).toEqual(Array.from(f.cells));
    expect(Array.from(m2.colors)).toEqual(Array.from(f.colors));
    cancelFloating(w, f); // tidy: put the world back
  });

  it('a masked lift only takes (and clears) masked cells', () => {
    const w = texturedWorld(100, 100, 4, 2);
    const orig = snapshot(w);
    // mask covers only the left 2x2 corner
    const mask = new Uint8Array(4 * 2);
    mask[0] = mask[1] = mask[4] = mask[5] = 1;
    const f = liftSelection(w, { x0: 100, y0: 100, x1: 103, y1: 101 }, mask)!;
    expect(w.types[w.idx(100, 100)]).toBe(Cell.Empty); // masked: lifted
    expect(w.types[w.idx(103, 101)]).toBe(orig.types[w.idx(103, 101)]); // outside: kept
    expect(f.mask[3]).toBe(0);
    cancelFloating(w, f);
    expectPlanesEqual(w, orig);
  });

  it('an over-cap lift refuses and leaves the world untouched', () => {
    const w = texturedWorld(10, 10, 20, 20);
    const orig = snapshot(w);
    // 600 x 500 = 300k cells > FLOAT_CELL_CAP
    expect(600 * 500).toBeGreaterThan(FLOAT_CELL_CAP);
    const f = liftSelection(w, { x0: 0, y0: 0, x1: 599, y1: 499 }, null);
    expect(f).toBeNull();
    expectPlanesEqual(w, orig);
  });
});

describe('symmetry', () => {
  it('mirrorPoints dedupes on-axis reflections', () => {
    // off-axis quad: 4 distinct images
    expect(mirrorPoints(10, 10, 'quad', 50, 50)).toHaveLength(4);
    // on the vertical axis: x-reflection collapses
    expect(mirrorPoints(50, 10, 'x', 50, 50)).toHaveLength(1);
    expect(mirrorPoints(50, 10, 'quad', 50, 50)).toHaveLength(2);
    // dead center under quad: a single point
    expect(mirrorPoints(50, 50, 'quad', 50, 50)).toHaveLength(1);
    // original always comes first
    expect(mirrorPoints(10, 20, 'x', 50, 50)[0]).toEqual([10, 20]);
    expect(mirrorPoints(10, 20, 'x', 50, 50)[1]).toEqual([90, 20]);
  });

  it('half-cell axes (even-sized regions) still reflect onto integer cells', () => {
    const ax = symAxes({ x0: 100, y0: 100, x1: 199, y1: 199 }, 1600, 1064);
    expect(ax.x).toBeCloseTo(149.5);
    const pts = mirrorPoints(120, 120, 'x', ax.x, ax.y);
    expect(pts[1]).toEqual([179, 120]);
    expect(Number.isInteger(pts[1][0])).toBe(true);
  });

  it('a symmetric rect stamps mirrored cells in ONE patch', () => {
    const w = new World();
    const rec = new PatchRecorder(w);
    // SYM:X about axis 200: a 10x10 rect at 100..109 mirrors to 290..299
    for (const [x0, y0, x1, y1] of mirrorPairs(100, 100, 109, 109, 'x', 200, 0)) {
      stampRect(w, rec, x0, y0, x1, y1, Cell.Stone, true);
    }
    const patch = rec.finish()!;
    expect(patch.before.idxs.length).toBe(200); // both copies, one recorder
    expect(w.types[w.idx(105, 105)]).toBe(Cell.Stone);
    expect(w.types[w.idx(295, 105)]).toBe(Cell.Stone);
    const cmd = paintTerrainCmd(w, patch.before, patch.after);
    cmd.undo({} as never);
    expect(w.types[w.idx(105, 105)]).toBe(Cell.Empty);
    expect(w.types[w.idx(295, 105)]).toBe(Cell.Empty);
  });

  it('mirrorPairs dedupes the on-axis symmetric box but keeps mirrored diagonals', () => {
    // a BOX centered on the axis reflects to itself (corner order ignored)
    expect(mirrorPairs(95, 10, 105, 20, 'x', 100, 0, true)).toHaveLength(1);
    expect(mirrorPairs(10, 10, 20, 20, 'x', 100, 0, true)).toHaveLength(2);
    // a LINE on the same box reflects into the OTHER diagonal — kept
    expect(mirrorPairs(95, 10, 105, 20, 'x', 100, 0)).toHaveLength(2);
    // ...but a horizontal on-axis segment is genuinely its own mirror
    expect(mirrorPairs(95, 10, 105, 10, 'x', 100, 0)).toHaveLength(1);
  });
});

describe('crown passes', () => {
  /** Flat slab: rock from y=200 down, open above; floor surface at y=200. */
  function slabWorld(): World {
    const w = new World();
    for (let y = 200; y < 240; y++) {
      for (let x = 80; x < 320; x++) w.types[w.idx(x, y)] = Cell.Wall;
    }
    return w;
  }
  const region = { x0: 90, y0: 150, x1: 300, y1: 230 };

  it('crowns: deterministic, top-surface-only, mask-honest', () => {
    const def = PASSES.find((p) => p.id === 'crowns')!;
    expect(def.usesMaterial).toBe(true);
    const run = (mask: Uint8Array | null): { w: World; idxs: number[] } => {
      const w = slabWorld();
      const rec = new PatchRecorder(w);
      runPass(def, w, rec, 777, region, 0.8, Cell.Moss, mask);
      return { w, idxs: rec.finish()?.after.idxs ?? [] };
    };
    const a = run(null);
    const b = run(null);
    expect(a.idxs.length).toBeGreaterThan(0);
    expect(a.idxs).toEqual(b.idxs); // same seed = same patch
    // every crown sits ON the surface: solid below, was open air
    for (const i of a.idxs) {
      const x = i % a.w.width,
        y = Math.floor(i / a.w.width);
      expect(a.w.types[i]).toBe(Cell.Moss);
      expect(y).toBe(199); // the only top surface in the slab
      expect(a.w.types[a.w.idx(x, y + 1)]).toBe(Cell.Wall);
    }
    // mask: left half only — nothing grows outside it
    const rw = region.x1 - region.x0 + 1;
    const rh = region.y1 - region.y0 + 1;
    const mask = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw / 2; x++) mask[x + y * rw] = 1;
    }
    const m = run(mask);
    expect(m.idxs.length).toBeGreaterThan(0);
    for (const i of m.idxs) {
      expect(i % m.w.width).toBeLessThan(region.x0 + rw / 2);
    }
  });

  it('crowns skip surfaces under liquid', () => {
    const def = PASSES.find((p) => p.id === 'crowns')!;
    const w = slabWorld();
    // drown the left half of the surface: water sits in the would-be crown
    // row AND the row above it
    for (let x = 80; x < 200; x++) {
      w.types[w.idx(x, 199)] = Cell.Water;
      w.types[w.idx(x, 198)] = Cell.Water;
    }
    const rec = new PatchRecorder(w);
    runPass(def, w, rec, 777, region, 1, Cell.Moss);
    const idxs = rec.finish()?.after.idxs ?? [];
    expect(idxs.length).toBeGreaterThan(0);
    for (const i of idxs) {
      expect(i % w.width).toBeGreaterThanOrEqual(200); // dry side only
    }
  });

  it('crownTint recolors top-surface rock without touching a single type', () => {
    const def = PASSES.find((p) => p.id === 'crownTint')!;
    expect(def.usesMaterial).toBe(false);
    const w = slabWorld();
    const before = snapshot(w);
    const rec = new PatchRecorder(w);
    const result = runPass(def, w, rec, 1234, region, 0.5, 0, null, 'earthen');
    const patch = rec.finish()!;
    expect(patch).not.toBeNull();
    expect(result.summary).toContain('moss');
    // color-only: types identical everywhere, colors changed in the patch
    expect(Buffer.compare(Buffer.from(w.types), Buffer.from(before.types))).toBe(0);
    let colorChanges = 0;
    for (let n = 0; n < patch.before.idxs.length; n++) {
      expect(patch.before.types[n]).toBe(patch.after.types[n]);
      if (patch.before.colors[n] !== patch.after.colors[n]) colorChanges++;
    }
    expect(colorChanges).toBeGreaterThan(0);
    // deterministic for the seed
    const w2 = slabWorld();
    const rec2 = new PatchRecorder(w2);
    runPass(def, w2, rec2, 1234, region, 0.5, 0, null, 'earthen');
    expect(rec2.finish()!.after.colors).toEqual(patch.after.colors);
  });
});

describe('object rotation command', () => {
  it('setObjectRotationCmd does and undoes', () => {
    const obj = makeObj('hazardEmitter', 100, 100, { cell: 'water', rate: 30 });
    const cmd = setObjectRotationCmd(obj, 270);
    cmd.do({} as never);
    expect(obj.rotation).toBe(270);
    cmd.undo({} as never);
    expect(obj.rotation).toBe(0);
  });
});

describe('bake exclusion mask', () => {
  it('skips door footprints, extends the exit well to the floor, keeps plain cells', () => {
    const door = makeObj('door', 100, 50, { w: 3, h: 13 });
    const well = makeObj('exitWell', 400, 300, { halfW: 14 });
    const lever = makeObj('lever', 200, 80);
    const hiddenDoor = makeObj('door', 600, 50, { w: 3, h: 13 });
    hiddenDoor.hidden = true;
    const skip = bakeExclusionMask([door, well, lever, hiddenDoor], 1600, 1064);
    // a scarred cell under the door footprint is skipped
    expect(skip[101 + 55 * 1600]).toBe(1);
    expect(skip[110 + 55 * 1600]).toBe(0); // just right of the slab
    // the well's cased shaft is excluded all the way down
    expect(skip[400 + 1000 * 1600]).toBe(1);
    expect(skip[400 + 290 * 1600]).toBe(1); // approach pocket band
    // footprint-less fixtures get their small body box
    expect(skip[200 + 81 * 1600]).toBe(1); // lever footing row
    expect(skip[200 + 70 * 1600]).toBe(0);
    // hidden objects do not compile, so they must not be excluded
    expect(skip[601 + 55 * 1600]).toBe(0);
  });
});

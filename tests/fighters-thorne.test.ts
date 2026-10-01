import { describe, expect, it } from 'vitest';

import { EventBus } from '@/core/events';
import { Rng } from '@/core/rng';
import type { Ctx, Enemy } from '@/core/types';
import { FighterSystem } from '@/fighters/FighterSystem';
import { Crop } from '@/fighters/kits/father-thorne-crop';
import type { CropCell, GrowReport } from '@/fighters/kits/father-thorne-crop';
import { motePose } from '@/fighters/kits/father-thorne-fx';
import {
  Camouflage, DRY, TUNING, coverCells, findSurfaceStart, isAnchor, isHard, isOpen, isStill, isSurface, mixRgb,
  planIronvine, planOvergrowth, settleSupport, surfaceNormal, vnoise, walkSurface, witherDie, witherStage,
} from '@/fighters/kits/father-thorne-grow';
import { kit } from '@/fighters/kits/father-thorne';
import { FELL_MIN_CELLS, FloodScratch, floodStand } from '@/game/floraFelling';
import { LEAF_REACH, leafAnchor } from '@/sim/elements/flora';
import { Cell, blocksEntity } from '@/sim/CellType';
import { World } from '@/sim/World';

/**
 * Father Thorne without a browser: the passive's state machine, the surface walker and the Ironvine and
 * Overgrowth plans over a real World, the cell ledger that withers what she grew, and the kit run through the real
 * FighterSystem. What the real engine does with them (the slow a foe feels, what a foe notices, the sim's own
 * handling of vines, fire and the flora felling rule) is probed in scripts/verify-fighter-thorne.mjs.
 */

const W = 400, H = 240, FLOOR = 200, CEIL = 130; // stone from y = FLOOR down and from y = CEIL up; open air between

/** A closed cave: a floor, a ceiling, walls at both ends, solid enough (3+ cells thick) for anchored support. */
function cave(opts: { floor?: number; ceiling?: number; leftWall?: number; rightWall?: number; pit?: [number, number] } = {}): World {
  const world = new World(W, H);
  const floor = opts.floor ?? FLOOR, ceiling = opts.ceiling ?? CEIL;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let solid = y >= floor || y <= ceiling || x <= (opts.leftWall ?? 6) || x >= W - 1 - (opts.rightWall ?? 6);
      if (opts.pit && y >= floor && x >= opts.pit[0] && x <= opts.pit[1] && y < floor + 40) solid = false;
      if (solid) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x555555);
    }
  }
  return world;
}

const seeded = (seed: number): (() => number) => {
  const r = new Rng(seed);
  return () => r.next();
};
const noSkip = (): boolean => false;
const censusOf = (w: World): Map<number, number> => {
  const m = new Map<number, number>();
  for (let i = 0; i < w.types.length; i++) m.set(w.types[i], (m.get(w.types[i]) ?? 0) + 1);
  return m;
};
/** Cells reachable from (sx, sy) over `!blocksEntity` cells, 4-connected: the repo's findability measure. */
function reach(w: World, sx: number, sy: number): Set<number> {
  const seen = new Set<number>([sx + sy * w.width]);
  const q = [sx + sy * w.width];
  while (q.length > 0) {
    const i = q.pop() as number;
    const x = i % w.width, y = (i / w.width) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!w.inBounds(nx, ny)) continue;
      const k = nx + ny * w.width;
      if (seen.has(k) || blocksEntity(w.types[k])) continue;
      seen.add(k);
      q.push(k);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------------------------------- Rooted Camouflage

describe('Rooted Camouflage: the state machine', () => {
  it('needs 60 still ticks, then climbs 0 -> 0.6 linearly over 180', () => {
    const c = new Camouflage();
    for (let t = 1; t <= 59; t++) expect(c.step(false, true)).toBe(0);
    expect(c.step(false, true)).toBeCloseTo(TUNING.camo.max / TUNING.camo.rampTicks, 6); // tick 60 starts the ramp
    for (let t = 61; t <= 150; t++) c.step(false, true);
    expect(c.value()).toBeCloseTo(TUNING.camo.max * (91 / 180), 6);
    for (let t = 151; t <= 240; t++) c.step(false, true);
    expect(c.value()).toBeCloseTo(0.6, 6);
    expect(c.progress()).toBe(1);
    for (let t = 0; t < 500; t++) c.step(false, true);
    expect(c.value()).toBeCloseTo(0.6, 6); // and it never passes it
  });

  it('drops to 0 the moment she moves, and starts the whole wait again', () => {
    const c = new Camouflage();
    for (let t = 0; t < 300; t++) c.step(false, true);
    expect(c.value()).toBeCloseTo(0.6, 6);
    expect(c.step(true, true)).toBe(0);
    expect(c.value()).toBe(0);
    for (let t = 1; t <= 59; t++) c.step(false, true);
    expect(c.value()).toBe(0);
    c.step(false, true);
    expect(c.value()).toBeGreaterThan(0);
  });

  it('never ramps without cover, and loses the ramp quickly if the cover goes while she stays still', () => {
    const c = new Camouflage();
    for (let t = 0; t < 400; t++) expect(c.step(false, false)).toBe(0);
    for (let t = 0; t < 300; t++) c.step(false, true);
    expect(c.value()).toBeCloseTo(0.6, 6);
    for (let t = 0; t < 30; t++) c.step(false, false); // 30 ticks x 6 = the whole 180 gone
    expect(c.value()).toBe(0);
  });

  it('is "still" only when grounded, slow and not carried', () => {
    expect(isStill(true, 0, false)).toBe(true);
    expect(isStill(true, 0.19, false)).toBe(true);
    expect(isStill(true, -0.2, false)).toBe(false);
    expect(isStill(false, 0, false)).toBe(false);
    expect(isStill(true, 0, true)).toBe(false);
  });

  it('counts natural cover in the box (Moss, Leaf, Trunk, Vines, Fungus, Glowshroom) and nothing else', () => {
    const w = cave();
    const put = (x: number, y: number, t: number): void => w.replaceCellAt(w.idx(x, y), t, 0x336633);
    const at = { x: 100, y: 190 };
    const cover = [Cell.Moss, Cell.Leaf, Cell.Trunk, Cell.Vines, Cell.Fungus, Cell.Glowshroom];
    cover.forEach((t, i) => put(at.x - 10 + i, at.y, t)); // on the box's left edge row
    put(at.x + 10, at.y + 10, Cell.Moss); // the far corner is still in
    put(at.x + 11, at.y, Cell.Moss); // one past the box
    put(at.x, at.y + 11, Cell.Moss);
    put(at.x + 3, at.y, Cell.Grass); // grass is ground cover, not natural cover for this
    put(at.x + 4, at.y, Cell.Wood);
    expect(coverCells(w, at.x, at.y, 10, 10)).toBe(7);
    expect(coverCells(w, at.x, at.y, 10, 10) >= TUNING.camo.need).toBe(true);
    expect(coverCells(w, 300, 190, 10, 10)).toBe(0);
  });

  it('draws leaf motes as a pure function of the frame (the same frame, the same leaves)', () => {
    const a = motePose(3, 1234, 100, 200), b = motePose(3, 1234, 100, 200);
    expect(a).toEqual(b);
    expect(motePose(3, 1235, 100, 200)).not.toEqual(a);
    for (let f = 0; f < 400; f++) {
      const m = motePose(2, f, 100, 200);
      expect(m.a).toBeGreaterThanOrEqual(0);
      expect(m.a).toBeLessThanOrEqual(1);
      expect(m.y).toBeGreaterThanOrEqual(200 - 27 - 0.01);
      expect(m.y).toBeLessThanOrEqual(200 + 2.01);
    }
  });
});

// ---------------------------------------------------------------------------------------------------- the surface walker and Ironvine

describe('the surface walker', () => {
  it('knows a surface: open air with something hard against a side', () => {
    const w = cave();
    expect(isSurface(w, 100, FLOOR - 1)).toBe(true); // on the floor
    expect(isSurface(w, 100, CEIL + 1)).toBe(true); // under the ceiling
    expect(isSurface(w, 7, 170)).toBe(true); // against a wall
    expect(isSurface(w, 100, 170)).toBe(false); // in the middle of the air
    expect(isHard(w, 100, FLOOR)).toBe(true);
    expect(isHard(w, 100, 170)).toBe(false);
    expect(isOpen(w, 100, 170)).toBe(true);
    expect(isOpen(w, 100, FLOOR)).toBe(false);
  });

  it('holds on to rock, not to loose powder: sand, snow and gold are no surface (the sim would drop what grew on them)', () => {
    const w = cave();
    for (let x = 100; x < 160; x++) for (let y = FLOOR - 5; y < FLOOR; y++) w.replaceCellAt(w.idx(x, y), Cell.Sand, 0xc2b280); // a bank of sand on the floor
    expect(isHard(w, 120, FLOOR - 1)).toBe(true); // it stops a body
    expect(isAnchor(w, 120, FLOOR - 1)).toBe(false); // but nothing can hold on to it
    expect(isSurface(w, 120, FLOOR - 6)).toBe(false);
    expect(isAnchor(w, 120, FLOOR)).toBe(true); // the stone below
    expect(planIronvine(w, 130, FLOOR - 6, 1, 0, seeded(1), noSkip, TUNING.vine)).toBe('NOTHING TO GROW ON');
    // the Overgrowth covers no sand either: no moss or leaf rests on it
    const plan = planOvergrowth(w, 130, FLOOR - 9, seeded(2), noSkip);
    expect(plan.some((c) => (c.cell === Cell.Moss || c.cell === Cell.Leaf) && c.x >= 100 && c.x < 160 && c.y >= FLOOR - 6 && c.y < FLOOR)).toBe(false);
  });

  it('starts on the ground under her feet, or the nearest surface in reach', () => {
    const w = cave();
    expect(findSurfaceStart(w, 100, FLOOR - 1, 1, 0, 12)).toEqual({ x: 100, y: FLOOR - 1 });
    const air = findSurfaceStart(w, 100, FLOOR - 9, 1, 0, 12); // 9 above the floor: she is airborne
    expect(air?.y).toBe(FLOOR - 1);
    expect(findSurfaceStart(w, 100, 165, 1, 0, 12)).toBeNull(); // nothing within 12 cells
  });

  it('runs along a flat floor in the aim for the full 60 cells', () => {
    const w = cave();
    const path = walkSurface(w, 100, FLOOR - 1, 1, 0, 60);
    expect(path[0]).toEqual({ x: 100, y: FLOOR - 1 });
    expect(path.length).toBe(61);
    expect(path.every((c) => c.y === FLOOR - 1 && isSurface(w, c.x, c.y))).toBe(true);
    expect(path[path.length - 1].x).toBe(160);
    // and the other way
    const back = walkSurface(w, 100, FLOOR - 1, -1, 0, 60);
    expect(back[back.length - 1].x).toBe(40);
  });

  it('follows a gentle slope up and down', () => {
    const w = cave();
    // a ramp of stone rising one cell every 3 cells to the right
    for (let x = 100; x < 160; x++) {
      const rise = Math.floor((x - 100) / 3);
      for (let y = FLOOR - rise; y < FLOOR; y++) w.replaceCellAt(w.idx(x, y), Cell.Stone, 0x555555);
    }
    const path = walkSurface(w, 100, FLOOR - 1, 1, 0, 50);
    expect(path.length).toBeGreaterThan(48);
    expect(path[path.length - 1].y).toBeLessThan(FLOOR - 12); // it climbed with the ground
    expect(path.every((c) => isSurface(w, c.x, c.y))).toBe(true);
  });

  it('stops at a wall when the aim cannot climb, and climbs it when the aim has a rise', () => {
    const w = cave();
    for (let y = 100; y < FLOOR; y++) for (let x = 130; x < 140; x++) w.replaceCellAt(w.idx(x, y), Cell.Stone, 0x555555);
    const flat = walkSurface(w, 100, FLOOR - 1, 1, 0, 60);
    expect(flat[flat.length - 1].x).toBe(129);
    expect(flat.every((c) => c.y === FLOOR - 1)).toBe(true);
    const n = Math.SQRT1_2;
    const up = walkSurface(w, 100, FLOOR - 1, n, -n, 60);
    const top = up.reduce((m, c) => Math.min(m, c.y), FLOOR);
    expect(top).toBeLessThan(FLOOR - 15); // it went up the face
    expect(up.some((c) => c.x === 129 && c.y < FLOOR - 10)).toBe(true);
    expect(up.every((c) => isSurface(w, c.x, c.y))).toBe(true);
  });

  it('can ride a ceiling and never leaves a surface or revisits a cell', () => {
    const w = cave();
    const path = walkSurface(w, 100, CEIL + 1, 1, 0, 60);
    expect(path.length).toBe(61);
    expect(path.every((c) => c.y === CEIL + 1)).toBe(true);
    const keys = new Set(path.map((c) => c.x + c.y * W));
    expect(keys.size).toBe(path.length);
  });

  it('computes the normal away from what is hard', () => {
    const w = cave();
    expect(surfaceNormal(w, 100, FLOOR - 1)).toEqual({ x: 0, y: -1 });
    expect(surfaceNormal(w, 100, CEIL + 1)).toEqual({ x: 0, y: 1 });
    expect(surfaceNormal(w, 7, 170)).toEqual({ x: 1, y: 0 });
    expect(surfaceNormal(w, 100, 170)).toEqual({ x: 0, y: 0 });
  });
});

describe('Ironvine: the plan', () => {
  it('lays 2-3 cells of Vines deep along a floor, up to 60 cells, only on the surface', () => {
    const w = cave();
    const plan = planIronvine(w, 100, FLOOR - 1, 1, 0, seeded(1), noSkip);
    if (typeof plan === 'string') throw new Error(plan);
    const xs = plan.cells.map((c) => c.x);
    expect(Math.min(...xs)).toBe(100);
    expect(Math.max(...xs)).toBe(160); // 60 cells of reach
    // 2-3 deep: every column has its base on the ground and at most 3 cells up
    const cols = new Map<number, number[]>();
    for (const c of plan.cells) {
      expect(c.y).toBeGreaterThanOrEqual(FLOOR - 3);
      expect(c.y).toBeLessThanOrEqual(FLOOR - 1);
      cols.set(c.x, [...(cols.get(c.x) ?? []), c.y]);
    }
    for (const ys of cols.values()) {
      expect(ys).toContain(FLOOR - 1); // never floating: the base is on the surface
      expect(ys.length).toBeGreaterThanOrEqual(2);
      expect(ys.length).toBeLessThanOrEqual(3);
    }
    // both depths occur
    const depths = new Set([...cols.values()].map((ys) => ys.length));
    expect(depths.has(2) && depths.has(3)).toBe(true);
    // thorns sit on the outermost cell only
    for (const c of plan.cells) if (c.thorn) expect(c.depth).toBeGreaterThan(0);
    expect(plan.cells.some((c) => c.thorn)).toBe(true);
  });

  it('writes only into open cells and never into a body, and never builds above a skipped base', () => {
    const w = cave();
    // a pool in the way, and a foe standing 20 cells ahead
    for (let y = FLOOR - 4; y < FLOOR; y++) for (let x = 130; x < 140; x++) w.replaceCellAt(w.idx(x, y), Cell.Water, 0x2060ff);
    const foe = (x: number, y: number): boolean => x >= 114 && x <= 126 && y >= FLOOR - 9 && y <= FLOOR;
    const plan = planIronvine(w, 100, FLOOR - 1, 1, 0, seeded(2), foe);
    if (typeof plan === 'string') throw new Error(plan);
    for (const c of plan.cells) {
      expect(isOpen(w, c.x, c.y)).toBe(true);
      expect(foe(c.x, c.y)).toBe(false);
    }
    // the pool is not a surface: the walk ends at its edge
    expect(Math.max(...plan.cells.map((c) => c.x))).toBeLessThan(130);
  });

  it('refuses where there is nothing to grow on, and where the surface runs out at once', () => {
    const open = new World(W, H); // no ground anywhere
    expect(planIronvine(open, 100, 100, 1, 0, seeded(3), noSkip)).toBe('NOTHING TO GROW ON');
    const w = cave();
    // straight up from a bare floor: no surface carries forward
    expect(planIronvine(w, 100, FLOOR - 1, 0, -1, seeded(3), noSkip)).toBe('NO ROOM TO GROW');
    // a wall at her nose
    for (let y = 100; y < FLOOR; y++) for (let x = 103; x < 120; x++) w.replaceCellAt(w.idx(x, y), Cell.Stone, 0x555555);
    expect(typeof planIronvine(w, 100, FLOOR - 1, 1, 0, seeded(3), noSkip)).toBe('string');
  });

  it('is deterministic for a seed, and every cell is soft growth (a body walks through it)', () => {
    const w = cave();
    const a = planIronvine(w, 100, FLOOR - 1, 1, 0, seeded(7), noSkip);
    const b = planIronvine(w, 100, FLOOR - 1, 1, 0, seeded(7), noSkip);
    expect(a).toEqual(b);
    if (typeof a === 'string') throw new Error(a);
    expect(blocksEntity(Cell.Vines)).toBe(false);
    // the cells appear along the path: the front moves 3 cells a tick, and the tail of the column lags its base
    const first = a.cells[0].at, last = a.cells[a.cells.length - 1].at;
    expect(first).toBe(0);
    expect(last).toBeGreaterThanOrEqual(Math.floor(60 / TUNING.vine.speed));
    for (const c of a.cells) expect(c.at).toBe(Math.floor(c.k / TUNING.vine.speed) + c.depth);
  });

  it('withers tips first: the order falls along the path', () => {
    const w = cave();
    const plan = planIronvine(w, 100, FLOOR - 1, 1, 0, seeded(5), noSkip);
    if (typeof plan === 'string') throw new Error(plan);
    const near = plan.cells.filter((c) => c.k < 10).map((c) => c.order);
    const far = plan.cells.filter((c) => c.k > 50).map((c) => c.order);
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(far)).toBeLessThan(mean(near));
  });
});

// ---------------------------------------------------------------------------------------------------- withering

describe('the wither schedule', () => {
  it('crumbles each cell between 24 s and 26 s after the cast, in order', () => {
    const T = TUNING.vine;
    expect(witherDie(1000, T.lifeTicks, T.spread, 0)).toBe(1000 + 1440);
    expect(witherDie(1000, T.lifeTicks, T.spread, 1)).toBe(1000 + 1440 + 120);
    expect(witherDie(1000, T.lifeTicks, T.spread, 0.5)).toBe(1000 + 1440 + 60);
    // clamped
    expect(witherDie(0, 10, 10, 5)).toBe(20);
    expect(witherDie(0, 10, 10, -1)).toBe(10);
    expect((T.lifeTicks + T.spread / 2) / 60).toBeCloseTo(25, 6); // about 25 s on average
  });

  it('browns for a fade, dries, then goes', () => {
    expect(witherStage(0, 1000, 90)).toBe(0);
    expect(witherStage(909, 1000, 90)).toBe(0);
    expect(witherStage(910, 1000, 90)).toBe(1);
    expect(witherStage(954, 1000, 90)).toBe(1);
    expect(witherStage(955, 1000, 90)).toBe(2);
    expect(witherStage(999, 1000, 90)).toBe(2);
    expect(witherStage(1000, 1000, 90)).toBe(3);
    expect(witherStage(5000, 1000, 90)).toBe(3);
  });

  it('mixes a colour toward dry brown', () => {
    expect(mixRgb(0x00ff00, DRY, 0)).toBe(0x00ff00);
    expect(mixRgb(0x00ff00, DRY, 1)).toBe(DRY);
    expect(vnoise(3.3, 9.1)).toBeGreaterThanOrEqual(0);
    expect(vnoise(3.3, 9.1)).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------------------------------- the ledger

describe('the Crop ledger', () => {
  const REPORT: GrowReport = { written: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
  const row = (n: number, cell: number, die: number, at = 0): CropCell[] =>
    Array.from({ length: n }, (_, i) => ({ x: 100 + i, y: FLOOR - 1, cell, life: -1, color: 0x22aa44, at: at + i, die, root: cell === Cell.Trunk }));

  it('writes each cell at its time, with its life, and tells the caller', () => {
    const w = cave();
    const crop = new Crop(w, 'vine', 0, row(5, Cell.Vines, 500));
    const told: number[] = [];
    crop.grow(2, noSkip, REPORT, (x) => told.push(x));
    expect(REPORT.written).toBe(3); // at 0, 1, 2
    expect(told).toEqual([100, 101, 102]);
    expect(w.types[w.idx(102, FLOOR - 1)]).toBe(Cell.Vines);
    expect(w.life[w.idx(102, FLOOR - 1)]).toBe(-1);
    expect(w.types[w.idx(103, FLOOR - 1)]).toBe(Cell.Empty);
    expect(crop.growing).toBe(true);
    crop.grow(10, noSkip, REPORT);
    expect(crop.growing).toBe(false);
    expect(crop.standing()).toBe(5);
    expect(crop.live).toBe(5);
  });

  it('does not write into a body, a solid or a liquid', () => {
    const w = cave();
    w.replaceCellAt(w.idx(101, FLOOR - 1), Cell.Water, 0x2060ff);
    w.replaceCellAt(w.idx(102, FLOOR - 1), Cell.Stone, 0x555555);
    const crop = new Crop(w, 'vine', 0, row(5, Cell.Vines, 500));
    crop.grow(10, (x) => x === 103, REPORT);
    expect(REPORT.written).toBe(2); // 100 and 104
    expect(w.types[w.idx(101, FLOOR - 1)]).toBe(Cell.Water);
    expect(w.types[w.idx(102, FLOOR - 1)]).toBe(Cell.Stone);
  });

  it('browns before it crumbles, and clears each cell on its own clock', () => {
    const w = cave();
    const cells = row(4, Cell.Vines, 0).map((c, i) => ({ ...c, at: 0, die: 1000 + i * 40 }));
    const crop = new Crop(w, 'vine', 0, cells);
    crop.grow(0, noSkip, REPORT);
    const i0 = w.idx(100, FLOOR - 1);
    const green = w.colors[i0];
    crop.wither(900, 90, 3600);
    expect(w.colors[i0]).toBe(green); // 100 ticks to go: healthy
    crop.wither(920, 90, 3600);
    expect(w.colors[i0]).not.toBe(green); // browning
    crop.wither(980, 90, 3600);
    expect(w.colors[i0]).toBe(mixRgb(green, DRY, 0.92)); // dry
    const dust: number[] = [];
    expect(crop.wither(1000, 90, 3600, (x) => dust.push(x))).toBe(1);
    expect(w.types[i0]).toBe(Cell.Empty);
    expect(dust).toEqual([100]);
    expect(crop.standing()).toBe(3);
    expect(crop.wither(1200, 90, 3600)).toBe(3);
    expect(crop.standing()).toBe(0);
    expect(crop.finished).toBe(true);
  });

  it('lets go of what the world took, but still withers a vine that was lifted and settles back', () => {
    const w = cave();
    const crop = new Crop(w, 'vine', 0, row(3, Cell.Vines, 1000).map((c) => ({ ...c, at: 0 })));
    crop.grow(0, noSkip, REPORT);
    const burnt = w.idx(100, FLOOR - 1), lifted = w.idx(101, FLOOR - 1);
    w.replaceCellAt(burnt, Cell.Ash, 0x888888); // burnt: gone for good
    w.clearCellAt(lifted); // lifted into a strand: the cell is empty for now
    crop.wither(1000, 90, 3600);
    expect(crop.standing()).toBe(0); // the third crumbled on its clock; the other two were not there to crumble
    expect(w.types[burnt]).toBe(Cell.Ash); // it never touches what is not its own
    // the strand settles back after the due time: it is withered when seen
    w.replaceCellAt(lifted, Cell.Vines, 0x22aa44);
    crop.wither(1500, 90, 3600);
    expect(w.types[lifted]).toBe(Cell.Empty);
    expect(crop.finished).toBe(false); // the burnt vine is indistinguishable from a lifted one: it is owed until the owing runs out
    crop.wither(1000 + 3600, 90, 3600);
    expect(crop.finished).toBe(true);
  });

  it('severs the strand that holds a lifted vine, lowest cell first, and lets the cell go', () => {
    const w = cave();
    // a hanging vine: five cells down from the roof, each dying a little before the one above (tip first)
    const cells: CropCell[] = Array.from({ length: 5 }, (_, i) => ({ x: 100, y: CEIL + 1 + i, cell: Cell.Vines, life: -1, color: 0x22aa44, at: 0, die: 1000 - i * 2, root: false }));
    const crop = new Crop(w, 'vine', 0, cells);
    crop.grow(0, noSkip, REPORT);
    for (const c of cells) w.clearCellAt(w.idx(c.x, c.y)); // the sim lifts the cluster into a swaying strand
    const cuts: number[] = [];
    crop.wither(995, 90, 3600, undefined, (_x, y) => { cuts.push(y); return true; });
    expect(cuts).toEqual([CEIL + 5, CEIL + 4]); // those due so far (the two lowest), bottom first
    crop.wither(1001, 90, 3600, undefined, (_x, y) => { cuts.push(y); return true; });
    expect(cuts.slice(2)).toEqual([CEIL + 3, CEIL + 2, CEIL + 1]);
    expect(crop.finished).toBe(true);
    // a cut is not asked twice for the same cell
    crop.wither(1100, 90, 3600, undefined, (_x, y) => { cuts.push(y); return true; });
    expect(cuts.length).toBe(5);
  });

  it('cuts lifted vines loose when it is wiped, lowest first', () => {
    const w = cave();
    const cells: CropCell[] = Array.from({ length: 3 }, (_, i) => ({ x: 100, y: CEIL + 1 + i, cell: Cell.Vines, life: -1, color: 0x22aa44, at: 0, die: 9999, root: false }));
    const crop = new Crop(w, 'vine', 0, cells);
    crop.grow(0, noSkip, REPORT);
    w.clearCellAt(w.idx(100, CEIL + 2)); // lifted
    const cuts: number[] = [];
    expect(crop.wipe((_x, y) => { cuts.push(y); return true; })).toBe(2);
    expect(cuts).toEqual([CEIL + 2]);
  });

  it('stops owing after the owing runs out', () => {
    const w = cave();
    const crop = new Crop(w, 'vine', 0, row(1, Cell.Vines, 100).map((c) => ({ ...c, at: 0 })));
    crop.grow(0, noSkip, REPORT);
    w.clearCellAt(w.idx(100, FLOOR - 1));
    crop.wither(200, 90, 3600);
    expect(crop.finished).toBe(false); // still owed
    crop.wither(100 + 3600, 90, 3600);
    expect(crop.finished).toBe(true);
  });

  it('wipes what it grew and only that', () => {
    const w = cave();
    const crop = new Crop(w, 'vine', 0, row(4, Cell.Vines, 9999).map((c) => ({ ...c, at: 0 })));
    crop.grow(0, noSkip, REPORT);
    w.replaceCellAt(w.idx(100, FLOOR - 1), Cell.Fire, 0xff6600); // not hers any more
    expect(crop.wipe()).toBe(3);
    expect(w.types[w.idx(100, FLOOR - 1)]).toBe(Cell.Fire);
    expect(w.types[w.idx(101, FLOOR - 1)]).toBe(Cell.Empty);
    expect(crop.finished).toBe(true);
  });

  it('knows its roots, and only while they stand', () => {
    const w = cave();
    const cells = [...row(2, Cell.Trunk, 9999), ...row(2, Cell.Moss, 9999).map((c) => ({ ...c, y: FLOOR - 2 }))].map((c) => ({ ...c, at: 0 }));
    const crop = new Crop(w, 'over', 0, cells);
    crop.grow(0, noSkip, REPORT);
    expect(crop.isRoot(w.idx(100, FLOOR - 1))).toBe(true);
    expect(crop.isRoot(w.idx(100, FLOOR - 2))).toBe(false); // moss is not a hold
    expect(crop.isRoot(w.idx(300, FLOOR - 1))).toBe(false);
    w.clearCellAt(w.idx(100, FLOOR - 1));
    expect(crop.isRoot(w.idx(100, FLOOR - 1))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------- Overgrowth

describe('Overgrowth: the plan', () => {
  const cx = 200, cy = FLOOR - 9;
  const T = TUNING.over;

  it('grows roots, vines, moss and leaves, inside the radius, into open air only', () => {
    const w = cave({ leftWall: 140 }); // a wall at x = 140: wall roots have a face
    const plan = planOvergrowth(w, cx, cy, seeded(11), noSkip);
    const kinds = new Map<number, number>();
    for (const c of plan) {
      kinds.set(c.cell, (kinds.get(c.cell) ?? 0) + 1);
      expect(isOpen(w, c.x, c.y)).toBe(true);
      expect(Math.hypot(c.x - cx, c.y - cy)).toBeLessThanOrEqual(T.radius + 0.01);
    }
    expect(kinds.get(Cell.Trunk) ?? 0).toBeGreaterThan(80);
    expect(kinds.get(Cell.Moss) ?? 0).toBeGreaterThan(30);
    expect(kinds.get(Cell.Leaf) ?? 0).toBeGreaterThan(10);
    expect(kinds.get(Cell.Vines) ?? 0).toBeGreaterThan(10);
    expect(plan.length).toBeLessThanOrEqual(T.maxCells);
    expect(new Set(plan.map((c) => c.x + c.y * W)).size).toBe(plan.length); // no cell twice
    // in order of appearance, the wave sweeping out from her
    for (let i = 1; i < plan.length; i++) expect(plan[i].at).toBeGreaterThanOrEqual(plan[i - 1].at);
    expect(plan[plan.length - 1].at).toBeLessThanOrEqual(T.growTicks + 50);
  });

  it('seals no route: it is soft growth only, and the reachable cave is exactly what it was', () => {
    const w = cave();
    const before = reach(w, 20, FLOOR - 1);
    expect(before.has(380 + (FLOOR - 1) * W)).toBe(true);
    const plan = planOvergrowth(w, cx, cy, seeded(12), noSkip);
    for (const c of plan) {
      expect([Cell.Trunk, Cell.Moss, Cell.Leaf, Cell.Vines]).toContain(c.cell);
      expect(blocksEntity(c.cell)).toBe(false);
      w.replaceCellAt(w.idx(c.x, c.y), c.cell, c.color);
      w.life[w.idx(c.x, c.y)] = c.life;
    }
    const after = reach(w, 20, FLOOR - 1);
    expect(after.size).toBe(before.size);
    expect(after.has(380 + (FLOOR - 1) * W)).toBe(true);
  });

  it('keeps every cell a body holds clear', () => {
    const w = cave();
    const body = (x: number, y: number): boolean => Math.abs(x - 200) <= 6 && y >= FLOOR - 19 && y <= FLOOR;
    const plan = planOvergrowth(w, cx, cy, seeded(13), body);
    expect(plan.length).toBeGreaterThan(200);
    for (const c of plan) expect(body(c.x, c.y)).toBe(false);
  });

  it('hangs its roots from rock that holds: every Trunk stand is supported (the flora would not fell it)', () => {
    const w = cave({ leftWall: 140 });
    const plan = planOvergrowth(w, cx, cy, seeded(14), noSkip);
    for (const c of plan) {
      w.replaceCellAt(w.idx(c.x, c.y), c.cell, c.color);
      w.life[w.idx(c.x, c.y)] = c.life;
    }
    const scratch = new FloodScratch();
    scratch.ensure(w.types.length);
    const epoch = scratch.next();
    let stands = 0;
    for (let i = 0; i < w.types.length; i++) {
      if (w.types[i] !== Cell.Trunk || scratch.visit[i] === epoch) continue;
      const stand = floodStand(w, i % W, (i / W) | 0, scratch, epoch);
      stands++;
      expect(stand.supported).toBe(true);
    }
    expect(stands).toBeGreaterThan(4);
  });

  it('is supported at every moment of the withering too: the tips go first, and no stand is left cut off from the rock (ten zones)', () => {
    let checks = 0;
    for (let seed = 32; seed < 42; seed++) {
      const w = cave({ leftWall: seed % 2 === 0 ? 140 : 6 });
      const plan = planOvergrowth(w, cx, cy, seeded(seed), noSkip);
      for (const c of plan) {
        w.replaceCellAt(w.idx(c.x, c.y), c.cell, c.color);
        w.life[w.idx(c.x, c.y)] = c.life;
      }
      // the cells go in the order of their wither time (the kit clears each at its own frame), a tick at a time
      const die = (c: { order: number }): number => Math.floor(T.witherSpread * Math.min(1, Math.max(0, c.order)));
      const byTime = [...plan].sort((a, b) => die(a) - die(b));
      const scratch = new FloodScratch();
      scratch.ensure(w.types.length);
      let i = 0;
      for (let t = 0; t <= T.witherSpread + 1; t++) {
        let cleared = false;
        for (; i < byTime.length && die(byTime[i]) <= t; i++) {
          w.clearCellAt(w.idx(byTime[i].x, byTime[i].y));
          cleared = cleared || byTime[i].cell === Cell.Trunk;
        }
        if (!cleared) continue;
        const epoch = scratch.next();
        for (let k = 0; k < w.types.length; k++) {
          if (w.types[k] !== Cell.Trunk || scratch.visit[k] === epoch) continue;
          const stand = floodStand(w, k % W, (k / W) | 0, scratch, epoch);
          checks++;
          // (a scrap under FELL_MIN_CELLS that loses its hold just crumbles to ash: it never becomes a log)
          if (!stand.supported && stand.count >= FELL_MIN_CELLS) throw new Error(`seed ${seed}: an unheld stand after tick ${t} of the wither: ${stand.count} cells from ${k % W},${(k / W) | 0}`);
        }
      }
      expect(i).toBe(plan.length);
    }
    expect(checks).toBeGreaterThan(500);
  });

  it('leaves are held: each rests within leaf reach of rock or wood through other leaves', () => {
    const w = cave();
    const plan = planOvergrowth(w, cx, cy, seeded(15), noSkip);
    for (const c of plan) {
      w.replaceCellAt(w.idx(c.x, c.y), c.cell, c.color);
      w.life[w.idx(c.x, c.y)] = c.life;
    }
    // a multi-source BFS over the leaves from every cell that anchors one
    for (const c of plan) {
      if (c.cell !== Cell.Leaf) continue;
      let steps = -1;
      const seen = new Set<number>([c.x + c.y * W]);
      let frontier: Array<[number, number]> = [[c.x, c.y]];
      for (let d = 0; d <= LEAF_REACH && steps < 0; d++) {
        const next: Array<[number, number]> = [];
        for (const [x, y] of frontier) {
          for (let dy = -1; dy <= 1 && steps < 0; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            const t = w.types[nx + ny * W];
            if (leafAnchor(t)) { steps = d; break; }
            if (t === Cell.Leaf && !seen.has(nx + ny * W)) { seen.add(nx + ny * W); next.push([nx, ny]); }
          }
        }
        frontier = next;
      }
      expect(steps).toBeGreaterThanOrEqual(0);
    }
  });

  it('always clings some roots up a wall that is in the zone (every one of thirty zones)', () => {
    for (let seed = 51; seed < 81; seed++) {
      const w = cave({ leftWall: 140 });
      const plan = planOvergrowth(w, cx, cy, seeded(seed), noSkip);
      const beside = plan.filter((c) => c.cell === Cell.Trunk && isAnchor(w, c.x - 1, c.y) && c.x <= 146).length;
      expect(beside, `seed ${seed}`).toBeGreaterThan(20);
    }
  });

  it('writes each hanging vine in one tick, top to bottom (the sim lifts a hanging cluster and would drop a cell added under it)', () => {
    const w = cave();
    const plan = planOvergrowth(w, cx, cy, seeded(41), noSkip);
    const vines = plan.filter((c) => c.cell === Cell.Vines);
    expect(vines.length).toBeGreaterThan(20);
    const byColumn = new Map<number, Set<number>>();
    for (const c of vines) byColumn.set(c.x, (byColumn.get(c.x) ?? new Set<number>()).add(c.at));
    for (const ats of byColumn.values()) expect(ats.size).toBe(1);
    // and down a vine the wither order only falls: the tip goes first
    for (const [x] of byColumn) {
      const col = vines.filter((c) => c.x === x).sort((a, b) => a.y - b.y);
      for (let i = 1; i < col.length; i++) expect(col[i].order).toBeLessThanOrEqual(col[i - 1].order);
    }
  });

  it('is deterministic for a seed and different for another', () => {
    const w = cave();
    const a = planOvergrowth(w, cx, cy, seeded(21), noSkip);
    const b = planOvergrowth(w, cx, cy, seeded(21), noSkip);
    const c = planOvergrowth(w, cx, cy, seeded(22), noSkip);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('plans little where there is nothing to grow on', () => {
    expect(planOvergrowth(new World(W, H), cx, cy, seeded(1), noSkip).length).toBeLessThan(T.minCells);
  });

  it('is supported at every moment of the growth: no stand, not even a scrap, stands unheld while it grows (ten zones)', () => {
    let ticks = 0, checked = 0;
    for (let seed = 31; seed < 41; seed++) {
      const w = cave({ leftWall: seed % 2 === 1 ? 140 : 6 });
      const plan = planOvergrowth(w, cx, cy, seeded(seed), noSkip);
      const scratch = new FloodScratch();
      scratch.ensure(w.types.length);
      let i = 0;
      for (let at = 0; at <= T.growTicks + 60; at++) {
        let wrote = false;
        for (; i < plan.length && plan[i].at <= at; i++) {
          const c = plan[i];
          w.replaceCellAt(w.idx(c.x, c.y), c.cell, c.color);
          w.life[w.idx(c.x, c.y)] = c.life;
          wrote = wrote || c.cell === Cell.Trunk;
        }
        if (!wrote) continue;
        ticks++;
        const epoch = scratch.next();
        for (let k = 0; k < w.types.length; k++) {
          if (w.types[k] !== Cell.Trunk || scratch.visit[k] === epoch) continue;
          const stand = floodStand(w, k % W, (k / W) | 0, scratch, epoch);
          checked++;
          if (!stand.supported) throw new Error(`seed ${seed}: an unheld stand at tick ${at}: ${stand.count} cells from ${k % W},${(k / W) | 0}`);
        }
      }
    }
    expect(ticks).toBeGreaterThan(200);
    expect(checked).toBeGreaterThan(500);
  });

  it('settles overlapping roots: a cell appears only once a held neighbour has, and goes before it loses its way back to the rock', () => {
    const w = cave();
    // two roots hung from the roof, the second crossing the first, with times that would leave a fragment cut off
    const mk = (x: number, y: number, at: number, order: number): { x: number; y: number; cell: number; life: number; color: number; at: number; order: number; root: boolean } =>
      ({ x, y, cell: Cell.Trunk, life: -1, color: 0x664422, at, order, root: true });
    const cells = [
      mk(100, CEIL + 1, 5, 0.9), mk(100, CEIL + 2, 6, 0.8), mk(100, CEIL + 3, 20, 0.2), // a root whose third cell is late and dies early
      mk(101, CEIL + 4, 3, 0.95), mk(101, CEIL + 5, 3, 0.95), // a fragment that would appear first and outlive its link
    ];
    settleSupport(w, cells);
    const by = (x: number, y: number) => cells.find((c) => c.x === x && c.y === y);
    expect(by(100, CEIL + 1)?.at).toBe(5); // held by the roof: stands on its own
    expect(by(101, CEIL + 4)?.at).toBe(20); // not before the cell that links it (100, CEIL + 3) is there
    expect(by(101, CEIL + 5)?.at).toBe(20);
    expect(by(101, CEIL + 4)?.order).toBeLessThanOrEqual(0.2 + 1e-9); // and it goes no later than that link
    expect(by(100, CEIL + 3)?.order).toBeCloseTo(0.2, 9);
  });
});

// ---------------------------------------------------------------------------------------------------- the kit through the real system

interface Setup {
  ctx: Ctx;
  sys: FighterSystem;
  world: World;
  enemies: Enemy[];
  player: Ctx['player'];
  step(n?: number): void;
  sfx: string[];
}

function setup(opts: { noFloor?: boolean } = {}): Setup {
  const world = cave();
  if (opts.noFloor) for (let y = FLOOR - 40; y < H; y++) for (let x = 0; x < W; x++) world.clearCellAt(world.idx(x, y));
  const events = new EventBus();
  const enemies: Enemy[] = [];
  const sfx: string[] = [];
  const player = {
    x: 200, y: FLOOR - 1, fx: 0, fy: 0, vx: 0, vy: 0, hp: 100, maxHp: 100, facing: 1, grounded: true, dead: false, invuln: 0,
    recharge: 0, pullT: 0, climbing: false, climbDir: 1, climbIntentY: 0, crouchT: 0, crawling: false, swinging: false,
    aimAngle: 0, lastDamageSource: null as string | null, status: { burning: 0 }, hat: { vx: 0, vy: 0 },
  };
  const state = { mode: 'play', frameCount: 1, paused: false };
  const noop = (): void => undefined;
  const ctx = {
    events, state, player, enemies, world,
    physics: { entityFree: (): boolean => true, tryMoveEntity: (): boolean => true },
    fx: { screenShake: 0, bloomKick: 0 },
    enemyCtl: {
      defs: { slime: { hp: 48, halfW: 5, h: 8, bounty: 0 }, golem: { hp: 170, halfW: 7, h: 20, bounty: 0 } },
      damage: (e: Enemy, amount: number): void => { e.hp -= amount; },
    },
    audio: { sfx: (id: string) => { sfx.push(id); } },
    particles: { burst: noop, spawn: noop },
    playerCtl: { releaseVine: noop },
    input: { keys: {} },
  } as unknown as Ctx;
  const sys = new FighterSystem(ctx, () => kit);
  sys.equip('father-thorne');
  return {
    ctx, sys, world, enemies, player: ctx.player, sfx,
    step: (n = 1) => { for (let i = 0; i < n; i++) { state.frameCount++; sys.update(ctx); } },
  };
}

function makeEnemy(x: number, y: number, kind = 'slime', hp = 400): Enemy {
  return { x, y, hp, maxHp: hp, kind, vx: 0, vy: 0, bobPhase: 0, knockVy: 0, knockVx: 0, knockT: 0, sleeping: false } as unknown as Enemy;
}

function standingOf(w: World, type: number): number {
  let n = 0;
  for (let i = 0; i < w.types.length; i++) if (w.types[i] === type) n++;
  return n;
}

describe('Father Thorne through the fighter system', () => {
  it('Rooted Camouflage: still near cover for 4 s she is 60% hidden; a step and she is not', () => {
    const { sys, world, player, step } = setup();
    // cover: eight cells of moss on the ground beside her
    for (let x = 196; x < 204; x++) world.replaceCellAt(world.idx(x, FLOOR - 1), Cell.Moss, 0x336633);
    step(1);
    expect(sys.concealment()).toBe(0);
    step(58);
    expect(sys.concealment()).toBe(0); // still settling: the first second
    step(122);
    expect(sys.concealment()).toBeGreaterThan(0.1);
    expect(sys.concealment()).toBeLessThan(0.6);
    expect(sys.view.meter).not.toBeNull();
    expect(sys.view.meter?.label).toBe('Rooted');
    step(130);
    expect(sys.concealment()).toBeCloseTo(0.6, 6);
    player.vx = 2; // she walks
    step(1);
    expect(sys.concealment()).toBe(0);
    expect(sys.view.meter).toBeNull();
    player.vx = 0;
    step(30);
    expect(sys.concealment()).toBe(0); // and the wait starts again
  });

  it('Rooted Camouflage: nothing without cover, and not while airborne', () => {
    const { sys, player, step } = setup();
    step(400);
    expect(sys.concealment()).toBe(0);
    expect(sys.view.meter).toBeNull();
    const second = setup();
    for (let x = 196; x < 204; x++) second.world.replaceCellAt(second.world.idx(x, FLOOR - 1), Cell.Moss, 0x336633);
    second.player.grounded = false;
    second.step(400);
    expect(second.sys.concealment()).toBe(0);
    expect(player.x).toBe(200);
  });

  it('Ironvine: refused with nothing to grow on, and the cooldown is not spent', () => {
    const { sys, player, step, sfx } = setup({ noFloor: true });
    player.y = 150; // between the ceiling and where the floor was: nothing within reach
    player.grounded = false;
    step(1);
    sys.press('tactical');
    step(1);
    expect(sys.view.tactical.ready).toBe(true);
    expect(sys.view.tactical.refusedAt).toBeGreaterThan(0);
    expect(sfx).toContain('wand.dry');
  });

  it('Ironvine: grows a thorn carpet along the floor, then withers it on its own after about 25 s', () => {
    const { sys, world, step, ctx } = setup();
    const before = censusOf(world);
    step(1);
    sys.press('tactical');
    step(1);
    expect(sys.view.tactical.ready).toBe(false);
    expect(sys.view.tactical.cooldownSeconds).toBeGreaterThanOrEqual(11);
    step(30); // 3 cells a tick: the whole 60 cells is down by 20 ticks
    const grown = standingOf(world, Cell.Vines);
    expect(grown).toBeGreaterThan(100);
    expect(grown).toBeLessThan(200);
    expect(sys.view.tactical.active).toBeGreaterThan(0.9);
    // every Vines cell sits on or just over the floor (2-3 deep) and has the ground or another vine beneath it
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (world.types[world.idx(x, y)] !== Cell.Vines) continue;
      expect(y).toBeGreaterThanOrEqual(FLOOR - 3);
      expect(y).toBeLessThan(FLOOR);
    }
    expect(world.life[world.idx(230, FLOOR - 1)]).toBe(-1); // dormant: it does not sprout past what was written
    step(1300);
    expect(standingOf(world, Cell.Vines)).toBe(grown); // 24 s: every cell is still there
    step(160); // browning, then crumbling between 24 s and 26 s
    expect(standingOf(world, Cell.Vines)).toBeLessThan(grown);
    step(120);
    expect(standingOf(world, Cell.Vines)).toBe(0);
    expect(sys.view.tactical.active).toBe(0);
    // nothing else changed: it wrote no solid and no powder
    const after = censusOf(world);
    for (const [t, n] of after) if (t !== Cell.Empty && t !== Cell.Vines) expect(n).toBe(before.get(t) ?? 0);
    expect(ctx.state.frameCount).toBeGreaterThan(1400);
    step(600);
    expect(sys.view.tactical.ready).toBe(true);
  });

  it('Ironvine: a foe in the vines is slowed to half, scratched once per 12 ticks, and the first one caught is marked', () => {
    const { sys, enemies, step } = setup();
    step(1);
    sys.press('tactical');
    step(25);
    const caught = makeEnemy(230, FLOOR - 1);
    const second = makeEnemy(250, FLOOR - 1);
    const far = makeEnemy(350, FLOOR - 1); // beyond the 60 cells
    enemies.push(caught, second, far);
    step(1);
    step(6);
    expect(sys.enemySlow(caught)).toBe(0.5);
    expect(sys.isMarked(caught)).toBe(true);
    expect(sys.isMarked(second)).toBe(false); // only the first
    expect(sys.isRevealed(caught)).toBe(true);
    expect(sys.enemySlow(far)).toBe(1);
    expect(far.hp).toBe(400);
    const hp0 = caught.hp;
    step(60);
    const lost = hp0 - caught.hp;
    expect(lost).toBeGreaterThanOrEqual(4);
    expect(lost).toBeLessThanOrEqual(6); // 1 per 12 ticks over 60 ticks
    expect(sys.enemySlow(second)).toBe(0.5);
    // a foe that leaves is no longer scratched, and its slow lapses in under a quarter of a second
    caught.x = 340;
    step(20);
    const hp1 = caught.hp;
    step(60);
    expect(caught.hp).toBe(hp1);
    expect(sys.enemySlow(caught)).toBe(1);
  });

  it('Overgrowth: a full bar sweeps a zone of soft growth around her, conceals her, slows foes and ends cleanly', () => {
    const { sys, world, player, enemies, step } = setup();
    const before = censusOf(world);
    sys.addCharge(1);
    step(1);
    expect(sys.view.ultimate.ready).toBe(true);
    sys.press('ultimate');
    step(1);
    expect(sys.view.ultimate.active).toBeGreaterThan(0.9);
    expect(sys.concealment()).toBeCloseTo(0.7, 6); // at once, from the first tick
    step(70);
    const trunk = standingOf(world, Cell.Trunk), moss = standingOf(world, Cell.Moss), leaf = standingOf(world, Cell.Leaf), vines = standingOf(world, Cell.Vines);
    expect(trunk).toBeGreaterThan(80);
    expect(moss).toBeGreaterThan(30);
    expect(leaf).toBeGreaterThan(10);
    expect(vines).toBeGreaterThan(10);
    // foes inside are slowed to 0.6, those outside are not
    const inside = makeEnemy(230, FLOOR - 1), outside = makeEnemy(300, FLOOR - 1);
    enemies.push(inside, outside);
    step(7);
    expect(sys.enemySlow(inside)).toBe(0.6);
    expect(sys.enemySlow(outside)).toBe(1);
    // she is hidden only while she is in it
    expect(sys.concealment()).toBeCloseTo(0.7, 6);
    player.x = 300;
    step(1);
    expect(sys.concealment()).toBeLessThan(0.7);
    player.x = 200;
    step(1);
    expect(sys.concealment()).toBeCloseTo(0.7, 6);
    // the roots are hand-holds: a Trunk cell of the crop is a hold, a Trunk cell of the world's own is not
    let rootAt: [number, number] | null = null;
    for (let y = 0; y < H && !rootAt; y++) for (let x = 0; x < W; x++) if (world.types[world.idx(x, y)] === Cell.Trunk) { rootAt = [x, y]; break; }
    expect(rootAt).not.toBeNull();
    expect(sys.climbHold(rootAt?.[0] ?? 0, rootAt?.[1] ?? 0)).toBe(true);
    world.replaceCellAt(world.idx(30, 150), Cell.Trunk, 0x664422); // natural wood, not hers
    expect(sys.climbHold(30, 150)).toBe(false);
    expect(sys.climbHold(200, FLOOR)).toBe(false); // rock is held by the engine's own rule, not by this seam
    // the effect ends at 720 ticks: the zone and the slow end; the roots brown and go over the next few seconds
    step(660);
    expect(sys.view.ultimate.active).toBe(0);
    player.vx = 1; // (standing still in the cover she grew she would be hidden by the passive; the zone's own 0.7 is what ends)
    step(1);
    expect(sys.concealment()).toBe(0);
    player.vx = 0;
    step(7);
    expect(sys.enemySlow(inside)).toBe(1);
    step(260);
    for (const t of [Cell.Trunk, Cell.Moss, Cell.Vines]) expect(standingOf(world, t)).toBeLessThanOrEqual(before.get(t) ?? 0 + 1);
    expect(standingOf(world, Cell.Trunk)).toBe((before.get(Cell.Trunk) ?? 0) + 1); // only the hand-placed natural one
    expect(standingOf(world, Cell.Vines)).toBe(0);
    expect(sys.climbHold(rootAt?.[0] ?? 0, rootAt?.[1] ?? 0)).toBe(false);
  });

  it('Overgrowth: bar not full is refused; nothing to grow on is refused and the bar is kept', () => {
    const a = setup();
    a.step(1);
    a.sys.press('ultimate');
    a.step(1);
    expect(a.sys.view.ultimate.active).toBe(0);
    expect(a.sys.view.ultimate.refusedAt).toBeGreaterThan(0);
    expect(standingOf(a.world, Cell.Trunk)).toBe(0);
    const b = setup({ noFloor: true });
    b.player.y = FLOOR - 120;
    b.player.grounded = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) b.world.clearCellAt(b.world.idx(x, y)); // an empty void
    b.sys.addCharge(1);
    b.step(1);
    b.sys.press('ultimate');
    b.step(1);
    expect(b.sys.view.ultimate.active).toBe(0);
    expect(b.sys.view.ultimate.charge).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(b.sfx).toContain('wand.dry');
  });

  it('a reset (a respawn, a floor change) takes back what she grew', () => {
    const { sys, world, step, ctx } = setup();
    step(1);
    sys.press('tactical');
    step(30);
    expect(standingOf(world, Cell.Vines)).toBeGreaterThan(100);
    ctx.events.emit('playerRespawned', undefined as never);
    expect(standingOf(world, Cell.Vines)).toBe(0);
    sys.addCharge(1);
    step(1);
    sys.press('ultimate');
    step(70);
    expect(standingOf(world, Cell.Trunk)).toBeGreaterThan(80);
    ctx.events.emit('levelChanged', { depth: 2, name: 'x' });
    expect(standingOf(world, Cell.Trunk)).toBe(0);
    expect(standingOf(world, Cell.Moss)).toBe(0);
    expect(sys.concealment()).toBe(0);
  });

  it('draws its own tells and puts them back after a reset', () => {
    const { sys, step, ctx } = setup();
    step(1);
    expect(sys.drawables.length).toBe(1);
    ctx.events.emit('levelChanged', { depth: 2, name: 'x' });
    expect(sys.drawables.length).toBe(0); // the system clears every drawable
    step(1);
    expect(sys.drawables.length).toBe(1); // the kit puts its own back
  });
});

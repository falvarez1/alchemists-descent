import { describe, expect, it } from 'vitest';

import { Cell, blocksEntity } from '@/sim/CellType';
import { World } from '@/sim/World';
import { wizardMask } from '@/world/validate';
import {
  DRESSING,
  applyPuddles,
  basinCells,
  dripReady,
  emitVent,
  planDressing,
  traceDressingRoute,
  type DressingAnchors,
  type Vent,
} from '@/game/mutatorDressing';

/**
 * The floor dressing (game/mutatorDressing) on a hand-built cave: deterministic from the seed, put
 * where the alchemist walks, in real closed basins, and checked against the route: a dressing that
 * would cost the walk a single position is reverted whole.
 *
 * The cave: a 460 x 140 world of rock with one long tunnel at rows 50..88 (40 tall, so a body fits
 * everywhere), its floor at row 88, with three PITS dug into the floor (a wide one, a narrow one the
 * body cannot stand in, and a deep one) and a few low ceiling bumps.
 */
const W = 460;
const H = 140;
const FLOOR = 88;

function cave(): World {
  const world = new World(W, H);
  for (let i = 0; i < world.types.length; i++) world.types[i] = Cell.Wall;
  const dig = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) world.clearCellAt(x + y * W);
  };
  dig(10, 50, 450, FLOOR - 1); // the tunnel
  dig(150, FLOOR, 175, FLOOR + 3); // a wide pit, 26 across, 4 deep
  dig(250, FLOOR, 253, FLOOR + 6); // a slot too narrow for a body (4 across)
  dig(330, FLOOR, 350, FLOOR + 5); // a deeper pit, 21 across
  return world;
}

function anchors(overrides: Partial<DressingAnchors> = {}): DressingAnchors {
  return {
    spawn: { x: 20, y: FLOOR - 1 },
    exit: { x: 440, sealY: FLOOR + 10 },
    key: null,
    portal: { x: 440, y: FLOOR - 1 },
    boss: null,
    keepOutRects: [],
    keepClear: [],
    ...overrides,
  };
}

const waterCells = (world: World): number => world.types.reduce((n, t) => n + (t === Cell.Water ? 1 : 0), 0);

describe('a basin', () => {
  it('is a closed pool: the empty cells at or below the surface row, bounded on every side', () => {
    const world = cave();
    const cells = basinCells(world, 160, FLOOR + 3, FLOOR, 400, () => true)!;
    expect(cells).not.toBeNull();
    // Every cell is empty air at or below the surface row, and nothing in the region touches open air beside it at its own row.
    const inRegion = new Set(cells);
    for (const i of cells) {
      const x = i % W;
      const y = (i - x) / W;
      expect(y).toBeGreaterThanOrEqual(FLOOR);
      expect(world.types[i]).toBe(Cell.Empty);
      for (const j of [i - 1, i + 1]) if (world.types[j] === Cell.Empty && Math.floor(j / W) === y) expect(inRegion.has(j)).toBe(true);
    }
  });

  it('gives up on a lake: a flat tunnel floor leaks along the whole tunnel, past the cap', () => {
    const world = cave();
    expect(basinCells(world, 80, FLOOR - 1, FLOOR - 1, 110, () => true)).toBeNull();
  });

  it('refuses a basin that touches a place the dressing must keep clear of', () => {
    const world = cave();
    expect(basinCells(world, 160, FLOOR + 3, FLOOR, 400, (x, y) => !(x === 165 && y === FLOOR + 1))).toBeNull();
  });
});

describe('the route', () => {
  it('traces the walk the population traces, spawn to portal', () => {
    const world = cave();
    const route = traceDressingRoute(world, anchors());
    expect(route).not.toBeNull();
    expect(route!.length).toBeGreaterThan(300);
  });
});

describe('planning a floor', () => {
  it('plans nothing for a set of complications that dress nothing', () => {
    const plan = planDressing(cave(), anchors(), 1234, ['tinderbox', 'low-gravity']);
    expect(plan.vents).toEqual([]);
    expect(plan.puddles).toEqual([]);
  });

  it('is deterministic: the same floor, seed and set give the same plan, whatever else has run', () => {
    const a = planDressing(cave(), anchors(), 99, ['wet-floors', 'gas-leak']);
    const b = planDressing(cave(), anchors(), 99, ['wet-floors', 'gas-leak']);
    expect(b).toEqual(a);
    expect(planDressing(cave(), anchors(), 100, ['wet-floors', 'gas-leak'])).not.toEqual(a);
  });

  it('gives each complication its own stream: Wet Floors lays out the same alone or beside another', () => {
    const alone = planDressing(cave(), anchors(), 7, ['wet-floors']);
    const paired = planDressing(cave(), anchors(), 7, ['wet-floors', 'slime-rain']);
    expect(paired.puddles).toEqual(alone.puddles);
    expect(paired.vents.filter((v) => v.kind === 'drips')).toEqual(alone.vents.filter((v) => v.kind === 'drips'));
    expect(paired.vents.some((v) => v.kind === 'slime')).toBe(true);
  });

  it('puts puddles in pits the alchemist can stand in, never the slot his body cannot fit', () => {
    let wide = 0;
    let slot = 0;
    for (let seed = 1; seed <= 25; seed++) {
      for (const p of planDressing(cave(), anchors(), seed, ['wet-floors']).puddles) {
        for (const i of p.cells) {
          const x = i % W;
          if (x >= 150 && x <= 175) wide++;
          if (x >= 250 && x <= 253) slot++;
        }
        expect(p.cells.length).toBeGreaterThanOrEqual(DRESSING.PUDDLE_MIN_CELLS);
        expect(p.cells.length).toBeLessThanOrEqual(DRESSING.PUDDLE_MAX_CELLS);
      }
    }
    expect(wide).toBeGreaterThan(0);
    expect(slot).toBe(0);
  });

  it('keeps clear of the arrival, pickups, and set pieces', () => {
    const world = cave();
    const clear = anchors({
      keepClear: [{ x: 162, y: FLOOR }],
      keepOutRects: [{ x0: 325, y0: FLOOR - 10, x1: 355, y1: FLOOR + 8 }],
    });
    for (let seed = 1; seed <= 25; seed++) {
      const plan = planDressing(world, clear, seed, ['wet-floors', 'gas-leak', 'slime-rain']);
      for (const p of plan.puddles) for (const i of p.cells) {
        const x = i % W;
        const y = (i - x) / W;
        expect(Math.hypot(x - 162, y - FLOOR)).toBeGreaterThanOrEqual(DRESSING.POINT_CLEAR);
        expect(x < 317 || x > 363).toBe(true);
      }
      for (const v of plan.vents) {
        expect(Math.hypot(v.x - 20, v.y - (FLOOR - 1))).toBeGreaterThanOrEqual(DRESSING.SPAWN_CLEAR);
        // (the set piece's rectangle, padded: a ceiling drip far above it is not inside it)
        expect(v.x >= 317 && v.x <= 363 && v.y >= FLOOR - 18 && v.y <= FLOOR + 16).toBe(false);
      }
    }
  });

  it('hangs drips from a ceiling over open air and roots gas vents in a floor', () => {
    const world = cave();
    const plan = planDressing(world, anchors(), 5, ['wet-floors', 'gas-leak', 'slime-rain']);
    const drips = plan.vents.filter((v) => v.dir === 0);
    const gas = plan.vents.filter((v) => v.dir === 180);
    expect(drips.length).toBeGreaterThan(0);
    expect(gas.length).toBeGreaterThan(0);
    for (const v of drips) {
      expect(blocksEntity(world.types[v.x + v.y * W])).toBe(true);
      expect(dripReady(world, v)).toBe(true);
    }
    for (const v of gas) {
      expect(blocksEntity(world.types[v.x + v.y * W])).toBe(true);
      expect(world.types[v.x + (v.y - 1) * W]).toBe(Cell.Empty);
    }
  });

  it('is left plain, and says why, when there is no walk to dress', () => {
    const world = new World(W, H); // all air: no tunnel, no floor for the body to fit... and no spawn footing
    for (let i = 0; i < world.types.length; i++) world.types[i] = Cell.Wall;
    const plan = planDressing(world, anchors(), 3, ['wet-floors']);
    expect(plan.puddles).toEqual([]);
    expect(plan.vents).toEqual([]);
    expect(plan.skipped).toBe('no route');
  });
});

describe('writing puddles, and checking the route', () => {
  it('fills the planned cells with real water and costs the route nothing', () => {
    const world = cave();
    const plan = planDressing(world, anchors(), 11, ['wet-floors']);
    expect(plan.puddles.length).toBeGreaterThan(0);
    const before = wizardMask({ world, spawn: anchors().spawn });
    const result = applyPuddles(world, anchors().spawn, plan.puddles);
    expect(result.reverted).toBe(false);
    expect(result.lost).toBe(0);
    expect(result.cells).toBe(plan.puddles.reduce((n, p) => n + p.cells.length, 0));
    expect(waterCells(world)).toBe(result.cells);
    const after = wizardMask({ world, spawn: anchors().spawn });
    for (let i = 0; i < before.length; i++) if (before[i] === 1) expect(after[i]).toBe(1);
  });

  it('reverts the whole dressing when it would wall the route (a dressing that blocks is put back)', () => {
    const world = cave();
    // A deliberately walling "puddle": the whole tunnel cross-section at x = 200, filled with rock.
    const wall = { x: 200, y: FLOOR - 1, depth: 1, cells: Array.from({ length: FLOOR - 50 }, (_, k) => 200 + (50 + k) * W) };
    const solid = Array.from(world.types);
    const result = applyPuddles(world, anchors().spawn, [wall], Cell.Stone);
    expect(result.reverted).toBe(true);
    expect(result.lost).toBeGreaterThan(0);
    expect(result.cells).toBe(0);
    // ...and every cell is as it was.
    expect(Array.from(world.types)).toEqual(solid);
  });

  it('skips cells that are no longer open air (the repair pass carved or sleeved them)', () => {
    const world = cave();
    const plan = planDressing(world, anchors(), 11, ['wet-floors']);
    const first = plan.puddles[0].cells[0];
    world.replaceCellAt(first, Cell.Metal, 0x888888);
    const result = applyPuddles(world, anchors().spawn, plan.puddles);
    expect(world.types[first]).toBe(Cell.Metal);
    expect(result.cells).toBe(plan.puddles.reduce((n, p) => n + p.cells.length, 0) - 1);
  });
});

describe('a vent', () => {
  const gasVent = (world: World): Vent => ({ kind: 'gas', x: 80, y: FLOOR, cell: Cell.MarshGas, dir: 180, rate: 22, burst: 4, phase: 0, budget: 10 });

  it('emits gas upward into open air, only while it has budget', () => {
    const world = cave();
    const vent = gasVent(world);
    expect(emitVent(world, vent)).toBe(4);
    for (let k = 1; k <= 4; k++) expect(world.types[80 + (FLOOR - k) * W]).toBe(Cell.MarshGas);
    expect(vent.budget).toBe(6);
    // the cells it already placed block the next burst until they drift away; budget caps the rest
    vent.budget = 2;
    for (let k = 1; k <= 4; k++) world.clearCellAt(80 + (FLOOR - k) * W);
    expect(emitVent(world, vent)).toBe(2);
    expect(vent.budget).toBe(0);
    expect(emitVent(world, vent)).toBe(0);
  });

  it('does not emit into rock (a vent whose mouth is blocked is silent)', () => {
    const world = cave();
    const vent = gasVent(world);
    world.replaceCellAt(80 + (FLOOR - 1) * W, Cell.Stone, 0x777777);
    expect(emitVent(world, vent)).toBe(0);
    expect(vent.budget).toBe(10);
  });

  it('a drip needs an open cell under its ceiling and some budget left', () => {
    const world = cave();
    const drip: Vent = { kind: 'drips', x: 100, y: 49, cell: Cell.Water, dir: 0, rate: 36, burst: 1, phase: 0, budget: 3 };
    expect(blocksEntity(world.types[100 + 49 * W])).toBe(true);
    expect(dripReady(world, drip)).toBe(true);
    world.replaceCellAt(100 + 50 * W, Cell.Stone, 0x777777);
    expect(dripReady(world, drip)).toBe(false);
    world.clearCellAt(100 + 50 * W);
    drip.budget = 0;
    expect(dripReady(world, drip)).toBe(false);
  });
});

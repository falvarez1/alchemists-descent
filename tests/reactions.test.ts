import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '@/core/types';
import { Cell, isLiquid } from '@/sim/CellType';
import { maybeReact, REACTIONS } from '@/sim/reactions';
import { World } from '@/sim/World';

// The alchemy table's contracts: every entry has a liquid participant (the
// dispatcher hook only runs on liquid cells), products are real cells, and
// the pair transforms actually land on the grid from either side.

function makeCtx(world: World): Ctx {
  return {
    world,
    particles: { spawn: () => undefined },
  } as unknown as Ctx;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('alchemy table contracts', () => {
  it('every reaction has at least one liquid participant', () => {
    for (const r of REACTIONS) {
      expect(isLiquid(r.a) || isLiquid(r.b), `${r.a}+${r.b}`).toBe(true);
    }
  });

  it('every product is a real cell id (or null/consumed)', () => {
    const valid = new Set<number>(Object.values(Cell));
    for (const r of REACTIONS) {
      if (r.aTo !== null) expect(valid.has(r.aTo)).toBe(true);
      if (r.bTo !== null) expect(valid.has(r.bTo)).toBe(true);
    }
  });

  it('no pair is registered twice (last-write silently wins otherwise)', () => {
    const seen = new Set<string>();
    for (const r of REACTIONS) {
      const key = [Math.min(r.a, r.b), Math.max(r.a, r.b)].join('+');
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });
});

describe('alchemy table transforms', () => {
  it('acid touching lava vitrifies: steam + glass', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // every roll passes
    const world = new World(32, 32);
    world.replaceCellAt(world.idx(10, 10), Cell.Acid, 0x28fa28);
    world.replaceCellAt(world.idx(10, 11), Cell.Lava, 0xfa1600);
    const reacted = maybeReact(makeCtx(world), 10, 10, Cell.Acid);
    expect(reacted).toBe(true);
    expect(world.types[world.idx(10, 10)]).toBe(Cell.Steam);
    expect(world.types[world.idx(10, 11)]).toBe(Cell.Glass);
    expect(world.life[world.idx(10, 10)]).toBeGreaterThan(0); // vapor clears
  });

  it('fires symmetrically from the OTHER side of the pair (lava cell active)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const world = new World(32, 32);
    world.replaceCellAt(world.idx(10, 10), Cell.Lava, 0xfa1600);
    world.replaceCellAt(world.idx(10, 11), Cell.Acid, 0x28fa28);
    const reacted = maybeReact(makeCtx(world), 10, 10, Cell.Lava);
    expect(reacted).toBe(true);
    expect(world.types[world.idx(10, 10)]).toBe(Cell.Glass);
    expect(world.types[world.idx(10, 11)]).toBe(Cell.Steam);
  });

  it('the philosopher\'s dust transmutes blood to healium and is CONSUMED', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const world = new World(32, 32);
    world.replaceCellAt(world.idx(8, 8), Cell.Blood, 0xa00c19);
    world.replaceCellAt(world.idx(9, 8), Cell.Catalyst, 0xff963c);
    expect(maybeReact(makeCtx(world), 8, 8, Cell.Blood)).toBe(true);
    expect(world.types[world.idx(8, 8)]).toBe(Cell.Healium);
    expect(world.types[world.idx(9, 8)]).toBe(Cell.Empty); // economy guard
  });

  it('a failed roll leaves both cells untouched', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // every roll fails
    const world = new World(32, 32);
    world.replaceCellAt(world.idx(10, 10), Cell.Acid, 0x28fa28);
    world.replaceCellAt(world.idx(10, 11), Cell.Lava, 0xfa1600);
    expect(maybeReact(makeCtx(world), 10, 10, Cell.Acid)).toBe(false);
    expect(world.types[world.idx(10, 10)]).toBe(Cell.Acid);
    expect(world.types[world.idx(10, 11)]).toBe(Cell.Lava);
  });

  it('unlisted neighbours never react (water beside oil is just wet oil)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const world = new World(32, 32);
    world.replaceCellAt(world.idx(10, 10), Cell.Water, 0x2369f0);
    world.replaceCellAt(world.idx(10, 11), Cell.Oil, 0x3a2d23);
    expect(maybeReact(makeCtx(world), 10, 10, Cell.Water)).toBe(false);
    expect(world.types[world.idx(10, 11)]).toBe(Cell.Oil);
  });
});

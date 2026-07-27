import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '@/core/types';
import { Cell, isLiquid } from '@/sim/CellType';
import { maybeReact, REACTIONS, refreshSecretReaction, SECRET_REACTION_POOL, secretIndexForSeed } from '@/sim/reactions';
import { World } from '@/sim/World';
import { mockRandom } from './helpers/randomSeam';

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
    mockRandom().mockReturnValue(0); // every roll passes
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
    mockRandom().mockReturnValue(0);
    const world = new World(32, 32);
    world.replaceCellAt(world.idx(10, 10), Cell.Lava, 0xfa1600);
    world.replaceCellAt(world.idx(10, 11), Cell.Acid, 0x28fa28);
    const reacted = maybeReact(makeCtx(world), 10, 10, Cell.Lava);
    expect(reacted).toBe(true);
    expect(world.types[world.idx(10, 10)]).toBe(Cell.Glass);
    expect(world.types[world.idx(10, 11)]).toBe(Cell.Steam);
  });

  it('the philosopher\'s dust transmutes blood to healium and is CONSUMED', () => {
    mockRandom().mockReturnValue(0);
    const world = new World(32, 32);
    world.replaceCellAt(world.idx(8, 8), Cell.Blood, 0xa00c19);
    world.replaceCellAt(world.idx(9, 8), Cell.Catalyst, 0xff963c);
    expect(maybeReact(makeCtx(world), 8, 8, Cell.Blood)).toBe(true);
    expect(world.types[world.idx(8, 8)]).toBe(Cell.Healium);
    expect(world.types[world.idx(9, 8)]).toBe(Cell.Empty); // economy guard
  });

  it('a failed roll leaves both cells untouched', () => {
    mockRandom().mockReturnValue(0.999); // every roll fails
    const world = new World(32, 32);
    world.replaceCellAt(world.idx(10, 10), Cell.Acid, 0x28fa28);
    world.replaceCellAt(world.idx(10, 11), Cell.Lava, 0xfa1600);
    expect(maybeReact(makeCtx(world), 10, 10, Cell.Acid)).toBe(false);
    expect(world.types[world.idx(10, 10)]).toBe(Cell.Acid);
    expect(world.types[world.idx(10, 11)]).toBe(Cell.Lava);
  });

  it('unlisted neighbours never react (water beside oil is just wet oil)', () => {
    mockRandom().mockReturnValue(0);
    const world = new World(32, 32);
    world.replaceCellAt(world.idx(10, 10), Cell.Water, 0x2369f0);
    world.replaceCellAt(world.idx(10, 11), Cell.Oil, 0x3a2d23);
    expect(maybeReact(makeCtx(world), 10, 10, Cell.Water)).toBe(false);
    expect(world.types[world.idx(10, 11)]).toBe(Cell.Oil);
  });
});

describe('the secret world reaction', () => {
  const FORBIDDEN_PRODUCTS = new Set<number>([Cell.Gold, Cell.Metal, Cell.Wall, Cell.Stone]);

  it('pool entries obey the rails: liquid participant, safe products, named', () => {
    for (const r of SECRET_REACTION_POOL) {
      expect(isLiquid(r.a) || isLiquid(r.b), r.name).toBe(true);
      for (const to of [r.aTo, r.bTo]) {
        if (to !== null) expect(FORBIDDEN_PRODUCTS.has(to), r.name).toBe(false);
      }
      expect(r.name.length).toBeGreaterThan(3);
    }
  });

  it('no secret is self-propagating (its products are never its own reactants)', () => {
    // the failure mode: product == reactant lets the front feed itself and a
    // whole lake converts (the Green Tide drained a rillback pool to 22 cells)
    for (const r of SECRET_REACTION_POOL) {
      for (const to of [r.aTo, r.bTo]) {
        if (to === null || to === Cell.Empty) continue;
        expect(to === r.a || to === r.b, `${r.name} feeds itself`).toBe(false);
      }
    }
  });

  it('no pool pair collides with the base table (the secret must ADD a rule)', () => {
    const base = new Set(REACTIONS.map((r) => [Math.min(r.a, r.b), Math.max(r.a, r.b)].join('+')));
    for (const r of SECRET_REACTION_POOL) {
      const key = [Math.min(r.a, r.b), Math.max(r.a, r.b)].join('+');
      expect(base.has(key), r.name).toBe(false);
    }
  });

  it('derivation is deterministic and covers the pool across seeds', () => {
    expect(secretIndexForSeed(1337)).toBe(secretIndexForSeed(1337));
    const hit = new Set<number>();
    for (let seed = 0; seed < 500; seed++) hit.add(secretIndexForSeed(seed));
    expect(hit.size).toBe(SECRET_REACTION_POOL.length); // no unreachable secret
  });

  it('the run secret fires, transforms, and announces ONCE near the wizard', () => {
    mockRandom().mockReturnValue(0);
    const world = new World(64, 64);
    const toasts: string[] = [];
    let chimes = 0;
    const ctx = {
      world,
      particles: { spawn: () => undefined },
      player: { x: 12, y: 12 },
      events: { emit: (kind: string, payload: { text?: string }) => { if (kind === 'toast' && payload.text) toasts.push(payload.text); } },
      audio: { learn: () => { chimes++; } },
      state: { worldSeed: 1337 },
    } as unknown as Ctx;
    refreshSecretReaction(ctx);
    const secret = (ctx.state as { secretReaction?: { a: number; b: number; name: string } }).secretReaction;
    expect(secret).toBeTruthy();
    expect(secret!.name).toBe(SECRET_REACTION_POOL[secretIndexForSeed(1337)].name);
    // place the pair next to the wizard and let it fire
    world.replaceCellAt(world.idx(10, 10), secret!.a as Cell, 0x777777);
    world.replaceCellAt(world.idx(10, 11), secret!.b as Cell, 0x777777);
    expect(maybeReact(ctx, 10, 10, secret!.a)).toBe(true);
    expect(toasts.some((t) => t.includes(secret!.name))).toBe(true);
    expect(chimes).toBe(1);
    // firing again does NOT re-announce
    world.replaceCellAt(world.idx(20, 20), secret!.a as Cell, 0x777777);
    world.replaceCellAt(world.idx(20, 21), secret!.b as Cell, 0x777777);
    maybeReact(ctx, 20, 20, secret!.a);
    expect(toasts.length).toBe(1);
    // a NEW seed re-arms the discovery: the next run's secret announces again
    (ctx.state as { worldSeed: number }).worldSeed = 42;
    refreshSecretReaction(ctx);
    const secret2 = (ctx.state as { secretReaction?: { a: number; b: number; name: string } })
      .secretReaction!;
    expect(secret2.name).toBe(SECRET_REACTION_POOL[secretIndexForSeed(42)].name);
    world.replaceCellAt(world.idx(14, 10), secret2.a as Cell, 0x777777);
    world.replaceCellAt(world.idx(14, 11), secret2.b as Cell, 0x777777);
    expect(maybeReact(ctx, 14, 10, secret2.a)).toBe(true);
    expect(toasts.length).toBe(2);
    expect(toasts[1]).toContain(secret2.name);
  });
});

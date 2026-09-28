import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGameParams } from '@/config/params';
import type { Ctx } from '@/core/types';
import { Rng } from '@/core/rng';
import { Cell, blocksEntity, isSoftGrowth, isSolid } from '@/sim/CellType';
import { World } from '@/sim/World';
import {
  handleLeaf,
  handleSeed,
  handleTrunk,
  igniteTrunk,
  LEAF_LITTER,
  leafAttachedLife,
  isSoakingLife,
  SEED_GLOW_HELD,
  SEED_THIRSTY_LOOSE,
  SOAK_IDLE_SPROUT,
} from '@/sim/elements/flora';
import {
  anchoredSupport,
  FELL_LEAF,
  FELL_SEED,
  FELL_WOOD,
  fitFellBody,
  floodStand,
  FloodScratch,
  liftStand,
  restampFell,
  spriteSampleAt,
} from '@/game/floraFelling';
import { FLORA_SPECIES, plantFlora, type FloraSpecies } from '@/world/floraKit';
import { mockRandom } from './helpers/randomSeam';

function ctxFor(world: World): Ctx {
  return {
    world,
    params: createGameParams(),
    particles: { list: [], spawn: vi.fn(), burst: vi.fn() },
    audio: { at: vi.fn(), sfx: vi.fn(), bubble: vi.fn(), creak: vi.fn() },
    events: { emit: vi.fn() },
  } as unknown as Ctx;
}

/** A flat floor of stone at row `floor` (the open foot row is floor - 1). */
function flatWorld(w = 120, h = 110, floor = 100): World {
  const world = new World(w, h);
  for (let y = floor; y < h; y++) for (let x = 0; x < w; x++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x555555);
  return world;
}

/** A plain trunk: `width` wide, from the foot row up `height` cells. */
function trunk(world: World, x0: number, foot: number, width: number, height: number): void {
  for (let y = foot; y > foot - height; y--) for (let x = x0; x < x0 + width; x++) {
    world.replaceCellAt(world.idx(x, y), Cell.Trunk, 0x998877);
    world.life[world.idx(x, y)] = -1;
  }
}

afterEach(() => vi.restoreAllMocks());

describe('flora cell classification', () => {
  it('lets bodies walk past living wood and foliage but never through seeds piles as walls', () => {
    expect(isSoftGrowth(Cell.Trunk)).toBe(true);
    expect(isSoftGrowth(Cell.Leaf)).toBe(true);
    expect(blocksEntity(Cell.Trunk)).toBe(false);
    expect(blocksEntity(Cell.Leaf)).toBe(false);
    expect(blocksEntity(Cell.Seed)).toBe(false);
    // Living wood never falls as cells (it fells as a body); leaves and seeds do.
    expect(isSolid(Cell.Trunk)).toBe(true);
    expect(isSolid(Cell.Leaf)).toBe(false);
    expect(isSolid(Cell.Seed)).toBe(false);
  });
});

describe('felling detection', () => {
  it('finds a standing trunk supported by the ground, and the part above a cut unsupported', () => {
    const world = flatWorld();
    trunk(world, 50, 99, 4, 40);
    const scratch = new FloodScratch();
    scratch.ensure(world.types.length);
    const whole = floodStand(world, 51, 80, scratch, scratch.next());
    expect(whole.supported).toBe(true);
    expect(whole.count).toBe(160);
    // cut two rows clean through
    for (let x = 50; x < 54; x++) { world.clearCellAt(world.idx(x, 94)); world.clearCellAt(world.idx(x, 95)); }
    const upper = floodStand(world, 51, 80, scratch, scratch.next());
    expect(upper.supported).toBe(false);
    expect(upper.count).toBe(4 * (40 - 6));
    const stump = floodStand(world, 51, 98, scratch, scratch.next());
    expect(stump.supported).toBe(true);
  });

  it('does not let a lone speck (a splinter the dig beam threw) hold a trunk up', () => {
    const world = flatWorld();
    trunk(world, 50, 70, 3, 20); // floating above the floor
    world.replaceCellAt(world.idx(49, 60), Cell.Wood, 0x806040); // a speck against the bark
    expect(anchoredSupport(world, 49, 60)).toBe(false);
    const scratch = new FloodScratch();
    scratch.ensure(world.types.length);
    expect(floodStand(world, 51, 60, scratch, scratch.next()).supported).toBe(false);
    // ...but a wall it leans on is real support
    for (let y = 50; y < 72; y++) for (let x = 45; x < 50; x++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x555555);
    expect(floodStand(world, 51, 60, scratch, scratch.next()).supported).toBe(true);
  });

  it('never lets powder heaped on or against the wood hold a cut trunk up, only powder it stands on', () => {
    const world = flatWorld();
    trunk(world, 50, 70, 3, 20); // floating above the floor (rows 51..70)
    // a heap of gold grains settled against the bark and on its top
    for (let y = 60; y < 64; y++) for (let x = 46; x < 50; x++) world.replaceCellAt(world.idx(x, y), Cell.Gold, 0xd4a020);
    for (let x = 49; x < 54; x++) for (let y = 48; y < 51; y++) world.replaceCellAt(world.idx(x, y), Cell.Gold, 0xd4a020);
    expect(anchoredSupport(world, 49, 61)).toBe(true); // the grain itself is packed...
    const scratch = new FloodScratch();
    scratch.ensure(world.types.length);
    expect(floodStand(world, 51, 60, scratch, scratch.next()).supported).toBe(false); // ...but it holds nothing up
    // a trunk standing ON a sand bed is held
    for (let x = 46; x < 56; x++) for (let y = 71; y < 74; y++) world.replaceCellAt(world.idx(x, y), Cell.Sand, 0xc0a060);
    expect(floodStand(world, 51, 60, scratch, scratch.next()).supported).toBe(true);
  });

  it('lifts a felled stand with its canopy and held pods, leaving litter behind', () => {
    const world = flatWorld();
    trunk(world, 50, 70, 3, 20);
    for (let x = 47; x <= 55; x++) for (let y = 48; y <= 50; y++) {
      const i = world.idx(x, y);
      if (world.types[i] !== Cell.Empty) continue;
      world.replaceCellAt(i, Cell.Leaf, 0x557744);
      world.life[i] = leafAttachedLife(1);
    }
    world.replaceCellAt(world.idx(47, 51), Cell.Seed, 0xccee88);
    world.life[world.idx(47, 51)] = SEED_GLOW_HELD;
    world.replaceCellAt(world.idx(60, 99), Cell.Leaf, 0x557744); // litter on the ground far away
    world.life[world.idx(60, 99)] = LEAF_LITTER;
    const scratch = new FloodScratch();
    scratch.ensure(world.types.length);
    const stand = floodStand(world, 51, 60, scratch, scratch.next());
    const sprite = liftStand(world, stand, scratch);
    expect(sprite).not.toBeNull();
    expect(sprite!.woodCount).toBe(60);
    expect(sprite!.leafCount).toBe(3 * 9);
    expect(sprite!.seedCount).toBe(1);
    for (let y = 40; y < 72; y++) for (let x = 45; x < 58; x++) {
      const t = world.types[world.idx(x, y)];
      expect(t === Cell.Trunk || t === Cell.Leaf || t === Cell.Seed).toBe(false);
    }
    expect(world.types[world.idx(60, 99)]).toBe(Cell.Leaf);
  });
});

describe('fitting the falling body', () => {
  it('fits an upright trunk as one tall box at angle ~0', () => {
    const world = flatWorld();
    trunk(world, 50, 70, 4, 40);
    const scratch = new FloodScratch();
    scratch.ensure(world.types.length);
    const sprite = liftStand(world, floodStand(world, 51, 50, scratch, scratch.next()), scratch)!;
    const fit = fitFellBody(sprite, 0.7);
    expect(Math.abs(fit.angle)).toBeLessThan(0.01);
    expect(fit.halfH).toBeGreaterThan(19);
    expect(fit.halfW).toBeLessThan(2.6);
    expect(fit.cx).toBeCloseTo(52, 0);
    expect(fit.cy).toBeCloseTo(51, 0);
  });

  it('gives a giant mushroom a stem box and a wide cap box', () => {
    const world = flatWorld();
    const plant = plantFlora(world, 'mushroom', 60, 99, new Rng(4), { height: 34 });
    expect(plant).not.toBeNull();
    // cut the stem near the foot
    for (let x = 50; x <= 70; x++) for (let y = 92; y <= 93; y++) if (world.types[world.idx(x, y)] === Cell.Trunk) world.clearCellAt(world.idx(x, y));
    const scratch = new FloodScratch();
    scratch.ensure(world.types.length);
    const stand = floodStand(world, 60, 70, scratch, scratch.next());
    expect(stand.supported).toBe(false);
    const fit = fitFellBody(liftStand(world, stand, scratch)!, 0.7);
    const widths = fit.boxes.map((b) => b.halfW).sort((a, b) => a - b);
    expect(fit.boxes.length).toBeGreaterThanOrEqual(2);
    expect(widths[widths.length - 1]).toBeGreaterThan(widths[0] * 2.5);
  });
});

describe('re-stamping the log', () => {
  it('writes a toppled trunk back as solid Wood lying on its side, in its final pose', () => {
    const world = flatWorld(160, 110, 100);
    trunk(world, 50, 90, 3, 30);
    const scratch = new FloodScratch();
    scratch.ensure(world.types.length);
    const sprite = liftStand(world, floodStand(world, 51, 80, scratch, scratch.next()), scratch)!;
    const fit = fitFellBody(sprite, 0.7);
    // lay it on the floor, top toward +x
    const pose = { x: 70, y: 98.5, a: fit.angle + Math.PI / 2 };
    const res = restampFell(world, sprite, fit.cx, fit.cy, fit.angle, pose.x, pose.y, pose.a, { rand: () => 0.9, fireColor: () => 0xff6600 });
    expect(res.wood).toBeGreaterThanOrEqual(80);
    let wood = 0, minY = 999, maxY = -1, minX = 999, maxX = -1;
    for (let y = 0; y < 100; y++) for (let x = 0; x < 160; x++) {
      const i = world.idx(x, y);
      if (world.types[i] !== Cell.Wood) continue;
      wood++;
      expect(world.colorOverrides.has(i)).toBe(true); // bark, not plank tiles
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    }
    expect(wood).toBe(res.wood);
    expect(maxY - minY).toBeLessThanOrEqual(4); // lying flat
    expect(maxX - minX).toBeGreaterThanOrEqual(28);
    expect(maxY).toBeLessThan(100); // never into the floor
  });

  it('displaces a pool upward when the log settles in it (a dam raises the water)', () => {
    const world = flatWorld(160, 110, 100);
    for (let y = 96; y < 100; y++) for (let x = 60; x < 100; x++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0x2266ff);
    let before = 0;
    for (const t of world.types) if (t === Cell.Water) before++;
    trunk(world, 20, 90, 3, 30);
    const scratch = new FloodScratch();
    scratch.ensure(world.types.length);
    const sprite = liftStand(world, floodStand(world, 21, 80, scratch, scratch.next()), scratch)!;
    const fit = fitFellBody(sprite, 0.7);
    const res = restampFell(world, sprite, fit.cx, fit.cy, fit.angle, 80, 98, fit.angle + Math.PI / 2, { rand: () => 0.9, fireColor: () => 0xff6600 });
    expect(res.displacedLiquid).toBeGreaterThan(0);
    let after = 0;
    for (const t of world.types) if (t === Cell.Water) after++;
    expect(after).toBe(before); // conserved: pushed up, not deleted
  });

  it('maps sprite pixels through the body pose (spawn pose samples itself)', () => {
    const world = flatWorld();
    trunk(world, 50, 70, 3, 20);
    const scratch = new FloodScratch();
    scratch.ensure(world.types.length);
    const sprite = liftStand(world, floodStand(world, 51, 60, scratch, scratch.next()), scratch)!;
    const fit = fitFellBody(sprite, 0.7);
    const si = spriteSampleAt(sprite, fit.cx, fit.cy, fit.angle, fit.cx, fit.cy, fit.angle, 51.5, 60.5);
    expect(sprite.kind[si]).toBe(FELL_WOOD);
    expect([FELL_WOOD, FELL_LEAF, FELL_SEED]).toContain(sprite.kind[si]);
  });
});

describe('leaf, trunk and seed rules', () => {
  it('holds a leaf beside wood and lets a stranded one go, then rests it as litter or a floating pad', () => {
    const world = flatWorld(40, 40, 30);
    const ctx = ctxFor(world);
    world.replaceCellAt(world.idx(10, 10), Cell.Trunk, 0x998877);
    world.replaceCellAt(world.idx(11, 10), Cell.Leaf, 0x557744);
    handleLeaf(ctx, 11, 10);
    expect(world.life[world.idx(11, 10)]).toBe(leafAttachedLife(0));
    world.replaceCellAt(world.idx(20, 5), Cell.Leaf, 0x557744);
    mockRandom().mockReturnValue(0.1);
    handleLeaf(ctx, 20, 5);
    expect(world.life[world.idx(20, 5)]).toBeGreaterThan(0);
    // a loose leaf over a pool floats on it
    world.replaceCellAt(world.idx(30, 29), Cell.Water, 0x2266ff);
    world.replaceCellAt(world.idx(30, 28), Cell.Leaf, 0x557744);
    world.life[world.idx(30, 28)] = 3;
    handleLeaf(ctx, 30, 28);
    expect(world.life[world.idx(30, 28)]).toBe(LEAF_LITTER);
  });

  it('smoulders living wood in place, chars it through, and lets water put it out', () => {
    const world = flatWorld(20, 20, 18);
    const ctx = ctxFor(world);
    world.replaceCellAt(world.idx(5, 10), Cell.Trunk, 0x998877);
    world.life[world.idx(5, 10)] = -1;
    igniteTrunk(ctx, world.idx(5, 10));
    expect(world.life[world.idx(5, 10)]).toBeGreaterThan(200);
    world.life[world.idx(5, 10)] = 1;
    mockRandom().mockReturnValue(0.3);
    handleTrunk(ctx, 5, 10);
    expect(world.types[world.idx(5, 10)]).not.toBe(Cell.Trunk);
    world.replaceCellAt(world.idx(8, 10), Cell.Trunk, 0x998877);
    world.life[world.idx(8, 10)] = 50;
    world.replaceCellAt(world.idx(9, 10), Cell.Water, 0x2266ff);
    handleTrunk(ctx, 8, 10);
    expect(world.life[world.idx(8, 10)]).toBe(-1);
  });

  it('soaks a pour, then sprouts a thirsty seed into a real stalk with Wood rungs', () => {
    const world = flatWorld(60, 140, 130);
    const ctx = ctxFor(world);
    const sx = 30, sy = 129;
    world.replaceCellAt(world.idx(sx, sy), Cell.Seed, 0xb08040);
    world.life[world.idx(sx, sy)] = SEED_THIRSTY_LOOSE;
    // a pour: water keeps arriving on the seed for 30 substeps
    for (let n = 0; n < 30; n++) {
      world.replaceCellAt(world.idx(sx, sy - 1), Cell.Water, 0x2266ff);
      handleSeed(ctx, sx, sy);
    }
    expect(isSoakingLife(world.life[world.idx(sx, sy)])).toBe(true);
    // a little puddle beside it, drunk whole when it sprouts
    for (let x = 22; x < 29; x++) world.replaceCellAt(world.idx(x, sy), Cell.Water, 0x2266ff);
    // the pour stops: after the idle window it sprouts
    for (let n = 0; n < SOAK_IDLE_SPROUT + 2 && world.life[world.idx(sx, sy)] <= 0; n++) handleSeed(ctx, sx, sy);
    const energy = world.life[world.idx(sx, sy)];
    expect(energy).toBeGreaterThan(60);
    let water = 0;
    for (const t of world.types) if (t === Cell.Water) water++;
    expect(water).toBeLessThanOrEqual(1); // it drank the pour and the puddle
    mockRandom().mockReturnValue(0.5);
    for (let n = 0; n < 400; n++) {
      let tip = -1;
      for (let i = 0; i < world.types.length; i++) if (world.types[i] === Cell.Seed && world.life[i] > 0) { tip = i; break; }
      if (tip < 0) break;
      world.movedTick++;
      handleSeed(ctx, tip % world.width, Math.floor(tip / world.width));
    }
    let stalk = 0, rungs = 0;
    for (let i = 0; i < world.types.length; i++) {
      if (world.types[i] === Cell.Trunk) stalk++;
      if (world.types[i] === Cell.Wood) rungs++;
    }
    expect(stalk).toBeGreaterThan(energy);
    expect(rungs).toBeGreaterThanOrEqual(24);
  });

  it('lets a seed that only caught a drip dry out instead of sprouting a stub', () => {
    const world = flatWorld(40, 60, 50);
    const ctx = ctxFor(world);
    world.replaceCellAt(world.idx(20, 49), Cell.Seed, 0xb08040);
    world.life[world.idx(20, 49)] = SEED_THIRSTY_LOOSE;
    world.replaceCellAt(world.idx(20, 48), Cell.Water, 0x2266ff);
    for (let n = 0; n < SOAK_IDLE_SPROUT + 4; n++) handleSeed(ctx, 20, 49);
    expect(world.life[world.idx(20, 49)]).toBe(SEED_THIRSTY_LOOSE);
    expect(world.types[world.idx(20, 49)]).toBe(Cell.Seed);
  });
});

describe('the flora kit', () => {
  const standing: FloraSpecies[] = ['birch', 'treefern', 'sapling', 'mushroom', 'emberbark', 'mangrove', 'snowbirch', 'glasswillow'];
  it.each(standing)('grows a %s as one supported stand of real cells', (species) => {
    const world = flatWorld(200, 160, 150);
    const plant = plantFlora(world, species, 100, 149, new Rng(12345));
    expect(plant).not.toBeNull();
    expect(plant!.trunk).toBeGreaterThan(10);
    const scratch = new FloodScratch();
    scratch.ensure(world.types.length);
    const epoch = scratch.next();
    let stands = 0;
    for (let i = 0; i < world.types.length; i++) {
      if (world.types[i] !== Cell.Trunk || scratch.visit[i] === epoch) continue;
      const stand = floodStand(world, i % world.width, Math.floor(i / world.width), scratch, epoch);
      stands++;
      expect(stand.supported).toBe(true);
    }
    expect(stands).toBe(1);
    // every leaf starts held on
    for (let i = 0; i < world.types.length; i++) {
      if (world.types[i] !== Cell.Leaf) continue;
      expect(world.life[i]).toBeLessThan(0);
    }
  });

  it('knows every species', () => {
    // 14 from wave 2; the Cold Store's and the Glass Galleries' six (wave 3).
    expect(FLORA_SPECIES.length).toBe(20);
  });

  it.each(['frostfern', 'icelily', 'glassreed', 'prismflower'] as FloraSpecies[])('grows a %s from real cells', (species) => {
    const world = flatWorld(120, 100, 90);
    // Floaters sit on the water line: give them a pond.
    if (species === 'icelily') for (let x = 40; x < 80; x++) for (let y = 86; y < 90; y++) world.replaceCellAt(world.idx(x, y), Cell.Brine, 0x68acb8);
    const plant = plantFlora(world, species, 50, species === 'icelily' ? 85 : 89, new Rng(777));
    expect(plant).not.toBeNull();
    let cells = 0;
    for (let i = 0; i < world.types.length; i++) if (world.types[i] === Cell.Leaf || world.types[i] === Cell.Trunk) cells++;
    expect(cells).toBeGreaterThanOrEqual(4);
  });
});

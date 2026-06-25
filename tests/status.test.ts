import { describe, expect, it, vi } from 'vitest';

import { createGameParams } from '@/config/params';
import type { Ctx } from '@/core/types';
import { createDefaultStatus, sampleAndTickStatus } from '@/entities/status';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

/** A ctx with a real World + spies for the side-effect sinks the status tick touches. */
function ctxWith(world: World) {
  const zap = vi.fn();
  const spark = vi.fn();
  const ctx = {
    world,
    params: createGameParams(),
    particles: { spawn: () => {} },
    audio: { zap },
    lightning: { spark },
    state: { frameCount: 0 },
  } as unknown as Ctx;
  return { ctx, zap, spark };
}

/** Fill the cells a body at (cx,cy) samples (cx±halfW, cy-0..h) with `cell` + charge. */
function fillBody(world: World, cell: number, cx: number, cy: number, halfW: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = -halfW; dx <= halfW; dx++) {
      const i = world.idx(cx + dx, cy - dy);
      world.types[i] = cell;
      world.setChargeAt(i, 8);
    }
  }
}

describe('electrified shock', () => {
  it('shocks a body standing in a charged conductor: damage, stutter-slow, zap + per-body arc', () => {
    const world = new World(24, 24);
    fillBody(world, Cell.Water, 12, 14, 3, 8);
    const { ctx, zap, spark } = ctxWith(world);
    const body = { x: 12, y: 14, status: createDefaultStatus() };

    const eff = sampleAndTickStatus(ctx, body, 3, 8);

    expect(body.status.electrified).toBeGreaterThan(0);
    expect(body.status.wet).toBeGreaterThan(0);
    expect(eff.damage).toBeGreaterThan(0);
    expect(eff.slowFactor).toBeLessThan(1); // electrified bodies stutter
    expect(zap).toHaveBeenCalledTimes(1); // rising-edge crack, once
    expect(spark).toHaveBeenCalled(); // lightning crawls the body
  });

  it('wet bodies take more shock than dry ones (the combo)', () => {
    // Dry-but-charged: a charged metal conductor with no water → electrified, not wet.
    const dryWorld = new World(24, 24);
    fillBody(dryWorld, Cell.Metal, 12, 14, 3, 8);
    const dry = sampleAndTickStatus(ctxWith(dryWorld).ctx, { x: 12, y: 14, status: createDefaultStatus() }, 3, 8);

    const wetWorld = new World(24, 24);
    fillBody(wetWorld, Cell.Water, 12, 14, 3, 8);
    const wet = sampleAndTickStatus(ctxWith(wetWorld).ctx, { x: 12, y: 14, status: createDefaultStatus() }, 3, 8);

    expect(dry.damage).toBeGreaterThan(0);
    expect(wet.damage).toBeGreaterThan(dry.damage);
  });

  it('shocks a body wading through charged blood', () => {
    const world = new World(24, 24);
    fillBody(world, Cell.Blood, 12, 14, 3, 8);
    const { ctx, zap, spark } = ctxWith(world);
    const body = { x: 12, y: 14, status: createDefaultStatus() };

    const eff = sampleAndTickStatus(ctx, body, 3, 8);

    expect(body.status.electrified).toBeGreaterThan(0);
    expect(body.status.wet).toBe(0);
    expect(eff.damage).toBeGreaterThan(0);
    expect(zap).toHaveBeenCalledTimes(1);
    expect(spark).toHaveBeenCalled();
  });

  it('shocks a body standing ON a charged conductor (charge underfoot, dry)', () => {
    const world = new World(24, 24);
    // a charged metal floor right under the feet — nothing in the body box
    for (let dx = -3; dx <= 3; dx++) {
      const i = world.idx(12 + dx, 15);
      world.types[i] = Cell.Metal;
      world.setChargeAt(i, 8);
    }
    const { ctx } = ctxWith(world);
    const body = { x: 12, y: 14, status: createDefaultStatus() }; // feet at y=14, floor at y=15

    const eff = sampleAndTickStatus(ctx, body, 3, 8);

    expect(body.status.electrified).toBeGreaterThan(0);
    expect(body.status.wet).toBe(0); // no water touching the body
    expect(eff.damage).toBeGreaterThan(0);
  });

  it('does not shock a body immune to electrification', () => {
    const world = new World(24, 24);
    fillBody(world, Cell.Water, 12, 14, 3, 8);
    const { ctx, zap } = ctxWith(world);
    const body = { x: 12, y: 14, status: createDefaultStatus() };

    const eff = sampleAndTickStatus(ctx, body, 3, 8, { electrified: true });

    expect(body.status.electrified).toBe(0);
    expect(zap).not.toHaveBeenCalled();
    // wet still applies (immunity is only to the charge), but no shock damage
    expect(eff.damage).toBe(0);
  });
});

describe('catch fire (percentage-based)', () => {
  function fillBox(world: World, cell: number, cx: number, cy: number, halfW: number, h: number): void {
    for (let dy = 0; dy < h; dy++) for (let dx = -halfW; dx <= halfW; dx++) world.types[world.idx(cx + dx, cy - dy)] = cell;
  }
  function plainCtx(world: World): Ctx {
    return {
      world,
      params: createGameParams(),
      particles: { spawn: () => {} },
      audio: { zap: () => {} },
      lightning: { spark: () => {} },
      state: { frameCount: 0 },
    } as unknown as Ctx;
  }

  it('ignites a body engulfed in fire (hot enough → certain)', () => {
    const world = new World(40, 40);
    fillBox(world, Cell.Fire, 20, 30, 4, 17);
    const body = { x: 20, y: 30, status: createDefaultStatus() };
    sampleAndTickStatus(plainCtx(world), body, 4, 17, undefined, 2);
    expect(body.status.burning).toBeGreaterThan(0);
  });

  it('ignites a body engulfed in lava (a furnace — even more heat)', () => {
    const world = new World(40, 40);
    fillBox(world, Cell.Lava, 20, 30, 4, 17);
    const body = { x: 20, y: 30, status: createDefaultStatus() };
    sampleAndTickStatus(plainCtx(world), body, 4, 17, undefined, 2);
    expect(body.status.burning).toBeGreaterThan(0);
  });

  it('never ignites a fire-immune body (imp / flameward)', () => {
    const world = new World(40, 40);
    fillBox(world, Cell.Lava, 20, 30, 4, 17);
    const body = { x: 20, y: 30, status: createDefaultStatus() };
    sampleAndTickStatus(plainCtx(world), body, 4, 17, { burning: true }, 2);
    expect(body.status.burning).toBe(0);
  });

  it('a light lick is a sub-certain roll, decided by the percentage', () => {
    const world = new World(40, 40);
    world.types[world.idx(20, 30)] = Cell.Fire; // a single fire cell at the body
    const lucky = { x: 20, y: 30, status: createDefaultStatus() };
    const unlucky = { x: 20, y: 30, status: createDefaultStatus() };
    const r = vi.spyOn(Math, 'random');
    try {
      r.mockReturnValue(0); // rolls under the small chance → catches
      sampleAndTickStatus(plainCtx(world), lucky, 4, 17, undefined, 2);
      r.mockReturnValue(0.999); // rolls over the chance → does not catch
      sampleAndTickStatus(plainCtx(world), unlucky, 4, 17, undefined, 2);
    } finally {
      r.mockRestore();
    }
    expect(lucky.status.burning).toBeGreaterThan(0);
    expect(unlucky.status.burning).toBe(0);
  });

  it('a wet body sheds a readable drip tell on its cadence frame', () => {
    const world = new World(40, 40);
    const spawn = vi.fn();
    const ctx = {
      world,
      params: createGameParams(),
      particles: { spawn },
      audio: { zap: () => {}, sizzle: () => {} },
      lightning: { spark: () => {} },
      state: { frameCount: 0 }, // frame % 9 === 0 → the wet tell beat runs
    } as unknown as Ctx;
    const body = { x: 20, y: 30, status: createDefaultStatus() };
    body.status.wet = 120; // soaked, no water cells around (just the lingering timer)

    const r = vi.spyOn(Math, 'random').mockReturnValue(0); // force the sparse drip
    try {
      sampleAndTickStatus(ctx, body, 4, 17, undefined, 1);
    } finally {
      r.mockRestore();
    }

    expect(spawn).toHaveBeenCalled();
  });

  it('a burning body crackles (audio sizzle) and sheds fire each visual frame', () => {
    const world = new World(40, 40);
    const sizzle = vi.fn();
    const spawn = vi.fn();
    const ctx = {
      world,
      params: createGameParams(),
      particles: { spawn },
      audio: { zap: () => {}, sizzle },
      lightning: { spark: () => {} },
      state: { frameCount: 0 }, // frame % 4 === 0 → the burning visual/audio beat runs
    } as unknown as Ctx;
    const body = { x: 20, y: 30, status: createDefaultStatus() };
    body.status.burning = 90; // already alight (no fire cells needed)

    sampleAndTickStatus(ctx, body, 4, 17, undefined, 1);

    expect(sizzle).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalled();
  });
});

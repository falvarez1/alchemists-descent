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

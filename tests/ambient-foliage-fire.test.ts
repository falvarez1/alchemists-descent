import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '@/core/types';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { GLOBAL_PARAMS, MATERIAL_PARAMS } from '@/config/params';
import { handleFire, handleEmber } from '@/sim/elements/thermal';
import { setRandomOverrideForTests } from '@/core/simRandom';
import { foliageBurnState } from '@/config/foliage';

function patch() {
  const world = new World(64, 64);
  const ctx = { world, params: { global: structuredClone(GLOBAL_PARAMS), materials: structuredClone(MATERIAL_PARAMS) }, particles: { list: [], spawn: vi.fn() } } as unknown as Ctx;
  world.replaceCellAt(world.idx(30, 30), Cell.Fire, 0);
  world.life[world.idx(30, 30)] = 20;
  world.replaceCellAt(world.idx(31, 30), Cell.Moss, 0);
  world.life[world.idx(31, 30)] = -2;
  setRandomOverrideForTests(() => 0);
  return { ctx, world, moss: world.idx(31, 30), flame: world.idx(30, 30) };
}

describe('Damp ambient foliage fuel', () => {
  it('retains quenched moss charring when a nearby grid flame reignites it', () => {
    const { ctx, world, moss } = patch();
    world.life[moss] = -10 - 65;
    handleFire(ctx, 30, 30);
    expect(foliageBurnState(world.life[moss])).toEqual({ age: 65, fuel: 5, burning: true });
  });

  it('starts a finite smoulder in added moss rather than creating a long-lived flame', () => {
    const { ctx, world, moss } = patch();
    handleFire(ctx, 30, 30);
    expect(world.types[moss]).toBe(Cell.Moss);
    expect(world.life[moss]).toBeLessThan(-99);
  });

  it('does not let the last two ticks of a small flame renew the moss fire budget', () => {
    const { ctx, world, moss, flame } = patch(); world.life[flame] = 3;
    handleFire(ctx, 30, 30);
    expect(world.types[moss]).toBe(Cell.Moss);
    expect(world.life[moss]).toBe(-2);
  });

  it('keeps ordinary puzzle moss on its existing ignition behavior', () => {
    const { ctx, world, moss } = patch(); world.life[moss] = -1;
    handleFire(ctx, 30, 30);
    expect(world.types[moss]).toBe(Cell.Fire);
    expect(world.life[moss]).toBe(26);
  });

  it('keeps ember ignition of added vines brief while ordinary vines retain their fuel', () => {
    const { ctx, world, moss, flame } = patch();
    world.replaceCellAt(flame, Cell.Ember, 0);
    world.replaceCellAt(moss, Cell.Vines, 0); world.life[moss] = -2;
    handleEmber(ctx, 30, 30);
    expect(world.types[moss]).toBe(Cell.Fire);
    expect(world.life[moss]).toBeLessThanOrEqual(5);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { gustHabitat, habitatBend, habitatPlant, updateHabitatMotion } from '@/game/HabitatMotion';
import type { Ctx } from '@/core/types';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { restoreLiving } from '@/game/persistence/ecology';
import { foliageHeatNearby } from '@/game/FoliageHeat';

function garden() {
  const world = new World(500, 400), spawn = vi.fn();
  world.replaceCellAt(world.idx(226, 315), Cell.Moss, 0);
  world.replaceCellAt(world.idx(226, 316), Cell.Wood, 0);
  const ctx = { world, levels: { current: { living: {} } }, state: { frameCount: 0 }, enemies: [], projectiles: [], particles: { list: [], spawn },
    player: { x: 400, y: 314, vx: 0 } } as unknown as Ctx;
  const tick = (count: number) => { for (let i = 0; i < count; i++) { ctx.state.frameCount++; updateHabitatMotion(ctx); } };
  tick(1);
  return { ctx, world, tick, spawn, plant: () => habitatPlant(world, 2)! };
}

describe('Frond contact response', () => {
  it('invalidates a cold-region cache on material edits and bulk world replacement', () => {
    const { ctx, world } = garden(); world.activity.beginStep(world);
    expect(foliageHeatNearby(ctx, 226, 303, 24)).toBe(false);
    world.replaceCellAt(world.idx(226, 302), Cell.Ember, 0);
    expect(foliageHeatNearby(ctx, 226, 303, 24)).toBe(true);
    world.clearCell(226, 302);
    expect(foliageHeatNearby(ctx, 226, 303, 24)).toBe(false);
    world.types[world.idx(226, 302)] = Cell.Fire; world.activity.invalidateAll();
    expect(foliageHeatNearby(ctx, 226, 303, 24)).toBe(true);
  });
  it('keeps oil as a heat candidate when it ignites through its fuel countdown', () => {
    const { ctx, world, tick, plant } = garden(); world.replaceCellAt(world.idx(226, 302), Cell.Oil, 0);
    world.activity.beginStep(world); tick(1); expect(plant().burning).toBe(false);
    world.life[world.idx(226, 302)] = 90; tick(1); expect(plant().burning).toBe(true);
    expect(foliageHeatNearby(ctx, 226, 303, 24)).toBe(true);
  });
  it('crosses the root continuously, retains momentum, and recovers after the player leaves', () => {
    const world = new World(500, 400); world.replaceCellAt(world.idx(226, 315), Cell.Moss, 0);
    world.replaceCellAt(world.idx(226, 316), Cell.Stone, 0);
    const ctx = { world, levels: { current: { living: {} } }, state: { frameCount: 0 }, enemies: [],
      player: { x: 220, y: 314, vx: 0 } } as unknown as Ctx;
    const tick = (count: number) => { for (let i = 0; i < count; i++) { ctx.state.frameCount++; updateHabitatMotion(ctx); } };
    tick(50); const left = habitatBend(world, 2);
    ctx.player.x = 232; tick(1); const firstRight = habitatBend(world, 2);
    expect(left).toBeGreaterThan(.03);
    expect(firstRight).toBeGreaterThan(0); // no one-frame flip when crossing the root
    expect(Math.abs(left - firstRight)).toBeLessThan(.04);
    tick(50); expect(habitatBend(world, 2)).toBeLessThan(-.03);
    ctx.player.x = 400; tick(120); expect(Math.abs(habitatBend(world, 2))).toBeLessThan(.06);
  });
  it('takes a directional kick impulse, bends with momentum and recovers', () => {
    const { ctx, tick, plant, spawn } = garden();
    const before = plant().angle;
    gustHabitat(ctx, x => x > 220 && x < 240 ? .7 : 0, 1, 0);
    expect(plant().angle).toBe(before);
    tick(5); expect(plant().angle).toBeGreaterThan(.35);
    expect(spawn).toHaveBeenCalledTimes(3);
    tick(100); expect(Math.abs(plant().angle)).toBeLessThan(.06);
  });
  it.each([Cell.Fire, Cell.Ember, Cell.Lava])('ignites on material %s touching the visible crown above its root', type => {
    const { world, tick, plant } = garden();
    world.replaceCellAt(world.idx(226, 302), type, 0);
    tick(1); expect(plant().burning).toBe(true); expect(plant().burn).toBeGreaterThan(0);
    expect(plant().detached).toBe(false);
  });
  it.each([Cell.Fire, Cell.Ember])('catches a fast flying %s crossing the leaf between ticks', type => {
    const { ctx, tick, plant } = garden();
    (ctx.particles.list as unknown[]).push({ x: 208, y: 302, vx: 35, vy: 0, type });
    tick(1); expect(plant().burning).toBe(true);
  });
  it('does not ignite for heat in empty space beside the crown or cosmetic glowing motes', () => {
    const { ctx, world, tick, plant } = garden();
    world.replaceCellAt(world.idx(247, 294), Cell.Fire, 0);
    (ctx.particles.list as unknown[]).push({ x: 225, y: 302, vx: 0, vy: 0, type: null, glow: 2 });
    tick(10); expect(plant().burning).toBe(false);
  });
  it('keeps a burning crown falling after its supporting plank disappears, then leaves ash', () => {
    const { world, tick, plant, spawn } = garden();
    world.replaceCellAt(world.idx(226, 316), Cell.Fire, 0);
    tick(1); expect(plant()).toMatchObject({ burning: true, detached: true, spent: false });
    tick(20); expect(plant().y).toBeGreaterThan(330); expect(plant().burn).toBeGreaterThan(.09);
    expect(plant().spent).toBe(false);
    tick(200); expect(plant().spent).toBe(true);
    expect(spawn.mock.calls.some(call => call[4] === Cell.Ash && call[7]?.deposit)).toBe(true);
  });
  it('water extinguishes the leaves and saves preserve scorching without resurrecting consumed plants', () => {
    const { ctx, world, tick, plant } = garden();
    world.replaceCellAt(world.idx(226, 302), Cell.Fire, 0); tick(35);
    world.replaceCellAt(world.idx(226, 302), Cell.Water, 0); tick(1);
    expect(plant().burning).toBe(false); const damage = plant().burn;
    ctx.levels.current!.living = restoreLiving(JSON.parse(JSON.stringify(ctx.levels.current!.living)));
    tick(1); expect(plant().burn).toBe(damage); expect(plant().burning).toBe(false);
    const saved = ctx.levels.current!.living!; saved.plants![2]!.spent = true;
    ctx.levels.current!.living = restoreLiving(JSON.parse(JSON.stringify(saved)));
    tick(10); expect(plant().spent).toBe(true);
  });
});

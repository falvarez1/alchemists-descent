import { describe, expect, it } from 'vitest';
import type { Ctx } from '@/core/types';
import { createGameParams } from '@/config/params';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { Simulation } from '@/sim/Simulation';
import { carryRillback } from '@/creatures/ecology';
import { createChain, tickChain } from '@/creatures/body';

function basin() {
  const world = new World(160, 100);
  for (let x = 0; x < 160; x++) world.replaceCellAt(world.idx(x, 90), Cell.Metal, 0);
  for (let y = 0; y < 90; y++) for (const x of [0, 71, 159]) world.replaceCellAt(world.idx(x, y), Cell.Metal, 0);
  for (let y = 20; y < 90; y++) for (let x = 1; x < 71; x++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0);
  const ctx = { world, state: { mode: 'play', score: 0, frameCount: 0, worldSeed: 777, currentBiome: 'earthen' },
    input: { mouse: { x: 0, y: 0 } }, params: createGameParams(), events: { emit: () => undefined },
    projectileCtl: { update: () => undefined }, shockwaves: [], particles: { list: [], spawn: () => undefined, burst: () => undefined },
    player: { x: 4, y: 4, dead: false, perks: {}, status: {} },
  } as unknown as Ctx;
  const sim = new Simulation(), tick = (count: number) => { for (let i = 0; i < count; i++) { ctx.state.frameCount++; sim.processFrame(ctx); } };
  const mass = (left = 0, right = world.width) => {
    let count = 0;
    for (let y = 0; y < world.height; y++) for (let x = left; x < right; x++) if (world.type(x, y) === Cell.Water || world.type(x, y) === Cell.Blood) count++;
    return count;
  };
  const open = () => { for (let y = 60; y < 82; y++) world.clearCell(71, y); };
  return { ctx, world, tick, mass, open };
}

describe('Hydraulic material transport', () => {
  it('carries water sideways off a ledge and accelerates its fall without adding mass or dropping metadata', () => {
    const world = new World(100, 100);
    world.replaceCellAt(world.idx(30, 10), Cell.Water, 0x335566);
    world.life[world.idx(30, 10)] = 17; world.setChargeAt(world.idx(30, 10), 9);
    world.flow.beginStep(world); world.flow.move(world, 30, 10, 31, 10);
    const heights = [];
    for (let tick = 0; tick < 12; tick++) {
      world.flow.beginStep(world);
      const index = world.types.indexOf(Cell.Water), x = index % world.width, y = Math.floor(index / world.width);
      expect(world.flow.fall(world, x, y)).toBe(true); heights.push(y);
    }
    const index = world.types.indexOf(Cell.Water);
    expect(index % world.width).toBeGreaterThan(38);
    expect(heights[11] - heights[9]).toBeGreaterThan(heights[3] - heights[1]);
    expect(world.types.filter(t => t === Cell.Water)).toHaveLength(1);
    expect(world.colors[index]).toBe(0x335566); expect(world.life[index]).toBe(17); expect(world.charge[index]).toBe(9);
    world.replaceCellAt(index, Cell.Ice, 0); expect(world.flow.falling.size).toBe(0);
  });

  it('sweeps fast water against a one-cell floor and clears flight history when the world changes', () => {
    const world = new World(80, 80);
    for (let x = 0; x < 80; x++) world.replaceCellAt(world.idx(x, 55), Cell.Metal, 0);
    world.replaceCellAt(world.idx(20, 5), Cell.Water, 0);
    for (let tick = 0; tick < 60; tick++) {
      world.flow.beginStep(world);
      const index = world.types.indexOf(Cell.Water);
      world.flow.fall(world, index % world.width, Math.floor(index / world.width));
    }
    expect(world.types.indexOf(Cell.Water)).toBe(world.idx(20, 54));
    expect(world.flow.falling.size).toBe(0);
    world.clearCell(20, 54); world.replaceCellAt(world.idx(20, 5), Cell.Water, 0);
    world.flow.fall(world, 20, 5); expect(world.flow.falling.size).toBe(1);
    world.activity.invalidateAll(); world.flow.beginStep(world); expect(world.flow.falling.size).toBe(0);
  });

  it('holds a sealed basin, then drains through a low outlet without losing water or leaking through its divider', () => {
    const { world, tick, mass, open } = basin(), initial = mass();
    tick(30); expect(mass(72)).toBe(0); expect(mass()).toBe(initial);
    open(); tick(360);
    expect(mass()).toBe(initial);
    expect(mass(72)).toBeGreaterThan(initial * .35);
    for (let y = 0; y < 60; y++) expect(world.type(71, y)).toBe(Cell.Metal);
    for (let y = 82; y < 90; y++) expect(world.type(71, y)).toBe(Cell.Metal);
  });

  it('transports submerged blood instead of locking it in space, conserving the combined liquid', () => {
    const { world, tick, mass, open } = basin();
    for (let x = 45; x < 50; x++) world.replaceCellAt(world.idx(x, 50), Cell.Blood, 0x8a1b28);
    const initial = mass(); open(); tick(180);
    expect(mass()).toBe(initial);
    const original = [45, 46, 47, 48, 49].filter(x => world.type(x, 50) === Cell.Blood);
    expect(original.length).toBeLessThan(2);
  });

  it('shares the actual discharge current with an immersed Rillback', () => {
    const { ctx, world, open, tick } = basin(); open(); tick(14);
    let bestX = 0, bestY = 0, speed = 0;
    for (let y = 60; y < 82; y++) for (let x = 40; x < 70; x++) {
      if (world.type(x, y) === Cell.Water && world.flow.x(x, y) > speed) { bestX = x; bestY = y; speed = world.flow.x(x, y); }
    }
    expect(speed).toBeGreaterThan(.1);
    const enemy = { x: bestX, y: bestY + 4, fx: 0, fy: 0, vx: 0, vy: 0, rillWet: 1, kind: 'rillback' } as Ctx['enemies'][number];
    carryRillback(ctx, enemy);
    expect(enemy.vx).toBeGreaterThan(0);
  });

  it('lets an exposed tail fall while submerged segments keep swimming', () => {
    const world = new World(100, 100);
    for (let y = 50; y < 99; y++) for (let x = 1; x < 99; x++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0);
    const body = createChain(65, 53, 1, 9, 4);
    for (let i = 1; i < body.nodes.length; i++) { body.nodes[i].y = 53 - i * 2; body.nodes[i].previousY = body.nodes[i].y; }
    const originalTail = body.nodes.at(-1)!.y;
    for (let tick = 0; tick < 90; tick++) tickChain(world, body, 65, 53, true, tick, true);
    expect(body.nodes.at(-1)!.y).toBeGreaterThan(originalTail + 10);
    expect(body.nodes.some(n => n.y > 50)).toBe(true);
  });
});

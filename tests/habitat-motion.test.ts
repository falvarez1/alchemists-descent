import { describe, expect, it } from 'vitest';
import { habitatBend, updateHabitatMotion } from '@/game/HabitatMotion';
import type { Ctx } from '@/core/types';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';

describe('Frond contact response', () => {
  it('crosses the root continuously, retains momentum, and recovers after the player leaves', () => {
    const world = new World(500, 400); world.replaceCellAt(world.idx(226, 315), Cell.Moss, 0);
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
});

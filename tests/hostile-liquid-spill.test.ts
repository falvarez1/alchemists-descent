import { describe, expect, it, vi } from 'vitest';

import type { Ctx } from '@/core/types';
import { Particles } from '@/particles/Particles';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

/**
 * THE SUMP HOLDS ITS WATER (fix3): the Leviathan's volleys and tail-slams are
 * torn out of its own pool. A throw that hit the alchemist used to vanish on
 * contact — every hit deleted the water it was made of — so a long fight bled
 * the pool dry. The drop now splashes off him and lands.
 */
describe('a thrown liquid that strikes the player', () => {
  function strike(type: Cell | null): { world: World; damage: ReturnType<typeof vi.fn>; particles: Particles } {
    const world = new World(40, 40);
    const damage = vi.fn();
    const ctx = {
      world,
      player: { x: 20, y: 20, dead: false },
      playerCtl: { damage },
      state: { mode: 'play' },
      enemyCtl: { splashHazard: () => false },
    } as unknown as Ctx;
    const particles = new Particles();
    // one step short of the player's feet, flying straight at them
    particles.spawn(17, 17, 1, 0, type, 0x2080ff, 60, { grav: 0, hostileDmg: 4, hostileSource: 'leviathan-water' });
    particles.update(ctx);
    return { world, damage, particles };
  }

  it('hurts him and lands as a real cell beside him', () => {
    const { world, damage, particles } = strike(Cell.Water);
    expect(damage).toHaveBeenCalledOnce();
    expect(particles.list).toHaveLength(0);
    let water = 0;
    for (let i = 0; i < world.types.length; i++) if (world.types[i] === Cell.Water) water++;
    expect(water).toBe(1);
  });

  it('leaves a thrown rock to vanish as before (only liquids splash back)', () => {
    const { world, damage } = strike(Cell.Stone);
    expect(damage).toHaveBeenCalledOnce();
    let stone = 0;
    for (let i = 0; i < world.types.length; i++) if (world.types[i] === Cell.Stone) stone++;
    expect(stone).toBe(0);
  });
});

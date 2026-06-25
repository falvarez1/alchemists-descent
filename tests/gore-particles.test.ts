import { describe, expect, it } from 'vitest';

import type { Ctx } from '@/core/types';
import { playerLiquidSplashDropletCount } from '@/entities/Player';
import { Particles } from '@/particles/Particles';
import { Cell } from '@/sim/CellType';
import { canDryBloodOnSurface } from '@/sim/stains';
import { World } from '@/sim/World';

function makeCtx(world: World): Ctx {
  return {
    world,
    player: { x: 0, y: 0, dead: false },
    state: { mode: 'play', score: 0 },
    events: { emit: () => undefined },
    audio: {
      coin: () => undefined,
      splash: () => undefined,
    },
    playerCtl: { damage: () => undefined },
  } as unknown as Ctx;
}

function set(world: World, x: number, y: number, type: Cell, color = 0x777777): void {
  world.replaceCellAt(world.idx(x, y), type, color);
}

describe('loot cascade', () => {
  it('rings coins UP the scale on a fast streak, resetting after a gap', () => {
    const streaks: number[] = [];
    const world = new World(16, 16);
    const ctx = {
      world,
      player: { x: 8, y: 8, dead: false },
      state: { mode: 'play', score: 0, frameCount: 0 },
      events: { emit: () => undefined },
      audio: { coin: (s = 0) => streaks.push(s) },
    } as unknown as Ctx;
    const particles = new Particles();
    const grabCoin = () => {
      particles.spawn(8, 5, 0, 0, null, 0xffe078, 30, { homing: true, value: 10 });
      particles.update(ctx);
    };

    grabCoin(); // first coin → streak 1
    ctx.state.frameCount = 6;
    grabCoin(); // within the gap → streak 2
    ctx.state.frameCount = 40;
    grabCoin(); // after the gap → resets to 1

    expect(streaks).toEqual([1, 2, 1]);
    expect(ctx.state.score).toBe(30);
  });
});

describe('gore particle deposition', () => {
  it('does not create blood cells when a blood particle expires in open air', () => {
    const world = new World(32, 32);
    const particles = new Particles();

    particles.spawn(10, 10, 0, 0, Cell.Blood, 0xb4232a, 1, { grav: 0 });
    particles.update(makeCtx(world));

    expect(particles.list).toHaveLength(0);
    expect(world.types[world.idx(10, 10)]).toBe(Cell.Empty);
  });

  it('still converts blood particles to liquid cells when they strike terrain', () => {
    const world = new World(32, 32);
    const particles = new Particles();
    set(world, 10, 11, Cell.Stone);

    particles.spawn(10, 8, 0, 1, Cell.Blood, 0xb4232a, 20, { grav: 0.16 });
    for (let frame = 0; frame < 4; frame++) particles.update(makeCtx(world));

    expect(particles.list).toHaveLength(0);
    expect(world.types[world.idx(10, 10)]).toBe(Cell.Blood);
  });

  it('does not embed blocking stone gore above a liquid impact', () => {
    const world = new World(32, 32);
    const particles = new Particles();
    set(world, 10, 10, Cell.Blood, 0xb4232a);

    particles.spawn(10, 8, 0, 2, Cell.Stone, 0x777777, 20, { grav: 0 });
    particles.update(makeCtx(world));

    expect(particles.list).toHaveLength(0);
    expect(world.types[world.idx(10, 8)]).toBe(Cell.Empty);
    expect(world.types[world.idx(10, 10)]).toBe(Cell.Blood);
  });
});

describe('blood drying surfaces', () => {
  it('rejects loose airborne flecks but accepts stable terrain and metal floors', () => {
    const world = new World(48, 48);
    set(world, 8, 8, Cell.Stone);

    expect(canDryBloodOnSurface(world, 8, 8)).toBe(false);

    for (let x = 20; x < 28; x++) {
      for (let y = 32; y < 36; y++) set(world, x, y, Cell.Stone);
    }
    expect(canDryBloodOnSurface(world, 24, 32)).toBe(true);

    set(world, 40, 20, Cell.Metal);
    expect(canDryBloodOnSurface(world, 40, 20)).toBe(true);
  });
});

describe('player liquid splashes', () => {
  it('emits a much larger visual splash during a stomp entry', () => {
    const normal = playerLiquidSplashDropletCount(4.8, false);
    const stomp = playerLiquidSplashDropletCount(4.8, true);

    expect(normal).toBeGreaterThan(0);
    expect(stomp).toBeGreaterThanOrEqual(normal * 3);
    expect(playerLiquidSplashDropletCount(1.2, true)).toBe(0);
  });
});

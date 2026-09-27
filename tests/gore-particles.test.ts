import { describe, expect, it } from 'vitest';

import type { Ctx } from '@/core/types';
import { playerLiquidSplashDropletCount } from '@/entities/Player';
import { Particles } from '@/particles/Particles';
import { Cell, blocksEntity } from '@/sim/CellType';
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
    // The purse was paid at harvest: a landing coin rings, it never pays twice.
    expect(ctx.state.score).toBe(0);
  });
});

describe('coin flight', () => {
  const flightCtx = (world: World, player: { x: number; y: number; dead: boolean }) => {
    const rings: number[] = [];
    const ctx = {
      world,
      player,
      state: { mode: 'play', score: 0, frameCount: 0 },
      events: { emit: () => undefined },
      audio: { coin: (s = 0) => rings.push(s) },
    } as unknown as Ctx;
    return { ctx, rings };
  };

  it('lands every coin of a burst through rock, without orbiting', () => {
    const world = new World(200, 120);
    // A stone slab between the kill and the wizard: the magnet pull ignores it.
    for (let y = 40; y < 120; y++) for (let x = 90; x < 100; x++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x777777);
    const { ctx, rings } = flightCtx(world, { x: 30, y: 100, dead: false });
    const particles = new Particles();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      particles.spawn(160, 95, Math.cos(a) * 2.1, -2.2 - (i % 3), null, 0xffe078, 300, { homing: true, glow: 2, grav: 0 });
    }
    let t = 0;
    while (particles.list.some((p) => p.homing) && t < 240) {
      particles.update(ctx);
      ctx.state.frameCount = ++t;
    }
    expect(rings).toHaveLength(12);
    expect(t).toBeLessThan(90); // ~130 cells in well under 1.5 s
    expect(ctx.state.score).toBe(0);
  });

  it('catches a coin moving faster than the catch radius (swept, no tunnelling)', () => {
    const world = new World(200, 60);
    const { ctx, rings } = flightCtx(world, { x: 100, y: 36, dead: false });
    const particles = new Particles();
    // Fired straight through the purse at top speed.
    particles.spawn(80, 30, 5.2, 0, null, 0xffe078, 300, { homing: true });
    for (let t = 0; t < 30 && rings.length === 0; t++) particles.update(ctx);
    expect(rings).toHaveLength(1);
  });

  it('lets a coin gutter out when the wizard dies mid-flight', () => {
    const world = new World(200, 60);
    const player = { x: 100, y: 50, dead: false };
    const { ctx, rings } = flightCtx(world, player);
    const particles = new Particles();
    particles.spawn(20, 20, 0, 0, null, 0xffe078, 300, { homing: true });
    particles.update(ctx);
    player.dead = true;
    for (let t = 0; t < 60; t++) particles.update(ctx);
    expect(particles.list).toHaveLength(0);
    expect(rings).toHaveLength(0);
  });

  it('never deletes a gold grain: a walled-in landing settles nearby or pays the purse', () => {
    const world = new World(40, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x777777);
    world.clearCellAt(world.idx(20, 20)); // a one-cell void the grain flies through
    const { ctx } = flightCtx(world, { x: 0, y: 0, dead: false });
    const particles = new Particles();
    particles.spawn(20.5, 20.5, 0, 1.2, Cell.Gold, 0xffd040, 240, { deposit: true, grav: 0 });
    particles.update(ctx);
    let gold = 0;
    for (let i = 0; i < world.types.length; i++) if (world.types[i] === Cell.Gold) gold++;
    expect(gold * 10 + ctx.state.score).toBe(10);
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

  it('settles loose explosion stone particles as pass-through ash', () => {
    const world = new World(32, 32);
    const particles = new Particles();
    set(world, 10, 10, Cell.Stone);

    particles.spawn(10, 8, 0, 2, Cell.Stone, 0x777777, 20, { grav: 0, looseDebris: true });
    particles.update(makeCtx(world));

    expect(particles.list).toHaveLength(0);
    expect(world.types[world.idx(10, 8)]).toBe(Cell.Ash);
    expect(blocksEntity(world.types[world.idx(10, 8)])).toBe(false);
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

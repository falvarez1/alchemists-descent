import { describe, expect, it } from 'vitest';

import { CELL_COUNT, Cell } from '@/sim/CellType';
import { World } from '@/sim/World';

describe('cell ABI contracts', () => {
  it('keeps material ids append-only and stable for saves and GPU packing', () => {
    expect(Cell).toEqual({
      Empty: 0,
      Sand: 1,
      Water: 2,
      Wall: 3,
      Wood: 4,
      Fire: 5,
      Oil: 6,
      Acid: 7,
      Gunpowder: 8,
      Steam: 9,
      Ice: 10,
      Lava: 11,
      Stone: 12,
      Metal: 13,
      Smoke: 14,
      Vines: 15,
      Nitrogen: 16,
      Gold: 17,
      Blood: 18,
      Slime: 19,
      Ember: 20,
      ElixirLife: 21,
      ElixirLevity: 22,
      ElixirStone: 23,
      Toxic: 24,
      Healium: 25,
      Teleportium: 26,
      Snow: 27,
      Coal: 28,
      Crystal: 29,
      Fungus: 30,
      Glass: 31,
      Ash: 32,
      Glowshroom: 33,
      Moss: 34,
      Catalyst: 35,
    });
    expect(CELL_COUNT).toBe(36);
    expect(Math.max(...Object.values(Cell))).toBeLessThan(128);
  });
});

describe('World.swap', () => {
  it('swaps full cell state and marks both cells moved in the current tick', () => {
    const world = new World(4, 4);
    const a = world.idx(1, 1);
    const b = world.idx(2, 2);
    world.types[a] = Cell.Water;
    world.colors[a] = 0x123456;
    world.life[a] = 7;
    world.charge[a] = 3;
    world.types[b] = Cell.Fire;
    world.colors[b] = 0xff6600;
    world.life[b] = 11;
    world.charge[b] = 5;
    world.movedTick = 42;

    world.swap(1, 1, 2, 2);

    expect(world.types[a]).toBe(Cell.Fire);
    expect(world.colors[a]).toBe(0xff6600);
    expect(world.life[a]).toBe(11);
    expect(world.charge[a]).toBe(5);
    expect(world.types[b]).toBe(Cell.Water);
    expect(world.colors[b]).toBe(0x123456);
    expect(world.life[b]).toBe(7);
    expect(world.charge[b]).toBe(3);
    expect(world.moved[a]).toBe(42);
    expect(world.moved[b]).toBe(42);
  });
});

import { describe, expect, it } from 'vitest';
import { MAX_PARTICLES } from '@/config/constants';
import type { Critter, Ctx } from '@/core/types';
import { ComponentStore, EntityPool } from '@/entities/ecs';
import { Critters } from '@/game/Critters';
import { Particles } from '@/particles/Particles';
import { Cell } from '@/sim/CellType';

interface Thing {
  name: string;
}

describe('EntityPool', () => {
  it('keeps ids stable when removeAt swap-removes a dense slot', () => {
    const pool = new EntityPool<Thing>();
    const a = { name: 'a' };
    const b = { name: 'b' };
    const c = { name: 'c' };

    const aid = pool.add(a)!;
    const bid = pool.add(b)!;
    const cid = pool.add(c)!;

    expect(pool.removeAt(1)).toBe(b);
    expect(pool.list).toEqual([a, c]);
    expect(pool.get(aid)).toBe(a);
    expect(pool.get(cid)).toBe(c);
    expect(pool.idOf(c)).toBe(cid);
    expect(pool.has(bid)).toBe(false);
    expect(pool.idOf(b)).toBeUndefined();
  });

  it('can remove by entity or id without exposing array mutation', () => {
    const pool = new EntityPool<Thing>();
    const a = pool.create(() => ({ name: 'a' }))!;
    const b = pool.create(() => ({ name: 'b' }))!;
    const bid = pool.idOf(b)!;

    expect(pool.remove(a)).toBe(a);
    expect(pool.removeId(bid)).toBe(b);
    expect(pool.size).toBe(0);
  });

  it('rejects create factories that return an already-active entity', () => {
    const pool = new EntityPool<Thing>();
    const a = { name: 'a' };
    pool.add(a);

    expect(() => pool.create(() => a)).toThrow(/fresh entity/);
    expect(pool.list).toEqual([a]);
  });

  it('treats adding the same object twice as idempotent', () => {
    const pool = new EntityPool<Thing>();
    const a = { name: 'a' };

    const first = pool.add(a)!;
    const second = pool.add(a)!;

    expect(second).toBe(first);
    expect(pool.list).toEqual([a]);
    expect(pool.removeAt(0)).toBe(a);
    expect(pool.has(first)).toBe(false);
    expect(pool.idOf(a)).toBeUndefined();
  });

  it('honors capacity and clears id side tables', () => {
    const pool = new EntityPool<Thing>({ max: 1 });
    const a = { name: 'a' };

    const aid = pool.add(a)!;
    expect(pool.full).toBe(true);
    expect(pool.add({ name: 'b' })).toBeNull();
    expect(pool.create(() => ({ name: 'c' }))).toBeNull();

    pool.clear();
    expect(pool.size).toBe(0);
    expect(pool.full).toBe(false);
    expect(pool.get(aid)).toBeUndefined();
    expect(pool.idOf(a)).toBeUndefined();
  });

  it('retains dense entities while preserving surviving ids', () => {
    const pool = new EntityPool<Thing>();
    const a = { name: 'a' };
    const b = { name: 'b' };
    const c = { name: 'c' };
    const aid = pool.add(a)!;
    pool.add(b);
    const cid = pool.add(c)!;

    pool.retain((entity) => entity.name !== 'b');

    expect(pool.list).toHaveLength(2);
    expect(pool.get(aid)).toBe(a);
    expect(pool.get(cid)).toBe(c);
    expect(pool.list).toEqual(expect.arrayContaining([a, c]));
  });
});

describe('ComponentStore', () => {
  it('stores sparse data by entity id', () => {
    const pool = new EntityPool<Thing>();
    const id = pool.add({ name: 'projectile' })!;
    const positions = new ComponentStore<{ x: number; y: number }>();

    positions.set(id, { x: 10, y: 20 });

    expect(positions.has(id)).toBe(true);
    expect(positions.get(id)).toEqual({ x: 10, y: 20 });
    expect([...positions.entries()]).toEqual([[id, { x: 10, y: 20 }]]);
    expect(positions.delete(id)).toBe(true);
    expect(positions.size).toBe(0);
  });

  it('can hold components from multiple pools without id collisions', () => {
    const projectiles = new EntityPool<Thing>();
    const critters = new EntityPool<Thing>();
    const projectileId = projectiles.add({ name: 'bolt' })!;
    const critterId = critters.add({ name: 'moth' })!;
    const positions = new ComponentStore<{ x: number; y: number }>();

    positions.set(projectileId, { x: 1, y: 2 });
    positions.set(critterId, { x: 3, y: 4 });

    expect(projectileId).not.toBe(critterId);
    expect(positions.get(projectileId)).toEqual({ x: 1, y: 2 });
    expect(positions.get(critterId)).toEqual({ x: 3, y: 4 });
  });

  it('keeps component lifetime explicit when a pool removes an entity', () => {
    const pool = new EntityPool<Thing>();
    const id = pool.add({ name: 'projectile' })!;
    const positions = new ComponentStore<{ x: number; y: number }>();
    positions.set(id, { x: 10, y: 20 });

    pool.removeId(id);

    expect(positions.get(id)).toEqual({ x: 10, y: 20 });
    positions.delete(id);
    expect(positions.has(id)).toBe(false);
  });
});

describe('Particles adapter', () => {
  it('honors capacity and clears through the entity pool', () => {
    const particles = new Particles();

    for (let i = 0; i < MAX_PARTICLES + 1; i++) {
      particles.spawn(i, 0, 0, 0, null, 0xffffff, 10);
    }

    expect(particles.list).toHaveLength(MAX_PARTICLES);
    particles.clear();
    expect(particles.list).toHaveLength(0);
  });

  it('swap-removes out-of-bounds particles during update', () => {
    const particles = new Particles();
    particles.spawn(-5, 0, 0, 0, null, 0xffffff, 10, { grav: 0 });
    particles.spawn(5, 5, 0, 0, null, 0xffffff, 10, { grav: 0 });
    const types = new Uint8Array(100);
    types.fill(Cell.Empty);
    const ctx = {
      world: {
        types,
        inBounds: (x: number, y: number) => x >= 0 && x < 10 && y >= 0 && y < 10,
        idx: (x: number, y: number) => x + y * 10,
      },
      player: { dead: true },
      state: { mode: 'play' },
    } as unknown as Ctx;

    particles.update(ctx);

    expect(particles.list).toHaveLength(1);
    expect(particles.list[0].x).toBe(5);
    expect(particles.list[0].y).toBe(5);
  });
});

describe('Critters adapter', () => {
  it('removes by object reference without exposing dense slots', () => {
    const critters = new Critters({ events: { on: () => undefined } } as unknown as Ctx);
    const pool = (critters as unknown as { pool: EntityPool<Critter> }).pool;
    const moth = makeCritter('moth');
    const fly = makeCritter('fly');
    pool.add(moth);
    pool.add(fly);

    expect(critters.remove(moth)).toBe(moth);
    expect(critters.list).toEqual([fly]);
    expect(critters.remove(moth)).toBeUndefined();
  });
});

function makeCritter(kind: Critter['kind']): Critter {
  return {
    kind,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    phase: 0,
    gasp: 0,
    facing: 1,
  };
}

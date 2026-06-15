import { describe, expect, it } from 'vitest';
import { ComponentStore, EntityPool } from '@/entities/ecs';

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
});

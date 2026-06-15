import { describe, expect, it } from 'vitest';

import type { Enemy } from '@/core/types';
import { EnemySpatialIndex } from '@/entities/enemySpatial';

describe('EnemySpatialIndex', () => {
  it('returns reusable nearby bucket candidates without scanning unrelated buckets', () => {
    const near = enemyAt(10, 20);
    const sameBucket = enemyAt(40, 20);
    const far = enemyAt(150, 20);
    const index = new EnemySpatialIndex(64);
    const out: Enemy[] = [];

    index.rebuild([near, sameBucket, far]);
    const firstBucket = [...((index as unknown as { buckets: Map<number, Enemy[]> }).buckets.values())][0];
    const candidates = index.query(12, 20, 6, out);

    expect(candidates).toBe(out);
    expect(candidates).toEqual([near, sameBucket]);
    expect(candidates).not.toContain(far);
    expect(index.has(near)).toBe(true);

    index.delete(near);
    expect(index.has(near)).toBe(false);

    index.rebuild([far]);
    expect([...((index as unknown as { buckets: Map<number, Enemy[]> }).buckets.values())][0]).toBe(firstBucket);
    expect(index.has(near)).toBe(false);
    expect(index.query(12, 20, 6, out)).toEqual([]);
  });

  it('can refresh live membership without rebuilding buckets', () => {
    const near = enemyAt(10, 20);
    const far = enemyAt(150, 20);
    const index = new EnemySpatialIndex(64);
    const out: Enemy[] = [];

    index.rebuild([near, far]);
    index.syncLive([far]);

    expect(index.query(12, 20, 6, out)).toContain(near);
    expect(index.has(near)).toBe(false);
    expect(index.has(far)).toBe(true);
  });
});

function enemyAt(x: number, y: number): Enemy {
  return { x, y } as Enemy;
}

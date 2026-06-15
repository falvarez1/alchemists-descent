import type { Enemy } from '@/core/types';

export class EnemySpatialIndex {
  private readonly buckets = new Map<number, Enemy[]>();
  private readonly activeKeys: number[] = [];
  private readonly live = new Set<Enemy>();

  constructor(private readonly bucketSize = 64) {}

  rebuild(enemies: readonly Enemy[]): void {
    for (const key of this.activeKeys) {
      this.buckets.get(key)!.length = 0;
    }
    this.activeKeys.length = 0;
    this.syncLive(enemies);
    for (const enemy of enemies) {
      const key = this.keyFor(enemy.x, enemy.y);
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = [];
        this.buckets.set(key, bucket);
      }
      if (bucket.length === 0) this.activeKeys.push(key);
      bucket.push(enemy);
    }
  }

  syncLive(enemies: readonly Enemy[]): void {
    this.live.clear();
    for (const enemy of enemies) this.live.add(enemy);
  }

  query(x: number, y: number, radius: number, out: Enemy[]): Enemy[] {
    out.length = 0;
    const r = Math.max(0, radius);
    const minX = Math.floor((x - r) / this.bucketSize);
    const maxX = Math.floor((x + r) / this.bucketSize);
    const minY = Math.floor((y - r) / this.bucketSize);
    const maxY = Math.floor((y + r) / this.bucketSize);
    for (let by = minY; by <= maxY; by++) {
      for (let bx = minX; bx <= maxX; bx++) {
        const bucket = this.buckets.get(this.key(bx, by));
        if (!bucket) continue;
        for (const enemy of bucket) out.push(enemy);
      }
    }
    return out;
  }

  has(enemy: Enemy): boolean {
    return this.live.has(enemy);
  }

  delete(enemy: Enemy): void {
    this.live.delete(enemy);
  }

  private keyFor(x: number, y: number): number {
    return this.key(Math.floor(x / this.bucketSize), Math.floor(y / this.bucketSize));
  }

  private key(x: number, y: number): number {
    return ((x & 0xffff) << 16) ^ (y & 0xffff);
  }
}

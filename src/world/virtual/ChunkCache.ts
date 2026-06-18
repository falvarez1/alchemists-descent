import type { VirtualChunk } from '@/world/virtual/types';

/**
 * LRU chunk cache keyed by chunk coordinate ONLY.
 *
 * INVARIANT — single generation per cache: {@link chunkKey} is `cx,cy` and carries
 * no seed/def identity, so one instance is valid for exactly ONE (seed, def) world.
 * If the world identity changes (new seed, edited VirtualWorldDef), callers MUST
 * {@link ChunkCache.clear} the cache first, or a stale chunk from the previous world
 * will be served for the same coordinate. Currently unused (re-exported via the
 * barrel for future chunk streaming); wire it in only with that clear-on-world-change
 * discipline.
 */
export class ChunkCache {
  // LRU recency is encoded by Map insertion order: the first key is the least-recently used,
  // the last key the most-recently used. Touching a key re-inserts it at the end.
  private readonly chunks = new Map<string, VirtualChunk>();

  constructor(private readonly maxChunks: number) {}

  get size(): number {
    return this.chunks.size;
  }

  get(cx: number, cy: number): VirtualChunk | null {
    const key = chunkKey(cx, cy);
    const chunk = this.chunks.get(key);
    if (chunk === undefined) return null;
    // Move to most-recently-used by re-inserting at the tail.
    this.chunks.delete(key);
    this.chunks.set(key, chunk);
    return chunk;
  }

  set(chunk: VirtualChunk): void {
    const key = chunkKey(chunk.cx, chunk.cy);
    this.chunks.delete(key);
    this.chunks.set(key, chunk);
    this.evict();
  }

  clear(): void {
    this.chunks.clear();
  }

  values(): VirtualChunk[] {
    return [...this.chunks.values()];
  }

  memoryBytes(): number {
    let bytes = 0;
    for (const chunk of this.chunks.values()) {
      bytes += chunk.types.byteLength + chunk.colors.byteLength + chunk.life.byteLength + chunk.charge.byteLength;
    }
    return bytes;
  }

  private evict(): void {
    while (this.chunks.size > this.maxChunks) {
      const oldestKey = this.chunks.keys().next().value;
      if (oldestKey === undefined) return;
      this.chunks.delete(oldestKey);
    }
  }
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

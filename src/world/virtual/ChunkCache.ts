import type { VirtualChunk } from '@/world/virtual/types';

export class ChunkCache {
  private readonly chunks = new Map<string, VirtualChunk>();
  private readonly touches = new Map<string, number>();
  private tick = 0;

  constructor(private readonly maxChunks: number) {}

  get size(): number {
    return this.chunks.size;
  }

  get(cx: number, cy: number): VirtualChunk | null {
    const key = chunkKey(cx, cy);
    const chunk = this.chunks.get(key) ?? null;
    if (chunk) this.touches.set(key, ++this.tick);
    return chunk;
  }

  set(chunk: VirtualChunk): void {
    const key = chunkKey(chunk.cx, chunk.cy);
    this.chunks.set(key, chunk);
    this.touches.set(key, ++this.tick);
    this.evict();
  }

  clear(): void {
    this.chunks.clear();
    this.touches.clear();
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
      let oldestKey = '';
      let oldestTick = Infinity;
      for (const [key, touched] of this.touches) {
        if (touched < oldestTick) {
          oldestTick = touched;
          oldestKey = key;
        }
      }
      if (!oldestKey) return;
      this.chunks.delete(oldestKey);
      this.touches.delete(oldestKey);
    }
  }
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

import { World } from '@/sim/World';
import type { VirtualChunk } from '@/world/virtual/types';

export interface MaterializedWindow {
  world: World;
  originX: number;
  originY: number;
  chunks: Array<{ cx: number; cy: number; hash: string }>;
}

export function materializeChunks(chunks: readonly VirtualChunk[]): MaterializedWindow {
  if (chunks.length === 0) {
    return { world: new World(1, 1), originX: 0, originY: 0, chunks: [] };
  }
  const size = chunks[0].size;
  const cx0 = Math.min(...chunks.map((chunk) => chunk.cx));
  const cy0 = Math.min(...chunks.map((chunk) => chunk.cy));
  const cx1 = Math.max(...chunks.map((chunk) => chunk.cx));
  const cy1 = Math.max(...chunks.map((chunk) => chunk.cy));
  const width = (cx1 - cx0 + 1) * size;
  const height = (cy1 - cy0 + 1) * size;
  const world = new World(width, height);
  const originX = cx0 * size;
  const originY = cy0 * size;

  for (const chunk of chunks) {
    if (chunk.size !== size) throw new Error('Cannot materialize chunks with mixed sizes');
    const ox = (chunk.cx - cx0) * size;
    const oy = (chunk.cy - cy0) * size;
    for (let y = 0; y < size; y++) {
      const srcOff = y * size;
      const dstOff = ox + (oy + y) * width;
      world.types.set(chunk.types.subarray(srcOff, srcOff + size), dstOff);
      world.colors.set(chunk.colors.subarray(srcOff, srcOff + size), dstOff);
      world.life.set(chunk.life.subarray(srcOff, srcOff + size), dstOff);
      world.charge.set(chunk.charge.subarray(srcOff, srcOff + size), dstOff);
    }
  }

  return {
    world,
    originX,
    originY,
    chunks: chunks.map((chunk) => ({ cx: chunk.cx, cy: chunk.cy, hash: chunk.meta.hash })),
  };
}

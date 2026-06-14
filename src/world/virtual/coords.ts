import type { BiomeMapDef } from '@/world/virtual/types';

export interface ChunkCoord {
  cx: number;
  cy: number;
}

export interface WorldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function floorDiv(n: number, d: number): number {
  return Math.floor(n / d);
}

export function mod(n: number, d: number): number {
  return ((n % d) + d) % d;
}

export function worldToChunk(x: number, y: number, chunkSize: number): ChunkCoord {
  return {
    cx: floorDiv(x, chunkSize),
    cy: floorDiv(y, chunkSize),
  };
}

export function chunkOrigin(cx: number, cy: number, chunkSize: number): { x: number; y: number } {
  return {
    x: cx * chunkSize,
    y: cy * chunkSize,
  };
}

export function localInChunk(x: number, y: number, chunkSize: number): { x: number; y: number } {
  return {
    x: mod(x, chunkSize),
    y: mod(y, chunkSize),
  };
}

export function chunkRect(cx: number, cy: number, chunkSize: number): WorldRect {
  const x0 = cx * chunkSize;
  const y0 = cy * chunkSize;
  return { x0, y0, x1: x0 + chunkSize - 1, y1: y0 + chunkSize - 1 };
}

export function rectsOverlap(a: WorldRect, b: WorldRect): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

export function biomeAtWorld(
  map: BiomeMapDef,
  worldX: number,
  worldY: number,
  biomeChunkSize: number,
): number {
  const bx = floorDiv(worldX, biomeChunkSize) + map.originChunkX;
  const by = floorDiv(worldY, biomeChunkSize) + map.originChunkY;
  const clampedX = Math.max(0, Math.min(map.widthChunks - 1, bx));
  const clampedY = Math.max(0, Math.min(map.heightChunks - 1, by));
  return map.cells[clampedX + clampedY * map.widthChunks] ?? 0;
}

export function chunksForRect(rect: WorldRect, chunkSize: number): { cx0: number; cy0: number; cx1: number; cy1: number } {
  return {
    cx0: floorDiv(rect.x0, chunkSize),
    cy0: floorDiv(rect.y0, chunkSize),
    cx1: floorDiv(rect.x1, chunkSize),
    cy1: floorDiv(rect.y1, chunkSize),
  };
}

import type { BiomeMapDef } from '@/world/virtual/types';

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

export function chunkOrigin(cx: number, cy: number, chunkSize: number): { x: number; y: number } {
  return {
    x: cx * chunkSize,
    y: cy * chunkSize,
  };
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

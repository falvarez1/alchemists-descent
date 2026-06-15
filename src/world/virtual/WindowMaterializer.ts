import { World } from '@/sim/World';
import type {
  VirtualChunk,
  VirtualSceneLight,
  VirtualSceneObject,
  VirtualScenePlacementInstance,
} from '@/world/virtual/types';

export interface MaterializedWindow {
  world: World;
  originX: number;
  originY: number;
  chunks: Array<{ cx: number; cy: number; hash: string }>;
  sceneObjects: VirtualSceneObject[];
  sceneLights: VirtualSceneLight[];
}

export function materializeChunks(chunks: readonly VirtualChunk[]): MaterializedWindow {
  if (chunks.length === 0) {
    return { world: new World(1, 1), originX: 0, originY: 0, chunks: [], sceneObjects: [], sceneLights: [] };
  }
  const size = chunks[0].size;
  const seen = new Set<string>();
  const cx0 = Math.min(...chunks.map((chunk) => chunk.cx));
  const cy0 = Math.min(...chunks.map((chunk) => chunk.cy));
  const cx1 = Math.max(...chunks.map((chunk) => chunk.cx));
  const cy1 = Math.max(...chunks.map((chunk) => chunk.cy));
  const width = (cx1 - cx0 + 1) * size;
  const height = (cy1 - cy0 + 1) * size;
  const expectedChunks = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
  for (const chunk of chunks) {
    if (chunk.size !== size) throw new Error('Cannot materialize chunks with mixed sizes');
    const key = `${chunk.cx},${chunk.cy}`;
    if (seen.has(key)) throw new Error(`Cannot materialize duplicate chunk ${key}`);
    seen.add(key);
  }
  if (seen.size !== expectedChunks) {
    throw new Error(`Cannot materialize sparse chunk window: expected ${expectedChunks} chunks, got ${seen.size}`);
  }
  const world = new World(width, height);
  const originX = cx0 * size;
  const originY = cy0 * size;

  for (const chunk of chunks) {
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

  const placements = uniqueScenePlacements(chunks);
  const sceneObjects: VirtualSceneObject[] = [];
  const sceneLights: VirtualSceneLight[] = [];
  for (const placement of placements) {
    for (const object of placement.objects) {
      const x = object.x - originX;
      const y = object.y - originY;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      sceneObjects.push({ ...object, x, y, params: { ...object.params } });
    }
    for (const light of placement.lights) {
      const x = light.x - originX;
      const y = light.y - originY;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      sceneLights.push({ ...light, x, y });
    }
  }

  return {
    world,
    originX,
    originY,
    chunks: chunks.map((chunk) => ({ cx: chunk.cx, cy: chunk.cy, hash: chunk.meta.hash })),
    sceneObjects,
    sceneLights,
  };
}

function uniqueScenePlacements(chunks: readonly VirtualChunk[]): VirtualScenePlacementInstance[] {
  const placements = new Map<string, VirtualScenePlacementInstance>();
  for (const chunk of chunks) {
    for (const placement of chunk.meta.scenePlacements ?? []) {
      if (!placements.has(placement.id)) placements.set(placement.id, placement);
    }
  }
  return [...placements.values()].sort((a, b) => a.id.localeCompare(b.id));
}

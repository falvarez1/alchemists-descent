import { World } from '@/sim/World';
import type {
  VirtualChunk,
  VirtualSceneLight,
  VirtualSceneLink,
  VirtualSceneObject,
  VirtualScenePlacementInstance,
} from '@/world/virtual/types';

export interface VirtualMaterializationLimits {
  maxSceneObjects: number;
  maxSceneLights: number;
}

export interface VirtualMaterializationStats {
  scenePlacements: number;
  sceneObjects: number;
  sceneLights: number;
  droppedSceneObjects: number;
  droppedSceneLights: number;
}

export interface MaterializedScenePlacement {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  objectCount: number;
  linkCount: number;
  lightCount: number;
  objects: VirtualSceneObject[];
  links: VirtualSceneLink[];
  lights: VirtualSceneLight[];
  sourceChunk?: { cx: number; cy: number; hash: string };
}

export interface MaterializedWindowCrop {
  world: World;
  srcX: number;
  srcY: number;
  scenePlacements: MaterializedScenePlacement[];
  sceneObjects: VirtualSceneObject[];
  sceneLights: VirtualSceneLight[];
  stats: VirtualMaterializationStats;
}

export const DEFAULT_VIRTUAL_MATERIALIZATION_LIMITS: VirtualMaterializationLimits = {
  maxSceneObjects: Number.MAX_SAFE_INTEGER,
  maxSceneLights: Number.MAX_SAFE_INTEGER,
};

export const DEFAULT_VIRTUAL_RUNTIME_MATERIALIZATION_LIMITS: VirtualMaterializationLimits = {
  maxSceneObjects: 256,
  maxSceneLights: 128,
};

export interface MaterializedWindow {
  world: World;
  originX: number;
  originY: number;
  chunks: Array<{ cx: number; cy: number; hash: string }>;
  scenePlacements: MaterializedScenePlacement[];
  sceneObjects: VirtualSceneObject[];
  sceneLights: VirtualSceneLight[];
  stats: VirtualMaterializationStats;
}

export function materializeChunks(
  chunks: readonly VirtualChunk[],
  limits: Partial<VirtualMaterializationLimits> = {},
): MaterializedWindow {
  const materializationLimits = normalizeMaterializationLimits(limits);
  if (chunks.length === 0) {
    return {
      world: new World(1, 1),
      originX: 0,
      originY: 0,
      chunks: [],
      scenePlacements: [],
      sceneObjects: [],
      sceneLights: [],
      stats: emptyStats(),
    };
  }
  const size = chunks[0].size;
  const seen = new Set<string>();
  // Single linear pass for the window bounds — avoids four map() allocations plus argument-spreads
  // (and the `Math.min(...bigArray)` "Maximum call stack size exceeded" hazard on very large windows).
  let cx0 = chunks[0].cx;
  let cy0 = chunks[0].cy;
  let cx1 = chunks[0].cx;
  let cy1 = chunks[0].cy;
  for (const chunk of chunks) {
    if (chunk.cx < cx0) cx0 = chunk.cx;
    if (chunk.cy < cy0) cy0 = chunk.cy;
    if (chunk.cx > cx1) cx1 = chunk.cx;
    if (chunk.cy > cy1) cy1 = chunk.cy;
  }
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
  const scenePlacements = placements
    .map(({ placement, sourceChunk }) => materializedScenePlacement(placement, originX, originY, sourceChunk))
    .filter((placement) => rectIntersects(placement.x, placement.y, placement.w, placement.h, width, height));
  const sceneObjects: VirtualSceneObject[] = [];
  const sceneLights: VirtualSceneLight[] = [];
  let droppedSceneObjects = 0;
  let droppedSceneLights = 0;
  for (const { placement } of placements) {
    for (const object of placement.objects) {
      const x = object.x - originX;
      const y = object.y - originY;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (sceneObjects.length >= materializationLimits.maxSceneObjects) {
        droppedSceneObjects++;
        continue;
      }
      sceneObjects.push({ ...object, x, y, params: { ...object.params } });
    }
    for (const light of placement.lights) {
      const x = light.x - originX;
      const y = light.y - originY;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (sceneLights.length >= materializationLimits.maxSceneLights) {
        droppedSceneLights++;
        continue;
      }
      sceneLights.push({ ...light, x, y });
    }
  }

  return {
    world,
    originX,
    originY,
    chunks: chunks.map((chunk) => ({ cx: chunk.cx, cy: chunk.cy, hash: chunk.meta.hash })),
    scenePlacements,
    sceneObjects,
    sceneLights,
    stats: {
      scenePlacements: placements.length,
      sceneObjects: sceneObjects.length,
      sceneLights: sceneLights.length,
      droppedSceneObjects,
      droppedSceneLights,
    },
  };
}

export function cropMaterializedWindow(
  materialized: MaterializedWindow,
  requestedSrcX: number,
  requestedSrcY: number,
  width: number,
  height: number,
  limits: Partial<VirtualMaterializationLimits> = DEFAULT_VIRTUAL_RUNTIME_MATERIALIZATION_LIMITS,
): MaterializedWindowCrop {
  const out = new World(width, height);
  const cropLimits = normalizeMaterializationLimits(limits, DEFAULT_VIRTUAL_RUNTIME_MATERIALIZATION_LIMITS);
  const maxSrcX = Math.max(0, materialized.world.width - width);
  const maxSrcY = Math.max(0, materialized.world.height - height);
  const srcX = Math.max(0, Math.min(maxSrcX, Math.floor(requestedSrcX)));
  const srcY = Math.max(0, Math.min(maxSrcY, Math.floor(requestedSrcY)));
  const copyWidth = Math.min(width, materialized.world.width - srcX);
  const copyHeight = Math.min(height, materialized.world.height - srcY);
  for (let y = 0; y < copyHeight; y++) {
    const sy = srcY + y;
    const srcOff = srcX + sy * materialized.world.width;
    const dstOff = y * width;
    out.types.set(materialized.world.types.subarray(srcOff, srcOff + copyWidth), dstOff);
    out.colors.set(materialized.world.colors.subarray(srcOff, srcOff + copyWidth), dstOff);
    out.life.set(materialized.world.life.subarray(srcOff, srcOff + copyWidth), dstOff);
    out.charge.set(materialized.world.charge.subarray(srcOff, srcOff + copyWidth), dstOff);
  }

  const sceneObjects: VirtualSceneObject[] = [];
  const sceneLights: VirtualSceneLight[] = [];
  const scenePlacements = materialized.scenePlacements
    .map((placement) => croppedScenePlacement(placement, srcX, srcY, width, height))
    .filter((placement) => rectIntersects(placement.x, placement.y, placement.w, placement.h, width, height));
  let droppedSceneObjects = 0;
  let droppedSceneLights = 0;
  for (const object of materialized.sceneObjects) {
    const x = object.x - srcX;
    const y = object.y - srcY;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    if (sceneObjects.length >= cropLimits.maxSceneObjects) {
      droppedSceneObjects++;
      continue;
    }
    sceneObjects.push({ ...object, x, y, params: { ...object.params } });
  }
  for (const light of materialized.sceneLights) {
    const x = light.x - srcX;
    const y = light.y - srcY;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    if (sceneLights.length >= cropLimits.maxSceneLights) {
      droppedSceneLights++;
      continue;
    }
    sceneLights.push({ ...light, x, y });
  }

  return {
    world: out,
    srcX,
    srcY,
    scenePlacements,
    sceneObjects,
    sceneLights,
    stats: {
      scenePlacements: materialized.stats.scenePlacements,
      sceneObjects: sceneObjects.length,
      sceneLights: sceneLights.length,
      droppedSceneObjects,
      droppedSceneLights,
    },
  };
}

function uniqueScenePlacements(
  chunks: readonly VirtualChunk[],
): Array<{ placement: VirtualScenePlacementInstance; sourceChunk: { cx: number; cy: number; hash: string } }> {
  const placements = new Map<
    string,
    { placement: VirtualScenePlacementInstance; sourceChunk: { cx: number; cy: number; hash: string } }
  >();
  for (const chunk of chunks) {
    const sourceChunk = { cx: chunk.cx, cy: chunk.cy, hash: chunk.meta.hash };
    for (const placement of chunk.meta.scenePlacements ?? []) {
      if (!placements.has(placement.id)) placements.set(placement.id, { placement, sourceChunk });
    }
  }
  return [...placements.values()].sort((a, b) =>
    a.placement.id < b.placement.id ? -1 : a.placement.id > b.placement.id ? 1 : 0,
  );
}

function materializedScenePlacement(
  placement: VirtualScenePlacementInstance,
  originX: number,
  originY: number,
  sourceChunk: { cx: number; cy: number; hash: string },
): MaterializedScenePlacement {
  return {
    id: placement.id,
    x: placement.x - originX,
    y: placement.y - originY,
    w: placement.w,
    h: placement.h,
    objectCount: placement.objects.length,
    linkCount: placement.links.length,
    lightCount: placement.lights.length,
    objects: placement.objects.map((object) => ({
      ...object,
      x: object.x - originX,
      y: object.y - originY,
      params: { ...object.params },
    })),
    links: placement.links.map((link) => ({ ...link })),
    lights: placement.lights.map((light) => ({ ...light, x: light.x - originX, y: light.y - originY })),
    sourceChunk: { ...sourceChunk },
  };
}

function croppedScenePlacement(
  placement: MaterializedScenePlacement,
  srcX: number,
  srcY: number,
  width: number,
  height: number,
): MaterializedScenePlacement {
  const { sourceChunk, ...rest } = placement;
  const objects = rest.objects
    .map((object) => ({ ...object, x: object.x - srcX, y: object.y - srcY, params: { ...object.params } }))
    .filter((object) => object.x >= 0 && object.y >= 0 && object.x < width && object.y < height);
  const objectIds = new Set(objects.map((object) => object.id));
  const lights = rest.lights
    .map((light) => ({ ...light, x: light.x - srcX, y: light.y - srcY }))
    .filter((light) => light.x >= 0 && light.y >= 0 && light.x < width && light.y < height);
  const links = rest.links.filter((link) => objectIds.has(link.fromId) && objectIds.has(link.toId)).map((link) => ({ ...link }));
  return {
    ...rest,
    ...(sourceChunk ? { sourceChunk: { ...sourceChunk } } : {}),
    x: placement.x - srcX,
    y: placement.y - srcY,
    objectCount: objects.length,
    linkCount: links.length,
    lightCount: lights.length,
    objects,
    links,
    lights,
  };
}

function rectIntersects(x: number, y: number, w: number, h: number, width: number, height: number): boolean {
  return x < width && x + w > 0 && y < height && y + h > 0;
}

function normalizeMaterializationLimits(
  limits: Partial<VirtualMaterializationLimits>,
  fallback: VirtualMaterializationLimits = DEFAULT_VIRTUAL_MATERIALIZATION_LIMITS,
): VirtualMaterializationLimits {
  return {
    maxSceneObjects: normalizeLimit(limits.maxSceneObjects, fallback.maxSceneObjects),
    maxSceneLights: normalizeLimit(limits.maxSceneLights, fallback.maxSceneLights),
  };
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function emptyStats(): VirtualMaterializationStats {
  return {
    scenePlacements: 0,
    sceneObjects: 0,
    sceneLights: 0,
    droppedSceneObjects: 0,
    droppedSceneLights: 0,
  };
}

import { Cell } from '@/sim/CellType';
import { EMPTY_COLOR, packRGB } from '@/sim/colors';
import { PIXEL_SCENE_BIOME_FILL, type PixelScenePlacementDef, type VirtualScenePlacementInstance } from '@/world/virtual/types';
import type { WorldRect } from '@/world/virtual/coords';
import { rectsOverlap } from '@/world/virtual/coords';

/** Resolves a biome-fill (FFFFFF) scene pixel to the surrounding biome's rock at a
 *  world coordinate. The chunk generator passes a terrain-coloured resolver. */
export type BiomeFillResolver = (worldX: number, worldY: number) => { type: number; color: number };

export interface PixelSceneStampTarget {
  originX: number;
  originY: number;
  size: number;
  types: Uint8Array;
  colors: Uint32Array;
  life?: Int16Array;
  charge?: Uint8Array;
}

export interface PixelSceneStampResult {
  scenes: string[];
  placements: VirtualScenePlacementInstance[];
}

export function overlappingPixelScenes(
  placements: readonly PixelScenePlacementDef[],
  rect: WorldRect,
): PixelScenePlacementDef[] {
  return placements
    .filter((placement) =>
      rectsOverlap(rect, {
        x0: placement.x,
        y0: placement.y,
        x1: placement.x + placement.scene.w - 1,
        y1: placement.y + placement.scene.h - 1,
      }),
    )
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function stampPixelScenes(
  target: PixelSceneStampTarget,
  placements: readonly PixelScenePlacementDef[],
  resolveFill?: BiomeFillResolver,
): PixelSceneStampResult {
  const chunkRect = {
    x0: target.originX,
    y0: target.originY,
    x1: target.originX + target.size - 1,
    y1: target.originY + target.size - 1,
  };
  const scenes: string[] = [];
  const stampedPlacements: VirtualScenePlacementInstance[] = [];
  for (const placement of overlappingPixelScenes(placements, chunkRect)) {
    const scene = placement.scene;
    const x0 = Math.max(chunkRect.x0, placement.x);
    const y0 = Math.max(chunkRect.y0, placement.y);
    const x1 = Math.min(chunkRect.x1, placement.x + scene.w - 1);
    const y1 = Math.min(chunkRect.y1, placement.y + scene.h - 1);
    let touched = false;
    for (let y = y0; y <= y1; y++) {
      const localY = y - target.originY;
      const sceneY = y - placement.y;
      for (let x = x0; x <= x1; x++) {
        const sceneX = x - placement.x;
        const si = sceneX + sceneY * scene.w;
        const material = scene.material[si];
        const mask = scene.mask;
        const writesPixel = mask ? mask[si] !== 0 : material !== Cell.Empty;
        if (material === undefined || !writesPixel) continue;
        const ci = x - target.originX + localY * target.size;
        if (material === PIXEL_SCENE_BIOME_FILL) {
          // "Use the biome's rock here" — resolved to the surrounding terrain so the
          // pixel is indistinguishable from the cave wall (Noita's FFFFFF).
          const fill = resolveFill ? resolveFill(x, y) : { type: Cell.Wall, color: fallbackSceneColor(Cell.Wall) };
          target.types[ci] = fill.type;
          target.colors[ci] = fill.type === Cell.Empty ? EMPTY_COLOR : fill.color;
        } else {
          target.types[ci] = material;
          target.colors[ci] = material === Cell.Empty ? EMPTY_COLOR : scene.colorOverrides?.[si] ?? fallbackSceneColor(material);
        }
        if (target.life && scene.life) target.life[ci] = scene.life[si] ?? 0;
        if (target.charge && scene.charge) target.charge[ci] = scene.charge[si] ?? 0;
        touched = true;
      }
    }
    if (touched || (scene.objects?.length ?? 0) > 0 || (scene.links?.length ?? 0) > 0 || (scene.lights?.length ?? 0) > 0) {
      scenes.push(placement.id);
      stampedPlacements.push(scenePlacementInstance(placement));
    }
  }
  return { scenes, placements: stampedPlacements };
}

function fallbackSceneColor(material: number): number {
  if (material === Cell.Stone) return packRGB(82, 78, 76);
  if (material === Cell.Wood) return packRGB(112, 73, 38);
  if (material === Cell.Metal) return packRGB(116, 126, 140);
  if (material === Cell.Wall) return packRGB(62, 58, 54);
  return packRGB(96, 92, 88);
}

function scenePlacementInstance(placement: PixelScenePlacementDef): VirtualScenePlacementInstance {
  const scene = placement.scene;
  return {
    id: placement.id,
    x: placement.x,
    y: placement.y,
    w: scene.w,
    h: scene.h,
    objects: (scene.objects ?? []).map((object) => ({
      ...object,
      id: instanceId(placement.id, object.id),
      x: placement.x + object.x,
      y: placement.y + object.y,
      params: { ...object.params },
    })),
    links: (scene.links ?? []).map((link) => ({
      ...link,
      id: instanceId(placement.id, link.id),
      fromId: instanceId(placement.id, link.fromId),
      toId: instanceId(placement.id, link.toId),
    })),
    lights: (scene.lights ?? []).map((light) => ({
      ...light,
      id: instanceId(placement.id, light.id),
      x: placement.x + light.x,
      y: placement.y + light.y,
    })),
  };
}

function instanceId(placementId: string, localId: string): string {
  return `${placementId}:${localId}`;
}

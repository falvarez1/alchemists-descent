import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import type { PixelScenePlacementDef } from '@/world/virtual/types';
import type { WorldRect } from '@/world/virtual/coords';
import { rectsOverlap } from '@/world/virtual/coords';

export interface PixelSceneStampTarget {
  originX: number;
  originY: number;
  size: number;
  types: Uint8Array;
  colors: Uint32Array;
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
): string[] {
  const chunkRect = {
    x0: target.originX,
    y0: target.originY,
    x1: target.originX + target.size - 1,
    y1: target.originY + target.size - 1,
  };
  const stamped: string[] = [];
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
        if (material === undefined || material === Cell.Empty) continue;
        const ci = x - target.originX + localY * target.size;
        target.types[ci] = material;
        target.colors[ci] = scene.colorOverrides?.[si] ?? fallbackSceneColor(material);
        touched = true;
      }
    }
    if (touched) stamped.push(placement.id);
  }
  return stamped;
}

function fallbackSceneColor(material: number): number {
  if (material === Cell.Stone) return packRGB(82, 78, 76);
  if (material === Cell.Wood) return packRGB(112, 73, 38);
  if (material === Cell.Metal) return packRGB(116, 126, 140);
  if (material === Cell.Wall) return packRGB(62, 58, 54);
  return packRGB(96, 92, 88);
}

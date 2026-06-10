import type { LevelDef } from '@/core/types';

/**
 * The descent: a vertical stack of persistent levels connected by sealed
 * wells in each floor. v1 is linear; branches arrive post-spine (DESIGN.md).
 */
export const LEVELS: Record<string, LevelDef> = {
  d1: { id: 'd1', name: 'EARTHEN HOLLOWS', biome: 'earthen', depth: 1, nextLevelId: 'd2' },
  d2: { id: 'd2', name: 'TIMBERWORKS', biome: 'timber', depth: 2, nextLevelId: 'd3' },
  d3: { id: 'd3', name: 'FLOODED CAVERNS', biome: 'flooded', depth: 3, nextLevelId: 'd4' },
  d4: { id: 'd4', name: 'FROZEN DEPTHS', biome: 'frozen', depth: 4, nextLevelId: 'd5' },
  d5: { id: 'd5', name: 'SCORCHED CORE', biome: 'scorched', depth: 5, nextLevelId: null },
};

export const START_LEVEL = 'd1';

/** Placed hostile population per level: base + per-depth growth, kind weights shift down. */
export function populationForDepth(depth: number): { slimes: number; imps: number; golems: number } {
  return {
    slimes: 14 + depth * 4,
    imps: depth >= 2 ? 4 + depth * 3 : 2,
    golems: depth >= 3 ? depth * 2 : depth >= 2 ? 1 : 0,
  };
}

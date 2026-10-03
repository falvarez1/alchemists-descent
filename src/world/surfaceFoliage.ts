import type { BiomeId } from '@/core/types';
import type { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { AMBIENT_FOLIAGE_LIFE } from '@/config/foliage';

export interface FoliageClearance { x: number; y: number; radius: number }
export const surfaceFoliageHash = (x: number, y: number): number => (Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
export const foliageSupport = (t: number): boolean => t === Cell.Stone || t === Cell.Wall || t === Cell.Wood;

/** A separate deterministic dressing pass never draws from the generation
 * stream. Existing materials own it; no solid cells or fixtures are replaced. */
export function dressSurfaceFoliage(world: World, seed: number, biome: BiomeId, clear: readonly FoliageClearance[] = []): void {
  const dry = biome === 'volcanic' || biome === 'frozen' || biome === 'crystal';
  const reserved = (x: number, y: number): boolean => clear.some(p => Math.abs(x - p.x) <= p.radius && Math.abs(y - p.y) <= p.radius);
  const free = (x: number, y: number): boolean => world.type(x, y) === Cell.Empty && !reserved(x, y);
  const mossFree = (x: number, y: number): boolean => (world.type(x, y) === Cell.Empty || (!dry && world.type(x, y) === Cell.Water)) && !reserved(x, y);
  const put = (x: number, y: number, t: number): void => {
    const i = world.idx(x, y), h = surfaceFoliageHash(x + seed, y);
    world.replaceCellAt(i, t, packRGB(42 + h % 15, 78 + h % 24, 47 + h % 17));
    world.life[i] = AMBIENT_FOLIAGE_LIFE;
  };
  for (let y = 10; y < world.height - 10; y++) for (let x = 10; x < world.width - 10; x++) {
    if (!foliageSupport(world.type(x, y))) continue;
    const h = surfaceFoliageHash(x + seed, y);
    // Small tufts leave gaps between fuel patches. Dry floors retain their
    // character, with far fewer damp seams than gardens and waterworks.
    if (x % 6 === 0 && h % (dry ? 11 : 5) < (dry ? 1 : 3) && mossFree(x, y - 1)) put(x, y - 1, Cell.Moss);
    if (!dry && y % 11 === 0 && h % 4 === 0) {
      if (free(x - 1, y)) put(x - 1, y, Cell.Moss);
      else if (free(x + 1, y)) put(x + 1, y, Cell.Moss);
    }
    // Disconnected hanging patches use the existing vine soft bodies. Never
    // grow a fuel bridge along an entire ceiling or across a reserved room.
    if (!dry && h % 103 === 0 && free(x, y + 1)) {
      const length = 14 + h % 31;
      for (let d = 1; d <= length; d++) {
        const vx = x + Math.round(Math.sin(d * .06 + h) * d * .035), vy = y + d;
        if (!world.inBounds(vx, vy) || !free(vx, vy)) break;
        put(vx, vy, Cell.Vines);
      }
    }
  }
}

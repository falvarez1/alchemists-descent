import { describe, expect, it } from 'vitest';
import {
  BROADLEAF, buildFlora, createFloraBlades, FERN, floraCoverMask, floraHeight, floraSpecies, LILY, SEDGE,
} from '@/world/flora';
import { foregroundFoliage } from '@/config/foliage';
import { Cell } from '@/sim/CellType';
import type { SurfaceFrondPose } from '@/world/foliageGeometry';

const seedsOf = (species: number, count: number): number[] => {
  const out: number[] = [];
  for (let s = 1; out.length < count; s++) {
    const seed = Math.imul(s, 2654435761) >>> 0;
    if (floraSpecies(seed, 0, true) === species) out.push(seed);
  }
  return out;
};
const pose = (seed: number): SurfaceFrondPose => ({ x: 200, y: 150, seed, side: 0, foreground: true,
  height: floraHeight(seed, 0, true, false), angle: 0, part: 0, burn: 0 });
const bits = (m: number): number => { let n = 0; for (; m; m &= m - 1) n++; return n; };

describe('Surface flora grammars', () => {
  it.each([['fern', FERN], ['broadleaf', BROADLEAF], ['sedge', SEDGE], ['lily', LILY]] as const)(
    'every %s hides a body standing at its root', (_name, species) => {
      for (const seed of seedsOf(species, 24)) {
        expect(bits(floraCoverMask(pose(seed), 200.5, 150)) / 9).toBeGreaterThanOrEqual(.55);
      }
    });

  it('grows a different silhouette from every seed, and the same one from the same seed', () => {
    const a = createFloraBlades(), b = createFloraBlades();
    const [s1, s2] = seedsOf(FERN, 2);
    buildFlora(pose(s1), null, a); buildFlora(pose(s2), null, b);
    expect(a.count).not.toBe(0);
    expect([...a.bx.slice(0, 20)]).not.toEqual([...b.bx.slice(0, 20)]);
    buildFlora(pose(s1), null, b);
    expect(b.count).toBe(a.count);
    expect([...b.bx.slice(0, a.count)]).toEqual([...a.bx.slice(0, a.count)]);
  });

  it('keeps cover plants sparse: at most one per patch, only with headroom and footing', () => {
    const open = (x: number, y: number): number => (y >= 151 ? 1 : y === 150 && x % 6 === 0 ? Cell.Moss : 0);
    const blocks = (t: number): boolean => t === 1;
    let chosen = 0;
    for (let x = 0; x < 8400; x += 6) if (foregroundFoliage(x, 150, 0, open, blocks)) chosen++;
    // 100 patches along a flat, open floor: well under one plant per patch.
    expect(chosen).toBeGreaterThan(40);
    expect(chosen).toBeLessThanOrEqual(100);
    const ceiling = (x: number, y: number): number => (y >= 151 || y < 135 ? 1 : open(x, y));
    for (let x = 0; x < 8400; x += 6) expect(foregroundFoliage(x, 150, 0, ceiling, blocks)).toBe(false);
  });
});

import { Cell } from '@/sim/CellType';

/** Mature damp dressing uses the existing signed life plane and cell IDs.
 * Ordinary moss/vines retain their normal growth and puzzle fuel. */
export const AMBIENT_FOLIAGE_LIFE = -2;
export const FOLIAGE_BURN_TICKS = 90;
export const FOLIAGE_MAX_FUEL = 5;

/** Foreground cover grows from a few chosen moss roots: one plant per
 * 84×40 patch at most, where the floor is wide and the air above is open, so
 * a clump reads as part of the room rather than a stamped row. */
export const FOLIAGE_COVER = {
  settleTicks: 30,
  revealTicks: 90,
  contactRadius: 24,
  maxSpeed: .35,
  minCoverage: .55,
  maxChar: .3,
} as const;

const PATCH_W = 84, PATCH_H = 40;

/** Pure in position and the nearby terrain: `types` is any cell lookup (the World's). */
export function foregroundFoliage(x: number, y: number, side: number,
  type?: (x: number, y: number) => number, blocks?: (t: number) => boolean): boolean {
  if (side !== 0) return false;
  const px = Math.floor(x / PATCH_W), py = Math.floor(y / PATCH_H);
  const patch = (Math.imul(px, 374761393) ^ Math.imul(py, 668265263)) >>> 0;
  if (patch % 100 >= 64) return false;
  // One anchor window per patch; the first moss root in it grows the plant.
  const anchor = px * PATCH_W + 12 + (patch >>> 8) % (PATCH_W - 24);
  if (x < anchor - 2 || x > anchor + 9) return false;
  if (!type || !blocks) return true;
  for (let ax = anchor - 2; ax < x; ax++) if (type(ax, y) === Cell.Moss) return false;
  for (let dy = 3; dy <= 27; dy += 3) for (const dx of [-5, 0, 5]) if (blocks(type(x + dx, y - dy))) return false;
  let footing = 0;
  for (let dx = -6; dx <= 6; dx += 2) if (blocks(type(x + dx, y + 1))) footing++;
  return footing >= 5;
}

export function foliageFuel(sourceLife: number): number {
  return Math.max(0, Math.min(FOLIAGE_MAX_FUEL, Math.floor(sourceLife) - 2));
}

/** Negative life already denotes dormant growth. Reserve a bounded band for
 * this foliage's smoulder so save/load retains age and decreasing fuel. */
export function foliageBurnLife(fuel: number, age = 0): number {
  return -100 - Math.max(0, Math.min(FOLIAGE_MAX_FUEL, Math.floor(fuel))) * 1000 - Math.min(FOLIAGE_BURN_TICKS, Math.max(0, Math.floor(age)));
}

export function foliageBurnState(life: number): { fuel: number; age: number; burning: boolean } {
  if (life > -100) return { fuel: 0, age: Math.max(0, -life - 10), burning: false };
  const value = -life - 100;
  return { fuel: Math.floor(value / 1000), age: value % 1000, burning: true };
}

/** Mature damp dressing uses the existing signed life plane and cell IDs.
 * Ordinary moss/vines retain their normal growth and puzzle fuel. */
export const AMBIENT_FOLIAGE_LIFE = -2;
export const FOLIAGE_BURN_TICKS = 90;
export const FOLIAGE_MAX_FUEL = 5;

/** Foreground cover is tall, cool-green growth rooted in the existing moss.
 * A stable patch choice makes its depth readable before a player enters it. */
export const FOLIAGE_COVER = {
  settleTicks: 30,
  revealTicks: 90,
  contactRadius: 24,
  maxSpeed: .35,
  minCoverage: .55,
  maxChar: .3,
} as const;

export function foregroundFoliage(x: number, y: number, side: number): boolean {
  if (side !== 0) return false;
  const patch = Math.imul(Math.floor(x / 48), 374761393) ^ Math.imul(Math.floor(y / 32), 668265263);
  return (patch >>> 0) % 3 === 0;
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

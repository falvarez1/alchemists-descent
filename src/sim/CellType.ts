/**
 * Every material that can occupy a simulation cell.
 * Numeric values are stable: they are stored raw in World.types and were
 * inherited from the original prototype, so save data / debug dumps keep meaning.
 *
 * (Const-object pattern instead of `enum` so the type fully erases and values
 * inline cleanly under esbuild/isolatedModules.)
 */
export const Cell = {
  Empty: 0,
  Sand: 1,
  Water: 2,
  Wall: 3,
  Wood: 4,
  Fire: 5,
  Oil: 6,
  Acid: 7,
  Gunpowder: 8,
  Steam: 9,
  Ice: 10,
  Lava: 11,
  Stone: 12,
  Metal: 13,
  Smoke: 14,
  Vines: 15,
  Nitrogen: 16,
  Gold: 17,
  Blood: 18,
  Slime: 19,
  Ember: 20,
} as const;

export type Cell = (typeof Cell)[keyof typeof Cell];

export const CELL_COUNT = 21;

/**
 * Classification predicates take plain numbers so values read straight out of
 * World.types (a Uint8Array) need no casting in hot loops.
 */

/** Rigid, load-bearing materials: never fall, entities stand on them. */
export function isSolid(t: number): boolean {
  return (
    t === Cell.Wall ||
    t === Cell.Wood ||
    t === Cell.Metal ||
    t === Cell.Stone ||
    t === Cell.Ice ||
    t === Cell.Vines
  );
}

/** Materials that carry electrical charge (chain lightning, sparks). */
export function isConductor(t: number): boolean {
  return (
    t === Cell.Water ||
    t === Cell.Lava ||
    t === Cell.Metal ||
    t === Cell.Acid ||
    t === Cell.Blood
  );
}

export function isLiquid(t: number): boolean {
  return (
    t === Cell.Water ||
    t === Cell.Oil ||
    t === Cell.Acid ||
    t === Cell.Lava ||
    t === Cell.Nitrogen ||
    t === Cell.Blood ||
    t === Cell.Slime
  );
}

export function isGas(t: number): boolean {
  return t === Cell.Steam || t === Cell.Smoke;
}

/** Materials that obstruct moving bodies (player, enemies, projectiles). */
export function blocksEntity(t: number): boolean {
  return isSolid(t) || t === Cell.Sand || t === Cell.Gold || t === Cell.Gunpowder;
}

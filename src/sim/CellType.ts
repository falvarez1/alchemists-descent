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
  ElixirLife: 21,
  ElixirLevity: 22,
  ElixirStone: 23,
  // Upgrade port (noita-alchemists-descent.html) — REMAPPED from its ids
  // 21-30 because 21-23 were already ours. The remap table lives in
  // docs/UPGRADE-DELTA.md; cell ids are append-only forever.
  Toxic: 24,
  Healium: 25,
  Teleportium: 26,
  Snow: 27,
  Coal: 28,
  Crystal: 29,
  Fungus: 30,
  Glass: 31,
  Ash: 32,
  Glowshroom: 33,
  // Wave F "The Caves Breathe"
  Moss: 34,
  // The Gilded Vault: the philosopher's dust. A glittering powder that
  // supercharges acid->gold transmutation on contact and is CONSUMED by it
  // (the economy guard: amplification is local and finite, never a rule
  // change — see handleAcid).
  Catalyst: 35,
  // Hidden mineral cache: dark host rock veined with gold that does NOT self-glow
  // (see Lighting — no emissive seed), so it reads as plain rock until the wizard's
  // light sweeps it and the flecks gleam. Dig it (erodeAt) to spill gold. Placed by
  // the mineral-vug fill pass into small cave pockets (world/biomeExtras).
  RawOre: 36,
  // Walk-through ground cover: blades that stand on dirt/walkable rock and creep
  // along it (handleGrass), passing the body straight through (isSoftGrowth) but
  // catching and racing fire like dry brush (thermal). Planted on the walkable
  // surface by world/surfaceDress.plantGroundCover alongside mushroom tufts.
  Grass: 37,
} as const;

export type Cell = (typeof Cell)[keyof typeof Cell];

/**
 * NOTE: the GPU compose path (render/ComposeShader.ts) packs each cell's type
 * into a texture byte as `type | 0x80` when the cell is charged. That is an
 * internal texture format, NOT a save format — but it means cell ids must
 * stay <= 127. Ids are append-only and top out at 37 today, so there is room
 * for 90 more materials; if id 128 is ever near, the charge bit moves first.
 */
export const CELL_COUNT = 38;

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
    t === Cell.Vines ||
    t === Cell.Crystal ||
    t === Cell.Glass ||
    t === Cell.Fungus ||
    t === Cell.Glowshroom ||
    t === Cell.Moss ||
    t === Cell.RawOre ||
    t === Cell.Grass
  );
}

/** Soft growth occupies the grid visually/sim-wise, but bodies move through it. */
export function isSoftGrowth(t: number): boolean {
  return (
    t === Cell.Vines ||
    t === Cell.Moss ||
    t === Cell.Fungus ||
    t === Cell.Glowshroom ||
    t === Cell.Grass
  );
}

/** Materials that carry electrical charge (chain lightning, sparks).
 *  Acid/Toxic stay inert so ooze does not turn whole caves into cyan glow. Blood
 *  conducts again as a short-lived wet gore pool, giving combat spills a real
 *  lightning-combo role beside water, molten rock, and metal. */
export function isConductor(t: number): boolean {
  return t === Cell.Water || t === Cell.Lava || t === Cell.Metal || t === Cell.Blood;
}

export function isLiquid(t: number): boolean {
  return (
    t === Cell.Water ||
    t === Cell.Oil ||
    t === Cell.Acid ||
    t === Cell.Lava ||
    t === Cell.Nitrogen ||
    t === Cell.Blood ||
    t === Cell.Slime ||
    t === Cell.ElixirLife ||
    t === Cell.ElixirLevity ||
    t === Cell.ElixirStone ||
    t === Cell.Toxic ||
    t === Cell.Healium ||
    t === Cell.Teleportium
  );
}

export function isGas(t: number): boolean {
  return t === Cell.Steam || t === Cell.Smoke;
}

/** Materials that obstruct moving bodies (player, enemies, projectiles). */
export function blocksEntity(t: number): boolean {
  if (isSoftGrowth(t)) return false;
  return (
    isSolid(t) ||
    t === Cell.Sand ||
    t === Cell.Gold ||
    t === Cell.Gunpowder ||
    t === Cell.Snow ||
    t === Cell.Coal ||
    t === Cell.Catalyst
  );
}

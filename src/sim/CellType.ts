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
  // MARSH GAS: flammable bog vapor. Rises and POOLS under ceilings (no
  // dissipation - the pocket you can see is the pocket that ignites); any
  // fire/lava/ember contact turns it to flame instantly, so a lit pocket
  // burns as a racing front. Seeded under cave ceilings in fungal/flooded
  // biomes (applyBiomeExtras) - mining or a stray fireball writes the set
  // piece. Fail-open: a blast only ever OPENS terrain.
  MarshGas: 38,
  // FLORA (Breathing Works wave 2). LEAF: canopy foliage, fern fronds, lily
  // pads and leaf litter. Walk-through growth that holds on while it is within
  // a few leaf-steps of wood or rock (its life plane stores that distance) and
  // otherwise lets go and flutters down (handleLeaf). Burns fast and bright;
  // floats on water.
  Leaf: 39,
  // TRUNK: living wood — tree trunks, branches, giant-fungus stems and caps,
  // root columns. Walk-past (a 2D forest never walls the route) but real: it
  // smoulders, digs and blasts, and a cluster that loses every contact with
  // load-bearing ground is FELLED (game/Flora: a hinged Rapier topple that
  // re-stamps as solid Wood where it lands).
  Trunk: 40,
  // SEED: a pod's seeds. Held on the plant until it is kicked, shaken or
  // felled, then a loose powder. Thirsty seeds drink the water they touch and
  // sprout a climbable root ladder (real Trunk + Wood rungs); glowseeds are the
  // Bellows' lure seeds, collected by walking over them.
  Seed: 41,
  // BRINE (wave 3, the Cold Store): the refrigeration wing's coolant — salt
  // water kept below freezing. It will NOT freeze (nitrogen and frost boil off
  // it), it eats the ice it touches back to water, it sinks under fresh water,
  // conducts like the sea, boils away under heat, and chills whoever wades in
  // it (a frostbite slow). The Cold Store runs it in gutters and sumps.
  Brine: 42,
  // MIRROR (wave 3, the Glass Galleries): silvered glass from the lens-grinding
  // halls. A static solid that REFLECTS the wand's beam (and the Lenswright's
  // lance) off its face — game/beamTrace reads the face from the cells around
  // the hit — and shatters like glass under a blast or a hard strike.
  Mirror: 43,
} as const;

export type Cell = (typeof Cell)[keyof typeof Cell];

/**
 * NOTE: the GPU compose path (render/ComposeShader.ts) packs each cell's type
 * into a texture byte as `type | 0x80` when the cell is charged. That is an
 * internal texture format, NOT a save format — but it means cell ids must
 * stay <= 127. Ids are append-only and top out at 43 today, so there is room
 * for 84 more materials; if id 128 is ever near, the charge bit moves first.
 */
export const CELL_COUNT = 44;

/**
 * Classification predicates take plain numbers so values read straight out of
 * World.types (a Uint8Array) need no casting in hot loops.
 */

/** Rigid, load-bearing materials: never fall, entities stand on them. */
function isSolidRef(t: number): boolean {
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
    t === Cell.Grass ||
    t === Cell.Trunk ||
    t === Cell.Mirror
  );
}

/** Soft growth occupies the grid visually/sim-wise, but bodies move through it. */
function isSoftGrowthRef(t: number): boolean {
  return (
    t === Cell.Vines ||
    t === Cell.Moss ||
    t === Cell.Fungus ||
    t === Cell.Glowshroom ||
    t === Cell.Grass ||
    t === Cell.Leaf ||
    t === Cell.Trunk
  );
}

/** Materials that carry electrical charge (chain lightning, sparks).
 *  Acid/Toxic stay inert so ooze does not turn whole caves into cyan glow. Blood
 *  conducts again as a short-lived wet gore pool, giving combat spills a real
 *  lightning-combo role beside water, molten rock, and metal. */
function isConductorRef(t: number): boolean {
  return t === Cell.Water || t === Cell.Lava || t === Cell.Metal || t === Cell.Blood || t === Cell.Brine;
}

function isLiquidRef(t: number): boolean {
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
    t === Cell.Teleportium ||
    t === Cell.Brine
  );
}

function isGasRef(t: number): boolean {
  return t === Cell.Steam || t === Cell.Smoke || t === Cell.MarshGas;
}

/** Materials that obstruct moving bodies (player, enemies, projectiles). */
function blocksEntityRef(t: number): boolean {
  if (isSoftGrowthRef(t)) return false;
  return (
    isSolidRef(t) ||
    t === Cell.Sand ||
    t === Cell.Gold ||
    t === Cell.Gunpowder ||
    t === Cell.Snow ||
    t === Cell.Coal ||
    t === Cell.Catalyst
  );
}

/**
 * The predicates above are the DEFINITIONS; hot loops call them per neighbour
 * per cell, so each is baked once into a 256-entry byte table built by running
 * the definition over every byte value. Same answers (a non-cell number reads
 * undefined, which is false, exactly as the comparison chains say), one load.
 */
function bake(definition: (t: number) => boolean): Uint8Array {
  const table = new Uint8Array(256);
  for (let t = 0; t < 256; t++) table[t] = definition(t) ? 1 : 0;
  return table;
}
const SOLID = bake(isSolidRef);
const SOFT_GROWTH = bake(isSoftGrowthRef);
const CONDUCTOR = bake(isConductorRef);
const LIQUID = bake(isLiquidRef);
const GAS = bake(isGasRef);
const BLOCKS_ENTITY = bake(blocksEntityRef);

/** Rigid, load-bearing materials: never fall, entities stand on them. */
export function isSolid(t: number): boolean { return SOLID[t] === 1; }
/** Soft growth occupies the grid visually/sim-wise, but bodies move through it. */
export function isSoftGrowth(t: number): boolean { return SOFT_GROWTH[t] === 1; }
/** Materials that carry electrical charge (see isConductorRef). */
export function isConductor(t: number): boolean { return CONDUCTOR[t] === 1; }
export function isLiquid(t: number): boolean { return LIQUID[t] === 1; }
export function isGas(t: number): boolean { return GAS[t] === 1; }
/** Materials that obstruct moving bodies (player, enemies, projectiles). */
export function blocksEntity(t: number): boolean { return BLOCKS_ENTITY[t] === 1; }

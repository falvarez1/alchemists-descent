import type { AuthoredLight } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR, packRGB, stoneColor } from '@/sim/colors';
import type { World } from '@/sim/World';

/**
 * THE REFUGE KETTLE (THE EXPERIMENT, GEN 64). Floor 1 had no cauldron at all, so the game's
 * alchemy was met on floor 2 by a player who had never been shown it. The Warm Refuge now has one,
 * on the plinth's west end beside the speaking pipe, with everything a first brew needs standing
 * within a few paces and nothing in the way of the walk:
 *
 *  - THE KETTLE: a regulation basin (the same 9-wide stone vessel the generator stamps) on the
 *    plinth's top row. Its brew is the cells in the bowl; the cells are the only inventory.
 *  - THE FURNACE UNDER IT: a sealed pocket in the plinth, a stone slab and the basin's base
 *    beneath the bowl, banked with a bed of real Ember cells: "the fire goes UNDER the pot". The
 *    heat the cauldron reads is any Fire, Lava or Ember within six cells, and an ember never burns
 *    out, so there is no fuel to run dry (a first version fed pilot flames from emitters: every
 *    burnt-out flame left ash, and the pocket choked within a minute). It is a cutaway: the embers
 *    glow through the plinth's face and nobody can walk through them. The generated floors'
 *    kettles want a fire of the player's own making; this one is lit because floor 1 is the
 *    lesson, and the lesson after is the bowl panel saying "no fire" on floor 2.
 *  - THE CISTERN: a sunken tank under a riveted grate (the Works' own pattern: the grate's gaps let a
 *    flask reach the water, a body walks over it). Thirty cells of water, finite.
 *  - THE TEA SHRUB: a mound of real leaf cells on the plinth's west end (walk-through, so it is no
 *    obstacle on the route), drawn up a cell at a time with the flask like anything else.
 *
 * Every cell is real: dig the slab and the furnace spills, burn the shrub and it is ash.
 */
export const REFUGE_KETTLE = {
  /** The bowl's centre column and the row of its stone base (the plinth's top row is 744). */
  x: 800,
  baseY: 743,
  /** The sealed furnace pocket in the plinth, under the bowl (rows 745-747, 7 wide). */
  furnace: { x0: 797, x1: 803, y0: 745, y1: 747 },
  /** The sunken tank (water 5 wide, rows 745-750) and the grate over it on the plinth's top row. */
  tank: { x0: 787, x1: 791, y0: 745, y1: 750, grateX0: 786, grateX1: 792, grateY: 744 },
  /** The shrub: an ellipse of leaf on the plinth's top row, west end. */
  shrub: { cx: 772.5, floorY: 743, rx: 5.5, ry: 4 },
  /** The footprint the placed-room list keeps clear of repair tunnels. */
  bounds: { x0: 764, y0: 728, x1: 808, y1: 752 },
} as const;

/** A cheap spatial hash for the shrub's ragged edge (no rng: the stamp draws nothing from any stream). */
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export interface RefugeKettle {
  /** The cauldron the brewing system reads: its centre column and its bottom interior row. */
  cauldron: { x: number; y: number };
  /** A warm glow over the kettle (the furnace shows through the plinth's face). */
  lights: AuthoredLight[];
}

/** Stamp the Refuge Kettle into the finished plinth. */
export function stampRefugeKettle(world: World): RefugeKettle {
  const K = REFUGE_KETTLE;
  const set = (x: number, y: number, t: number, color: number): void => {
    if (!world.inBounds(x, y)) return;
    world.replaceCellAt(world.idx(x, y), t, color);
  };
  const copper = packRGB(91, 73, 48);

  // THE KETTLE: the room over the base opened, a stone base row, two-tall walls (authoring/stamps.stampCauldron).
  for (let dy = 1; dy <= 6; dy++) for (let dx = -4; dx <= 4; dx++) set(K.x + dx, K.baseY - dy, Cell.Empty, EMPTY_COLOR);
  for (let dx = -4; dx <= 4; dx++) set(K.x + dx, K.baseY, Cell.Stone, stoneColor());
  for (let t = 1; t <= 2; t++) {
    set(K.x - 4, K.baseY - t, Cell.Stone, stoneColor());
    set(K.x + 4, K.baseY - t, Cell.Stone, stoneColor());
  }

  // THE FURNACE: a sealed pocket under the bowl (the plinth's own top row and the basin's base are the slab over it), banked with embers.
  const f = K.furnace;
  for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) set(x, y, Cell.Ember, COLOR_FN[Cell.Ember]());

  // THE CISTERN: water in a sunken tank, a riveted grate over its mouth (every other column open to the flask).
  const t = K.tank;
  for (let y = t.y0; y <= t.y1; y++) for (let x = t.x0; x <= t.x1; x++) set(x, y, Cell.Water, COLOR_FN[Cell.Water]());
  for (let x = t.grateX0; x <= t.grateX1; x++) {
    if ((x - t.grateX0) % 2 === 0) set(x, t.grateY, Cell.Metal, copper);
    else set(x, t.grateY, Cell.Empty, EMPTY_COLOR);
  }

  // THE TEA SHRUB: leaf cells on the plinth, ragged at the edge, anchored by the stone under them.
  const s = K.shrub;
  const leaf = COLOR_FN[Cell.Leaf];
  for (let y = s.floorY - Math.ceil(s.ry); y <= s.floorY; y++) {
    for (let x = Math.floor(s.cx - s.rx); x <= Math.ceil(s.cx + s.rx); x++) {
      const nx = (x - s.cx) / s.rx, ny = (y - s.floorY) / s.ry;
      if (nx * nx + ny * ny > 1 || hash(x, y) % 6 === 0) continue;
      set(x, y, Cell.Leaf, leaf());
    }
  }

  const lights: AuthoredLight[] = [{
    x: K.x, y: K.baseY - 8, r: 1, g: 0.66, b: 0.3, intensity: 0.6, radius: 78, bloom: 0.12, flicker: 0.14,
    flickerPhase: hash(K.x, K.baseY) % 600, falloff: 'soft', occluded: true,
  }];
  return { cauldron: { x: K.x, y: K.baseY - 1 }, lights };
}

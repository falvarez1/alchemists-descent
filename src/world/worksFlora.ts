import { Rng, hashSeed } from '@/core/rng';
import { blocksEntity, Cell } from '@/sim/CellType';
import { EMPTY_COLOR, packRGB } from '@/sim/colors';
import { SEED_THIRSTY_LOOSE } from '@/sim/elements/flora';
import type { World } from '@/sim/World';
import { groundAt, plantFlora, type FloraSpecies, type PlantOptions } from '@/world/floraKit';

/* ============================================================
 * FLOOR 1's FLORA, hand-planted (the rest of the descent is dressed by the
 * worldgen flora pass). The Breathing Works is authored, so its trees are
 * too: every stand below is at a fixed spot, grown from a fixed stream, the
 * same in every run, and none of them stands on the forced route's tunnels
 * or rungs (living wood is walk-past anyway; a felled log is real Wood that
 * digs and burns).
 *
 *  - The Silt Garden: a pale cave-birch on the dock at the foot of the return
 *    shaft, another rising out of the Root Loper's fungal bank, a tree-fern
 *    hung with glowseed pods by the east wall, a kickable sapling on the lip
 *    of the way down, fern beds and grass along the floor.
 *  - The Feeding Gallery: a birch at each open end of the floor, tree-ferns
 *    with glowseed pods under both catwalks, a sapling in the catwalk gap.
 *  - THE SEED CELLAR, the floor's optional flora puzzle: a small rock room off
 *    the Undertow's west end (where the chute from the garden lands). Thirsty
 *    seeds lie in a cup sunk in its floor below a lit shelf with gold on it;
 *    a sealed stone cistern hangs on the near wall with a wooden bung in its
 *    floor. Burn or dig the bung (Spark Bolt, Excavate), the pour floods the
 *    cup, the seeds drink and a root ladder climbs to the shelf.
 * ============================================================ */

/** The Seed Cellar's rock room (the rootLadder room of the flora pass, mirrored: its door faces east). */
export const WORKS_SEED_CELLAR = {
  x0: 120, x1: 204, y0: 900, floorY: 1010,
  shelf: { x0: 126, x1: 150, y: 952 },
  bed: { x: 157 },
  cistern: { x0: 163, x1: 177, y0: 973, y1: 980 },
  door: { x0: 196, x1: 314, y0: 988 },
  reward: { x: 134, y: 950 },
} as const;

interface WorksStand {
  species: FloraSpecies;
  x: number;
  /** Row to search for the ground from (downwards). */
  from: number;
  opts?: PlantOptions;
  /** Clear the fungal shelf under the foot first (the Root Loper's bank). */
  clearFungus?: boolean;
}

/** Every planted stand, in planting order (append-only keeps the stream stable). */
export const WORKS_FLORA: readonly WorksStand[] = [
  // The Silt Garden (floor 825).
  { species: 'birch', x: 288, from: 740, opts: { height: 62, lean: -0.02 } }, // on the dock
  { species: 'birch', x: 598, from: 790, opts: { height: 66, lean: -0.03 }, clearFungus: true },
  { species: 'treefern', x: 628, from: 790, opts: { height: 22, pods: 'glow' }, clearFungus: true },
  { species: 'sapling', x: 258, from: 800, opts: { height: 16 } },
  { species: 'fernbed', x: 300, from: 800 }, { species: 'grasstuft', x: 318, from: 800 },
  { species: 'fernbed', x: 372, from: 800 }, { species: 'grasstuft', x: 400, from: 800 },
  { species: 'fernbed', x: 562, from: 800 }, { species: 'grasstuft', x: 582, from: 800 },
  // The Feeding Gallery (floor 450).
  { species: 'birch', x: 940, from: 400, opts: { height: 68, lean: 0.02 } },
  { species: 'birch', x: 1488, from: 400, opts: { height: 62, lean: -0.02 } },
  { species: 'treefern', x: 1120, from: 420, opts: { height: 18, pods: 'glow' } },
  { species: 'treefern', x: 1300, from: 420, opts: { height: 17, pods: 'glow' } },
  { species: 'sapling', x: 1220, from: 420, opts: { height: 18 } },
  { species: 'fernbed', x: 962, from: 420 }, { species: 'grasstuft', x: 1062, from: 420 },
  { species: 'fernbed', x: 1160, from: 420 }, { species: 'grasstuft', x: 1252, from: 420 },
  { species: 'fernbed', x: 1350, from: 420 }, { species: 'grasstuft', x: 1466, from: 420 },
  { species: 'fernbed', x: 1506, from: 420 },
];

const CELLAR_ROCK = (): number => packRGB(52, 70, 72);
const CELLAR_MASONRY = packRGB(78, 89, 80);

function set(world: World, x: number, y: number, t: Cell, color: number, life = 0): void {
  if (!world.inBounds(x, y)) return;
  const i = world.idx(x, y);
  if (world.types[i] === Cell.Metal) return;
  world.replaceCellAt(i, t, color);
  world.life[i] = life;
}

function box(world: World, x0: number, y0: number, x1: number, y1: number, t: Cell, color: () => number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(world, x, y, t, color());
}

/**
 * The Seed Cellar's rock: carved before the Works' chalk-lip pass, so its new
 * faces are lit and weathered like every other room's.
 */
export function carveSeedCellar(world: World): void {
  const C = WORKS_SEED_CELLAR;
  const empty = (): number => EMPTY_COLOR;
  box(world, C.x0 + 6, C.y0 + 6, C.x1 - 6, C.floorY - 1, Cell.Empty, empty);
  box(world, C.x0 + 6, C.floorY, C.x1 - 6, C.floorY + 5, Cell.Stone, CELLAR_ROCK);
  // The high shelf off the far (west) wall, and the lit niche behind it.
  box(world, C.shelf.x0, C.shelf.y, C.shelf.x1, C.shelf.y + 3, Cell.Stone, CELLAR_ROCK);
  box(world, C.x0 - 2, C.shelf.y - 18, C.x0 + 6, C.shelf.y - 1, Cell.Empty, empty);
  // The cup, sunk flush with the floor (a pour pools over the seeds), on dark soil.
  box(world, C.bed.x - 4, C.floorY, C.bed.x + 4, C.floorY + 1, Cell.Empty, empty);
  box(world, C.bed.x - 4, C.floorY + 2, C.bed.x + 4, C.floorY + 2, Cell.Stone, () => packRGB(64, 50, 38));
  // The door: the east wall at floor height, out to where the garden chute lands.
  box(world, C.door.x0, C.door.y0, C.door.x1, C.floorY - 1, Cell.Empty, empty);
}

/**
 * Plant the floor: every WORKS_FLORA stand, then the Seed Cellar's fittings
 * (cistern, bung, seeds, lamps). Runs after the habitat dressing, so a stand
 * grows over the moss it lands on and never under the ivy.
 */
export function plantWorksFlora(world: World): number {
  const rng = new Rng(hashSeed(0x5eed, 'works-flora'));
  let planted = 0;
  for (const s of WORKS_FLORA) {
    if (s.clearFungus) {
      for (let y = s.from; y < s.from + 40; y++) for (let x = s.x - 4; x <= s.x + 4; x++) {
        if (world.inBounds(x, y) && world.types[world.idx(x, y)] === Cell.Fungus) set(world, x, y, Cell.Empty, EMPTY_COLOR);
      }
    }
    const y = groundAt(world, s.x, s.from, s.from + 60);
    if (y < 0) continue;
    if (plantFlora(world, s.species, s.x, y, rng, { floor: 'bellows', ...s.opts })) planted++;
  }
  const C = WORKS_SEED_CELLAR;
  // The sealed cistern: stone, bracketed to the east wall above the door.
  const k = C.cistern;
  box(world, k.x0 - 1, k.y0 - 1, k.x1 + 1, k.y1 + 1, Cell.Stone, () => CELLAR_MASONRY);
  box(world, k.x1 + 1, k.y1 - 1, C.x1 - 6, k.y1 + 1, Cell.Stone, () => packRGB(72, 82, 76));
  box(world, k.x0, k.y0, k.x1, k.y1, Cell.Water, () => packRGB(48, 98, 93));
  // The bung: three cells of wood in the cistern's floor, at the end over the cup.
  for (let x = k.x0; x <= k.x0 + 2; x++) set(world, x, k.y1 + 1, Cell.Wood, packRGB(118, 88, 54));
  // A low curb past where the pour lands turns the spill into the cup, not out of the door.
  box(world, k.x0 + 5, C.floorY - 2, k.x0 + 6, C.floorY - 1, Cell.Stone, CELLAR_ROCK);
  // Five thirsty seeds in the cup.
  for (let x = C.bed.x - 2; x <= C.bed.x + 2; x++) {
    set(world, x, C.floorY + 1, Cell.Seed, packRGB(176 + rng.int(20), 126 + rng.int(14), 54), SEED_THIRSTY_LOOSE);
  }
  // Glowshroom lamps: the shelf's niche (the gold reads from the floor), and
  // the door (the cellar reads from the Undertow).
  const lamp = (x: number, y: number): void => {
    for (let dx = -1; dx <= 1; dx++) set(world, x + dx, y, Cell.Glowshroom, packRGB(105, 175, 140));
    set(world, x, y - 1, Cell.Glowshroom, packRGB(112, 184, 146));
  };
  lamp(C.x0 + 1, C.shelf.y - 1);
  lamp(C.x1 - 10, C.floorY - 1);
  // A few ferns by the door, so the cellar belongs to the garden above.
  for (const x of [184, 192]) {
    const y = groundAt(world, x, C.floorY - 12, C.floorY + 2);
    if (y >= 0 && blocksEntity(world.types[world.idx(x, y + 1)]) && plantFlora(world, 'fernbed', x, y, rng, { floor: 'bellows' })) planted++;
  }
  return planted;
}

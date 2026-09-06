import type { World } from '@/sim/World';
import { blocksEntity, Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';

export const WORKS_PLANTS: ReadonlyArray<readonly [number, number, number, boolean]> = [
  [88,315,20,false],[124,315,14,false],[226,315,24,false],[302,315,16,false],[436,315,22,false],
  [160,97,76,true],[290,98,50,true],[468,170,68,true],
  [580,341,14,false],[699,325,18,false],[788,349,16,false],[887,445,22,false],[712,168,85,true],
  [979,450,25,false],[1030,390,16,false],[1186,390,19,false],[1328,390,21,false],[1433,450,17,false],
  [1000,169,67,true],[1185,168,92,true],[1410,169,64,true],
  [1100,730,20,false],[1190,650,14,false],[1453,650,17,false],[1457,486,65,true],
  [765,760,24,false],[795,744,19,false],[920,744,23,false],[985,760,17,false],[839,543,72,true],
  [183,825,28,false],[248,825,21,false],[516,825,32,false],[575,825,29,false],[465,544,82,true],
  [525,1010,21,false],[659,1010,16,false],[817,1010,24,false],[620,864,64,true],
  [985,1010,21,false],[1120,1010,17,false],[1282,1010,25,false],[1490,1010,28,false],[1228,831,84,true],
] as const;

/** Find the initial material anchor near an authored planting position.
 * Runtime crowns retain their own pose and fuel after this anchor is lost. */
export function worksPlantRoot(world: World, x: number, y: number, hanging: boolean, planted = false): number {
  for (let yy = y - 7; yy <= y + 24; yy++) {
    if (!world.inBounds(x, yy + 1)) continue;
    if (planted) {
      if (world.type(x, yy) === (hanging ? Cell.Vines : Cell.Moss)) return yy;
    } else if (hanging ? blocksEntity(world.type(x, yy - 1)) && world.type(x, yy) === Cell.Empty
      : world.type(x, yy) === Cell.Empty && blocksEntity(world.type(x, yy + 1))) return yy;
  }
  return -1;
}

export function dressWorksHabitat(world: World, seed: number): void {
  const hash = (x: number, y: number) => (Math.imul(x + seed, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  const put = (x: number, y: number, t: Cell, color: number) => {
    if (world.inBounds(x, y)) world.replaceCellAt(world.idx(x, y), t, color);
  };
  // Broken faces cluster at a small masonry scale. The walkable step stays at
  // two cells; broad room silhouettes no longer end in immaculate ruler edges.
  for (let x = 18; x < world.width - 18; x++) for (let y = 120; y < world.height - 12; y++) {
    if (world.type(x, y) !== Cell.Stone || world.type(x, y - 1) !== Cell.Empty) continue;
    if (hash(x >> 2, y) % 9 < 2 && Math.abs(x - 857) > 95 && Math.abs(x - 285) > 35 && Math.abs(x - 180) > 45) {
      const depth = 1 + hash(x >> 1, y) % 2;
      for (let d = 0; d < depth && world.type(x, y + d) === Cell.Stone; d++) world.clearCell(x, y + d);
      // Do not treat the freshly exposed face as another authored surface.
      y += depth;
    }
  }
  for (const [x, expectedY, size, hanging] of WORKS_PLANTS) {
    const y = worksPlantRoot(world, x, expectedY, hanging);
    if (y < 0) continue;
    const type = hanging ? Cell.Vines : Cell.Moss;
    put(x, y, type, packRGB(58, 100, 73));
    if (hanging) {
      for (let d = 1; d < size; d++) {
        const xx = x + Math.round(Math.sin(d * .065 + x) * d * .10), yy = y + d;
        if (world.type(xx, yy) !== Cell.Empty) break;
        put(xx, yy, Cell.Vines, packRGB(44 + d % 3 * 4, 75 + d % 4 * 4, 60));
      }
    } else {
      for (let dx = -9; dx <= 9; dx++) for (let dy = -1; dy <= 2; dy++) {
        if (world.type(x + dx, y + dy) === Cell.Empty && blocksEntity(world.type(x + dx, y + dy + 1))) {
          put(x + dx, y + dy, Cell.Moss, packRGB(66, 108, 78));
        }
      }
    }
  }
  // Timber braces physically connect the catwalks to their knees. The crawl
  // passage below remains open, including after the softer braces burn away.
  for (const [x, y, width] of [[570,341,63],[677,325,66],[789,349,48],[1015,390,195],[1230,390,167]]) {
    for (const end of [x + 5, x + width - 6]) for (let d = 0; d < 20; d++) {
      // The gallery's raised exit sits beneath this end. A diagonal there
      // makes a narrowing wedge between the landing and the catwalk ceiling.
      if (x === 1230 && end > x + width / 2) continue;
      const xx = end + (end < x + width / 2 ? d : -d), yy = y + 7 + d;
      if (world.type(xx, yy) === Cell.Empty) put(xx, yy, Cell.Wood, packRGB(80, 72, 50));
    }
  }
  // Soft fungal shelves turn the garden bank into a habitat for the Root Loper.
  for (let x = 476; x < 598; x++) for (let y = 816; y < 826; y++) {
    if (world.type(x, y) === Cell.Empty && y > 819 + Math.sin(x * .13) * 3) put(x, y, Cell.Fungus, packRGB(79, 105, 66));
  }
}

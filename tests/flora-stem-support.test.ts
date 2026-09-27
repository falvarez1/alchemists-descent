import { describe, expect, it } from 'vitest';

import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { anchoredSupport, holdsUp } from '@/sim/elements/flora';
import { floodStand, FloodScratch } from '@/game/floraFelling';
import { dropStrandedStands } from '@/world/floraPass';

/**
 * THE 16-CELL STEM THAT FELL ON ITS OWN (Flora's spontaneous-fall census).
 *
 * The Drowned Cisterns grow kelp in pools whose beds carry gold. On D3 seed 1 a
 * 16-cell kelp stem stood on a single Wall cell set in a gold pocket: the Wall
 * cell's only load-bearing neighbours were two gold grains. anchoredSupport
 * counted those grains as what embeds the Wall, so the stand was judged
 * supported at generation — and then the wizard's harvester field (every gold
 * cell within 30 cells of him flies to the purse) lifted the grains as he walked
 * past, the untouched Wall footing became a "lone speck", and the stem fell with
 * nothing having touched it or the cell it stood on.
 *
 * A static footing is embedded only by static rock: loose powder (gold, sand,
 * coal, snow) leaves on its own — harvested at range, slid, grazed — so it can
 * pack a powder bed but never anchor a rock. And gold is never footing at all:
 * the harvester lifts it from under anything the moment the alchemist is near.
 */

function stamp(world: World, x: number, y: number, t: Cell, color: number): void {
  world.replaceCellAt(world.idx(x, y), t, color);
  if (t === Cell.Trunk) world.life[world.idx(x, y)] = -1;
}

function trunkColumn(world: World, x: number, foot: number, height: number): void {
  for (let y = foot; y > foot - height; y--) stamp(world, x, y, Cell.Trunk, 0x3a5640);
}

function stoneFloor(world: World, top: number): void {
  for (let y = top; y < world.height; y++) for (let x = 0; x < world.width; x++) stamp(world, x, y, Cell.Stone, 0x555555);
}

/**
 * The D3 seed-1 pool bed, cell for cell around the stem's foot (the census
 * found it at x 797..805, y 851..858 on the generated level). W = Wall,
 * g = gold, ~ = water, p = a loose seed, T = the stem.
 */
const BED = [
  '~~T.~~...',
  'W~~T~~...',
  'WW~T~~...',
  'WWW~T....',
  'WWWgW....',
  'WWgggp...',
  '~~~~g.p..',
  '~~~~.....',
];

function goldPocketBed(): { world: World; footX: number; footY: number } {
  const world = new World(40, 40);
  const ox = 10, oy = 20;
  for (let r = 0; r < BED.length; r++) {
    for (let c = 0; c < BED[r].length; c++) {
      const ch = BED[r][c];
      const t = ch === 'W' ? Cell.Wall : ch === 'g' ? Cell.Gold : ch === '~' ? Cell.Water : ch === 'p' ? Cell.Seed : ch === 'T' ? Cell.Trunk : null;
      if (t !== null) stamp(world, ox + c, oy + r, t, t === Cell.Trunk ? 0x3a5640 : 0x777777);
    }
  }
  // ...and the stem's straight run above the wiggle: 4 + 12 = 16 cells.
  trunkColumn(world, ox + 2, oy - 1, 12);
  return { world, footX: ox + 4, footY: oy + 3 };
}

function harvestGold(world: World): void {
  for (let i = 0; i < world.types.length; i++) if (world.types[i] === Cell.Gold) world.clearCellAt(i);
}

describe('a stem on a footing only loose powder embeds', () => {
  it('is judged the same before and after the gold around its Wall footing is harvested', () => {
    const scratch = new FloodScratch();
    const bed = goldPocketBed();
    scratch.ensure(bed.world.types.length);
    const stand = floodStand(bed.world, bed.footX, bed.footY, scratch, scratch.next());
    expect(stand.count).toBe(16);
    expect(bed.world.types[bed.world.idx(bed.footX, bed.footY + 1)]).toBe(Cell.Wall);
    const before = stand.supported;
    // The wizard walks past: every gold cell in the pool bed flies to the purse.
    const walked = goldPocketBed();
    harvestGold(walked.world);
    const after = floodStand(walked.world, walked.footX, walked.footY, scratch, scratch.next()).supported;
    // The bug: supported at generation, felled the moment the gold left.
    expect(after).toBe(before);
    // The Wall touches rock only through gold: it was never embedded.
    expect(anchoredSupport(bed.world, bed.footX, bed.footY + 1)).toBe(false);
    expect(before).toBe(false);
  });

  it('is removed by generation\'s last word instead of falling on the player later', () => {
    const { world } = goldPocketBed();
    expect(dropStrandedStands(world)).toBe(1);
    let trunk = 0;
    for (const t of world.types) if (t === Cell.Trunk) trunk++;
    expect(trunk).toBe(0);
  });

  it('keeps a stem whose rock bed is embedded in rock, gold in it or not', () => {
    const world = new World(40, 40);
    stoneFloor(world, 30);
    stamp(world, 19, 30, Cell.Gold, 0xd4a020); // gold beside the footing...
    stamp(world, 21, 31, Cell.Gold, 0xd4a020); // ...and under its neighbour
    trunkColumn(world, 20, 29, 16);
    const scratch = new FloodScratch();
    scratch.ensure(world.types.length);
    expect(floodStand(world, 20, 20, scratch, scratch.next()).supported).toBe(true);
    harvestGold(world);
    expect(floodStand(world, 20, 20, scratch, scratch.next()).supported).toBe(true);
  });

  it('does not count gold as footing: the harvester lifts it from under anything', () => {
    const world = new World(40, 40);
    stoneFloor(world, 30);
    for (let x = 17; x <= 23; x++) for (let y = 30; y <= 31; y++) stamp(world, x, y, Cell.Gold, 0xd4a020);
    trunkColumn(world, 20, 29, 16);
    expect(holdsUp(world, 20, 30, true)).toBe(false);
    const scratch = new FloodScratch();
    scratch.ensure(world.types.length);
    expect(floodStand(world, 20, 20, scratch, scratch.next()).supported).toBe(false);
  });

  it('still lets a powder bed hold a stem from underneath, and embedded rock hold it from the side', () => {
    const world = new World(40, 40);
    stoneFloor(world, 30);
    for (let x = 14; x <= 26; x++) for (let y = 27; y <= 29; y++) stamp(world, x, y, Cell.Sand, 0xc0a060);
    trunkColumn(world, 20, 26, 16);
    const scratch = new FloodScratch();
    scratch.ensure(world.types.length);
    expect(floodStand(world, 20, 18, scratch, scratch.next()).supported).toBe(true);
    const wall = new World(40, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 6; x++) stamp(wall, x, y, Cell.Stone, 0x555555);
    trunkColumn(wall, 6, 25, 16); // hung on the rock face, nothing under it
    expect(floodStand(wall, 6, 15, scratch, scratch.next()).supported).toBe(true);
  });
});

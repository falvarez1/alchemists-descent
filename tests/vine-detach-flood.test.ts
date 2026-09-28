import { describe, expect, it } from 'vitest';

import type { Ctx } from '@/core/types';
import { VineStrands } from '@/entities/VineStrands';
import { Cell } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { World } from '@/sim/World';

function makeCtx(world: World): Ctx {
  return {
    world,
    state: { mode: 'play', frameCount: 0 },
    fx: { screenShake: 0 },
    player: { x: 0, y: 0, dead: false },
    events: { on: () => () => undefined },
  } as unknown as Ctx;
}

function vine(world: World, x: number, y: number, color = 0x446644): void {
  world.replaceCellAt(world.idx(x, y), Cell.Vines, color);
  world.life[world.idx(x, y)] = -1;
}

describe('detachCluster support flood (stamped membership)', () => {
  it('holds a colony over the cap and drops it the moment it shrinks to the cap', () => {
    const world = new World(220, 120);
    const system = new VineStrands(makeCtx(world));
    for (let x = 3; x <= 195; x++) vine(world, x, 60); // 193 unanchored vines in open air
    world.activity.stepSerial = 1;
    expect(system.detachCluster(3, 60)).toBe(false); // truncated at 192
    expect(world.types[world.idx(3, 60)]).toBe(Cell.Vines);
    world.activity.stepSerial = 2;
    world.clearCellAt(world.idx(195, 60)); // exactly the cap, no anchor: it must fall
    expect(system.detachCluster(3, 60)).toBe(true);
    for (let x = 3; x <= 194; x++) expect(world.types[world.idx(x, 60)]).toBe(Cell.Empty);
    expect(system.strands.length).toBe(1);
    expect(system.strands[0].nodes.length).toBe(192);
  });

  it('keeps an anchored colony and repeats the answer from its proof', () => {
    const world = new World(120, 80);
    const system = new VineStrands(makeCtx(world));
    world.replaceCellAt(world.idx(10, 30), Cell.Stone, 0x777777);
    for (let x = 11; x <= 60; x++) vine(world, x, 30);
    for (let step = 1; step <= 3; step++) {
      world.activity.stepSerial = step;
      expect(system.detachCluster(60, 30)).toBe(false);
    }
    world.activity.stepSerial = 4;
    world.clearCellAt(world.idx(10, 30)); // the anchor goes: the next step's flood drops it
    expect(system.detachCluster(60, 30)).toBe(true);
  });

  it('gives a fallen cluster the average colour of its cells and 8-connected segments', () => {
    const world = new World(80, 60);
    const system = new VineStrands(makeCtx(world));
    const cells: Array<[number, number, number]> = [
      [20, 20, packRGB(10, 200, 30)], [21, 20, packRGB(30, 100, 50)], [22, 21, packRGB(50, 0, 70)], [22, 22, packRGB(70, 60, 90)],
    ];
    for (const [x, y, c] of cells) vine(world, x, y, c);
    world.activity.stepSerial = 1;
    expect(system.detachCluster(20, 20)).toBe(true);
    const strand = system.strands[0];
    expect(strand.color).toBe(packRGB(40, 90, 60));
    expect(strand.nodes.length).toBe(4);
    expect(strand.segments.length).toBe(3); // a chain: right, diagonal, down
  });
});

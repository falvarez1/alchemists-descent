import { describe, expect, it } from 'vitest';
import type { Ctx } from '@/core/types';
import { VineStrands } from '@/entities/VineStrands';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';

function garden() {
  const world = new World(800, 600), callbacks: Array<() => void> = [];
  const ctx = { world, state: { mode: 'play', frameCount: 0 }, fx: { screenShake: 0 },
    player: { x: 210, y: 310, dead: false },
    events: { on: (event: string, callback: () => void) => { if (event === 'levelChanged') callbacks.push(callback); return () => undefined; } },
  } as unknown as Ctx;
  const system = new VineStrands(ctx); ctx.vineStrands = system;
  world.replaceCellAt(world.idx(160, 96), Cell.Stone, 0x888888);
  const cells = [];
  for (let d = 0; d < 76; d++) {
    const x = 160 + Math.round(Math.sin(d * .065 + 160) * d * .1), y = 97 + d;
    cells.push(world.idx(x, y)); world.replaceCellAt(world.idx(x, y), Cell.Vines, 0x446644); world.life[world.idx(x, y)] = -1;
  }
  const tick = (count: number) => { for (let i = 0; i < count; i++) { ctx.state.frameCount++; system.update(ctx); } };
  return { ctx, world, system, cells, tick, leave: () => callbacks.forEach(callback => callback()) };
}

describe('Living vine continuity', () => {
  it('activates an entire curved diagonal stem with its root above the view, using fewer physical joints than cells', () => {
    const { system, cells, world, tick } = garden(); tick(8);
    expect(system.strands).toHaveLength(1);
    const vine = system.strands[0];
    expect(vine.originCells).toHaveLength(76);
    expect(vine.nodes.length).toBeLessThan(30);
    expect(vine.segments.length).toBe(vine.nodes.length - 1);
    expect(vine.nodes.at(-1)!.y - vine.nodes[0].y).toBeGreaterThan(70);
    expect(cells.every(index => world.types[index] === Cell.Empty)).toBe(true);
    expect(new Set(vine.nodes.flatMap(n => n.sourceCells ?? [])).size).toBe(76);
  });

  it('sways, reacts to a kick, and keeps its ceiling socket fixed', () => {
    const { system, tick } = garden(); tick(100);
    const vine = system.strands[0], tail = vine.nodes.at(-1)!;
    const xs = [];
    for (let i = 0; i < 180; i++) { tick(1); xs.push(tail.x); }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(.3);
    expect(vine.nodes[0].x).toBe(160.5); expect(vine.nodes[0].y).toBe(97.5);
    const before = tail.x;
    system.applyRadialImpulse(tail.x - 15, tail.y, 40, 2); tick(12);
    expect(Math.abs(tail.x - before)).toBeGreaterThan(1);
  });

  it('keeps the full diagonal material component attached until its terrain support is removed', () => {
    const { system, world, cells } = garden();
    const end = cells.at(-1)!;
    expect(system.detachCluster(end % world.width, Math.floor(end / world.width))).toBe(false);
    world.clearCell(160, 96);
    expect(system.detachCluster(end % world.width, Math.floor(end / world.width))).toBe(true);
    expect(system.strands[0].nodes).toHaveLength(76);
    expect(system.strands[0].segments).toHaveLength(75);
  });

  it('releases a severed lower section with its leaves, retaining only the actual upper stem at the ceiling', () => {
    const { system, tick, world, leave } = garden(); tick(8);
    const original = system.strands[0], point = original.nodes[3];
    expect(system.cutAt(point.x, point.y, 2)).toBe(1);
    expect(system.strands).not.toContain(original);
    const lower = system.strands.find(s => !s.tendril)!;
    expect(lower.nodes.length).toBeGreaterThan(15);
    expect(lower.nodes.some(n => n.leafLength)).toBe(true);
    const y = lower.nodes[0].y; tick(25);
    expect(lower.nodes[0].y).toBeGreaterThan(y + 10);
    const topMaterial = system.strands.find(s => s.tendril)!.originCells!;
    expect(topMaterial.length).toBeLessThan(10);
    leave();
    expect(system.strands).toHaveLength(0);
    expect(topMaterial.every(index => world.types[index] === Cell.Vines)).toBe(true);
    expect(world.type(160, 119)).toBe(Cell.Empty);
  });

  it('never restores a vine to its old ceiling after its support is dug away', () => {
    const { system, tick, world, cells, leave } = garden(); tick(8);
    world.clearCell(160, 96); tick(30);
    expect(system.strands[0].tendril).toBe(false);
    expect(system.strands[0].nodes[0].y).toBeGreaterThan(120);
    leave();
    expect(world.types[cells[0]]).toBe(Cell.Empty);
  });

  it('restores an intact offscreen vine without losing or duplicating material', () => {
    const { system, tick, world, cells, ctx } = garden(); tick(8);
    ctx.player.x = 760; tick(1);
    expect(system.strands).toHaveLength(0);
    expect(cells.every(index => world.types[index] === Cell.Vines)).toBe(true);
    expect([...world.types].filter(type => type === Cell.Vines)).toHaveLength(76);
  });

  it('copies held vine material into a save without mutating the running world or resurrecting cut sections', () => {
    const { system, tick, world, cells } = garden(); tick(8);
    const types = world.types.slice(), life = world.life.slice();
    system.writeSnapshotCells(world, types, life);
    expect(cells.every(index => types[index] === Cell.Vines && life[index] === -1)).toBe(true);
    expect(cells.every(index => world.types[index] === Cell.Empty)).toBe(true);
    const node = system.strands[0].nodes[3];
    expect(system.hitTest(node.x, node.y, 1)).toBe(true);
    expect(system.hitTest(node.x + 50, node.y, 1)).toBe(false);
    system.cutAt(node.x, node.y, 2); tick(30);
    const cutTypes = world.types.slice(); system.writeSnapshotCells(world, cutTypes, world.life.slice());
    expect(cutTypes[cells[0]]).toBe(Cell.Vines);
    expect(cutTypes[cells[20]]).toBe(Cell.Empty);
    expect([...cutTypes].filter(type => type === Cell.Vines).length).toBeGreaterThan(40);
  });
});

import { describe, expect, test } from 'vitest';
import { weaponLaneClear, safeTravel, safeMobilityLanding, safeDrop, safeHopClearance } from '@/arena/ai/combat';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import type { Ctx } from '@/core/types';
import { lineClear } from '@/arena/ai/worldView';
import { createWorldView } from '@/arena/ai/worldView';
import { Control, StuckDetector } from '@/arena/ai/control';
import type { BrainSelf } from '@/arena/ai/brain';

describe('observed firing paths', () => {
  const weapon = { speed: 7.5, gravity: .14, minRange: 90, maxRange: 220 };
  const origin = { x: 600, y: 630 }, target = { x: 740, y: 630 }, aim = { x: 740, y: 604 };
  test('checks the thrown arc against a low ceiling before committing a bomb', () => {
    const clear = (_ax: number, ay: number, _bx: number, by: number) => Math.min(ay, by) > 625;
    expect(weaponLaneClear(origin, target, aim, weapon, clear)).toBe(false);
  });
  test('permits a clear lob over a low obstacle that blocks a direct shot', () => {
    const clear = (ax: number, ay: number, bx: number, by: number) => !(Math.max(ax, bx) >= 660 && Math.min(ax, bx) <= 670 && Math.max(ay, by) > 625);
    expect(weaponLaneClear(origin, target, aim, weapon, clear)).toBe(true);
  });
  test('a straight spell still respects cover and an instant spell uses its aim line', () => {
    const straight = { ...weapon, gravity: 0 }, point = { x: 740, y: 630 };
    expect(weaponLaneClear(origin, target, point, straight, () => false)).toBe(false);
    expect(weaponLaneClear(origin, target, point, { ...straight, speed: 0 }, () => true)).toBe(true);
  });
  test('thin cover cannot fall between the firing-lane samples', () => {
    expect(lineClear(x => x === 655, 650, 630, 662, 630)).toBe(false);
  });
  test.each([600, 601])('traces an upward ballistic shot beyond its first tick at target x=%s', x => {
    const above = { x, y: 540 };
    expect(weaponLaneClear(origin, above, above, weapon, (_ax, ay, _bx, by) => Math.min(ay, by) > 580)).toBe(false);
    expect(weaponLaneClear(origin, above, above, weapon, () => true)).toBe(true);
  });
  test('traces a downward ballistic shot through the full vertical lane', () => {
    const below = { x: origin.x, y: 730 };
    expect(weaponLaneClear(origin, below, below, weapon, (_ax, ay, _bx, by) => Math.max(ay, by) < 680)).toBe(false);
  });
  test('rejects an upward shot that cannot reach the target before falling', () => {
    const above = { x: origin.x, y: 330 };
    expect(weaponLaneClear(origin, above, above, weapon, () => true)).toBe(false);
  });
  test('checks the ground between us and the landing, including thin flames', () => {
    const world = new World();
    for (let x = 590; x <= 650; x++) world.replaceCellAt(world.idx(x, 640), Cell.Metal, 0);
    const ctx = { world, physics: { entityFree: () => true, cellBlocks: (x: number, y: number) => world.type(x, y) === Cell.Metal } } as unknown as Pick<Ctx, 'world' | 'physics'>;
    expect(safeTravel(ctx, 600, 639, 630)).toBe(true);
    world.replaceCellAt(world.idx(611, 627), Cell.Fire, 0);
    expect(safeTravel(ctx, 600, 639, 630)).toBe(false);
  });
  test('permits leaving an existing flame patch along a corridor with decreasing exposure', () => {
    const world = new World();
    world.replaceCellAt(world.idx(600, 627), Cell.Fire, 0);
    const ctx = { world } as Pick<Ctx, 'world' | 'physics'>;
    expect(safeTravel(ctx, 600, 639, 630)).toBe(true);
    world.replaceCellAt(world.idx(617, 627), Cell.Fire, 0);
    expect(safeTravel(ctx, 600, 639, 630)).toBe(false);
  });
  test('an airborne dash can land over a shallow safe descent without demanding ground at flight height', () => {
    const world = new World();
    for (let x = 590; x <= 650; x++) world.replaceCellAt(world.idx(x, 640), Cell.Metal, 0);
    const ctx = { world, physics: { entityFree: () => true, cellBlocks: (x: number, y: number) => world.type(x, y) === Cell.Metal } } as unknown as Pick<Ctx, 'world' | 'physics'>;
    expect(safeMobilityLanding(ctx, 600, 610, 630)).toBe(true);
    world.replaceCellAt(world.idx(630, 631), Cell.Fire, 0);
    expect(safeMobilityLanding(ctx, 600, 610, 630)).toBe(false);
    expect(safeMobilityLanding(ctx, 600, 560, 630)).toBe(false);
  });
  test('a drop checks the actual standing position before approving a floor below acid', () => {
    const world = new World();
    for (let x = 590; x <= 650; x++) world.replaceCellAt(world.idx(x, 640), Cell.Metal, 0);
    world.replaceCellAt(world.idx(630, 635), Cell.Acid, 0);
    const ctx = { world, physics: { entityFree: () => true, cellBlocks: (x: number, y: number) => world.type(x, y) === Cell.Metal } } as unknown as Pick<Ctx, 'world' | 'physics'>;
    expect(safeDrop(ctx, 630, 610)).toBe(false);
  });
  test('a descent checks hazards between sampled columns and above the final standing pose', () => {
    const world = new World();
    for (let x = 590; x <= 650; x++) world.replaceCellAt(world.idx(x, 640), Cell.Metal, 0);
    world.replaceCellAt(world.idx(632, 616), Cell.Fire, 0);
    const ctx = { world, physics: { entityFree: () => true, cellBlocks: (x: number, y: number) => world.type(x, y) === Cell.Metal } } as unknown as Pick<Ctx, 'world' | 'physics'>;
    expect(safeDrop(ctx, 630, 610)).toBe(false);
    expect(safeMobilityLanding(ctx, 600, 610, 630)).toBe(false);
  });
  test('finds a clear hop over cinders onto cover, bounded by ceiling clearance and fuel', () => {
    const world = new World();
    for (let x = 300; x <= 440; x++) world.replaceCellAt(world.idx(x, 640), Cell.Metal, 0);
    for (let y = 614; y < 640; y++) for (let x = 360; x <= 367; x++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0);
    world.replaceCellAt(world.idx(353, 637), Cell.Ember, 0);
    const blocks = (x: number, y: number) => world.type(Math.round(x), Math.round(y)) === Cell.Metal || world.type(Math.round(x), Math.round(y)) === Cell.Stone;
    const ctx = { world, physics: { cellBlocks: blocks, entityFree: (x: number, y: number, hw: number, h: number) => {
      for (let dx = -hw; dx <= hw; dx++) for (let dy = -h; dy <= 0; dy++) if (blocks(x + dx, y + dy)) return false;
      return true;
    } } } as unknown as Pick<Ctx, 'world' | 'physics'>;
    expect(safeHopClearance(ctx, 330, 639, 366, 40)).toBe(611);
    expect(safeHopClearance(ctx, 330, 639, 366, 24)).toBeNull();
    world.replaceCellAt(world.idx(330, 638), Cell.Ember, 0);
    expect(safeHopClearance(ctx, 330, 639, 366, 40)).toBe(611);
    for (let x = 315; x <= 350; x++) world.replaceCellAt(world.idx(x, 603), Cell.Stone, 0);
    expect(safeHopClearance(ctx, 330, 639, 366, 40)).toBeNull();
  });
  test('retreating along safe ground does not spend levitation on an unnecessary escape jump', () => {
    const self = { player: { firing: false }, input: { keys: {}, mouse: {} } } as BrainSelf;
    const control = new Control(self, { free: () => true }, .8);
    const body = { ...createWorldView().me, x: 600, y: 639, sy: 630, grounded: true, levit: 60 };
    control.observe(body, 100);
    control.startEscape(-1, 12, false);
    control.walkTo(body, 740, { tol: 6 });
    expect(self.input.keys.left).toBe(true);
    expect(self.input.keys.jump).toBe(false);
  });
  test('retries a blocked route within 1.5 seconds instead of standing idle for three', () => {
    const stuck = new StuckDetector(), position = { x: 330, y: 637 };
    stuck.update(position, false, 0);
    let retry = false;
    for (let tick = 1; tick <= 90; tick++) retry ||= stuck.update(position, true, tick, tick);
    expect(retry).toBe(true);
  });
  test('movement and deliberate holds do not cause premature route retries', () => {
    const moving = new StuckDetector(), waiting = new StuckDetector();
    for (let tick = 0; tick < 240; tick++) {
      expect(moving.update({ x: 330 + tick * .2, y: 637 }, true, tick)).toBe(false);
      expect(waiting.update({ x: 330, y: 637 }, false, tick)).toBe(false);
    }
    const firing = new StuckDetector();
    for (let tick = 0; tick < 120; tick++) expect(firing.update({ x: 330, y: 637 }, true, tick, 0)).toBe(false);
  });
});

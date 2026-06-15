import { describe, expect, it } from 'vitest';

import type { LevelRuntime, Mechanism } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { validateFindability } from '@/world/validate';

function runtimeWithRune(blocked: boolean): LevelRuntime {
  const world = new World(32, 32);
  world.types.fill(Cell.Empty);
  if (blocked) {
    for (let y = 1; y < 31; y++) world.types[world.idx(15, y)] = Cell.Stone;
  }
  return {
    def: { id: 'test', name: 'Test', biome: 'earthen', depth: 1, nextLevelId: null },
    world,
    enemies: [],
    waystones: [],
    pickups: [],
    mechanisms: [],
    runeVaults: [{ rx: 18, ry: 16, lit: false }],
    spawn: { x: 8, y: 18 },
    explored: new Uint8Array(world.width * world.height),
    regions: null,
    cauldron: null,
    portal: null,
    keyTaken: false,
  } as unknown as LevelRuntime;
}

function runtimeWithPlug(actuated: boolean): LevelRuntime {
  const world = new World(32, 32);
  world.types.fill(Cell.Empty);
  for (let y = 1; y < 31; y++) world.types[world.idx(15, y)] = Cell.Stone;
  const plug: Mechanism = {
    id: 1,
    kind: 'plug',
    x: 22,
    y: 18,
    w: 4,
    h: 2,
    state: 0,
    targetId: -1,
  };
  const mechanisms: Mechanism[] = [plug];
  if (actuated) {
    mechanisms.push(
      { id: 2, kind: 'relay', x: 9, y: 18, w: 1, h: 1, state: 0, targetId: plug.id },
      { id: 3, kind: 'sensor', x: 8, y: 18, w: 1, h: 1, state: 0, targetId: 2 },
    );
  }
  return {
    def: { id: 'test', name: 'Test', biome: 'earthen', depth: 1, nextLevelId: null },
    world,
    enemies: [],
    waystones: [],
    pickups: [],
    mechanisms,
    runeVaults: [],
    spawn: { x: 8, y: 18 },
    explored: new Uint8Array(world.width * world.height),
    regions: null,
    cauldron: null,
    portal: null,
    keyTaken: false,
  } as unknown as LevelRuntime;
}

describe('findability validation', () => {
  it('requires line of sight for ranged rune interactions', () => {
    const issues = validateFindability(runtimeWithRune(true));

    expect(issues.some((issue) => issue.what === 'rune' && issue.severity === 'error')).toBe(true);
  });

  it('accepts ranged rune interactions with a clear nearby reachable cell', () => {
    const issues = validateFindability(runtimeWithRune(false));

    expect(issues.some((issue) => issue.what === 'rune' && issue.severity === 'error')).toBe(false);
  });

  it('requires line of sight for manual plugs', () => {
    const issues = validateFindability(runtimeWithPlug(false));

    expect(issues.some((issue) => issue.what === 'plug' && issue.severity === 'error')).toBe(true);
  });

  it('lets reachable machine inputs own relay-actuated plug findability', () => {
    const issues = validateFindability(runtimeWithPlug(true));

    expect(issues.some((issue) => issue.what === 'plug' && issue.severity === 'error')).toBe(false);
  });
});

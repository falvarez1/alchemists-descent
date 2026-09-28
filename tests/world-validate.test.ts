import { describe, expect, it } from 'vitest';

import type { LevelRuntime, Mechanism } from '@/core/types';
import { makePickup } from '@/core/pickupDefs';
import { blocksEntity, Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { failOpenFindability, validateFindability } from '@/world/validate';

it('repairs an approach around a protected closed gate to reach its pressure plate', () => {
  const world = new World(128, 96);
  world.types.fill(Cell.Stone);
  for (let y = 42; y < 80; y++) for (let x = 8; x < 120; x++) world.types[world.idx(x, y)] = Cell.Empty;
  const body: Array<[number, number]> = [];
  for (let y = 45; y < 80; y++) for (let x = 50; x < 54; x++) {
    world.types[world.idx(x, y)] = Cell.Metal; body.push([x, y]);
  }
  const plateBody: Array<[number, number]> = [];
  for (let x = 23; x < 30; x++) { world.types[world.idx(x, 79)] = Cell.Metal; plateBody.push([x, 79]); }
  const runtime = { ...runtimeWithRune(false), world, spawn: { x: 96, y: 78 }, runeVaults: [], mechanisms: [
    { id: 1, kind: 'door', x: 50, y: 45, w: 4, h: 35, state: 0, targetId: 0, body },
    { id: 2, kind: 'plate', x: 23, y: 79, w: 7, h: 1, state: 0, targetId: 1, body: plateBody },
  ] } as LevelRuntime;
  expect(validateFindability(runtime).some(issue => issue.what === 'plate' && issue.severity === 'error')).toBe(true);
  const result = failOpenFindability(runtime);
  expect(result.remaining.filter(issue => issue.severity === 'error')).toEqual([]);
  for (const [x, y] of [...body, ...plateBody]) expect(world.type(x, y)).toBe(Cell.Metal);
  expect(runtime.mechanisms.map(mechanism => mechanism.state)).toEqual([0, 0]);
});

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

function runtimeWithSpellLab(blocked: boolean): LevelRuntime {
  const world = new World(40, 40);
  world.types.fill(Cell.Empty);
  if (blocked) {
    for (let y = 1; y < 39; y++) world.types[world.idx(20, y)] = Cell.Stone;
  }
  return {
    def: { id: 'd1', name: 'D1', biome: 'earthen', depth: 1, nextLevelId: 'd2' },
    world,
    enemies: [],
    waystones: [],
    pickups: [],
    mechanisms: [],
    runeVaults: [],
    spawn: { x: 8, y: 24 },
    explored: new Uint8Array(world.width * world.height),
    regions: null,
    cauldron: null,
    portal: null,
    keyTaken: false,
    spellLab: { x: 28, y: 24, rewardX: 28, rewardY: 20 },
  } as unknown as LevelRuntime;
}

function runtimeWithBuriedRewards(): LevelRuntime {
  const world = new World(40, 40);
  world.types.fill(Cell.Empty);
  for (let y = 1; y < 39; y++) world.types[world.idx(20, y)] = Cell.Stone;
  return {
    def: { id: 'test', name: 'Test', biome: 'earthen', depth: 1, nextLevelId: null },
    world,
    enemies: [],
    waystones: [],
    pickups: [
      makePickup('chest', 28, 24),
      makePickup('potion', 29, 24),
      makePickup('goldpile', 30, 24, { amount: 25 }),
    ],
    mechanisms: [],
    runeVaults: [],
    spawn: { x: 8, y: 24 },
    explored: new Uint8Array(world.width * world.height),
    regions: null,
    cauldron: null,
    portal: null,
    keyTaken: false,
  } as unknown as LevelRuntime;
}

function runtimeWithHostVaultArch(blocked: boolean): LevelRuntime {
  const world = new World(72, 56);
  world.types.fill(Cell.Empty);
  if (blocked) {
    for (let y = 1; y < 55; y++) world.types[world.idx(32, y)] = Cell.Stone;
  }
  return {
    def: { id: 'd2', name: 'D2', biome: 'fungal', depth: 2, nextLevelId: 'd3' },
    world,
    enemies: [],
    waystones: [],
    pickups: [],
    mechanisms: [],
    runeVaults: [],
    spawn: { x: 12, y: 30 },
    explored: new Uint8Array(world.width * world.height),
    regions: null,
    cauldron: null,
    portal: null,
    keyTaken: false,
    vaultArch: { x: 54, y: 28, backX: 44, backY: 28, discoverX: 44, discoverY: 28 },
  } as unknown as LevelRuntime;
}

function runtimeWithPrefabBlockedLever(): LevelRuntime {
  const world = new World(72, 56);
  world.types.fill(Cell.Empty);
  for (let y = 1; y < 55; y++) world.types[world.idx(32, y)] = Cell.Stone;
  const lever: Mechanism = {
    id: 1,
    kind: 'lever',
    x: 54,
    y: 30,
    w: 1,
    h: 1,
    state: 0,
    targetId: -1,
    body: [
      [53, 31],
      [54, 31],
      [55, 31],
    ],
  };
  for (const [x, y] of lever.body!) world.types[world.idx(x, y)] = Cell.Metal;
  return {
    def: { id: 'test', name: 'Test', biome: 'earthen', depth: 1, nextLevelId: null },
    world,
    enemies: [],
    waystones: [],
    pickups: [],
    mechanisms: [lever],
    runeVaults: [],
    spawn: { x: 12, y: 30 },
    explored: new Uint8Array(world.width * world.height),
    regions: null,
    cauldron: null,
    portal: null,
    keyTaken: false,
    placedPrefabs: [{ id: 'blocked-machine', x0: 20, y0: 10, x1: 60, y1: 40 }],
  } as unknown as LevelRuntime;
}

function settleSand(world: World, frames: number): void {
  for (let frame = 0; frame < frames; frame++) {
    for (let y = world.height - 2; y >= 1; y--) {
      for (let x = 1; x < world.width - 1; x++) {
        const i = world.idx(x, y);
        if (world.types[i] !== Cell.Sand) continue;
        const below = world.idx(x, y + 1);
        if (world.types[below] === Cell.Empty) world.swap(x, y, x, y + 1);
      }
    }
  }
}

describe('findability validation', () => {
  it('judges a filled counterweight by its feed opening and still rejects a sealed machine', () => {
    const runtime = runtimeWithRune(false), world = runtime.world;
    runtime.runeVaults.length = 0;
    runtime.mechanisms.push({ id: 1, kind: 'counterweight', x: 20, y: 29, w: 9, h: 1,
      state: 1, targetId: -1, zone: { x0: 20, y0: 22, x1: 28, y1: 28 } });
    for (let y = 22; y <= 29; y++) for (let x = 19; x <= 29; x++) {
      world.types[world.idx(x, y)] = x === 19 || x === 29 || y === 29 ? Cell.Metal : Cell.Sand;
    }
    expect(validateFindability(runtime).some(issue => issue.what === 'counterweight')).toBe(false);
    for (let y = 1; y < 31; y++) world.types[world.idx(15, y)] = Cell.Stone;
    expect(validateFindability(runtime)).toContainEqual({ what: 'counterweight', x: 24, y: 20, severity: 'error' });
  });

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

  it('requires D1 Spell Lab markers and rewards to be wizard-reachable', () => {
    expect(
      validateFindability(runtimeWithSpellLab(false)).some((issue) => issue.what.startsWith('spell-lab')),
    ).toBe(false);

    const blocked = validateFindability(runtimeWithSpellLab(true));
    expect(blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ what: 'spell-lab', severity: 'error' }),
        expect.objectContaining({ what: 'spell-lab-reward', severity: 'error' }),
      ]),
    );
  });

  it('reports unreachable non-key pickups as buried treasure diagnostics', () => {
    const issues = validateFindability(runtimeWithBuriedRewards());

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ what: 'chest', severity: 'info' }),
        expect.objectContaining({ what: 'potion', severity: 'info' }),
        expect.objectContaining({ what: 'goldpile', severity: 'info' }),
      ]),
    );
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false);
  });

  it('requires the host-side vault arch tell to be wizard-reachable', () => {
    expect(validateFindability(runtimeWithHostVaultArch(false)).some((issue) => issue.what === 'vault-arch')).toBe(
      false,
    );

    expect(validateFindability(runtimeWithHostVaultArch(true))).toEqual(
      expect.arrayContaining([expect.objectContaining({ what: 'vault-arch', severity: 'error' })]),
    );
  });

  it('carves a fail-open rescue route for hard findability errors', () => {
    const runtime = runtimeWithHostVaultArch(true);
    const result = failOpenFindability(runtime);

    expect(result.repaired).toEqual(
      expect.arrayContaining([expect.objectContaining({ what: 'vault-arch', severity: 'error' })]),
    );
    expect(result.remaining.some((issue) => issue.what === 'vault-arch' && issue.severity === 'error')).toBe(false);
  });

  it('does not turn open air into solid rescue rails', () => {
    const runtime = runtimeWithHostVaultArch(true);
    const world = runtime.world;
    const before = world.types.slice();

    failOpenFindability(runtime);

    let newOpenBlockers = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i] === Cell.Empty && blocksEntity(world.types[i])) newOpenBlockers++;
    }
    expect(newOpenBlockers).toBe(0);
  });

  it('does not erase protected vault arch metal while carving fail-open routes', () => {
    const runtime = runtimeWithHostVaultArch(true);
    const world = runtime.world;
    const arch = runtime.vaultArch!;
    const protectedIndex = world.idx(arch.discoverX!, arch.discoverY!);
    world.types[protectedIndex] = Cell.Metal;

    failOpenFindability(runtime);

    expect(world.types[protectedIndex]).toBe(Cell.Metal);
  });

  it('carves through prefab footprints when required triggers are otherwise unreachable', () => {
    const runtime = runtimeWithPrefabBlockedLever();

    const result = failOpenFindability(runtime);

    expect(result.repaired).toEqual(
      expect.arrayContaining([expect.objectContaining({ what: 'lever', severity: 'error' })]),
    );
    expect(result.remaining.some((issue) => issue.what === 'lever' && issue.severity === 'error')).toBe(false);
    for (const [x, y] of runtime.mechanisms[0]!.body!) {
      expect(runtime.world.types[runtime.world.idx(x, y)]).toBe(Cell.Metal);
    }
  });

  it('keeps fail-open rescue routes reachable after loose material settles', () => {
    const runtime = runtimeWithHostVaultArch(true);
    const world = runtime.world;
    runtime.pickups.push(makePickup('key', 54, 36));
    for (let y = 2; y <= 12; y++) {
      for (let x = 18; x <= 50; x++) {
        world.types[world.idx(x, y)] = Cell.Sand;
      }
    }

    const result = failOpenFindability(runtime);
    settleSand(world, 36);

    expect(result.repaired.some((issue) => issue.what === 'vault-arch')).toBe(true);
    expect(result.repaired.some((issue) => issue.what === 'key')).toBe(true);
    expect(validateFindability(runtime).some((issue) => issue.severity === 'error')).toBe(
      false,
    );
  });
});

import { describe, expect, it } from 'vitest';

import type { LevelRuntime, Mechanism } from '@/core/types';
import { makePickup } from '@/core/pickupDefs';
import { blocksEntity, Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { failOpenFindability, validateFindability } from '@/world/validate';

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

import { describe, expect, it } from 'vitest';

import { createDefaultPostFxSettings } from '@/config/params';
import { LEVELS } from '@/config/worldgraph';
import type { Ctx, GameStateData, LevelDef } from '@/core/types';
import { HEIGHT, WIDTH } from '@/config/constants';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';

/**
 * FULL-generateLevel golden lock. tests/gen-golden.test.ts only hashes
 * `generateCaves` (the bare skeleton); the rest of generateLevel — structures,
 * secrets, prefab placement, gauge-rescue — is otherwise guarded only by the
 * findability audit's 4 seeds (reachability, not exact cells). These hashes lock
 * the EXACT cell-type output of the whole pipeline across several depths/biomes/
 * archetypes, so a "pure refactor" (helper extraction, stage split) that
 * accidentally changes a single cell is caught immediately. A DELIBERATE
 * generation change re-records these AND bumps GEN_VERSION (CLAUDE.md invariant 4).
 *
 * Colors are Math.random paint and deliberately not hashed; cell types are the
 * deterministic contract (this is why restoreLevel can regenerate-from-seed).
 */

const noop = (): undefined => undefined;
function noopSubsystem(): unknown {
  return new Proxy({}, { get: () => noop });
}

function makeCtx(world: World, worldSeed: number): Ctx {
  const state: GameStateData = {
    mode: 'build',
    score: 0,
    frameCount: 0,
    activeInputMode: 'element',
    currentElement: Cell.Sand,
    currentSpell: 'bolt',
    currentBiome: 'earthen',
    brushSize: 6,
    playerSpawned: false,
    worldSeed,
    paused: false,
    postFx: createDefaultPostFxSettings(),
    editorLights: null,
  };
  return {
    world,
    state,
    player: { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2), vx: 0, vy: 0, fx: 0, fy: 0 },
    enemies: [],
    enemyCtl: { spawn: noop },
    events: { emit: noop, on: noop, off: noop },
    audio: noopSubsystem(),
    particles: noopSubsystem(),
    rigidBodies: noopSubsystem(),
    fx: {},
    levels: { current: null },
    sanctum: { open: noop },
  } as unknown as Ctx;
}

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function levelTypeHash(def: LevelDef, seed: number): string {
  return fnv1a(generateLevelState(def, seed).world.types);
}

function generateLevelState(def: LevelDef, seed: number): ReturnType<WorldGen['generateLevel']> & { world: World } {
  const world = new World();
  const gen = new WorldGen();
  const ctx = makeCtx(world, seed);
  ctx.worldgen = gen;
  return { ...gen.generateLevel(ctx, def, seed), world };
}

function cellsNear(world: World, marker: { x: number; y: number }, cell: Cell, radius: number): number {
  let count = 0;
  for (let y = Math.floor(marker.y - radius); y <= Math.floor(marker.y + radius); y++) {
    for (let x = Math.floor(marker.x - radius); x <= Math.floor(marker.x + radius); x++) {
      if (world.inBounds(x, y) && world.types[world.idx(x, y)] === cell) count++;
    }
  }
  return count;
}

function countCellsInRect(world: World, rect: { x0: number; y0: number; x1: number; y1: number }, cells: readonly Cell[]): number {
  const wanted = new Set<number>(cells);
  let count = 0;
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      if (world.inBounds(x, y) && wanted.has(world.types[world.idx(x, y)])) count++;
    }
  }
  return count;
}

function hasEnemyInside(level: ReturnType<typeof generateLevelState>, kind: string, rect: { x0: number; y0: number; x1: number; y1: number }): boolean {
  return level.prefabEnemies.some((e) =>
    e.kind === kind &&
    e.x >= rect.x0 &&
    e.x <= rect.x1 &&
    e.y >= rect.y0 &&
    e.y <= rect.y1,
  );
}

function emptyBottomExitCells(level: ReturnType<typeof generateLevelState>): number {
  const { exit, world } = level;
  let count = 0;
  for (let y = world.height - 6; y < world.height; y++) {
    for (let dx = -exit.halfW; dx <= exit.halfW; dx++) {
      const x = exit.x + dx;
      if (world.inBounds(x, y) && world.types[world.idx(x, y)] === Cell.Empty) count++;
    }
  }
  return count;
}

// Re-recorded for GEN_VERSION 32: signature depths now get real-cell encounter
// lairs for the organic enemy trio, shifting full-level cell output where they land.
const GOLDEN: Array<{ id: keyof typeof LEVELS; seed: number; hash: string }> = [
  { id: 'd1', seed: 1337, hash: 'd9b6b61a' },
  { id: 'd4', seed: 1337, hash: '7f71738f' },
  { id: 'd8', seed: 1337, hash: '7825a71e' },
  { id: 'vault', seed: 1337, hash: '20798ecd' },
  { id: 'd2', seed: 42, hash: '13e28c90' },
];

describe('full generateLevel golden hashes', () => {
  for (const { id, seed, hash } of GOLDEN) {
    it(`${id} @ seed ${seed} reproduces the locked cell-type output`, () => {
      expect(levelTypeHash(LEVELS[id], seed)).toBe(hash);
    });
  }
});

describe('D1 Spell Lab generation', () => {
  for (const seed of [1, 42, 1337]) {
    it(`places all required real-cell teaching stations at seed ${seed}`, () => {
      const level = generateLevelState(LEVELS.d1, seed);
      const lab = level.spellLab;
      expect(lab).toBeTruthy();
      expect(cellsNear(level.world, lab!, Cell.Sand, 28)).toBeGreaterThan(0);
      expect(cellsNear(level.world, lab!, Cell.Wood, 28)).toBeGreaterThan(0);
      expect(cellsNear(level.world, lab!, Cell.Fire, 28)).toBeGreaterThan(0);
      expect(cellsNear(level.world, lab!, Cell.Water, 28)).toBeGreaterThan(0);
      expect(cellsNear(level.world, lab!, Cell.Lava, 28)).toBeGreaterThan(0);
      expect(level.mechanisms.some((m) =>
        m.kind === 'chargelatch' &&
        Math.abs(m.x - lab!.x) < 30 &&
        Math.abs(m.y - lab!.y) < 20,
      )).toBe(true);
      expect(level.pickups.some((p) =>
        !p.taken &&
        p.kind === 'tome' &&
        p.data.card === 'heavy' &&
        Math.abs(p.x - lab!.rewardX) <= 2 &&
        Math.abs(p.y - lab!.rewardY) <= 2,
      )).toBe(true);
    });
  }
});

describe('generated organic encounter lairs', () => {
  const cases = [
    {
      id: 'd2',
      lair: 'encounter-lair-rootloper-grove',
      kind: 'rootloper',
      signature: [Cell.Vines, Cell.Moss, Cell.Fungus, Cell.Glowshroom],
      minCells: 45,
    },
    {
      id: 'd4',
      lair: 'encounter-lair-rillback-pool',
      kind: 'rillback',
      signature: [Cell.Water, Cell.Blood, Cell.Slime],
      minCells: 220,
    },
    {
      id: 'd5',
      lair: 'encounter-lair-rootloper-grove',
      kind: 'rootloper',
      signature: [Cell.Vines, Cell.Moss, Cell.Fungus, Cell.Glowshroom],
      minCells: 45,
    },
    {
      id: 'd6',
      lair: 'encounter-lair-stonemaw-seam',
      kind: 'stonemaw',
      signature: [Cell.RawOre, Cell.Coal],
      minCells: 45,
    },
    {
      id: 'd8',
      lair: 'encounter-lair-stonemaw-seam',
      kind: 'stonemaw',
      signature: [Cell.RawOre, Cell.Coal],
      minCells: 45,
    },
  ] as const;

  for (const seed of [1, 42, 1337]) {
    for (const c of cases) {
      it(`${c.id} @ seed ${seed} places a ${c.kind} lair with real-cell habitat`, () => {
        const level = generateLevelState(LEVELS[c.id], seed);
        const lair = level.placedPrefabs.find((p) => p.id === c.lair);
        expect(lair, `${c.id} ${seed} missing ${c.lair}`).toBeTruthy();
        expect(hasEnemyInside(level, c.kind, lair!)).toBe(true);
        expect(countCellsInRect(level.world, lair!, c.signature)).toBeGreaterThanOrEqual(c.minCells);
        expect(countCellsInRect(level.world, lair!, [Cell.Metal])).toBe(0);
      });
    }
  }
});

describe('D1 bench progression geometry', () => {
  for (const seed of [1, 42, 1337]) {
    it(`places the only Refuge bench near spawn and seals the old bottom shaft at seed ${seed}`, () => {
      const level = generateLevelState(LEVELS.d1, seed);
      expect(level.refuge).toBeTruthy();
      const refuge = level.refuge!;
      const dist = Math.hypot(refuge.x - level.spawn.x, refuge.y - level.spawn.y);
      expect(dist).toBeLessThanOrEqual(150);
      expect(emptyBottomExitCells(level)).toBe(0);
    });
  }

  it('does not place recurring Refuge benches below D1', () => {
    for (const id of ['d2', 'd4', 'd8', 'vault'] as const) {
      expect(generateLevelState(LEVELS[id], 1337).refuge).toBeNull();
    }
  });
});

describe('D1 Noita-style surface intro', () => {
  for (const seed of [1, 42, 1337]) {
    it(`starts the wizard on a daylit surface above an open cave mouth at seed ${seed}`, () => {
      const level = generateLevelState(LEVELS.d1, seed);
      expect(level.surfaceSpawn).toBeTruthy();
      const surf = level.surfaceSpawn!;
      const W = level.world.width;
      // The surface start sits well above the cave spawn chamber.
      expect(surf.y).toBeLessThan(level.spawn.y - 40);
      // Open daylight sky directly overhead — the wizard begins outdoors.
      expect(level.world.types[surf.x + (surf.y - 24) * W]).toBe(Cell.Empty);
      expect(level.world.types[surf.x + (surf.y - 60) * W]).toBe(Cell.Empty);
      // The wizard stands on solid ground.
      expect(level.world.types[surf.x + (surf.y + 1) * W]).not.toBe(Cell.Empty);
      // The cave mouth: a mostly-open shaft from the surface down to the spawn.
      let open = 0;
      const top = level.spawn.y - 80;
      for (let y = top; y < level.spawn.y; y++) {
        if (level.world.types[level.spawn.x + y * W] === Cell.Empty) open++;
      }
      expect(open).toBeGreaterThan((level.spawn.y - top) * 0.5);
    });
  }

  it('only caps D1 with a surface — deeper levels have none', () => {
    for (const id of ['d2', 'd4', 'd8', 'vault'] as const) {
      expect(generateLevelState(LEVELS[id], 1337).surfaceSpawn).toBeNull();
    }
  });
});

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

// Re-recorded for GEN_VERSION 30: the open strip below the caves is packed to solid
// rock (terrain runs all the way down to the bedrock), shifting cell types on every seed.
const GOLDEN: Array<{ id: keyof typeof LEVELS; seed: number; hash: string }> = [
  { id: 'd1', seed: 1337, hash: '2d066867' },
  { id: 'd4', seed: 1337, hash: 'e061b436' },
  { id: 'd8', seed: 1337, hash: '85cbff75' },
  { id: 'vault', seed: 1337, hash: '20798ecd' },
  { id: 'd2', seed: 42, hash: '94bc3274' },
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

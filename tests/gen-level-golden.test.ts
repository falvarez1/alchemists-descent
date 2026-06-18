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
  const world = new World();
  const gen = new WorldGen();
  const ctx = makeCtx(world, seed);
  ctx.worldgen = gen;
  gen.generateLevel(ctx, def, seed);
  return fnv1a(ctx.world.types);
}

// Re-recorded for GEN_VERSION 26: living walk-through ground cover (grass +
// glowshroom/fungus tufts) is planted on moss-crown walk surfaces in generateCaves
// (world/surfaceDress.plantGroundCover), shifting cell types on those levels. d8
// and vault are UNCHANGED — their biomes aren't moss-crowned / skip the polish
// block, so no cover is planted. (v25 was noiseDensity 0.66 + the solidifyRock close.)
const GOLDEN: Array<{ id: keyof typeof LEVELS; seed: number; hash: string }> = [
  { id: 'd1', seed: 1337, hash: '4c7570c1' },
  { id: 'd4', seed: 1337, hash: 'ea181c61' },
  { id: 'd8', seed: 1337, hash: '7f87cbd4' },
  { id: 'vault', seed: 1337, hash: '36b10aba' },
  { id: 'd2', seed: 42, hash: '96da8a86' },
];

describe('full generateLevel golden hashes', () => {
  for (const { id, seed, hash } of GOLDEN) {
    it(`${id} @ seed ${seed} reproduces the locked cell-type output`, () => {
      expect(levelTypeHash(LEVELS[id], seed)).toBe(hash);
    });
  }
});

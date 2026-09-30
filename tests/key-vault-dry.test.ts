import { describe, expect, it } from 'vitest';

import { createDefaultPostFxSettings } from '@/config/params';
import { HEIGHT, WIDTH } from '@/config/constants';
import { LEVELS } from '@/config/worldgraph';
import type { Ctx, GameStateData, LevelDef } from '@/core/types';
import { Cell, isLiquid } from '@/sim/CellType';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';
import { makeLevelRuntime } from '@/game/runtime';
import { extractRegionGraph } from '@/world/regions';
import { validateFindability } from '@/world/validate';

/**
 * THE GOLDEN KEY NEVER RESTS IN THE SEA (GEN 62). A flooded floor's liquid counts as open, so its
 * one giant region had its centroid in the water and the key went to the world floor on most
 * seeds (d3 seed 7: (795, 1055), a dive down a slit 500 deep and a swim back). A pick in a sea is
 * swapped for the farthest dry body-fit cell; the vault pocket carved there stays dry.
 */

const noop = (): undefined => undefined;
const noopSubsystem = (): unknown => new Proxy({}, { get: () => noop });

function generate(def: LevelDef, seed: number) {
  const world = new World();
  const gen = new WorldGen();
  const state: GameStateData = {
    mode: 'build', score: 0, frameCount: 0, activeInputMode: 'element', currentElement: Cell.Sand, currentSpell: 'bolt',
    currentBiome: 'earthen', brushSize: 6, playerSpawned: false, worldSeed: seed, paused: false, postFx: createDefaultPostFxSettings(), editorLights: null,
  };
  const ctx = {
    world, state, player: { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2), vx: 0, vy: 0, fx: 0, fy: 0 },
    enemies: [], enemyCtl: { spawn: noop }, events: { emit: noop, on: noop, off: noop }, audio: noopSubsystem(), particles: noopSubsystem(),
    rigidBodies: noopSubsystem(), fx: {}, levels: { current: null }, sanctum: { open: noop },
  } as unknown as Ctx;
  ctx.worldgen = gen;
  const out = gen.generateLevel(ctx, def, seed);
  const runtime = makeLevelRuntime({
    def, world, spawn: out.spawn, regions: extractRegionGraph(world, out.spawn, { x: out.exit.x, y: out.exit.sealY - 12 }),
    waystones: out.waystones, exit: out.exit, cauldron: out.cauldron, pickups: out.pickups, portal: out.portal, mechanisms: out.mechanisms,
    runeVaults: out.runeVaults, boss: out.boss, placedPrefabs: out.placedPrefabs,
  });
  return { world, out, runtime };
}

describe('the golden key of a flooded floor', () => {
  for (const seed of [7, 42]) {
    it(`d3 @ seed ${seed}: dry ground in the upper floor, findable`, () => {
      const { world, out, runtime } = generate(LEVELS.d3, seed);
      const key = out.pickups.find((p) => p.kind === 'key');
      expect(key, 'the floor has its key').toBeTruthy();
      if (!key) return;
      expect(key.y, 'not on the world floor').toBeLessThan(HEIGHT * 0.85);
      let liquid = 0;
      for (let dy = -24; dy <= 24; dy += 2) {
        for (let dx = -24; dx <= 24; dx += 2) {
          if (world.inBounds(Math.floor(key.x) + dx, Math.floor(key.y) + dy) && isLiquid(world.types[world.idx(Math.floor(key.x) + dx, Math.floor(key.y) + dy)])) liquid++;
        }
      }
      expect(liquid, 'liquid cells within 24 of the key').toBe(0);
      expect(validateFindability(runtime).filter((i) => i.severity === 'error' && i.what === 'key')).toEqual([]);
    }, 90000);
  }
});

import { describe, expect, it } from 'vitest';

import { createDefaultPostFxSettings } from '@/config/params';
import { HEIGHT, WIDTH } from '@/config/constants';
import { LEVELS } from '@/config/worldgraph';
import type { Ctx, GameStateData, LevelDef } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';
import { makeLevelRuntime } from '@/game/runtime';
import { extractRegionGraph } from '@/world/regions';
import { validateFindability } from '@/world/validate';

/**
 * LAVA LAKES (GEN 62, world/lavaLakes): the Kiln Heart's molten lakes are carved halls and
 * natural basins, CONTAINED by construction — and only that floor has them.
 */

const noop = (): undefined => undefined;
const noopSubsystem = (): unknown => new Proxy({}, { get: () => noop });

function makeCtx(world: World, worldSeed: number): Ctx {
  const state: GameStateData = {
    mode: 'build', score: 0, frameCount: 0, activeInputMode: 'element', currentElement: Cell.Sand, currentSpell: 'bolt',
    currentBiome: 'earthen', brushSize: 6, playerSpawned: false, worldSeed, paused: false, postFx: createDefaultPostFxSettings(), editorLights: null,
  };
  return {
    world, state, player: { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2), vx: 0, vy: 0, fx: 0, fy: 0 },
    enemies: [], enemyCtl: { spawn: noop }, events: { emit: noop, on: noop, off: noop }, audio: noopSubsystem(), particles: noopSubsystem(),
    rigidBodies: noopSubsystem(), fx: {}, levels: { current: null }, sanctum: { open: noop },
  } as unknown as Ctx;
}

function generate(def: LevelDef, seed: number) {
  const world = new World();
  const gen = new WorldGen();
  const ctx = makeCtx(world, seed);
  ctx.worldgen = gen;
  const out = gen.generateLevel(ctx, def, seed);
  const runtime = makeLevelRuntime({
    def, world, spawn: out.spawn, regions: extractRegionGraph(world, out.spawn, { x: out.exit.x, y: out.exit.sealY - 12 }),
    waystones: out.waystones, exit: out.exit, cauldron: out.cauldron, pickups: out.pickups, portal: out.portal, mechanisms: out.mechanisms,
    runeVaults: out.runeVaults, boss: out.boss, placedPrefabs: out.placedPrefabs, ...(out.story ? { story: out.story } : {}),
  });
  return { world, out, gen, runtime };
}

/** What may touch a lake's lava beside or below it (world/lavaLakes STATIC). */
const STATIC = new Set<number>([Cell.Wall, Cell.Stone, Cell.Metal, Cell.Crystal, Cell.Glass, Cell.RawOre, Cell.Mirror, Cell.Lava]);

describe('the Kiln Heart lava lakes', () => {
  for (const seed of [1337, 5, 42]) {
    it(`d4 @ seed ${seed}: a volcanic floor, every lake contained, the hall findable`, () => {
      const { world, gen, out, runtime } = generate(LEVELS.d4, seed);
      const lakes = gen.lastLavaLakes;
      expect(lakes, 'the volcanic floor has its lakes').toBeTruthy();
      if (!lakes) return;
      expect(lakes.lakes.length).toBeGreaterThanOrEqual(5);
      expect(lakes.dropped, 'no lake cost a route').toBe(0);
      let lava = 0;
      for (let i = 0; i < world.types.length; i++) if (world.types[i] === Cell.Lava) lava++;
      // (GEN 65: the Crucible's gatehouse reserves ground the lakes would take - seed 5 holds 7.9K, was 12.5K; ten surveyed seeds run 7.9-18K)
      expect(lava, 'lava cells (was 1.3-2.0K before GEN 62)').toBeGreaterThan(7000);
      // Contained: beside or below a lake's lava, at or under its surface, only static rock.
      let leaks = 0;
      for (const lake of lakes.lakes) {
        for (let y = lake.surfaceY; y <= lake.y1 + 2; y++) {
          for (let x = lake.x0 - 2; x <= lake.x1 + 2; x++) {
            if (world.types[world.idx(x, y)] !== Cell.Lava) continue;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1]] as const) {
              if (!STATIC.has(world.types[world.idx(x + dx, y + dy)])) leaks++;
            }
          }
        }
      }
      expect(leaks, 'lava cells with an open or loose neighbour beside/below').toBe(0);
      // The lakes are placed rooms (repair routes walk around them).
      expect(out.placedPrefabs.filter((p) => p.id.startsWith('encounter-lair-lava-')).length).toBe(lakes.lakes.length);
      // The boss hall is walkable to, and nothing the player must reach was cut off.
      const errors = validateFindability(runtime).filter((i) => i.severity === 'error');
      expect(errors.filter((e) => e.what === 'boss-arena')).toEqual([]);
    }, 90000);
  }

  it('the other floors never reach the pass (no budget, no lake, no lava prefab)', () => {
    const { gen, out } = generate(LEVELS.d2, 42);
    expect(gen.lastLavaLakes).toBeNull();
    expect(out.placedPrefabs.filter((p) => p.id.startsWith('encounter-lair-lava-'))).toEqual([]);
  }, 90000);
});

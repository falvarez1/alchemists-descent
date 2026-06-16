import { describe, expect, it } from 'vitest';

import { HEIGHT, WIDTH } from '@/config/constants';
import { createDefaultPostFxSettings } from '@/config/params';
import { LEVELS } from '@/config/worldgraph';
import type { AuthoredLight, Ctx, GameStateData, LevelDef } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';

// generateLevel runs the full build (caves + structures + prefab placement). Placement reaches
// a few extra subsystems (player/enemies for crush-safety, audio/particles/events on some
// objects). The stub just has to not crash AND be identical across calls so determinism holds;
// its concrete values never feed the seeded RNG that authors the lights.
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

function generateLevelLights(def: LevelDef, seed: number): AuthoredLight[] {
  const world = new World();
  const gen = new WorldGen();
  const ctx = makeCtx(world, seed);
  ctx.worldgen = gen;
  return gen.generateLevel(ctx, def, seed).authoredLights;
}

describe('campaign generated-light restore parity', () => {
  // Restore does NOT serialize authored lights: restoreLevel regenerates the pristine level
  // from seed and takes pristine.authoredLights, then overlays saved cell mutations
  // (src/game/Levels.ts). So restore parity for lights == light-generation determinism.
  // worldgen.test already covers cell-color restore; this covers the lights it doesn't.
  // generateLevel is ~3s, so share three generations across the assertions below.
  const fresh = generateLevelLights(LEVELS.d1, 1337);
  const restored = generateLevelLights(LEVELS.d1, 1337); // restoreLevel's regenerate-from-seed step
  const otherSeed = generateLevelLights(LEVELS.d1, 99999);

  it('authors lights at all (so the determinism check is not vacuous)', () => {
    expect(fresh.length).toBeGreaterThan(0);
  });

  it('regenerates authored lights identically for the same level + seed', () => {
    // Every authored light (color/intensity/radius/bloom/flicker/position) must come back
    // byte-for-byte, or a resumed expedition renders dimmer/different than the fresh run.
    expect(restored).toEqual(fresh);
  });

  it('produces different authored lights for a different seed (lights track generation)', () => {
    expect(otherSeed).not.toEqual(fresh);
  });
});

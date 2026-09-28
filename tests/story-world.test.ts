import { describe, expect, it } from 'vitest';

import { createDefaultPostFxSettings } from '@/config/params';
import { LEVELS } from '@/config/worldgraph';
import { HEIGHT, WIDTH } from '@/config/constants';
import type { Ctx, GameStateData, LevelDef } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';
import { makeLevelRuntime } from '@/game/runtime';
import { extractRegionGraph } from '@/world/regions';
import { validateFindability, wizardMask } from '@/world/validate';
import { openKilnFlue, resetKilnFlue } from '@/world/kilnFlue';
import { standable } from '@/world/storySites';

/**
 * STORY WORLD (wave 3 WS-S): the story's sites are findable by construction,
 * and the Kiln escape's route is clean — once the heave blows the damper, a
 * full-size alchemist can get from the Colossus's floor to the hatch on every
 * seed, and a restart puts the climb back exactly as it was generated.
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
    runeVaults: out.runeVaults, boss: out.boss, ...(out.story ? { story: out.story } : {}),
  });
  return { world, out, runtime };
}

const near = (mask: Uint8Array, x: number, y: number, r: number): boolean => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const X = Math.round(x + dx), Y = Math.round(y + dy);
    if (X > 0 && Y > 0 && X < WIDTH && Y < HEIGHT && mask[X + Y * WIDTH]) return true;
  }
  return false;
};

describe('the Kiln escape route', () => {
  for (const seed of [1337, 5, 42]) {
    it(`seed ${seed}: sealed before the heave, clean from the Kiln floor to the hatch after it, and restorable`, () => {
      const { world, out } = generate(LEVELS.d4, seed);
      const flue = out.story?.flue;
      expect(flue, 'the Kiln has its flue').toBeTruthy();
      if (!flue) return;
      const boss = out.boss!;
      // The damper is metal until the heave: the fight cannot be sniped from the ledges.
      for (let y = flue.damper.y0; y <= flue.damper.y1; y++) for (let x = flue.damper.x0; x <= flue.damper.x1; x++) {
        expect(world.types[world.idx(x, y)], `damper ${x},${y}`).toBe(Cell.Metal);
      }
      expect(flue.ledges.length).toBeGreaterThanOrEqual(7);
      // Every ledge is a place to stand.
      for (const l of flue.ledges) expect(standable(world, Math.round((l.x0 + l.x1) / 2), l.y0 - 1), `ledge at ${l.y0}`).toBe(true);
      // The heave: the route from the boss's floor to the hatch is walkable (9x17, levitation for vertical runs).
      openKilnFlue(world, flue);
      const mask = wizardMask({ world, spawn: { x: boss.x - 20, y: boss.y } });
      expect(near(mask, flue.start.x, flue.start.y, 6), 'the foot of the flue').toBe(true);
      expect(near(mask, flue.exit.x, flue.exit.y, 6), 'the hatch landing').toBe(true);
      // A restart after the climb spoiled it (lava, cooled stone, sand) puts it back exactly.
      const ledge = flue.ledges[2];
      for (let x = flue.shaft.x0; x <= flue.shaft.x1; x++) world.replaceCellAt(world.idx(x, ledge.y0 - 4), Cell.Stone, 0x444444);
      for (let x = ledge.x0; x <= ledge.x1; x++) world.clearCellAt(world.idx(x, ledge.y0));
      resetKilnFlue(world, flue);
      const again = wizardMask({ world, spawn: { x: flue.start.x, y: flue.start.y } });
      expect(near(again, flue.exit.x, flue.exit.y, 6), 'restored climb').toBe(true);
      expect(world.types[world.idx(ledge.x0 + 2, ledge.y0)]).toBe(Cell.Stone);
    }, 60000);
  }
});

describe('story sites', () => {
  it('floor 1: six named pipes on standable floor, Pell at the Warm Refuge, the valve in its nook — all findable', () => {
    const { runtime, out } = generate(LEVELS.d1, 1337);
    const st = out.story!;
    expect(st.pipes.map(p => p.id)).toEqual(['intake', 'sluice', 'gallery', 'refuge', 'undertow', 'bell']);
    for (const p of st.pipes) expect(standable(runtime.world, p.x, p.floorY), p.id).toBe(true);
    expect(st.camp && Math.abs(st.camp.x - 1004) < 30).toBe(true);
    expect(validateFindability(runtime).filter(i => i.what.startsWith('story'))).toEqual([]);
  }, 30000);

  for (const id of ['d2', 'd3'] as const) {
    it(`${id}: pipes near the arrival, a camp and a valve, all findable at generation`, () => {
      const { runtime, out } = generate(LEVELS[id], 42);
      const st = out.story!;
      expect(st.pipes.length).toBeGreaterThanOrEqual(1);
      expect(st.camp).toBeTruthy();
      expect(st.valve).toBeTruthy();
      expect(validateFindability(runtime).filter(i => i.what.startsWith('story') && i.severity === 'error')).toEqual([]);
    }, 60000);
  }
});

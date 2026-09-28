import { describe, expect, it } from 'vitest';

import { HEIGHT, WIDTH } from '@/config/constants';
import { createDefaultPostFxSettings } from '@/config/params';
import { LEVELS } from '@/config/worldgraph';
import type { Ctx, GameStateData } from '@/core/types';
import { fnv1aString } from '@/core/rng';
import { Cell, isSoftGrowth, isSolid } from '@/sim/CellType';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';

/**
 * Encounter lairs are SEALED features (GEN 55): every tunnel carved after one
 * exists walks around it, and the Rillback pool re-asserts after the rescues.
 * Each case below is an expedition whose later passes used to cut straight
 * through its lair (GEN 54 cell counts in the comments). Seeds are the RUNTIME
 * level seeds, exactly what Levels.createLevel feeds the generator.
 */

const noop = (): undefined => undefined;
const noopSubsystem = (): unknown => new Proxy({}, { get: () => noop });

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

function generate(id: keyof typeof LEVELS, expeditionSeed: number): { world: World; lairs: ReturnType<WorldGen['generateLevel']>['placedPrefabs'] } {
  const seed = (expeditionSeed ^ fnv1aString(id)) >>> 0;
  const world = new World();
  const gen = new WorldGen();
  const ctx = makeCtx(world, seed);
  ctx.worldgen = gen;
  const level = gen.generateLevel(ctx, LEVELS[id], seed);
  return { world, lairs: level.placedPrefabs.filter((p) => p.id.startsWith('encounter-lair-')) };
}

function count(world: World, rect: { x0: number; y0: number; x1: number; y1: number }, cells: readonly Cell[]): number {
  const wanted = new Set<number>(cells);
  let n = 0;
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) if (wanted.has(world.types[world.idx(x, y)])) n++;
  }
  return n;
}

const POOL = [Cell.Water, Cell.Blood, Cell.Slime];
const GROVE = [Cell.Vines, Cell.Moss, Cell.Fungus, Cell.Glowshroom];

describe('encounter lairs survive the tunnels carved after them', () => {
  const cases = [
    // GEN 54: a flora-room connector drained the pool, 577 -> 3.
    { id: 'd3', exp: 3, lair: 'encounter-lair-rillback-pool', cells: POOL, min: 500 },
    // GEN 54: a gauge-rescue tunnel cut the pool in half, 589 -> 383.
    { id: 'd3', exp: 20, lair: 'encounter-lair-rillback-pool', cells: POOL, min: 500 },
    // GEN 54: a flora-room connector took all of it, 574 -> 0.
    { id: 'd3', exp: 27, lair: 'encounter-lair-rillback-pool', cells: POOL, min: 500 },
    // GEN 54: a flora-room connector bored out the ore seam, 186 -> 38 (under the audit's 45).
    // GEN 58 (the Kiln's flue moved the lair): the lair's OWN connector climbed through it, 175 -> 121.
    { id: 'd4', exp: 21, lair: 'encounter-lair-stonemaw-seam', cells: [Cell.RawOre, Cell.Coal], min: 170 },
    // GEN 58: a story nook's connector ENDED on a floor inside the grove (a tunnel is never kept
    // out of the room it ends in) and cut the grove's west wall and floor, 142 -> 130 and 92 -> 85.
    { id: 'd2', exp: 10, lair: 'encounter-lair-rootloper-grove', cells: GROVE, min: 140 },
    { id: 'd2', exp: 24, lair: 'encounter-lair-rootloper-grove', cells: GROVE, min: 90 },
  ] as const;
  for (const c of cases) {
    it(`${c.id} expedition ${c.exp} keeps its ${c.lair.replace('encounter-lair-', '')}`, () => {
      const { world, lairs } = generate(c.id, c.exp);
      const lair = lairs.find((p) => p.id === c.lair);
      expect(lair, 'lair placed').toBeTruthy();
      expect(count(world, lair!, c.cells)).toBeGreaterThanOrEqual(c.min);
    });
  }
});

describe("a stonemaw's own connector leaves its seam whole", () => {
  // A tunnel is never kept out of the room it starts in, so the lair's own
  // connector was free to bore through the seam on its way out: at GEN 58 it
  // cut 5-68 ore/coal cells on 20 of 32 surveyed seeds. The seam (its band, the
  // flecks above it, the floor under it) is now the lair's ORGAN, which its own
  // connectors walk around. These four were among the worst (47-68 cells each).
  for (const exp of [4, 14, 21, 26]) {
    it(`d4 expedition ${exp}`, () => {
      const { world, lairs } = generate('d4', exp);
      const lair = lairs.find((p) => p.id === 'encounter-lair-stonemaw-seam');
      expect(lair, 'lair placed').toBeTruthy();
      const floorY = lair!.y1 + 1 - 10;
      const seam = { x0: lair!.x1 - 25, y0: lair!.y0 + 9, x1: lair!.x1 - 7, y1: floorY + 4 };
      expect(count(world, seam, [Cell.RawOre, Cell.Coal])).toBeGreaterThanOrEqual(170);
    });
  }
});

describe('grove vines hang from real rock', () => {
  // A vine cell holds only under another vine or beside load-bearing rock
  // (sim/elements/vines); one stamped in the air detaches on the first sim
  // step. Half a second into a visit the d2 seed-5 grove kept 2 to 63 of its
  // 105 vine cells that way, a different number every time.
  for (const exp of [1, 5, 42]) {
    it(`d2 expedition ${exp}: every vine in the grove is anchored`, () => {
      const { world, lairs } = generate('d2', exp);
      const grove = lairs.find((p) => p.id === 'encounter-lair-rootloper-grove');
      expect(grove, 'grove placed').toBeTruthy();
      const anchor = (x: number, y: number): boolean => {
        const t = world.types[world.idx(x, y)];
        return isSolid(t) && !isSoftGrowth(t);
      };
      let vines = 0;
      const loose: string[] = [];
      for (let y = grove!.y0; y <= grove!.y1; y++) {
        for (let x = grove!.x0; x <= grove!.x1; x++) {
          if (world.types[world.idx(x, y)] !== Cell.Vines) continue;
          vines++;
          const held = world.types[world.idx(x, y - 1)] === Cell.Vines ||
            anchor(x, y - 1) || anchor(x, y + 1) || anchor(x - 1, y) || anchor(x + 1, y);
          if (!held) loose.push(`${x},${y}`);
        }
      }
      expect(vines).toBeGreaterThan(20);
      expect(loose).toEqual([]);
    });
  }
});

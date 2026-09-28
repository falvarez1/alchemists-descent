import { describe, expect, it } from 'vitest';

import { createDefaultPostFxSettings } from '@/config/params';
import { LEVELS } from '@/config/worldgraph';
import type { Ctx, GameStateData, LevelDef } from '@/core/types';
import { HEIGHT, WIDTH } from '@/config/constants';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';
import { makeLevelRuntime } from '@/game/runtime';
import { validateFindability } from '@/world/validate';
import { ICE_HOUSE, LENS_ROOM } from '@/world/wardenArenas';

/**
 * THE SECOND DOORS (wave 3) generate deterministically, with their set pieces:
 * the Cold Store (d2b) — the Frozen Fall, the Ice Vault, the Rime Warden's
 * Ice-House with its coal pits and brine gutters — and the Glass Galleries
 * (d3b) — the Periscope and the Prism Gate (lenses judged at their optics'
 * ports), the Lenswright's Lens Room with its silvered panels. The full
 * pipeline's cell types are locked here as the spine floors' are in
 * tests/gen-level-golden.test.ts (a deliberate change re-records these AND
 * bumps GEN_VERSION), and the findability audit passes — the story's pipes,
 * camp and valve included.
 */

const noop = (): undefined => undefined;
function noopSubsystem(): unknown {
  return new Proxy({}, { get: () => noop });
}

function makeCtx(world: World, worldSeed: number): Ctx {
  const state: GameStateData = {
    mode: 'build', score: 0, frameCount: 0, activeInputMode: 'element', currentElement: Cell.Sand, currentSpell: 'bolt',
    currentBiome: 'earthen', brushSize: 6, playerSpawned: false, worldSeed, paused: false,
    postFx: createDefaultPostFxSettings(), editorLights: null,
  };
  return {
    world, state,
    player: { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2), vx: 0, vy: 0, fx: 0, fy: 0 },
    enemies: [], enemyCtl: { spawn: noop }, events: { emit: noop, on: noop, off: noop },
    audio: noopSubsystem(), particles: noopSubsystem(), rigidBodies: noopSubsystem(), fx: {},
    levels: { current: null }, sanctum: { open: noop },
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

function generate(def: LevelDef, seed: number): ReturnType<WorldGen['generateLevel']> & { world: World } {
  const world = new World();
  const gen = new WorldGen();
  const ctx = makeCtx(world, seed);
  ctx.worldgen = gen;
  return { ...gen.generateLevel(ctx, def, seed), world };
}

function count(world: World, x0: number, y0: number, x1: number, y1: number, cell: Cell): number {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (world.inBounds(x, y) && world.types[world.idx(x, y)] === cell) n++;
  return n;
}

/** GEN_VERSION 57: the Ice-House and the Glass Galleries (galleries skeleton, light rooms, dressing, the Lens Room), with the story's camp and valve nooks. */
const GOLDEN: Array<{ id: 'd2b' | 'd3b'; seed: number; hash: string }> = [
  { id: 'd2b', seed: 1337, hash: 'a7525099' }, // GEN_VERSION 58: late tunnels also route around the second doors' rooms (lair fix + biomes)
  { id: 'd3b', seed: 1337, hash: 'dc94f5bc' }, // GEN_VERSION 58: as d2b
];

describe('the second doors: golden hashes', () => {
  for (const { id, seed, hash } of GOLDEN) {
    it(`${id} @ seed ${seed} reproduces the locked cell-type output`, () => {
      const a = fnv1a(generate(LEVELS[id], seed).world.types);
      const b = fnv1a(generate(LEVELS[id], seed).world.types);
      expect(b).toBe(a);
      expect(a).toBe(hash);
    });
  }
});

describe('the Cold Store (d2b) builds its set pieces', () => {
  for (const seed of [7, 1337]) {
    it(`seed ${seed}: the Frozen Fall, the Ice Vault and the Ice-House`, () => {
      const level = generate(LEVELS.d2b, seed);
      const ids = level.placedPrefabs.map((p) => p.id);
      expect(ids).toContain('cold-frozen-fall');
      expect(ids).toContain('cold-ice-vault');
      expect(level.boss?.kind).toBe('rimewarden');
      const b = level.boss!;
      // The coal pits and brine gutters sunk in its floor.
      const FY = b.y + 1;
      expect(count(level.world, b.x - ICE_HOUSE.P1, FY, b.x + ICE_HOUSE.P1, FY + 2, Cell.Coal)).toBeGreaterThanOrEqual(36);
      expect(count(level.world, b.x - ICE_HOUSE.G1, FY, b.x + ICE_HOUSE.G1, FY + 2, Cell.Brine)).toBeGreaterThanOrEqual(48);
      // Headroom over the post (nothing hangs lower than it is tall).
      let head = 0;
      while (head < 60 && level.world.types[level.world.idx(b.x, b.y - head)] === Cell.Empty) head++;
      expect(head).toBeGreaterThanOrEqual(36);
    });
  }
});

describe('the Glass Galleries (d3b) builds its set pieces', () => {
  for (const seed of [7, 1337]) {
    it(`seed ${seed}: the Periscope, the Prism Gate and the Lens Room`, () => {
      const level = generate(LEVELS.d3b, seed);
      const ids = level.placedPrefabs.map((p) => p.id);
      expect(ids).toContain('glass-periscope');
      expect(ids).toContain('glass-prism-gate');
      // Three lenses sealed behind optics, each judged at its port.
      const lenses = level.mechanisms.filter((m) => m.kind === 'sensor' && m.sensorType === 'light' && m.lightPort);
      expect(lenses.length).toBe(3);
      const twins = lenses.filter((m) => m.latch === 'timed');
      expect(twins.length).toBe(2);
      expect(twins[0].targetId).toBe(twins[1].targetId);
      // The Lenswright's gallery: it hangs over the floor, silvered panels in the vault.
      expect(level.boss?.kind).toBe('lenswright');
      const b = level.boss!;
      const FY = b.y + 1 + LENS_ROOM.HOVER;
      expect(count(level.world, b.x - LENS_ROOM.HALF, FY, b.x + LENS_ROOM.HALF, FY, Cell.Stone)).toBeGreaterThanOrEqual(108);
      expect(count(level.world, b.x - LENS_ROOM.RX - 6, b.y - 50, b.x + LENS_ROOM.RX + 6, FY, Cell.Mirror)).toBeGreaterThanOrEqual(24);
      // The dressing: silvered panels and glass all over the galleries.
      expect(count(level.world, 0, 0, WIDTH - 1, HEIGHT - 1, Cell.Mirror)).toBeGreaterThan(150);
      expect(count(level.world, 0, 0, WIDTH - 1, HEIGHT - 1, Cell.Glass)).toBeGreaterThan(150);
    });
  }
});

describe('the second doors pass the findability audit', () => {
  for (const id of ['d2b', 'd3b'] as const) {
    for (const seed of [3, 7]) {
      it(`${id} @ seed ${seed}`, () => {
        const level = generate(LEVELS[id], seed);
        const runtime = makeLevelRuntime({
          def: LEVELS[id], world: level.world, spawn: level.spawn, regions: null, mechanisms: level.mechanisms,
          pickups: level.pickups, waystones: level.waystones, runeVaults: level.runeVaults, exit: level.exit,
          portal: level.portal, cauldron: level.cauldron, refuge: level.refuge ?? undefined, spellLab: level.spellLab ?? undefined,
          vaultArch: level.vaultArch ?? undefined, boss: level.boss ?? undefined, ...(level.story ? { story: level.story } : {}),
        });
        expect(validateFindability(runtime).filter((issue) => issue.severity === 'error')).toEqual([]);
        // The story's sites land on these floors too: pipes near the arrival, Pell's camp, the valve.
        expect(level.story?.pipes.length ?? 0).toBeGreaterThanOrEqual(1);
        expect(level.story?.camp).toBeTruthy();
        expect(level.story?.valve).toBeTruthy();
      });
    }
  }
});

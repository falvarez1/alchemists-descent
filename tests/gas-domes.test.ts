import { describe, expect, it } from 'vitest';

import { HEIGHT, WIDTH } from '@/config/constants';
import { createDefaultPostFxSettings } from '@/config/params';
import { GEN } from '@/config/gen';
import { LEVELS } from '@/config/worldgraph';
import type { Ctx, GameStateData, LevelDef } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';
import { goldPocketBudgetForBiome } from '@/world/biomeExtras';

/**
 * GAS DOMES (GEN 62, world/biomeExtras) and GOLD FLECKS (config/gen goldPockets): the marsh floors hold a
 * few real lamps of gas under their biggest ceilings, away from every bowl, and the campaign floors carry
 * about half the gold flecks they did.
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
  return { world, out: gen.generateLevel(ctx, def, seed) };
}

/** Sizes of the 4-connected masses of marsh gas. */
function gasMasses(world: World): Array<{ cells: number; x: number; y: number }> {
  const seen = new Uint8Array(world.types.length);
  const masses: Array<{ cells: number; x: number; y: number }> = [];
  for (let i = 0; i < world.types.length; i++) {
    if (world.types[i] !== Cell.MarshGas || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let cells = 0, sx = 0, sy = 0;
    while (stack.length > 0) {
      const c = stack.pop() as number;
      cells++;
      const x = c % WIDTH, y = (c / WIDTH) | 0;
      sx += x;
      sy += y;
      for (const n of [c + 1, c - 1, c + WIDTH, c - WIDTH]) {
        if (n >= 0 && n < world.types.length && world.types[n] === Cell.MarshGas && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    masses.push({ cells, x: sx / cells, y: sy / cells });
  }
  return masses.sort((a, b) => b.cells - a.cells);
}

describe('gas domes', () => {
  for (const [id, min] of [['d2', 2], ['d3', 2]] as const) {
    it(`${id} @ seed 7 holds at least ${min} gas masses of 300+ cells, each clear of every waystone`, () => {
      const { world, out } = generate(LEVELS[id], 7);
      const big = gasMasses(world).filter((m) => m.cells >= 300);
      expect(big.length, `masses of 300+ cells: ${big.map((m) => m.cells).join(',')}`).toBeGreaterThanOrEqual(min);
      for (const m of big) {
        expect(m.cells, 'no lamp larger than the cap').toBeLessThanOrEqual(1400);
        for (const ws of out.waystones) expect(Math.hypot(m.x - ws.x, m.y - ws.y), `gas mass at ${Math.round(m.x)},${Math.round(m.y)} near a waystone`).toBeGreaterThan(30);
      }
    }, 90000);
  }
});

describe('gold flecks', () => {
  it('the campaign floors carry about half the gold pockets they did (effective 45-50 each)', () => {
    for (const biome of ['fungal', 'frozen', 'flooded', 'crystal', 'volcanic'] as const) {
      const g = GEN[biome];
      const effective = goldPocketBudgetForBiome(g.goldPockets, biome) * (g.goldKeep ?? 1);
      expect(effective, biome).toBeGreaterThan(40);
      expect(effective, biome).toBeLessThanOrEqual(50);
    }
  });

  it('an unbudgeted biome keeps every pocket', () => {
    expect(GEN.earthen.goldKeep).toBeUndefined();
    expect(GEN.timber.goldKeep).toBeUndefined();
  });
});

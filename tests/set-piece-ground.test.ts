import { describe, expect, it } from 'vitest';

import { createDefaultPostFxSettings } from '@/config/params';
import { HEIGHT, WIDTH } from '@/config/constants';
import { LEVELS } from '@/config/worldgraph';
import type { Ctx, GameStateData, LevelDef } from '@/core/types';
import { Cell, blocksEntity, isLiquid } from '@/sim/CellType';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';
import { clearLooseStock } from '@/world/looseStock';
import { holdPortalShrine } from '@/world/portalShrine';

/**
 * SET PIECES STAND ON REAL GROUND (GEN 62): loot is never left inside rock, stock in a
 * fixture's room is cleared only where that is safe, and the exit shrine has a floor and
 * an open ring.
 */

describe('clearLooseStock', () => {
  const fresh = (): World => {
    const w = new World();
    for (let y = 100; y < 160; y++) for (let x = 100; x < 180; x++) w.types[w.idx(x, y)] = Cell.Empty;
    return w;
  };
  const site = { x0: 100, y0: 100, x1: 179, y1: 159 };

  it('clears a pocket that touches open air', () => {
    const w = fresh();
    for (let y = 120; y < 126; y++) for (let x = 120; x < 130; x++) w.types[w.idx(x, y)] = Cell.Oil;
    expect(clearLooseStock(w, [site], () => false)).toBe(60);
    expect(w.types[w.idx(125, 122)]).toBe(Cell.Empty);
  });

  it('leaves a seam bound by rock, a room another pass owns and a sea alone', () => {
    const w = new World();
    // a pocket walled in rock: no open neighbour
    for (let y = 120; y < 124; y++) for (let x = 120; x < 124; x++) { w.types[w.idx(x, y)] = Cell.Gunpowder; }
    for (let y = 119; y < 125; y++) for (let x = 119; x < 125; x++) if (w.types[w.idx(x, y)] === Cell.Empty) w.types[w.idx(x, y)] = Cell.Wall;
    expect(clearLooseStock(w, [site], () => false)).toBe(0);
    // an owned room
    const w2 = fresh();
    for (let x = 120; x < 130; x++) w2.types[w2.idx(x, 130)] = Cell.Sand;
    expect(clearLooseStock(w2, [site], (x) => x === 125)).toBe(0);
    expect(w2.types[w2.idx(125, 130)]).toBe(Cell.Sand);
    // a sea (more than maxCells)
    const w3 = fresh();
    for (let y = 130; y < 160; y++) for (let x = 100; x < 180; x++) w3.types[w3.idx(x, y)] = Cell.Water;
    expect(clearLooseStock(w3, [site], () => false, 600)).toBe(0);
  });
});

describe('holdPortalShrine', () => {
  it('puts the plug top back as a stone pad and clears the ring above it', () => {
    const w = new World();
    const exit = { x: 800, sealY: 1018, halfW: 14 };
    const portal = { x: 800, y: 1008, open: false };
    // the carve took the plug's top; powder and rock sit in the ring
    for (let y = 990; y < 1018; y++) for (let x = 780; x < 820; x++) w.types[w.idx(x, y)] = Cell.Empty;
    for (let y = 1000; y < 1010; y++) for (let x = 797; x < 803; x++) w.types[w.idx(x, y)] = Cell.Gunpowder;
    w.types[w.idx(805, 1005)] = Cell.Wall;
    w.types[w.idx(806, 1018)] = Cell.Metal;
    expect(holdPortalShrine(w, portal, exit)).toBeGreaterThan(0);
    for (let dx = -14; dx <= 14; dx++) {
      const t = w.types[w.idx(800 + dx, 1018)];
      expect(t === Cell.Stone || t === Cell.Metal).toBe(true);
    }
    for (let y = 994; y <= 1017; y++) for (let x = 794; x <= 806; x++) expect(w.types[w.idx(x, y)]).toBe(Cell.Empty);
  });
});

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

describe('generated loot', () => {
  it('d3 @ seed 7: no region-centroid loot is left inside rock, and the exit shrine has a floor', () => {
    const { world, out } = generate(LEVELS.d3, 7);
    const buried = out.pickups.filter((p) => ['chest', 'goldpile', 'potion', 'tome', 'heart'].includes(p.kind)
      && blocksEntity(world.types[world.idx(Math.floor(p.x), Math.floor(p.y))])
      // (a vault's own coin grains lie under its loot)
      && world.types[world.idx(Math.floor(p.x), Math.floor(p.y))] !== Cell.Gold);
    expect(buried.map((p) => `${p.kind}@${Math.floor(p.x)},${Math.floor(p.y)}`)).toEqual([]);
    const portal = out.portal!;
    let solid = 0;
    for (let dx = -8; dx <= 8; dx++) if (blocksEntity(world.types[world.idx(Math.floor(portal.x) + dx, out.exit.sealY)])) solid++;
    expect(solid, 'cells of the ground row under the portal that are solid').toBe(17);
  }, 90000);
});

describe('a flooded floor exit shrine', () => {
  it('d3 @ seed 7 stands above the water line, with a dry ring', () => {
    const { world, out } = generate(LEVELS.d3, 7);
    const portal = out.portal!;
    expect(out.exit.sealY, 'the seal row sits above the flood line (62% of the height)').toBeLessThan(HEIGHT * 0.62);
    let wet = 0;
    for (let y = Math.floor(portal.y) - 14; y < out.exit.sealY; y++) {
      for (let x = Math.floor(portal.x) - 6; x <= Math.floor(portal.x) + 6; x++) if (isLiquid(world.types[world.idx(x, y)])) wet++;
    }
    expect(wet, 'liquid cells in the shrine ring').toBe(0);
  }, 90000);
});

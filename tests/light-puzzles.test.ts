import { describe, expect, it } from 'vitest';

import { HEIGHT, WIDTH } from '@/config/constants';
import { createDefaultPostFxSettings } from '@/config/params';
import { LEVELS } from '@/config/worldgraph';
import type { Ctx, GameStateData, LevelDef, LumenBloom } from '@/core/types';
import { makeLevelRuntime } from '@/game/runtime';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';
import { validateFindability } from '@/world/validate';
import { updateLumenBlooms } from '@/game/lumenBlooms';

const noop = (): undefined => undefined;
function noopSubsystem(): unknown {
  return new Proxy({}, { get: () => noop });
}

function makeCtx(world: World, worldSeed: number): Ctx {
  const state: GameStateData = {
    mode: 'build', score: 0, frameCount: 0, activeInputMode: 'element', currentElement: Cell.Sand,
    currentSpell: 'bolt', currentBiome: 'earthen', brushSize: 6, playerSpawned: false, worldSeed,
    paused: false, postFx: createDefaultPostFxSettings(), editorLights: null,
  } as GameStateData;
  return {
    world, state,
    player: { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2), vx: 0, vy: 0, fx: 0, fy: 0 },
    enemies: [], enemyCtl: { spawn: noop }, events: { emit: noop, on: noop, off: noop },
    audio: noopSubsystem(), particles: noopSubsystem(), rigidBodies: noopSubsystem(),
    fx: {}, levels: { current: null }, sanctum: { open: noop },
  } as unknown as Ctx;
}

function generate(def: LevelDef, seed: number): ReturnType<WorldGen['generateLevel']> & { world: World; ctx: Ctx } {
  const world = new World();
  const gen = new WorldGen();
  const ctx = makeCtx(world, seed);
  ctx.worldgen = gen;
  return { ...gen.generateLevel(ctx, def, seed), world, ctx };
}

describe('light puzzles are placed on floors 2-4', () => {
  for (const id of ['d2', 'd3', 'd4'] as const) {
    it(`${id}: a photocell strongroom and a lumen-bloom crossing, both findable`, () => {
      const level = generate(LEVELS[id], 1337);
      const lenses = level.mechanisms.filter((m) => m.kind === 'sensor' && m.sensorType === 'light');
      const gates = level.mechanisms.filter((m) => m.kind === 'valve' && lenses.some((l) => l.targetId === m.id));
      expect(lenses.length).toBeGreaterThanOrEqual(1);
      expect(gates.length).toBe(1);
      expect(gates[0].oneShot).toBe(true);
      expect(level.lumenBlooms?.length ?? 0).toBe(2);
      expect(level.placedPrefabs.some((p) => p.id === 'light-lamplighters-lock')).toBe(true);
      expect(level.placedPrefabs.some((p) => p.id === 'light-bloom-crossing')).toBe(true);
      // Each puzzle room is a deep-dark zone; the main route gets one or two more.
      expect(level.darkZones?.length ?? 0).toBeGreaterThanOrEqual(3);
      const runtime = makeLevelRuntime({
        def: LEVELS[id], world: level.world, spawn: level.spawn, regions: null,
        mechanisms: level.mechanisms, pickups: level.pickups, portal: level.portal, exit: level.exit,
        waystones: level.waystones, cauldron: level.cauldron, runeVaults: level.runeVaults,
        ...(level.lumenBlooms ? { lumenBlooms: level.lumenBlooms } : {}),
      });
      const issues = validateFindability(runtime).filter((i) => i.what === 'photocell' || i.what === 'lumen-bloom' || i.what === 'valvefront');
      expect(issues).toEqual([]);
    }, 60000);
  }

  it('the gentler Rot Gardens use one permanent lens; deeper floors a timed twin', () => {
    const d2 = generate(LEVELS.d2, 1337).mechanisms.filter((m) => m.sensorType === 'light');
    const d3 = generate(LEVELS.d3, 1337).mechanisms.filter((m) => m.sensorType === 'light');
    expect(d2.map((m) => m.latch)).toEqual(['permanent']);
    expect(d3.length).toBe(2);
    expect(d3.every((m) => m.latch === 'timed')).toBe(true);
  }, 60000);

  it('the Bellows gets its small Undertow cache (and no worldgen rooms)', () => {
    const d1 = generate(LEVELS.d1, 1337);
    const lens = d1.mechanisms.find((m) => m.sensorType === 'light');
    expect(lens).toBeTruthy();
    const lid = d1.mechanisms.find((m) => m.id === lens!.targetId);
    expect(lid?.kind).toBe('valve');
    expect(d1.darkZones?.length).toBe(2);
    expect(d1.placedPrefabs.some((p) => p.id.startsWith('light-'))).toBe(false);
  }, 60000);
});

describe('lumen blooms', () => {
  function bloomWorld(): { ctx: Ctx; bloom: LumenBloom; q: { wand: number } } {
    const world = new World();
    const ctx = makeCtx(world, 1);
    const q = { wand: 0 };
    ctx.lightQuery = { level: () => 0.02, wandLight: () => q.wand, darkness: () => 1, hooded: false };
    ctx.player = { x: 10, y: 10, dead: false } as Ctx['player'];
    const petals: Array<[number, number]> = [];
    for (let c = 0; c < 20; c++) for (let r = 0; r < 2; r++) petals.push([500 + c, 600 + r]);
    const bloom: LumenBloom = { id: 1, x: 498, y: 597, dir: 1, petals, open: 0, hold: 0, shown: -1 };
    return { ctx, bloom, q };
  }

  it('unfurls real glass petals while lit, holds, then furls tip-first in the dark', () => {
    const { ctx, bloom, q } = bloomWorld();
    const glass = (): number => bloom.petals.filter(([x, y]) => ctx.world.types[ctx.world.idx(x, y)] === Cell.Glass).length;
    q.wand = 0.4;
    for (let t = 0; t < 60; t++) updateLumenBlooms(ctx, [bloom]);
    expect(bloom.open).toBe(1);
    expect(glass()).toBe(40);
    q.wand = 0;
    for (let t = 0; t < 50; t++) updateLumenBlooms(ctx, [bloom]);
    expect(glass()).toBe(40); // still holding
    for (let t = 0; t < 200; t++) updateLumenBlooms(ctx, [bloom]);
    const mid = glass();
    expect(mid).toBeLessThan(40);
    expect(mid).toBeGreaterThan(0);
    // Tip first: the root petals are the last to go.
    expect(ctx.world.types[ctx.world.idx(500, 600)]).toBe(Cell.Glass);
    for (let t = 0; t < 800; t++) updateLumenBlooms(ctx, [bloom]);
    expect(glass()).toBe(0);
  });

  it('never writes a petal over rock or a body, and never takes back what is not its glass', () => {
    const { ctx, bloom, q } = bloomWorld();
    ctx.world.types[ctx.world.idx(505, 600)] = Cell.Stone;
    q.wand = 0.4;
    for (let t = 0; t < 60; t++) updateLumenBlooms(ctx, [bloom]);
    // It stops at the obstruction rather than floating petals past it.
    expect(ctx.world.types[ctx.world.idx(505, 600)]).toBe(Cell.Stone);
    expect(ctx.world.types[ctx.world.idx(510, 600)]).toBe(Cell.Empty);
    q.wand = 0;
    for (let t = 0; t < 1200; t++) updateLumenBlooms(ctx, [bloom]);
    expect(ctx.world.types[ctx.world.idx(505, 600)]).toBe(Cell.Stone);
  });

  it('a restored bloom clears petals its save kept and starts furled', () => {
    const { ctx, bloom } = bloomWorld();
    for (const [x, y] of bloom.petals) ctx.world.types[ctx.world.idx(x, y)] = Cell.Glass;
    updateLumenBlooms(ctx, [bloom]);
    expect(bloom.petals.every(([x, y]) => ctx.world.types[ctx.world.idx(x, y)] === Cell.Empty)).toBe(true);
  });
});

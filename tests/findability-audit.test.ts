import { describe, expect, it } from 'vitest';

import { HEIGHT, WIDTH } from '@/config/constants';
import { createDefaultPostFxSettings } from '@/config/params';
import { LEVELS } from '@/config/worldgraph';
import type { Ctx, GameStateData, LevelDef, LevelRuntime, Mechanism } from '@/core/types';
import { fnv1aString } from '@/core/rng';
import { makeLevelRuntime } from '@/game/runtime';
import { Cell } from '@/sim/CellType';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';
import { FindabilityAudit, createAuditBuffers } from '@/world/findabilityAudit';
import { reachableMask, validateFindability, wizardMask } from '@/world/validate';

/**
 * The sliced audit is a detector built from the synchronous passes re-cut into
 * resumable steps. Its one promise: for the same grid and objects it says exactly
 * what validateFindability says, at any budget.
 */

/** Drive an audit to its verdict, `budgetMs` a call, counting the calls. */
function drive(audit: FindabilityAudit, budgetMs: number): { calls: number; result: NonNullable<ReturnType<FindabilityAudit['step']>> } {
  for (let calls = 1; calls < 5_000_000; calls++) {
    const result = audit.step(budgetMs);
    if (result) return { calls, result };
  }
  throw new Error('the audit never finished');
}

function noisyRuntime(seed: number, connect = false, w = 160, h = 110): LevelRuntime {
  let s = seed >>> 0;
  const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const world = new World(w, h);
  world.types.fill(Cell.Stone);
  // Carve a cave of rooms and corridors, then scatter loose powder, metal and ice.
  for (let k = 0; k < 14; k++) {
    const cx = 10 + Math.floor(rnd() * (w - 20)), cy = 10 + Math.floor(rnd() * (h - 20));
    const rx = 4 + Math.floor(rnd() * 14), ry = 5 + Math.floor(rnd() * 9);
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1) world.types[world.idx(x, y)] = Cell.Empty;
    }
  }
  for (let i = 0; i < w * h; i++) {
    const r = rnd();
    if (world.types[i] === Cell.Empty && r < 0.04) world.types[i] = r < 0.02 ? Cell.Sand : r < 0.03 ? Cell.Metal : Cell.Ice;
    else if (world.types[i] === Cell.Stone && r > 0.985) world.types[i] = Cell.Empty;
  }
  const spawn = { x: 40, y: 50 };
  for (let y = spawn.y - 20; y <= spawn.y + 4; y++) for (let x = spawn.x - 7; x <= spawn.x + 7; x++) world.types[world.idx(x, y)] = Cell.Empty;
  if (connect) {
    // Wide L-shaped tunnels from the spawn to every target, so some fixtures audit clean.
    const dig = (x0: number, y0: number, x1: number, y1: number): void => {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = y0 - 18; y <= y0 + 3; y++) world.types[world.idx(x, y)] = Cell.Empty;
      for (let y = Math.min(y0, y1) - 18; y <= Math.max(y0, y1) + 3; y++) for (let x = x1 - 6; x <= x1 + 6; x++) world.types[world.idx(x, y)] = Cell.Empty;
    };
    for (const [tx, ty] of [[100, 70], [60, 55], [120, 30], [30, 90], [140, 90]]) dig(spawn.x, spawn.y, tx, ty);
  }
  const plate: Mechanism = { id: 1, kind: 'plate', x: 100, y: 70, w: 7, h: 1, state: 0, targetId: -1 };
  const door: Mechanism = { id: 2, kind: 'door', x: 60, y: 40, w: 3, h: 20, state: 0, targetId: -1 };
  return {
    def: { id: 'test', name: 'Test', biome: 'earthen', depth: 1, nextLevelId: null },
    world, enemies: [], waystones: [{ x: 120, y: 30 }], pickups: [], mechanisms: [plate, door], runeVaults: [{ rx: 30, ry: 90, lit: false }],
    spawn, explored: new Uint8Array(w * h), regions: null, cauldron: null, portal: { x: 140, y: 90 }, keyTaken: false,
  } as unknown as LevelRuntime;
}

function sameIssues(a: readonly unknown[], b: readonly unknown[]): void {
  const key = (x: unknown): string => JSON.stringify(x);
  expect(a.map(key).sort()).toEqual(b.map(key).sort());
}

describe('sliced findability audit', () => {
  it('builds exactly the synchronous masks and issues, at any budget', () => {
    const verdicts = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const runtime = noisyRuntime(seed, seed > 3);
      const wantIssues = validateFindability(runtime);
      verdicts.add(wantIssues.some((issue) => issue.severity === 'error') ? 'errors' : 'clean');
      const wantSeen = reachableMask(runtime);
      const wantWiz = wizardMask(runtime);
      for (const budget of [Infinity, 0.05, 0]) {
        const audit = new FindabilityAudit(runtime, null);
        const { result } = drive(audit, budget);
        expect(result.unchanged).toBe(false);
        sameIssues(result.issues, wantIssues);
        const masks = audit.masks();
        expect(Buffer.compare(Buffer.from(masks.seen), Buffer.from(wantSeen)), `seen, seed ${seed}, budget ${budget}`).toBe(0);
        expect(Buffer.compare(Buffer.from(masks.wiz), Buffer.from(wantWiz)), `wiz, seed ${seed}, budget ${budget}`).toBe(0);
      }
    }
    // the comparison is only worth something if the fixtures produce both kinds of verdict
    expect([...verdicts].sort()).toEqual(['clean', 'errors']);
  });

  it('makes progress on every call, even on a zero budget, and takes many calls to do a little each', () => {
    const runtime = noisyRuntime(9);
    const slow = drive(new FindabilityAudit(runtime, null), 0);
    const fast = drive(new FindabilityAudit(runtime, null), Infinity);
    expect(fast.calls).toBe(1);
    expect(slow.calls).toBeGreaterThan(20);
  });

  it('agrees with the synchronous audit on real generated floors', () => {
    const noop = (): undefined => undefined;
    const proxy = (): unknown => new Proxy({}, { get: () => noop });
    const build = (def: LevelDef, expeditionSeed: number): LevelRuntime => {
      const seed = (expeditionSeed ^ fnv1aString(def.id)) >>> 0;
      const world = new World();
      const state = {
        mode: 'build', score: 0, frameCount: 0, activeInputMode: 'element', currentElement: Cell.Sand, currentSpell: 'bolt',
        currentBiome: 'earthen', brushSize: 6, playerSpawned: false, worldSeed: seed, paused: false,
        postFx: createDefaultPostFxSettings(), editorLights: null,
      } as GameStateData;
      const gen = new WorldGen();
      const ctx = {
        world, state, player: { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2), vx: 0, vy: 0, fx: 0, fy: 0 }, enemies: [],
        enemyCtl: { spawn: noop }, events: { emit: noop, on: noop, off: noop }, audio: proxy(), particles: proxy(), rigidBodies: proxy(),
        fx: {}, levels: { current: null }, sanctum: { open: noop }, worldgen: gen,
      } as unknown as Ctx;
      const level = gen.generateLevel(ctx, def, seed);
      return makeLevelRuntime({
        def, world, spawn: level.spawn, regions: null, mechanisms: level.mechanisms, pickups: level.pickups, waystones: level.waystones,
        runeVaults: level.runeVaults, exit: level.exit, portal: level.portal, cauldron: level.cauldron, refuge: level.refuge ?? undefined,
        spellLab: level.spellLab ?? undefined, vaultArch: level.vaultArch ?? undefined,
      });
    };
    const buffers = createAuditBuffers(WIDTH, HEIGHT);
    for (const [id, seed] of [['d1', 7], ['d3', 1337]] as const) {
      const runtime = build(LEVELS[id], seed);
      const { result, calls } = drive(new FindabilityAudit(runtime, null, buffers), 2);
      sameIssues(result.issues, validateFindability(runtime));
      expect(calls, `${id}: sliced into many calls`).toBeGreaterThan(3);
    }
  }, 120_000);

  describe('the fingerprint', () => {
    it('ends after the hash when nothing the audit reads has changed', () => {
      const runtime = noisyRuntime(3);
      const first = drive(new FindabilityAudit(runtime, null), Infinity).result;
      const second = drive(new FindabilityAudit(runtime, first.print), Infinity).result;
      expect(second.unchanged).toBe(true);
      expect(second.issues).toEqual([]);
      expect(second.print).toBe(first.print);
    });

    it('does not mistake a moved liquid for a moved wall', () => {
      const runtime = noisyRuntime(3);
      const w = runtime.world;
      const open = [...w.types.keys()].filter((i) => w.types[i] === Cell.Empty).slice(100, 140);
      const first = drive(new FindabilityAudit(runtime, null), Infinity).result;
      for (const i of open) w.types[i] = Cell.Water; // water is not a wall: the verdict cannot change
      const second = drive(new FindabilityAudit(runtime, first.print), Infinity).result;
      expect(second.unchanged).toBe(true);
    });

    it('sees a corridor seal, a swapped metal, a flipped mechanism and a moved one', () => {
      const runtime = noisyRuntime(3);
      const w = runtime.world;
      const base = drive(new FindabilityAudit(runtime, null), Infinity).result.print;
      const printAfter = (mutate: () => void, undo: () => void): string => {
        mutate();
        const p = drive(new FindabilityAudit(runtime, null), Infinity).result.print;
        undo();
        return p;
      };
      const cell = [...w.types.keys()].find((i) => w.types[i] === Cell.Empty && i > 5000)!;
      expect(printAfter(() => { w.types[cell] = Cell.Stone; }, () => { w.types[cell] = Cell.Empty; })).not.toBe(base);
      expect(printAfter(() => { w.types[cell] = Cell.Metal; }, () => { w.types[cell] = Cell.Empty; })).not.toBe(base);
      const stone = [...w.types.keys()].find((i) => w.types[i] === Cell.Stone && i > 5000)!;
      expect(printAfter(() => { w.types[stone] = Cell.Metal; }, () => { w.types[stone] = Cell.Stone; })).not.toBe(base);
      expect(printAfter(() => { runtime.mechanisms[1].state = 1; }, () => { runtime.mechanisms[1].state = 0; })).not.toBe(base);
      expect(printAfter(() => { runtime.mechanisms[0].x += 5; }, () => { runtime.mechanisms[0].x -= 5; })).not.toBe(base);
      // and undone, it is the same print again
      expect(drive(new FindabilityAudit(runtime, null), Infinity).result.print).toBe(base);
    });

    it('finds a corridor sealed after a clean verdict: the print differs and the audit reports the error', () => {
      const runtime = noisyRuntime(3);
      const w = runtime.world;
      const clean = drive(new FindabilityAudit(runtime, null), Infinity).result;
      // Wall the spawn chamber in.
      for (let y = 20; y < 70; y++) for (let x = 20; x < 64; x++) {
        const i = w.idx(x, y);
        if (w.types[i] === Cell.Empty && (x < 24 || x > 59 || y < 25 || y > 65)) w.types[i] = Cell.Stone;
      }
      const after = drive(new FindabilityAudit(runtime, clean.print), Infinity).result;
      expect(after.unchanged).toBe(false);
      sameIssues(after.issues, validateFindability(runtime));
    });
  });
});

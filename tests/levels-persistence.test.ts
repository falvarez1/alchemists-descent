import { describe, expect, it, vi } from 'vitest';
import type { Ctx, Enemy, LevelRuntime, WandLoadoutSave, WandRuntimeSnapshot } from '@/core/types';
import { GEN_TUNE, GEN_VERSION, genTuneSignature } from '@/config/gen';
import { LEVELS } from '@/config/worldgraph';
import { Flask } from '@/combat/Flask';
import { createDefaultStatus } from '@/entities/status';
import { Levels, reviveSavedEnemy, snapshotEnemyForSave } from '@/game/Levels';
import { makePickup } from '@/core/pickupDefs';
import { makeLevelRuntime } from '@/game/runtime';
import { rleEncode } from '@/core/rle';
import { Cell, CELL_COUNT } from '@/sim/CellType';
import { World } from '@/sim/World';

function enemy(overrides: Partial<Enemy> = {}): Enemy {
  return {
    kind: 'bat',
    x: 120,
    y: 80,
    fx: 0,
    fy: 0,
    vx: 0,
    vy: 0,
    hp: 9,
    maxHp: 16,
    flash: 0,
    timer: 17,
    attackCd: 12,
    bobPhase: 1.5,
    grounded: false,
    stride: 0,
    splat: 0,
    prevG: false,
    blink: 0,
    jetFuel: 0,
    jetCd: 0,
    stuckT: 0,
    status: createDefaultStatus(),
    ...overrides,
  };
}

function withLocalStorage<T>(run: (store: Map<string, string>) => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
  try {
    return run(store);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
  }
}

function withLevelDom<T>(run: () => T): T {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { getElementById: () => null },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { setTimeout: (fn: () => void) => (fn(), 0) },
  });
  try {
    return run();
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete (globalThis as typeof globalThis & { document?: Document }).document;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete (globalThis as typeof globalThis & { window?: Window }).window;
  }
}

function makeRestoreCtx(): Ctx {
  return {
    world: new World(),
    enemies: [],
    state: { worldSeed: 99 },
    worldgen: {
      generateLevel: () => ({
        exit: { x: 100, sealY: 140, halfW: 8 },
        waystones: [],
        spawn: { x: 24, y: 48 },
        cauldron: null,
        pickups: [],
        portal: null,
        mechanisms: [],
        runeVaults: [],
        boss: null,
        vaultArch: null,
        vaultHoard: null,
        spellLab: null,
        prefabEnemies: [],
        placedPrefabs: [],
        authoredLights: [],
        emitters: [],
        decors: [],
        refuge: null,
      }),
    },
  } as unknown as Ctx;
}

function restoreSavedBlob(levels: Levels, ctx: Ctx, blob: unknown): LevelRuntime {
  return (levels as unknown as {
    restoreLevel(ctx: Ctx, def: typeof LEVELS.d2, blob: typeof blob): LevelRuntime;
  }).restoreLevel(ctx, LEVELS.d2, blob);
}

describe('settled route repairs', () => {
  /** A 32x32 rock with one waystone sealed inside it: an error-severity findability issue the audit must report. */
  function sealedFloor(): LevelRuntime {
    const world = new World(32, 32);
    world.types.fill(Cell.Stone);
    for (let y = 18; y < 31; y++) for (let x = 8; x < 24; x++) world.types[world.idx(x, y)] = Cell.Empty;
    const runtime = makeLevelRuntime({ def: LEVELS.d2, world, spawn: { x: 16, y: 29 } });
    runtime.waystones.push({ x: 16, y: 4, lit: false });
    return runtime;
  }

  function harness(runtime: LevelRuntime) {
    const ctx = { state: { mode: 'build' }, player: { x: 0, y: 0, firing: false }, enemies: [] } as unknown as Ctx;
    const levels = new Levels(ctx);
    const internals = levels as unknown as {
      currentId: string;
      levels: Map<string, LevelRuntime>;
      settledAudit: object | null;
      repairFindability: () => boolean;
      scheduleSettledFindabilityRepair(ctx: Ctx, runtime: LevelRuntime): void;
    };
    const repair = vi.fn(() => false);
    internals.currentId = 'd2'; internals.levels.set('d2', runtime);
    internals.repairFindability = repair;
    /** Game ticks until no check is in progress (each tick is one slice; a tick also starts any check whose
     *  step deadline has passed). Returns how many distinct checks it saw. */
    const tickAudit = (): number => {
      let seen = 0;
      let last: object | null = null;
      for (let i = 0; i < 100_000 && internals.settledAudit; i++) {
        if (internals.settledAudit !== last) { seen++; last = internals.settledAudit; }
        levels.update(ctx);
      }
      return seen;
    };
    /** Advance the clock, finishing every check that starts on the way. Returns how many ran. */
    const advance = (ms: number): number => {
      let ran = 0;
      for (let left = ms; left > 0; left -= 100) {
        vi.advanceTimersByTime(Math.min(100, left));
        ran += tickAudit();
      }
      return ran;
    };
    return { ctx, levels, internals, repair, advance };
  }

  it('waits for material progress under pauses or slow frames, then cancels on disposal', () => {
    vi.useFakeTimers();
    const runtime = sealedFloor();
    const { ctx, levels, internals, repair, advance } = harness(runtime);
    try {
      internals.scheduleSettledFindabilityRepair(ctx, runtime);
      expect(advance(7000)).toBe(0);
      expect(repair).not.toHaveBeenCalled();
      expect(levels.findabilityReady).toBe(false);
      runtime.world.activity.stepSerial = 18;
      expect(advance(300)).toBe(1);
      // The sealed waystone is an error verdict, so the synchronous repair is handed over to.
      expect(repair).toHaveBeenCalledTimes(1);
      expect(advance(7000)).toBe(0);
      expect(repair).toHaveBeenCalledTimes(1);
      runtime.world.activity.stepSerial = 390;
      expect(advance(7000)).toBe(4);
      expect(repair).toHaveBeenCalledTimes(5);
      expect(levels.findabilityReady).toBe(false);
      runtime.world.activity.stepSerial = 720;
      expect(advance(7000)).toBe(2);
      expect(repair).toHaveBeenCalledTimes(7);
      expect(levels.findabilityReady).toBe(true);
      // The LATE checks keep watching a settled floor on the same step clock (a seam drains for minutes).
      expect(advance(7000)).toBe(0);
      runtime.world.activity.stepSerial = 1080;
      expect(advance(7000)).toBe(1);
      expect(repair).toHaveBeenCalledTimes(8);
      runtime.world.activity.stepSerial = 10800;
      expect(advance(7000)).toBe(7);
      expect(repair).toHaveBeenCalledTimes(15);
      runtime.world.activity.stepSerial = 99999;
      expect(advance(7000)).toBe(0); // the schedule is over
      internals.scheduleSettledFindabilityRepair(ctx, runtime);
      levels.dispose();
      runtime.world.activity.stepSerial += 720;
      expect(advance(7000)).toBe(0);
      expect(repair).toHaveBeenCalledTimes(15);
    } finally { levels.dispose(); vi.useRealTimers(); }
  });

  it('runs the whole cascade without a synchronous pass when the floor is fine', () => {
    vi.useFakeTimers();
    const runtime = sealedFloor();
    runtime.waystones.length = 0; // nothing sealed in
    const { ctx, levels, internals, repair, advance } = harness(runtime);
    try {
      internals.scheduleSettledFindabilityRepair(ctx, runtime);
      runtime.world.activity.stepSerial = 720;
      expect(advance(20000)).toBe(7);
      expect(repair).not.toHaveBeenCalled();
      expect(levels.findabilityReady).toBe(true);
    } finally { levels.dispose(); vi.useRealTimers(); }
  });

  it('starts each check on the tick its step deadline is reached, not on the wall clock', () => {
    // Manual stepping and slow runners run ticks faster or slower than real time: the checks must audit the same
    // material steps either way, so no timer may have to fire for a due check to start.
    vi.useFakeTimers();
    const runtime = sealedFloor(); // the sealed waystone: every check ends in the (spied) repair
    const { ctx, levels, internals, repair } = harness(runtime);
    try {
      internals.scheduleSettledFindabilityRepair(ctx, runtime);
      const checkedAt: number[] = [];
      for (let step = 0; step <= 1100; step++) {
        runtime.world.activity.stepSerial = step;
        const before = repair.mock.calls.length;
        levels.update(ctx); // one game tick: start a due check, then slice it
        for (let i = 0; i < 100_000 && internals.settledAudit; i++) levels.update(ctx);
        if (repair.mock.calls.length > before) checkedAt.push(step);
      }
      expect(checkedAt).toEqual([18, 96, 174, 264, 390, 540, 720, 1080]);
      expect(levels.findabilityReady).toBe(true);
    } finally { levels.dispose(); vi.useRealTimers(); }
  });

  it('falls back to the synchronous check when the slices cannot run', () => {
    vi.useFakeTimers();
    const runtime = sealedFloor();
    runtime.waystones.length = 0;
    const { ctx, levels, internals, repair } = harness(runtime);
    try {
      internals.scheduleSettledFindabilityRepair(ctx, runtime);
      runtime.world.activity.stepSerial = 720;
      vi.advanceTimersByTime(400); // step 0 starts its slices; nothing ever calls update
      expect(repair).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10_000);
      expect(repair).toHaveBeenCalledTimes(1); // fail-open: the old synchronous pass
      expect(levels.findabilityReady).toBe(false);
    } finally { levels.dispose(); vi.useRealTimers(); }
  });
});

describe('level enemy persistence', () => {
  it('round-trips behavior state used by roosts, patrols, and enemy attacks', () => {
    const saved = snapshotEnemyForSave(
      enemy({
        sleeping: true,
        alerted: true,
        patrol: [
          [10, 20],
          [30, 40],
        ],
        patrolIdx: 1,
        calmT: 83,
        recoil: 6,
        fusing: 45,
        punching: 9,
        windup: 4,
        swoop: 7,
        tumble: 2,
        blink: 11,
        jetFuel: 1,
        jetCd: 23,
        stuckT: 5,
        slimed: 90,
        wary: 12,
        cranky: 33,
        webPulse: 8,
        needleX: 155,
        needleY: 66,
        tpCool: 44,
        rootSupport: 0.72,
        rootGrowthBudget: 12,
        rootPanic: 9,
        rootSeekDir: -1,
        rootLashX: 133,
        rootLashY: 64,
        mawChewT: 6,
        mawChewCd: 24,
        mawDir: 1,
        mawStun: 13,
        rillWet: 0.44,
        rillChargeCd: 31,
        rillChargeWindup: 7,
        status: { ...createDefaultStatus(), burning: 20, electrified: 15, regen: 90 },
        submerged: true,
        dmgK: 1.4,
      }),
    );

    const revived = reviveSavedEnemy(saved);

    expect(revived.sleeping).toBe(true);
    expect(revived.alerted).toBe(true);
    expect(revived.patrol).toEqual([
      [10, 20],
      [30, 40],
    ]);
    expect(revived.patrolIdx).toBe(1);
    expect(revived.calmT).toBe(83);
    expect(revived.recoil).toBe(6);
    // MID-ATTACK TELEGRAPHS ARE DELIBERATELY NOT REVIVED (invariant #5:
    // transient combat state clears on transitions) — a fuse lit or a windup
    // begun during a prior visit must not resume with its tell already spent.
    expect(revived.fusing).toBeUndefined();
    expect(revived.punching).toBeUndefined();
    expect(revived.windup).toBeUndefined();
    expect(revived.swoop).toBeUndefined();
    expect(revived.tumble).toBe(2);
    expect(revived.blink).toBe(0);
    expect(revived.jetFuel).toBe(1);
    expect(revived.jetCd).toBe(23);
    expect(revived.stuckT).toBe(5);
    expect(revived.slimed).toBe(90);
    expect(revived.wary).toBe(12);
    expect(revived.cranky).toBe(33);
    expect(revived.webPulse).toBe(8);
    expect(revived.needleX).toBeUndefined(); // belongs to the dropped windup
    expect(revived.needleY).toBeUndefined();
    expect(revived.tpCool).toBe(44);
    expect(revived.rootSupport).toBeCloseTo(0.72);
    expect(revived.rootGrowthBudget).toBe(12);
    expect(revived.rootPanic).toBe(9);
    expect(revived.rootSeekDir).toBe(-1);
    expect(revived.rootLashX).toBe(133);
    expect(revived.rootLashY).toBe(64);
    expect(revived.mawChewT).toBe(6);
    expect(revived.mawChewCd).toBe(24);
    expect(revived.mawDir).toBe(1);
    expect(revived.mawStun).toBe(13);
    expect(revived.rillWet).toBeCloseTo(0.44);
    expect(revived.rillChargeCd).toBe(31);
    expect(revived.rillChargeWindup).toBeUndefined(); // telegraph — not revived
    expect(revived.status.burning).toBe(20);
    expect(revived.status.electrified).toBe(15);
    expect(revived.status.regen).toBe(90);
    expect(revived.submerged).toBe(true);
    expect(revived.timer).toBe(17);
    expect(revived.attackCd).toBe(12);
    expect(revived.bobPhase).toBe(1.5);
    expect(revived.dmgK).toBe(1.4);
  });

  it('deep-copies patrol paths across save and restore', () => {
    const source = enemy({ patrol: [[1, 2]], patrolIdx: 0 });
    const saved = snapshotEnemyForSave(source);
    source.patrol![0][0] = 99;

    const revived = reviveSavedEnemy(saved);
    revived.patrol![0][1] = 77;

    expect(saved.patrol).toEqual([[1, 2]]);
    expect(revived.patrol).toEqual([[1, 77]]);
  });

  it('rejects invalid saved enemy kinds before they reach runtime definition lookups', () => {
    const saved = snapshotEnemyForSave(enemy());
    const revived = reviveSavedEnemy({ ...saved, kind: 'bogus' as never });

    expect(revived.kind).toBe('slime');

    const levels = new Levels({} as Ctx);
    const validBlob = {
      id: 'd1',
      rle: '',
      explored: '',
      life: [],
      charge: [],
      pickups: [],
      mechanisms: [],
      waystones: [],
      runeVaults: [],
      litOrder: [],
      keyTaken: false,
      portalOpen: false,
      enemies: [{ ...saved, kind: 'bogus' }],
    };
    const shape = levels as unknown as { isExpeditionSaveShape(value: unknown): boolean };
    expect(
      shape.isExpeditionSaveShape({
        v: 1,
        currentId: 'd1',
        expeditionSeed: 1,
        score: 0,
        levels: [validBlob],
        loadout: {},
        player: { x: 0, y: 0, hp: 1, maxHp: 1, levit: 0, maxLevit: 1, perks: {} },
      }),
    ).toBe(false);
  });

  it('clamps oversized saved Weaver lair webs on restore', () => {
    const savedWorld = new World();
    const ctx = {
      world: savedWorld,
      enemies: [],
      state: { worldSeed: 99 },
      worldgen: {
        generateLevel: () => ({
          exit: { x: 100, sealY: 140, halfW: 8 },
          waystones: [],
          spawn: { x: 24, y: 48 },
          cauldron: null,
          pickups: [],
          portal: null,
          mechanisms: [],
          runeVaults: [],
          boss: null,
          vaultArch: null,
          vaultHoard: null,
          spellLab: null,
          prefabEnemies: [],
          placedPrefabs: [],
          authoredLights: [],
          emitters: [],
          decors: [],
          refuge: null,
        }),
      },
    } as unknown as Ctx;
    const levels = new Levels(ctx);
    const blob = {
      id: 'd2',
      rle: rleEncode(savedWorld.types),
      life: [],
      charge: [],
      explored: '',
      waystones: [],
      pickups: [],
      mechanisms: [],
      runeVaults: [],
      keyTaken: false,
      portalOpen: false,
      litOrder: [],
      enemies: [],
      weaverLairWebs: [{ x: 80, y: 70, radius: 500, radials: 40, rings: 30, thickness: 8, color: -1, jitter: 4 }],
    };

    const restored = (levels as unknown as {
      restoreLevel(ctx: Ctx, def: typeof LEVELS.d2, blob: typeof blob): LevelRuntime;
    }).restoreLevel(ctx, LEVELS.d2, blob);

    expect(restored.weaverLairWebs).toHaveLength(1);
    expect(restored.weaverLairWebs[0]).toMatchObject({
      radius: 34,
      radials: 8,
      rings: 4,
      thickness: 1,
      color: 0xffffff,
    });
    expect(restored.weaverLairWebs[0].jitter).toBeCloseTo(0.12);
  });

  it('rejects saved levels with invalid material ids before restore mutates the world', () => {
    const savedWorld = new World();
    savedWorld.types[0] = CELL_COUNT;
    const ctx = makeRestoreCtx();
    const levels = new Levels(ctx);
    const blob = {
      id: 'd2',
      rle: rleEncode(savedWorld.types),
      life: [],
      charge: [],
      explored: '',
      waystones: [],
      pickups: [],
      mechanisms: [],
      runeVaults: [],
      keyTaken: false,
      portalOpen: false,
      litOrder: [],
      enemies: [],
    };

    expect(() => restoreSavedBlob(levels, ctx, blob)).toThrow(/invalid cell id/);
  });

  it('restores open timed valves by clearing their material and regenerating old-save countdowns', () => {
    const savedWorld = new World();
    for (let y = 100; y < 102; y++) {
      for (let x = 100; x < 103; x++) savedWorld.types[savedWorld.idx(x, y)] = Cell.Stone;
    }
    const ctx = makeRestoreCtx();
    const levels = new Levels(ctx);
    const blob = {
      id: 'd2',
      rle: rleEncode(savedWorld.types),
      life: [],
      charge: [],
      explored: '',
      waystones: [],
      pickups: [],
      mechanisms: [
        {
          id: 1,
          kind: 'valve',
          x: 100,
          y: 100,
          w: 3,
          h: 2,
          state: 1,
          targetId: -1,
          material: Cell.Stone,
          autoCloseFrames: 20,
        },
      ],
      runeVaults: [],
      keyTaken: false,
      portalOpen: false,
      litOrder: [],
      enemies: [],
    };

    const restored = restoreSavedBlob(levels, ctx, blob);
    const valve = restored.mechanisms[0]!;
    expect(valve).toMatchObject({ closeT: 20, prevWant: true });
    for (let y = 100; y < 102; y++) {
      for (let x = 100; x < 103; x++) {
        expect(restored.world.types[restored.world.idx(x, y)]).toBe(Cell.Empty);
      }
    }
  });

  it('restores, clears, and sanitizes saved map waypoints', () => {
    const restoreWithWaypoint = (mapWaypoint?: unknown): LevelRuntime => {
      const savedWorld = new World();
      const ctx = {
        world: savedWorld,
        enemies: [],
        state: { worldSeed: 99 },
        worldgen: {
          generateLevel: () => ({
            exit: { x: 100, sealY: 140, halfW: 8 },
            waystones: [],
            spawn: { x: 24, y: 48 },
            cauldron: null,
            pickups: [],
            portal: null,
            mechanisms: [],
            runeVaults: [],
            boss: null,
            vaultArch: null,
            vaultHoard: null,
            spellLab: null,
            prefabEnemies: [],
            placedPrefabs: [],
            authoredLights: [],
            emitters: [],
            decors: [],
            refuge: null,
          }),
        },
      } as unknown as Ctx;
      const levels = new Levels(ctx);
      const blob = {
        id: 'd2',
        rle: rleEncode(savedWorld.types),
        life: [],
        charge: [],
        explored: '',
        waystones: [],
        pickups: [],
        mechanisms: [],
        runeVaults: [],
        keyTaken: false,
        portalOpen: false,
        litOrder: [],
        enemies: [],
        ...(mapWaypoint !== undefined ? { mapWaypoint } : {}),
      };

      return (levels as unknown as {
        restoreLevel(ctx: Ctx, def: typeof LEVELS.d2, blob: typeof blob): LevelRuntime;
      }).restoreLevel(ctx, LEVELS.d2, blob);
    };

    expect(restoreWithWaypoint({ x: 300, y: 200, label: 'Gate Route' }).mapWaypoint).toEqual({
      x: 300,
      y: 200,
      label: 'Gate Route',
    });
    expect(restoreWithWaypoint(null).mapWaypoint).toBeNull();
    expect(restoreWithWaypoint().mapWaypoint).toBeNull();
    expect(restoreWithWaypoint({ x: 99999, y: -20, label: '   ' }).mapWaypoint).toEqual({
      x: 1599,
      y: 0,
      label: 'Waypoint',
    });
    expect(restoreWithWaypoint({ x: Number.NaN, y: 20, label: 'Bad' }).mapWaypoint).toBeNull();
  });

  it('exiting a custom playtest restores the previous expedition pointer', () => {
    const world = new World();
    let particlesCleared = false;
    let lightningCleared = false;
    let wandsCleared = false;
    let bottleCancelled = false;
    const ctx = {
      world,
      enemies: [],
      projectiles: [{ x: 1, y: 1, vx: 0, vy: 0, type: 'bolt', life: 3, age: 0, charging: false, hostile: false }],
      shockwaves: [{ x: 1, y: 1 }],
      particles: { clear: () => { particlesCleared = true; } },
      lightning: { clear: () => { lightningCleared = true; } },
      wands: { clearTransientState: () => { wandsCleared = true; } },
      input: {
        activeChargingBlackHole: null,
        releaseHeldInput: () => undefined,
      },
      fx: { digBeam: { x0: 0, y0: 0, x1: 1, y1: 1, life: 1 } },
      flask: { cancelBottle: () => { bottleCancelled = true; } },
      state: {
        currentBiome: 'earthen',
        debugGodMode: false,
        debugTainted: false,
        worldSeed: 123,
      },
      player: {
        x: 10,
        y: 20,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
      },
      playerCtl: {
        findSpawnPoint: () => ({ x: 10, y: 20 }),
      },
      camera: {
        snapTo: () => undefined,
      },
      events: {
        emit: () => undefined,
      },
    } as unknown as Ctx;
    const levels = new Levels(ctx);
    const prior = makeLevelRuntime({
      def: {
        id: 'd1',
        name: 'Depth 1',
        biome: 'earthen',
        depth: 1,
        nextLevelId: null,
      },
      world,
      enemies: [],
      spawn: { x: 10, y: 20 },
      regions: null,
    });
    const internals = levels as unknown as {
      currentId: string | null;
      levels: Map<string, LevelRuntime>;
    };
    internals.levels.set('d1', prior);
    internals.currentId = 'd1';

    levels.playCurrentWorld(ctx);
    expect(levels.current?.def.id).toBe('custom');
    expect(ctx.projectiles).toHaveLength(0);
    expect(ctx.shockwaves).toHaveLength(0);
    expect(ctx.fx.digBeam).toBeNull();
    expect(particlesCleared).toBe(true);
    expect(lightningCleared).toBe(true);
    expect(wandsCleared).toBe(true);
    expect(bottleCancelled).toBe(true);

    levels.exitCustomPlaytest(ctx);
    expect(levels.current?.def.id).toBe('d1');
  });

  it('clears disposable virtual runtimes without poisoning campaign resume', () => {
    const world = new World();
    const ctx = {
      world,
      enemies: [enemy()],
      state: { playtestSource: 'test' },
      input: {
        activeChargingBlackHole: null,
        releaseHeldInput: () => undefined,
      },
      projectiles: [],
      shockwaves: [],
      lightning: { clear: () => undefined },
      particles: { clear: () => undefined },
      fx: { digBeam: null },
    } as unknown as Ctx;
    const levels = new Levels(ctx);
    const virtualRuntime = makeLevelRuntime({
      def: {
        id: 'virtual-builder-test',
        name: 'Virtual Test',
        biome: 'earthen',
        depth: 1,
        nextLevelId: null,
      },
      world,
      enemies: [],
      spawn: { x: 10, y: 20 },
      regions: null,
    });
    const internals = levels as unknown as {
      currentId: string | null;
      levels: Map<string, LevelRuntime>;
    };
    internals.levels.set('virtual-builder-test', virtualRuntime);
    internals.currentId = 'virtual-builder-test';

    levels.exitDisposableRuntime(ctx);

    expect(levels.current).toBeNull();
    expect(internals.levels.has('virtual-builder-test')).toBe(false);
    expect(ctx.state.playtestSource).toBeNull();
    expect(ctx.enemies).toHaveLength(0);
  });

  it('does not save dead players or disposable runtimes', () => {
    withLocalStorage((store) => {
      const world = new World();
      const ctx = {
        world,
        enemies: [],
        state: {
          playtestSource: null,
          debugGodMode: false,
          debugTainted: false,
          score: 0,
          worldSeed: 42,
        },
        player: {
          x: 10,
          y: 20,
          hp: 0,
          maxHp: 100,
          dead: true,
          levit: 100,
          maxLevit: 100,
          perks: {},
        },
      } as unknown as Ctx;
      const levels = new Levels(ctx);
      const runtime = makeLevelRuntime({
        def: {
          id: 'd1',
          name: 'Depth 1',
          biome: 'earthen',
          depth: 1,
          nextLevelId: null,
        },
        world,
        enemies: [],
        spawn: { x: 10, y: 20 },
        regions: null,
      });
      const internals = levels as unknown as {
        currentId: string | null;
        levels: Map<string, LevelRuntime>;
      };
      internals.levels.set('d1', runtime);
      internals.currentId = 'd1';

      levels.saveExpedition(ctx);
      expect(store.get('noita-expedition')).toBeUndefined();

      ctx.player.dead = false;
      ctx.state.debugTainted = true;
      levels.saveExpedition(ctx);
      expect(store.get('noita-expedition')).toBeUndefined();

      ctx.state.debugTainted = false;
      internals.levels.set('virtual-builder-test', {
        ...runtime,
        def: { ...runtime.def, id: 'virtual-builder-test' },
      });
      internals.currentId = 'virtual-builder-test';

      levels.saveExpedition(ctx);
      expect(store.get('noita-expedition')).toBeUndefined();
    });
  });

  it('death checkpoints persist the penalty while resuming at the respawn anchor', () => {
    withLocalStorage((store) => {
      const world = new World();
      const ctx = {
        world,
        enemies: [],
        state: {
          playtestSource: null,
          debugGodMode: false,
          score: 170,
          worldSeed: 42,
        },
        player: {
          x: 300,
          y: 240,
          hp: 0,
          maxHp: 120,
          dead: true,
          levit: 12,
          maxLevit: 90,
          perks: { torchbearer: true },
        },
        wands: {
          snapshotLoadout: () => ({
            active: 0,
            collection: ['spark'],
            wands: [],
          }),
          snapshotRuntimeState: () => ({
            active: 0,
            collection: ['spark'],
            wands: [],
            lastDryFire: 0,
            flameBurst: 0,
            depthsGranted: [],
            infuserGranted: false,
          }),
        },
        flask: {
          activeIndex: 0,
          slots: [],
          bottleView: () => null,
        },
      } as unknown as Ctx;
      const levels = new Levels(ctx);
      const runtime = makeLevelRuntime({
        def: {
          id: 'd1',
          name: 'Depth 1',
          biome: 'earthen',
          depth: 1,
          nextLevelId: null,
        },
        world,
        enemies: [],
        spawn: { x: 44, y: 55 },
        regions: null,
      });
      runtime.pickups.push(makePickup('goldpile', 301, 234, { amount: 30 }));
      const internals = levels as unknown as {
        currentId: string | null;
        levels: Map<string, LevelRuntime>;
      };
      internals.levels.set('d1', runtime);
      internals.currentId = 'd1';

      levels.saveDeathCheckpoint(ctx);

      const save = JSON.parse(store.get('noita-expedition') ?? 'null') as {
        score: number;
        player: {
          x: number;
          y: number;
          hp: number;
          maxHp: number;
          levit: number;
          maxLevit: number;
          perks: Record<string, true>;
        };
        levels: Array<{
          pickups: Array<{ kind: string; data: { amount?: number } }>;
        }>;
      };
      expect(save.score).toBe(170);
      expect(save.player).toMatchObject({
        x: 44,
        y: 55,
        hp: 120,
        maxHp: 120,
        levit: 90,
        maxLevit: 90,
      });
      expect(save.player.perks).toEqual({ torchbearer: true });
      expect(save.levels[0].pickups).toEqual([expect.objectContaining({ kind: 'goldpile', data: { amount: 30 } })]);
    });
  });

  it('serializes full wand runtime state and flask belt state into expedition saves', () => {
    withLocalStorage((store) => {
      const world = new World();
      for (let i = 0; i < 20005; i++) {
        world.types[i] = Cell.Fungus;
        world.life[i] = -1;
        world.charge[i] = 1;
      }
      const scarIdx = world.idx(7, 7);
      world.types[scarIdx] = Cell.Stone;
      world.colors[scarIdx] = 0x552211;
      world.colorOverrides.add(scarIdx);
      const loadout: WandLoadoutSave = {
        active: 0,
        collection: ['spark'],
        wands: [{ frameId: 'starter', cards: ['spark', null, null], mana: 55 }],
      };
      const wands: WandRuntimeSnapshot = {
        active: 1,
        collection: ['spark', 'infuser'],
        wands: [
          {
            frameId: 'starter',
            cards: ['spark', 'infuser', null],
            mana: 42,
            cooldown: 7,
            castIndex: 1,
          },
        ],
        lastDryFire: 11,
        flameBurst: 3,
        depthsGranted: [2, 3],
        infuserGranted: true,
      };
      const ctx = {
        world,
        enemies: [],
        state: {
          playtestSource: null,
          debugGodMode: false,
          score: 250,
          worldSeed: 9001,
        },
        player: {
          x: 111,
          y: 222,
          hp: 70,
          maxHp: 120,
          levit: 40,
          maxLevit: 90,
          perks: { torchbearer: true },
        },
        wands: {
          snapshotLoadout: () => loadout,
          snapshotRuntimeState: () => wands,
        },
        flask: {
          activeIndex: 1,
          slots: [
            { material: Cell.Water, count: 300, capacity: 600 },
            { material: Cell.Acid, count: 120, capacity: 600 },
          ],
          bottleView: () => null,
        },
      } as unknown as Ctx;
      const levels = new Levels(ctx);
      const runtime = makeLevelRuntime({
        def: {
          id: 'd1',
          name: 'Depth 1',
          biome: 'earthen',
          depth: 1,
          nextLevelId: null,
        },
        world,
        enemies: [],
        spawn: { x: 10, y: 20 },
        regions: null,
      });
      runtime.pickups.push(makePickup('tome', 66, 77, { card: 'spark', offerPending: true }));
      runtime.mapWaypoint = { x: 333, y: 444, label: 'Portal Route' };
      const internals = levels as unknown as {
        currentId: string | null;
        levels: Map<string, LevelRuntime>;
      };
      internals.levels.set('d1', runtime);
      internals.currentId = 'd1';

      levels.saveExpedition(ctx);

      const save = JSON.parse(store.get('noita-expedition') ?? 'null') as {
        genTuneSignature?: string;
        loadout: WandLoadoutSave;
        wands: WandRuntimeSnapshot;
        flasks: {
          activeIndex: number;
          slots: Array<{
            material: number | null;
            count: number;
            capacity: number;
          }>;
        };
        levels: Array<{
          colorOverrides?: Array<[number, number]>;
          life: Array<[number, number]>;
          charge: Array<[number, number]>;
          pickups: Array<{ kind: string; data: { offerPending?: boolean } }>;
          mapWaypoint?: { x: number; y: number; label: string } | null;
        }>;
      };
      expect(save.genTuneSignature).toBe(genTuneSignature());
      expect(save.loadout).toEqual(loadout);
      expect(save.wands).toEqual({ ...wands, flameBurst: 0 });
      expect(save.flasks).toEqual({
        activeIndex: 1,
        slots: [
          { material: Cell.Water, count: 300, capacity: 600 },
          { material: Cell.Acid, count: 120, capacity: 600 },
        ],
      });
      expect(save.levels[0].colorOverrides).toContainEqual([scarIdx, 0x552211]);
      expect(save.levels[0].life).toHaveLength(20005);
      expect(save.levels[0].charge).toHaveLength(20005);
      expect(save.levels[0].pickups[0]).toMatchObject({
        kind: 'tome',
        data: { offerPending: false },
      });
      expect(save.levels[0].mapWaypoint).toEqual({ x: 333, y: 444, label: 'Portal Route' });
    });
  });

  it('serializes an in-flight flask bottle separately from belt inventory', () => {
    withLocalStorage((store) => {
      const world = new World();
      const loadout: WandLoadoutSave = { active: 0, collection: [], wands: [] };
      const wands: WandRuntimeSnapshot = {
        active: 0,
        collection: [],
        wands: [],
        lastDryFire: 0,
        flameBurst: 0,
        depthsGranted: [],
        infuserGranted: false,
      };
      const ctx = {
        world,
        enemies: [],
        state: {
          playtestSource: null,
          debugGodMode: false,
          score: 0,
          worldSeed: 42,
        },
        player: {
          x: 10,
          y: 20,
          hp: 100,
          maxHp: 100,
          levit: 100,
          maxLevit: 100,
          perks: {},
        },
        wands: {
          snapshotLoadout: () => loadout,
          snapshotRuntimeState: () => wands,
        },
        flask: {
          activeIndex: 1,
          slots: [
            { material: null, count: 0, capacity: 600 },
            { material: null, count: 0, capacity: 600 },
          ],
          bottleView: () => ({
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            material: Cell.Water,
            count: 80,
          }),
        },
      } as unknown as Ctx;
      const levels = new Levels(ctx);
      const runtime = makeLevelRuntime({
        def: {
          id: 'd1',
          name: 'Depth 1',
          biome: 'earthen',
          depth: 1,
          nextLevelId: null,
        },
        world,
        enemies: [],
        spawn: { x: 10, y: 20 },
        regions: null,
      });
      const internals = levels as unknown as {
        currentId: string | null;
        levels: Map<string, LevelRuntime>;
      };
      internals.levels.set('d1', runtime);
      internals.currentId = 'd1';

      levels.saveExpedition(ctx);

      const save = JSON.parse(store.get('noita-expedition') ?? 'null') as {
        flasks: {
          activeIndex: number;
          slots: Array<{ material: number | null; count: number }>;
          bottle?: {
            material: number | null;
            count: number;
            x: number;
            y: number;
            vx: number;
            vy: number;
          };
        };
      };
      expect(save.flasks.activeIndex).toBe(1);
      expect(save.flasks.slots[1]).toMatchObject({ material: null, count: 0 });
      expect(save.flasks.bottle).toMatchObject({
        material: Cell.Water,
        count: 80,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      });
    });
  });

  it('archives expedition saves captured under different worldgen tuning', () => {
    withLocalStorage((store) => {
      const originalTune = { ...GEN_TUNE };
      const savedSignature = genTuneSignature();
      try {
        GEN_TUNE.caveScale = GEN_TUNE.caveScale + 0.1;
        store.set(
          'noita-expedition',
          JSON.stringify({
            v: 1,
            genVersion: GEN_VERSION,
            genTuneSignature: savedSignature,
            expeditionSeed: 123,
            currentId: 'd1',
            score: 25,
            player: {
              x: 333,
              y: 444,
              hp: 80,
              maxHp: 100,
              levit: 60,
              maxLevit: 100,
              perks: {},
            },
            loadout: { active: 0, collection: ['spark'], wands: [] },
            levels: [],
          }),
        );
        const toasts: string[] = [];
        const ctx = {
          world: new World(),
          enemies: [],
          state: {},
          events: {
            emit: (_name: string, payload?: { text?: string }) => {
              if (payload?.text) toasts.push(payload.text);
            },
          },
        } as unknown as Ctx;
        const levels = new Levels(ctx) as unknown as {
          tryResumeExpedition(ctx: Ctx): boolean;
        };

        expect(levels.tryResumeExpedition(ctx)).toBe(false);
        expect(store.get('noita-expedition')).toBeUndefined();
        expect(JSON.parse(store.get('noita-expedition-archive')!).genTuneSignature).toBe(savedSignature);
        expect(toasts).toContain('WORLDGEN TUNING CHANGED - EXPEDITION ARCHIVED — start a new descent');
      } finally {
        Object.assign(GEN_TUNE, originalTune);
      }
    });
  });

  it('does not checkpoint over the saved hero position while resuming a legacy save', () => {
    withLocalStorage((store) => {
      withLevelDom(() => {
        const world = new World();
        const loadout: WandLoadoutSave = {
          active: 0,
          collection: ['spark'],
          wands: [{ frameId: 'starter', cards: ['spark', null, null], mana: 55 }],
        };
        const wands: WandRuntimeSnapshot = {
          active: 0,
          collection: ['spark'],
          wands: [
            {
              frameId: 'starter',
              cards: ['spark', null, null],
              mana: 55,
              cooldown: 0,
              castIndex: 0,
            },
          ],
          lastDryFire: 0,
          flameBurst: 0,
          depthsGranted: [],
          infuserGranted: false,
        };
        store.set(
          'noita-expedition',
          JSON.stringify({
            v: 1,
            genVersion: GEN_VERSION,
            expeditionSeed: 123,
            currentId: 'd3',
            score: 25,
            player: {
              x: 333,
              y: 444,
              hp: 80,
              maxHp: 100,
              levit: 60,
              maxLevit: 100,
              perks: {},
            },
            loadout,
            flasks: { activeIndex: 0, slots: [] },
            levels: [],
          }),
        );
        const flask = new Flask();
        let markedDepth = 0;
        const ctx = {
          world,
          enemies: [],
          projectiles: [],
          shockwaves: [],
          state: {
            playtestSource: null,
            debugGodMode: false,
            score: 0,
            worldSeed: 123,
            mode: 'play',
          },
          player: {
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            fx: 0,
            fy: 0,
            hp: 100,
            maxHp: 100,
            levit: 100,
            maxLevit: 100,
            perks: {},
            firing: true,
            crawling: true,
            crawlT: 10,
            wallGrabT: 10,
          },
          input: {
            activeChargingBlackHole: null,
            keys: {
              left: true,
              right: true,
              up: true,
              jump: true,
              wallJump: true,
              down: true,
              grab: true,
            },
            isDrawing: true,
            lastX: 1,
            lastY: 1,
            buildSpellHeld: true,
            bombCharge: 1,
            siphonHeld: true,
            pourHeld: true,
            drinkHeld: true,
          },
          fx: { digBeam: {} },
          simulation: { accumulator: 0 },
          particles: { clear: () => undefined },
          lightning: { clear: () => undefined },
          camera: { snapTo: () => undefined },
          events: { emit: () => undefined },
          flask,
          wands: {
            loadLoadout: () => undefined,
            restoreRuntimeState: () => undefined,
            markDepthGrantsThrough: (depth: number) => {
              markedDepth = depth;
            },
            snapshotLoadout: () => loadout,
            snapshotRuntimeState: () => wands,
          },
        } as unknown as Ctx;
        const levels = new Levels(ctx);
        const runtime = makeLevelRuntime({
          def: {
            id: 'd1',
            name: 'Depth 1',
            biome: 'earthen',
            depth: 1,
            nextLevelId: null,
          },
          world,
          enemies: [],
          spawn: { x: 10, y: 20 },
          regions: null,
        });
        const internals = levels as unknown as {
          currentId: string | null;
          levels: Map<string, LevelRuntime>;
          tryResumeExpedition(ctx: Ctx): boolean;
        };
        internals.levels.set('d1', runtime);
        internals.levels.delete('d1');
        internals.levels.set('d3', {
          ...runtime,
          def: LEVELS.d3,
          spawn: { x: 10, y: 20 },
        });

        expect(internals.tryResumeExpedition(ctx)).toBe(true);

        expect(ctx.player).toMatchObject({ x: 333, y: 444 });
        expect(markedDepth).toBe(LEVELS.d3.depth);
        const persisted = JSON.parse(store.get('noita-expedition') ?? 'null') as { player: { x: number; y: number } };
        expect(persisted.player).toMatchObject({ x: 333, y: 444 });
      });
    });
  });
});

describe('level objective labels', () => {
  it('uses the resident boss kind for objective copy', () => {
    const levels = new Levels({} as Ctx);
    const objective = levels as unknown as { bossObjective(kind: 'leviathan' | 'colossus' | undefined): string };

    expect(objective.bossObjective('leviathan')).toBe('Drain the Sunken Leviathan.');
    expect(objective.bossObjective('colossus')).toBe('Bring down the Kiln Colossus.');
    expect(objective.bossObjective(undefined)).toBe('Bring down the Kiln Colossus.');
  });
});

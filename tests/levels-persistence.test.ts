import { describe, expect, it } from 'vitest';
import type { Ctx, Enemy, LevelRuntime, WandLoadoutSave, WandRuntimeSnapshot } from '@/core/types';
import { GEN_VERSION } from '@/config/gen';
import { LEVELS } from '@/config/worldgraph';
import { Flask } from '@/combat/Flask';
import { createDefaultStatus } from '@/entities/status';
import { Levels, reviveSavedEnemy, snapshotEnemyForSave } from '@/game/Levels';
import { makeLevelRuntime } from '@/game/runtime';
import { Cell } from '@/sim/CellType';
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
    expect(revived.fusing).toBe(45);
    expect(revived.punching).toBe(9);
    expect(revived.windup).toBe(4);
    expect(revived.swoop).toBe(7);
    expect(revived.tumble).toBe(2);
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

  it('exiting a custom playtest restores the previous expedition pointer', () => {
    const world = new World();
    const ctx = {
      world,
      enemies: [],
      projectiles: [],
      state: {
        currentBiome: 'earthen',
        debugGodMode: false,
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
      def: { id: 'd1', name: 'Depth 1', biome: 'earthen', depth: 1, nextLevelId: null },
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

    levels.exitCustomPlaytest(ctx);
    expect(levels.current?.def.id).toBe('d1');
  });

  it('serializes full wand runtime state and flask belt state into expedition saves', () => {
    withLocalStorage((store) => {
      const world = new World();
      const loadout: WandLoadoutSave = {
        active: 0,
        collection: ['spark'],
        wands: [{ frameId: 'starter', cards: ['spark', null, null], mana: 55 }],
      };
      const wands: WandRuntimeSnapshot = {
        active: 1,
        collection: ['spark', 'infuser'],
        wands: [
          { frameId: 'starter', cards: ['spark', 'infuser', null], mana: 42, cooldown: 7, castIndex: 1 },
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
        def: { id: 'd1', name: 'Depth 1', biome: 'earthen', depth: 1, nextLevelId: null },
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
        loadout: WandLoadoutSave;
        wands: WandRuntimeSnapshot;
        flasks: { activeIndex: number; slots: Array<{ material: number | null; count: number; capacity: number }> };
      };
      expect(save.loadout).toEqual(loadout);
      expect(save.wands).toEqual(wands);
      expect(save.flasks).toEqual({
        activeIndex: 1,
        slots: [
          { material: Cell.Water, count: 300, capacity: 600 },
          { material: Cell.Acid, count: 120, capacity: 600 },
        ],
      });
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
          bottleView: () => ({ x: 0, y: 0, vx: 0, vy: 0, material: Cell.Water, count: 80 }),
        },
      } as unknown as Ctx;
      const levels = new Levels(ctx);
      const runtime = makeLevelRuntime({
        def: { id: 'd1', name: 'Depth 1', biome: 'earthen', depth: 1, nextLevelId: null },
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
          bottle?: { material: number | null; count: number; x: number; y: number; vx: number; vy: number };
        };
      };
      expect(save.flasks.activeIndex).toBe(1);
      expect(save.flasks.slots[1]).toMatchObject({ material: null, count: 0 });
      expect(save.flasks.bottle).toMatchObject({ material: Cell.Water, count: 80, x: 0, y: 0, vx: 0, vy: 0 });
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
          wands: [{ frameId: 'starter', cards: ['spark', null, null], mana: 55, cooldown: 0, castIndex: 0 }],
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
            keys: { left: true, right: true, up: true, jump: true, wallJump: true, down: true, grab: true },
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
          def: { id: 'd1', name: 'Depth 1', biome: 'earthen', depth: 1, nextLevelId: null },
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

  it('checkpoints the final vault-arch arrival position instead of the destination spawn', () => {
    withLocalStorage((store) => {
      withLevelDom(() => {
        const world = new World();
        const vaultWorld = new World();
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
        const flask = new Flask();
        const ctx = {
          world,
          enemies: [],
          projectiles: [],
          shockwaves: [],
          state: {
            mode: 'play',
            playtestSource: null,
            debugGodMode: false,
            score: 0,
            worldSeed: 123,
            frameCount: 10,
          },
          player: {
            x: 50,
            y: 50,
            vx: 1,
            vy: 1,
            fx: 1,
            fy: 1,
            hp: 100,
            maxHp: 100,
            levit: 100,
            maxLevit: 100,
            perks: {},
            dead: false,
            firing: false,
            crawling: false,
            crawlT: 0,
            wallGrabT: 0,
          },
          input: {
            activeChargingBlackHole: null,
            keys: { left: false, right: false, up: false, jump: false, wallJump: false, down: false, grab: false },
            isDrawing: false,
            lastX: null,
            lastY: null,
            buildSpellHeld: false,
            bombCharge: -1,
            siphonHeld: false,
            pourHeld: false,
            drinkHeld: false,
          },
          fx: { digBeam: null },
          simulation: { accumulator: 0 },
          particles: { clear: () => undefined, spawn: () => undefined },
          lightning: { clear: () => undefined },
          camera: { snapTo: () => undefined },
          events: { emit: () => undefined },
          audio: { portalWhoosh: () => undefined },
          flask,
          wands: {
            snapshotLoadout: () => loadout,
            snapshotRuntimeState: () => wands,
          },
          sanctum: { open: () => undefined },
        } as unknown as Ctx;
        const levels = new Levels(ctx);
        const host = makeLevelRuntime({
          def: { ...LEVELS.d1, nextLevelId: null },
          world,
          enemies: [],
          spawn: { x: 10, y: 20 },
          regions: null,
          vaultArch: { x: 50, y: 50, backX: 60, backY: 60 },
        });
        const vault = makeLevelRuntime({
          def: LEVELS.vault,
          world: vaultWorld,
          enemies: [],
          spawn: { x: 100, y: 120 },
          regions: null,
          vaultArch: { x: 30, y: 40, backX: 77, backY: 88 },
        });
        const internals = levels as unknown as {
          currentId: string | null;
          expeditionSeed: number | null;
          levels: Map<string, LevelRuntime>;
        };
        internals.levels.set('d1', host);
        internals.levels.set('vault', vault);
        internals.currentId = 'd1';
        internals.expeditionSeed = 123;

        levels.update(ctx);

        const save = JSON.parse(store.get('noita-expedition') ?? 'null') as { currentId: string; player: { x: number; y: number } };
        expect(save.currentId).toBe('vault');
        expect(save.player).toMatchObject({ x: 77, y: 88 });
      });
    });
  });
});

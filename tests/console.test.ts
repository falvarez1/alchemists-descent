import { describe, expect, it } from 'vitest';

import { createDefaultPostFxSettings, createGameParams } from '@/config/params';
import { EventBus } from '@/core/events';
import type {
  Ctx,
  CardId,
  Enemy,
  EnemyDef,
  EnemyKind,
  GameStateData,
  InputState,
  LevelRuntime,
  WandsApi,
} from '@/core/types';
import { createPlayer } from '@/entities/Player';
import { createConsoleApi } from '@/game/console/commands';
import { resolveRelativeCoord, parseCellType } from '@/game/console/commands';
import { tokenizeConsoleLine } from '@/game/console/registry';
import { CONSOLE_BINDS_KEY, CONSOLE_WATCHES_KEY } from '@/game/console/prefs';
import { CONSOLE_SCRIPTS_KEY } from '@/game/console/scripts';
import { Cell } from '@/sim/CellType';
import { slimeColor } from '@/sim/colors';
import { World } from '@/sim/World';

const ENEMY_DEFS = {
  slime: { hp: 10, halfW: 5, h: 8, bounty: 0, gore: Cell.Slime, goreFn: slimeColor },
} satisfies Partial<Record<EnemyKind, EnemyDef>>;

function withMockLocalStorage(initial: Record<string, string> = {}): { restore: () => void; store: Map<string, string> } {
  const globals = globalThis as unknown as {
    localStorage?: Pick<Storage, 'getItem' | 'setItem'>;
  };
  const previous = globals.localStorage;
  const store = new Map<string, string>(Object.entries(initial));
  globals.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
  return {
    store,
    restore: () => {
      if (previous) globals.localStorage = previous;
      else delete globals.localStorage;
    },
  };
}

function withConsoleScripts(scripts: Record<string, string | string[]>): { restore: () => void; store: Map<string, string> } {
  return withMockLocalStorage({ [CONSOLE_SCRIPTS_KEY]: JSON.stringify(scripts) });
}

function makeCtx(): Ctx {
  const state: GameStateData = {
    mode: 'build',
    score: 0,
    frameCount: 0,
    activeInputMode: 'element',
    currentElement: Cell.Sand,
    currentSpell: 'bolt',
    currentBiome: 'earthen',
    brushSize: 3,
    playerSpawned: false,
    worldSeed: 1,
    paused: false,
    debugGodMode: false,
    postFx: createDefaultPostFxSettings(),
    editorLights: null,
    playtestSource: null,
  };
  const input: InputState = {
    keys: { left: false, right: false, up: false, jump: false, wallJump: false, down: false, grab: false },
    mouse: { x: 50, y: 50 },
    isDrawing: false,
    lastX: null,
    lastY: null,
    buildSpellHeld: false,
    bombCharge: -1,
    activeChargingBlackHole: null,
    siphonHeld: false,
    pourHeld: false,
    drinkHeld: false,
  };
  const world = new World();
  const player = createPlayer();
  player.x = 100;
  player.y = 120;
  const collection: CardId[] = [];
  const counters: Record<string, number> = { 'probe.ready': 2 };
  let perfVisible = false;
  const wands: WandsApi = {
    wands: [
      { frame: { id: 'a', name: 'A', capacity: 1, castDelay: 1, recharge: 1, manaMax: 1, manaRegen: 1, spread: 0 }, cards: [null], mana: 1, cooldown: 0, castIndex: 0 },
      { frame: { id: 'b', name: 'B', capacity: 1, castDelay: 1, recharge: 1, manaMax: 1, manaRegen: 1, spread: 0 }, cards: [null], mana: 1, cooldown: 0, castIndex: 0 },
    ],
    active: 0,
    collection,
    fire: () => undefined,
    update: () => undefined,
    grantCard: (_ctx, id) => {
      collection.push(id);
    },
    slotCard: () => undefined,
    snapshotLoadout: () => ({ active: 0, collection: [], wands: [] }),
    loadLoadout: () => undefined,
    grantReviewLoadout: () => undefined,
    upgradeFrame: () => false,
    nextCastSlots: () => [],
  };
  let current: LevelRuntime | null = null;
  const ctx = {
    world,
    events: new EventBus(),
    audio: { ensure: () => undefined },
    params: createGameParams(),
    state,
    input,
    fx: { bloomKick: 0, screenShake: 0, digBeam: null, hitstop: 0 },
    camera: {
      x: 0,
      y: 0,
      tx: 0,
      ty: 0,
      zoom: 1,
      zoomLock: null,
      idleFrames: 0,
      renderX: 0,
      renderY: 0,
      update: () => undefined,
      updateSimBounds: () => undefined,
      snapTo(x: number, y: number) {
        this.x = x;
        this.y = y;
        this.tx = x;
        this.ty = y;
      },
    },
    player,
    enemies: [],
    projectiles: [],
    shockwaves: [],
    waves: { num: 1, active: false, intermission: 0, kills: 0 },
    particles: { list: [], spawn: () => undefined, burst: () => undefined, update: () => undefined, clear: () => undefined },
    explosions: { trigger: () => undefined },
    lightning: { arcs: [], cast: () => undefined, update: () => undefined, clear: () => undefined },
    projectileCtl: { update: () => undefined },
    physics: {
      cellBlocks: () => false,
      entityFree: () => true,
      crushLooseDebris: () => undefined,
      tryMoveEntity: () => true,
    },
    playerCtl: { damage: () => undefined, kill: () => undefined, respawn: () => undefined, findSpawnPoint: () => ({ x: 100, y: 120 }), update: () => undefined },
    enemyCtl: {
      defs: ENEMY_DEFS as Record<EnemyKind, EnemyDef>,
      spawn(kind: EnemyKind, x: number, y: number) {
        ctx.enemies.push({
          kind,
          x,
          y,
          fx: 0,
          fy: 0,
          vx: 0,
          vy: 0,
          hp: 10,
          maxHp: 10,
          flash: 0,
          timer: 0,
          attackCd: 0,
          bobPhase: 0,
          grounded: false,
          stride: 0,
          splat: 0,
          prevG: false,
          blink: 0,
          jetFuel: 0,
          jetCd: 0,
          stuckT: 0,
          status: { wet: 0, oiled: 0, burning: 0, frozen: 0, electrified: 0, regen: 0, levity: 0, stoneskin: 0, swift: 0, torch: 0 },
        } satisfies Enemy);
      },
      damage: () => undefined,
      kill(enemy: Enemy) {
        const index = ctx.enemies.indexOf(enemy);
        if (index >= 0) ctx.enemies.splice(index, 1);
      },
      update: () => undefined,
    },
    spells: {
      wandTip: () => ({ x: 0, y: 0 }),
      digRay: () => null,
      erodeAt: () => undefined,
      executeWarp: () => false,
      firePlayerSpell: () => undefined,
      castBuildSpell: () => undefined,
      emitBuildFlame: () => undefined,
    },
    simulation: { accumulator: 0, update: () => undefined, processFrame: () => undefined },
    worldgen: { spawnHint: null, generateCaves: () => undefined, regenerate: () => undefined, spawnFortress: () => undefined, generateLevel: () => ({}) },
    waveCtl: { start: () => undefined, update: () => undefined },
    flask: { state: { material: null, count: 0, capacity: 100 }, update: () => undefined, throwFlask: () => undefined, bottleView: () => null },
    telemetry: {
      count: (key, n = 1) => {
        counters[key] = (counters[key] ?? 0) + n;
      },
      all: () => ({ ...counters }),
    },
    perf: {
      get visible() {
        return perfVisible;
      },
      setVisible(visible: boolean) {
        perfVisible = visible;
        return perfVisible;
      },
      toggle() {
        perfVisible = !perfVisible;
        return perfVisible;
      },
    },
    levels: {
      get current() {
        return current;
      },
      get transitioning() {
        return false;
      },
      startDescent: () => undefined,
      update: () => undefined,
      respawnPoint: () => null,
      playCurrentWorld: () => undefined,
      seedReviewKit: () => undefined,
      saveExpedition: () => undefined,
      hasSavedExpedition: () => false,
      abandonExpedition: () => undefined,
      debugEnterLevel: (_ctx, id) => {
        current = { def: { id, name: id.toUpperCase(), biome: 'earthen', depth: 1, nextLevelId: null }, world, enemies: [], waystones: [], exit: null, explored: new Uint8Array(1), spawn: { x: 100, y: 120 }, regions: null, cauldron: null, pickups: [], portal: null, keyTaken: false, mechanisms: [], runeVaults: [] };
        return true;
      },
    },
    wands,
    pickups: { update: () => undefined },
    mechanisms: { update: () => undefined, strike: () => undefined, interact: () => false },
    sanctum: { isOpen: false, open: () => undefined, openShop: () => undefined },
    critters: { list: [], update: () => undefined, killAt: () => undefined },
  } as unknown as Ctx;
  ctx.console = createConsoleApi(ctx);
  return ctx;
}

describe('console registry', () => {
  it('tokenizes quoted arguments and trailing whitespace', () => {
    expect(tokenizeConsoleLine('cell "liquid nitrogen" 3 ')).toEqual({
      tokens: ['cell', 'liquid nitrogen', '3'],
      trailingSpace: true,
      quoteOpen: false,
    });
  });

  it('parses typed materials and relative coordinates', () => {
    const ctx = makeCtx();
    expect(parseCellType(ctx, 'water')).toBe(Cell.Water);
    expect(parseCellType(ctx, 'Liquid Nitrogen')).toBe(Cell.Nitrogen);
    expect(resolveRelativeCoord('~12', 100)).toBe(112);
    expect(resolveRelativeCoord('~-8', 100)).toBe(92);
  });

  it('dispatches help and command completion', async () => {
    const ctx = makeCtx();
    await expect(ctx.console.exec('help')).resolves.toMatchObject({ ok: true });
    expect(ctx.console.complete('sp')).toContain('spawn');
    expect(ctx.console.complete('cell wa')).toContain('water');
  });

  it('teleports with structured resolved coordinates', async () => {
    const ctx = makeCtx();
    const res = await ctx.console.exec('tp ~5 ~-3');
    expect(res.ok).toBe(true);
    expect(ctx.player.x).toBe(105);
    expect(ctx.player.y).toBe(117);
    expect(res.data).toMatchObject({ target: 'sandbox', resolved: { x: 105, y: 117, free: true } });
  });

  it('paints cells and reports data through the automation API', async () => {
    const ctx = makeCtx();
    const res = await ctx.console.exec('cell water 2');
    expect(res.ok).toBe(true);
    expect(ctx.world.types[ctx.world.idx(50, 50)]).toBe(Cell.Water);
    expect(res.data).toMatchObject({ target: 'sandbox', material: { id: Cell.Water }, radius: 2 });
  });

  it('fills and dumps bounded cell regions with structured data', async () => {
    const ctx = makeCtx();
    const fill = await ctx.console.exec('fill 10 12 12 13 water');
    const dump = await ctx.console.exec('dump 10 12 3 2');
    const count = await ctx.console.exec('count water 10 12 3 2');
    const tooLarge = await ctx.console.exec('fill 0 0 500 500 sand');

    expect(fill.ok).toBe(true);
    expect(fill.data).toMatchObject({
      target: 'sandbox',
      material: { id: Cell.Water },
      cells: 6,
      bounds: { x0: 10, y0: 12, x1: 12, y1: 13 },
    });
    expect(dump.ok).toBe(true);
    expect(dump.data).toMatchObject({ target: 'sandbox', origin: { x: 10, y: 12 }, size: { w: 3, h: 2 } });
    expect((dump.data as { types: number[][] }).types).toEqual([
      [Cell.Water, Cell.Water, Cell.Water],
      [Cell.Water, Cell.Water, Cell.Water],
    ]);
    expect(count).toMatchObject({ ok: true, data: { target: 'sandbox', material: { id: Cell.Water }, count: 6 } });
    expect(tooLarge.ok).toBe(false);
    expect(tooLarge.data).toMatchObject({ code: 'area-cap', command: 'fill' });
  });

  it('blocks raw Builder document target mutation', async () => {
    const ctx = makeCtx();
    const before = ctx.world.types[ctx.world.idx(50, 50)];
    const res = await ctx.console.exec('cell sand --target builder-document');
    expect(res.ok).toBe(false);
    expect(res.data).toMatchObject({ code: 'target-blocked', target: 'builder-document' });
    expect(ctx.world.types[ctx.world.idx(50, 50)]).toBe(before);
  });

  it('blocks sandbox cell reads while Builder Author is open', async () => {
    const ctx = makeCtx();
    const globals = globalThis as unknown as {
      document?: { body: { classList: { contains: (className: string) => boolean } } };
    };
    const previousDocument = globals.document;
    globals.document = { body: { classList: { contains: (className: string) => className === 'builder-open' } } };
    try {
      const res = await ctx.console.exec('dump 0 0 1 1 @sandbox');
      expect(res.ok).toBe(false);
      expect(res.data).toMatchObject({ code: 'target-blocked', command: 'dump', target: 'sandbox', reason: 'builder-open' });
    } finally {
      if (previousDocument) globals.document = previousDocument;
      else delete globals.document;
    }
  });

  it('rejects duplicate explicit targets before mutation', async () => {
    const ctx = makeCtx();
    const cases = [
      'cell water @sandbox @expedition',
      'cell water --target sandbox --target=expedition',
      'cell water --target=sandbox @expedition',
    ];
    for (const line of cases) {
      const before = ctx.world.types[ctx.world.idx(50, 50)];
      const res = await ctx.console.exec(line);
      expect(res.ok).toBe(false);
      expect(res.data).toMatchObject({ code: 'target-duplicate', first: 'sandbox', duplicate: 'expedition' });
      expect(ctx.world.types[ctx.world.idx(50, 50)]).toBe(before);
    }
  });

  it('does not infer Builder playtest target from a non-Builder custom runtime', async () => {
    const ctx = makeCtx();
    ctx.state.mode = 'play';
    ctx.levels.debugEnterLevel(ctx, 'custom');

    const implicit = await ctx.console.exec('count sand');
    const builderTarget = await ctx.console.exec('count sand --target builder-playtest');
    const expeditionRuntime = await ctx.console.exec('find pickup --target expedition');

    expect(implicit.ok).toBe(true);
    expect(implicit.data).toMatchObject({ target: 'expedition' });
    expect(builderTarget.ok).toBe(false);
    expect(builderTarget.data).toMatchObject({
      code: 'target-inactive',
      command: 'count',
      target: 'builder-playtest',
      mode: 'play',
      level: 'custom',
      playtestSource: null,
    });
    expect(expeditionRuntime.ok).toBe(false);
    expect(expeditionRuntime.data).toMatchObject({ code: 'not-found', kind: 'pickup', target: 'expedition' });
  });

  it('blocks persistent-state commands in Builder playtest target', async () => {
    const ctx = makeCtx();
    ctx.state.mode = 'play';
    ctx.state.playtestSource = 'builder';
    ctx.levels.debugEnterLevel(ctx, 'custom');

    const before = {
      debugGodMode: ctx.state.debugGodMode,
      score: ctx.state.score,
      maxHp: ctx.player.maxHp,
      hp: ctx.player.hp,
      cards: ctx.wands.collection.length,
    };
    const god = await ctx.console.exec('god --target builder-playtest');
    const give = await ctx.console.exec('give gold 50 --target builder-playtest');
    const heal = await ctx.console.exec('heal full --target builder-playtest');
    const gold = await ctx.console.exec('gold 50 --target builder-playtest');

    expect(god.ok).toBe(false);
    expect(god.data).toMatchObject({ code: 'target-blocked', target: 'builder-playtest', reason: 'persistent-state' });
    expect(give.ok).toBe(false);
    expect(give.data).toMatchObject({ code: 'target-blocked', target: 'builder-playtest', reason: 'persistent-state' });
    expect(heal.ok).toBe(false);
    expect(heal.data).toMatchObject({ code: 'target-blocked', target: 'builder-playtest', reason: 'persistent-state' });
    expect(gold.ok).toBe(false);
    expect(gold.data).toMatchObject({ code: 'target-blocked', target: 'builder-playtest', reason: 'persistent-state' });
    expect({
      debugGodMode: ctx.state.debugGodMode,
      score: ctx.state.score,
      maxHp: ctx.player.maxHp,
      hp: ctx.player.hp,
      cards: ctx.wands.collection.length,
    }).toEqual(before);
  });

  it('sets and gets live params without tainting debug saves', async () => {
    const ctx = makeCtx();
    const set = await ctx.console.exec('set global.simSpeed 0.5');
    const get = await ctx.console.exec('get global.simSpeed');
    expect(set.ok).toBe(true);
    expect(get).toMatchObject({ ok: true, data: { path: 'global.simSpeed', value: 0.5 } });
    expect(ctx.state.debugGodMode).toBe(false);
  });

  it('runs localStorage scripts through exec with assert gating', async () => {
    const storage = withConsoleScripts({
      smoke: [
        'set global.simSpeed 0.6',
        'assert global.simSpeed == 0.6',
        'gpu off',
      ],
    });
    try {
      const ctx = makeCtx();
      const res = await ctx.console.exec('exec smoke');

      expect(res.ok).toBe(true);
      expect(res.data).toMatchObject({ code: 'script-complete', name: 'smoke', commands: 3 });
      expect(ctx.params.global.simSpeed).toBe(0.6);
      expect(ctx.state.postFx.gpuCompose).toBe(false);
      expect(ctx.state.debugGodMode).toBe(false);
      expect(ctx.console.complete('exec sm')).toContain('smoke');
    } finally {
      storage.restore();
    }
  });

  it('exec fails fast on failed assert and reports the script line', async () => {
    const storage = withConsoleScripts({
      bad: [
        'set global.simSpeed 0.5',
        'assert global.simSpeed >= 1',
        'set global.simSpeed 1.5',
      ],
    });
    try {
      const ctx = makeCtx();
      const res = await ctx.console.exec('exec bad');

      expect(res.ok).toBe(false);
      expect(res.data).toMatchObject({ code: 'script-failed', name: 'bad', lineNumber: 2 });
      expect(ctx.params.global.simSpeed).toBe(0.5);
      expect(ctx.state.debugGodMode).toBe(false);
    } finally {
      storage.restore();
    }
  });

  it('keeps concurrent top-level exec calls isolated from nested recursion checks', async () => {
    const storage = withConsoleScripts({
      alpha: [
        'set global.simSpeed 0.4',
        'assert global.simSpeed >= 0.4',
      ],
      beta: [
        'gpu off',
        'assert postFx.gpuCompose == false',
      ],
      cycle: ['exec cycle'],
    });
    try {
      const ctx = makeCtx();
      const [alpha, beta] = await Promise.all([
        ctx.console.exec('exec alpha'),
        ctx.console.exec('exec beta'),
      ]);
      const after = await ctx.console.exec('exec alpha');
      const cycle = await ctx.console.exec('exec cycle');

      expect(alpha).toMatchObject({ ok: true, data: { code: 'script-complete', name: 'alpha' } });
      expect(beta).toMatchObject({ ok: true, data: { code: 'script-complete', name: 'beta' } });
      expect(after).toMatchObject({ ok: true, data: { code: 'script-complete', name: 'alpha' } });
      expect(cycle.ok).toBe(false);
      expect(cycle.data).toMatchObject({ code: 'script-failed', name: 'cycle' });
      expect((cycle.data as { results: Array<{ data?: { code?: string } }> }).results[0].data).toMatchObject({ code: 'script-cycle' });
    } finally {
      storage.restore();
    }
  });

  it('manages watch and bind preferences without touching gameplay state', async () => {
    const storage = withMockLocalStorage();
    try {
      const ctx = makeCtx();
      const watch = await ctx.console.exec('watch global.simSpeed');
      const list = await ctx.console.exec('watch list');
      const unwatch = await ctx.console.exec('watch global.simSpeed');
      const bind = await ctx.console.exec('bind F4 time 0.5');
      const bindList = await ctx.console.exec('bind list');
      const invalidBind = await ctx.console.exec('bind KeyW time 1');
      const clearBind = await ctx.console.exec('bind F4 clear');

      expect(watch).toMatchObject({ ok: true, data: { action: 'watch', path: 'global.simSpeed', watching: true } });
      expect(list).toMatchObject({ ok: true, data: { watches: ['global.simSpeed'] } });
      expect(unwatch).toMatchObject({ ok: true, data: { action: 'watch', path: 'global.simSpeed', watching: false } });
      expect(JSON.parse(storage.store.get(CONSOLE_WATCHES_KEY) ?? '[]')).toEqual([]);
      expect(bind).toMatchObject({ ok: true, data: { action: 'bind', key: 'F4', command: 'time 0.5' } });
      expect(bindList).toMatchObject({ ok: true, data: { binds: { F4: 'time 0.5' } } });
      expect(invalidBind).toMatchObject({ ok: false, data: { code: 'bind-key-invalid' } });
      expect(clearBind).toMatchObject({ ok: true, data: { action: 'bind', key: 'F4', command: null } });
      expect(JSON.parse(storage.store.get(CONSOLE_BINDS_KEY) ?? '{}')).toEqual({});
      expect(ctx.state.debugGodMode).toBe(false);
    } finally {
      storage.restore();
    }
  });

  it('sanitizes persisted watch and bind preferences', async () => {
    const storage = withMockLocalStorage({
      [CONSOLE_BINDS_KEY]: JSON.stringify({ F4: 'time 0.5', KeyW: 'time 2', F11: 'time 3' }),
      [CONSOLE_WATCHES_KEY]: JSON.stringify([
        'global.simSpeed',
        'bad.path',
        '',
        ...Array.from({ length: 20 }, (_v, i) => `postFx.param${i}`),
      ]),
    });
    try {
      const ctx = makeCtx();
      const bindList = await ctx.console.exec('bind list');
      const watchList = await ctx.console.exec('watch list');
      const bindStorage = JSON.parse(storage.store.get(CONSOLE_BINDS_KEY) ?? '{}') as Record<string, string>;
      const watchStorage = JSON.parse(storage.store.get(CONSOLE_WATCHES_KEY) ?? '[]') as string[];

      expect(bindList).toMatchObject({ ok: true, data: { binds: { F4: 'time 0.5' } } });
      expect(bindStorage).toEqual({ F4: 'time 0.5' });
      expect(watchList.ok).toBe(true);
      expect(watchStorage).toHaveLength(12);
      expect(watchStorage).toContain('global.simSpeed');
      expect(watchStorage).not.toContain('bad.path');
    } finally {
      storage.restore();
    }
  });

  it('reports screenshot as unavailable outside the browser runtime', async () => {
    const ctx = makeCtx();
    const res = await ctx.console.exec('screenshot');

    expect(res).toMatchObject({ ok: false, data: { code: 'ui-unavailable' } });
  });

  it('supports Phase 2 readouts and live tuning without taint', async () => {
    const ctx = makeCtx();
    const time = await ctx.console.exec('time 0.8');
    const gpu = await ctx.console.exec('gpu off');
    const pos = await ctx.console.exec('pos');
    const tele = await ctx.console.exec('tele');

    expect(time).toMatchObject({ ok: true, data: { path: 'global.simSpeed', value: 0.8, tainted: false } });
    expect(gpu).toMatchObject({ ok: true, data: { path: 'postFx.gpuCompose', value: false, tainted: false } });
    expect(pos).toMatchObject({ ok: true, data: { mode: 'build', player: { x: 100, y: 120 } } });
    expect(tele).toMatchObject({ ok: true, data: { counters: { 'probe.ready': 2 } } });
    expect(ctx.state.debugGodMode).toBe(false);
  });

  it('finds runtime pickups, mechanisms, and portals', async () => {
    const ctx = makeCtx();
    ctx.state.mode = 'play';
    ctx.levels.debugEnterLevel(ctx, 'd1');
    const runtime = ctx.levels.current;
    expect(runtime).not.toBeNull();
    runtime!.pickups.push({ kind: 'key', x: 105, y: 118, vx: 0, vy: 0, taken: false, data: {} });
    runtime!.mechanisms.push({ id: 7, kind: 'lever', x: 130, y: 140, w: 1, h: 1, state: 0, targetId: -1 });
    runtime!.portal = { x: 160, y: 170, open: false };

    const pickup = await ctx.console.exec('find pickup');
    const mechanism = await ctx.console.exec('find mechanism');
    const portal = await ctx.console.exec('find portal');

    expect(pickup).toMatchObject({ ok: true, data: { target: 'expedition', item: { kind: 'key', x: 105, y: 118 } } });
    expect(mechanism).toMatchObject({ ok: true, data: { target: 'expedition', item: { id: 7, kind: 'lever' } } });
    expect(portal).toMatchObject({ ok: true, data: { target: 'expedition', item: { x: 160, y: 170, open: false } } });
  });

  it('does not read parked expedition runtime metadata for sandbox find target', async () => {
    const ctx = makeCtx();
    ctx.state.mode = 'play';
    ctx.levels.debugEnterLevel(ctx, 'd1');
    ctx.levels.current!.pickups.push({ kind: 'key', x: 105, y: 118, vx: 0, vy: 0, taken: false, data: {} });
    ctx.state.mode = 'build';

    const res = await ctx.console.exec('find pickup @sandbox');

    expect(res.ok).toBe(false);
    expect(res.data).toMatchObject({ code: 'runtime-unavailable', command: 'find', target: 'sandbox' });
  });

  it('taints normal expedition for Phase 2 gameplay mutations', async () => {
    const ctx = makeCtx();
    ctx.state.mode = 'play';
    ctx.player.hp = 10;
    ctx.levels.debugEnterLevel(ctx, 'd1');

    const heal = await ctx.console.exec('heal full');
    const gold = await ctx.console.exec('gold 25');

    expect(heal.ok).toBe(true);
    expect(gold.ok).toBe(true);
    expect(ctx.player.hp).toBe(ctx.player.maxHp);
    expect(ctx.state.score).toBe(25);
    expect(ctx.state.debugGodMode).toBe(true);
  });

  it('does not taint expedition saves when give validation fails', async () => {
    const ctx = makeCtx();
    ctx.state.mode = 'play';
    ctx.levels.debugEnterLevel(ctx, 'd1');

    const badAmount = await ctx.console.exec('give gold nope');
    const badKind = await ctx.console.exec('give bogus');

    expect(badAmount.ok).toBe(false);
    expect(badKind.ok).toBe(false);
    expect(ctx.state.score).toBe(0);
    expect(ctx.state.debugGodMode).toBe(false);
  });

  it('caps enemy spawn count', async () => {
    const ctx = makeCtx();
    const res = await ctx.console.exec('spawn slime 33');
    expect(res.ok).toBe(false);
    expect(ctx.enemies).toHaveLength(0);
  });
});

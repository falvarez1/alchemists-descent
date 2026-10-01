import { beforeEach, describe, expect, it } from 'vitest';

import { HEIGHT, WIDTH } from '@/config/constants';
import { GEN } from '@/config/gen';
import { createDefaultPostFxSettings } from '@/config/params';
import { LEVELS } from '@/config/worldgraph';
import { EventBus } from '@/core/events';
import type { Ctx, GameStateData, LevelDef, LockKind, Mechanism } from '@/core/types';
import { makePlug, makeRelay, makeSensor } from '@/core/mechanismFactories';
import { LOCK_FAR_OBJECTIVE, LOCK_TEXT, lockFocus, lockObjective, lockOf } from '@/game/lockText';
import { Mechanisms } from '@/game/Mechanisms';
import { makeLevelRuntime } from '@/game/runtime';
import { Cell, blocksEntity } from '@/sim/CellType';
import { World } from '@/sim/World';
import { WorldGen } from '@/world/CaveGenerator';
import { LOCK_RELENT_FRAMES, PLUG_DEPTH, PLUG_HEIGHT } from '@/world/locks';
import { bellInterior, bellLayout, BELL } from '@/world/lockGasBell';
import { reachableMask, routeSealedWorld, validateFindability, wizardMask } from '@/world/validate';

/**
 * THE LOCKS (world/locks, GEN 64): each campaign floor's key vault is a signature puzzle chamber on the
 * route, sealed by a Metal door the floor's own machine breaks. This file holds the generation contracts
 * (the room, the chain, the seal, findability, the floors that have no lock) and the mechanism contracts
 * (the relent, the vent). The chemistry itself is PLAYED by scripts/verify-gas-bell.mjs (real input).
 */

const noop = (): undefined => undefined;
function noopSubsystem(): unknown {
  return new Proxy({}, { get: () => noop });
}

function makeGenCtx(world: World, worldSeed: number, biome: LevelDef['biome']): Ctx {
  const state = {
    mode: 'build', score: 0, frameCount: 0, activeInputMode: 'element', currentElement: Cell.Sand,
    currentSpell: 'bolt', currentBiome: biome, brushSize: 6, playerSpawned: false, worldSeed,
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

function generate(def: LevelDef, seed: number): ReturnType<WorldGen['generateLevel']> & { world: World } {
  const world = new World();
  const gen = new WorldGen();
  const ctx = makeGenCtx(world, seed, def.biome);
  ctx.worldgen = gen;
  return { ...gen.generateLevel(ctx, def, seed), world };
}

function runtimeOf(level: ReturnType<typeof generate>, def: LevelDef) {
  return makeLevelRuntime({
    def, world: level.world, spawn: level.spawn, regions: null, mechanisms: level.mechanisms, pickups: level.pickups,
    portal: level.portal, exit: level.exit, waystones: level.waystones, cauldron: level.cauldron, runeVaults: level.runeVaults,
    placedPrefabs: level.placedPrefabs, ...(level.emitters.length > 0 ? { emitters: level.emitters } : {}),
  });
}

describe('the Gas Bell (d2)', () => {
  for (const seed of [1337, 5, 42]) {
    describe(`seed ${seed}`, () => {
      const level = generate(LEVELS.d2, seed);
      const runtime = runtimeOf(level, LEVELS.d2);
      const plug = level.mechanisms.find((m) => m.kind === 'plug' && m.lock === 'gasbell')!;
      const room = level.placedPrefabs.find((p) => p.id === 'lock-gas-bell')!;

      it('lays a lock room on the floor, with one vault door and one key', () => {
        expect(room).toBeTruthy();
        expect(plug).toBeTruthy();
        expect(plug.routeSeal).toBe(true);
        expect(plug.material).toBe(Cell.Metal);
        expect(plug.body!.length).toBe(PLUG_DEPTH * PLUG_HEIGHT);
        expect(plug.relentFrames).toBe(LOCK_RELENT_FRAMES);
        const keys = level.pickups.filter((p) => p.kind === 'key');
        expect(keys.length).toBe(1);
        // the key stands inside the vault: right of the door, within the room, behind the door's face
        expect(keys[0].x).toBeGreaterThan(plug.x + plug.w);
        expect(keys[0].x).toBeLessThan(room.x1);
        expect(keys[0].y).toBeGreaterThan(plug.y - 5);
        expect(keys[0].y).toBeLessThan(plug.y + plug.h + 3);
        // no pocket vault was carved as well
        expect(level.placedPrefabs.filter((p) => p.id.startsWith('lock-')).length).toBe(1);
      });

      it('chains clapper -> relay -> door, and the vent halts on the clapper', () => {
        const relay = level.mechanisms.find((m) => m.kind === 'relay' && m.targetId === plug.id)!;
        expect(relay.outputAction).toBe('break');
        const sensor = level.mechanisms.find((m) => m.kind === 'sensor' && m.targetId === relay.id)!;
        expect(sensor.sensorType).toBe('heat');
        expect(sensor.latch).toBe('permanent');
        expect(sensor.cue).toBe('lock.bell');
        const vent = level.emitters.find((e) => e.cell === Cell.MarshGas && e.haltOn === sensor.id)!;
        expect(vent).toBeTruthy();
        expect(vent.cap!.max).toBeGreaterThan(300);
        expect(lockFocus(runtime, plug)).toEqual({ x: sensor.x, y: sensor.y });
      });

      it('hangs the bell full of marsh gas, glass porthole at wand height, vent pipe open to the hall', () => {
        const sensor = level.mechanisms.find((m) => m.kind === 'sensor' && m.sensorType === 'heat' && m.lock === undefined && m.cue === 'lock.bell')!;
        const L = bellLayout({ x0: room.x0, y0: room.y0 }, { id: 'lock-gas-bell', w: room.x1 - room.x0 + 1, h: room.y1 - room.y0 + 1, minSpawnDist: 0 });
        expect(L.bx).toBe(sensor.x);
        const inside = bellInterior(L);
        let gas = 0;
        for (const [x, y] of inside) if (level.world.types[level.world.idx(x, y)] === Cell.MarshGas) gas++;
        expect(gas).toBeGreaterThan(inside.length - 6);
        // a glass porthole on the west face, centred on a standing alchemist's wand height (feet - 9)
        let glass = 0;
        for (let y = L.portY0; y <= L.portY1; y++) for (let x = L.portHoleX; x <= L.portHoleX + BELL.wall + 2; x++) if (level.world.types[level.world.idx(x, y)] === Cell.Glass) glass++;
        expect(glass).toBeGreaterThan(14);
        expect(L.portY1).toBeLessThan(L.floorY - 24); // the porthole is in the bell's belly: a bolt is aimed up to it
        expect(level.world.types[level.world.idx(L.bx, L.by - BELL.ry)]).toBe(Cell.Metal);
        expect(level.world.types[level.world.idx(L.bx, L.by - BELL.ry - 3)]).toBe(Cell.Metal); // the chain
        // the bell is connected to the hall's air by its pipe (the findability audit sees the clapper)
        const seen = reachableMask({ world: level.world, spawn: level.spawn });
        expect(seen[level.world.idx(L.pipeX, L.by)]).toBe(1);
        expect(seen[level.world.idx(L.pipeX, L.bottomY + 2)]).toBe(1);
        // ...and a body can walk under it (the clear gap holds a 17-cell alchemist)
        for (let y = L.floorY - 18; y < L.floorY; y++) expect(blocksEntity(level.world.types[level.world.idx(L.bx, y)]), `under the bell at ${y}`).toBe(false);
      });

      it('seals the key: unreachable while the door stands, reachable with it open, and findability is clean', () => {
        const key = level.pickups.find((p) => p.kind === 'key')!;
        const sealed = wizardMask({ world: level.world, spawn: level.spawn });
        expect(sealed[level.world.idx(Math.floor(key.x), Math.floor(key.y) - 3)]).toBe(0);
        const open = wizardMask({ world: routeSealedWorld(level.world, level.mechanisms), spawn: level.spawn });
        expect(open[level.world.idx(Math.floor(key.x), Math.floor(key.y) - 3)]).toBe(1);
        expect(validateFindability(runtime).filter((i) => i.severity === 'error')).toEqual([]);
      });

      it('is a closed Metal box: every cell of its shell is Metal', () => {
        const L = bellLayout({ x0: room.x0, y0: room.y0 }, { id: 'lock-gas-bell', w: room.x1 - room.x0 + 1, h: room.y1 - room.y0 + 1, minSpawnDist: 0 });
        const vx1 = room.x1 - 12, vx0 = vx1 - 18, floorY = L.floorY;
        for (let y = floorY - 28; y <= floorY + 2; y++) {
          for (const x of [vx1 + 1, vx1 + 2, vx1 + 3]) expect(level.world.types[level.world.idx(x, y)], `${x},${y}`).toBe(Cell.Metal);
        }
        for (let x = plug.x; x <= vx1 + 3; x++) {
          expect(level.world.types[level.world.idx(x, floorY - 28)], `lintel ${x}`).toBe(Cell.Metal);
          expect(level.world.types[level.world.idx(x, floorY + 2)], `sill ${x}`).toBe(Cell.Metal);
        }
        expect(blocksEntity(level.world.types[level.world.idx(vx0 + 2, floorY - 30)])).toBe(false); // nothing above the box
      });
    });
  }

  it('is deterministic per seed', () => {
    const a = generate(LEVELS.d2, 7), b = generate(LEVELS.d2, 7);
    expect(Buffer.compare(Buffer.from(a.world.types), Buffer.from(b.world.types))).toBe(0);
    expect(a.pickups.find((p) => p.kind === 'key')).toEqual(b.pickups.find((p) => p.kind === 'key'));
  });
});

describe('floors without a lock are untouched', () => {
  it('only the floors with a GenDef.lock draw one', () => {
    expect(GEN.fungal.lock).toBe('gasbell');
    for (const biome of ['earthen', 'frozen', 'crystal', 'timber', 'scorched'] as const) expect(GEN[biome].lock, biome).toBeUndefined();
  });

  it('the Cold Store keeps its pocket vault and generates no lock room', () => {
    const level = generate(LEVELS.d2b, 1337);
    expect(level.placedPrefabs.some((p) => p.id.startsWith('lock-'))).toBe(false);
    expect(level.mechanisms.some((m) => m.lock)).toBe(false);
    expect(level.pickups.filter((p) => p.kind === 'key').length).toBe(1);
  });
});

describe('the lock plug (mechanism contract)', () => {
  let ctx: Ctx;
  let world: World;
  let list: Mechanism[];
  let events: EventBus;
  let toasts: string[];
  let mech: Mechanisms;
  let lockEvents: Array<{ kind: LockKind; phase: string }>;
  const emitters: Array<{ x: number; y: number; cell: number; rate: number; dir: 0 | 90 | 180 | 270; burst: number; phase: number; cap?: { x0: number; y0: number; x1: number; y1: number; max: number }; haltOn?: number }> = [];

  beforeEach(() => {
    world = new World();
    events = new EventBus();
    list = [];
    toasts = [];
    lockEvents = [];
    emitters.length = 0;
    events.on('toast', ({ text }) => toasts.push(text));
    events.on('lockChanged', (e) => lockEvents.push({ kind: e.kind, phase: e.phase }));
    ctx = {
      world, events, enemies: [],
      player: { x: 100, y: 100, dead: false, pullT: 0, pullDir: 1, facing: 1 },
      state: { mode: 'play', paused: false, frameCount: 1, currentBiome: 'fungal' },
      audio: { sfx: noop, creature: noop, tone: noop, groan: noop, zap: noop, bubble: noop, brazier: noop, lever: noop, doorGrind: noop, boom: noop },
      particles: { spawn: noop, burst: noop, clear: noop },
      enemyCtl: { defs: {} },
      levels: { current: { mechanisms: list, runeVaults: [], emitters, pickups: [], def: LEVELS.d2, keyTaken: false } },
      fx: { screenShake: 0 },
    } as unknown as Ctx;
    mech = new Mechanisms(ctx);
  });
  const step = (n: number): void => { for (let i = 0; i < n; i++) { ctx.state.frameCount++; mech.update(ctx); } };

  function door(): Mechanism {
    const plug = makePlug(world, list, 300, 300, 20, 20, Cell.Metal, null, 0.95);
    plug.routeSeal = true;
    plug.lock = 'gasbell';
    plug.relentFrames = 500;
    return plug;
  }

  it('a fired relay breaks the door: its cells clear, the key is free, the lock announces it opened', () => {
    const plug = door();
    for (let dx = -1; dx <= 1; dx++) world.types[world.idx(290 + dx, 291)] = Cell.Metal; // the relay's footing
    const relay = makeRelay(list, 290, 290, { delayFrames: 10, outputAction: 'break' }, plug);
    const sensor = makeSensor(world, list, 200, 300, { sensorType: 'heat', threshold: 4, zone: { x0: 195, y0: 295, x1: 205, y1: 299 }, latch: 'permanent' }, relay);
    step(5);
    expect(plug.state).toBe(0);
    for (let x = 196; x < 202; x++) world.types[world.idx(x, 297)] = Cell.Fire;
    step(8); // the zone is scanned every 4 frames
    expect(sensor.state).toBe(1);
    expect(relay.fuseT).toBeDefined();
    step(14);
    expect(relay.state).toBe(1);
    expect(plug.state).toBe(1);
    expect(world.types[world.idx(310, 310)]).toBe(Cell.Empty);
    expect(lockEvents).toContainEqual({ kind: 'gasbell', phase: 'opened' });
  });

  it('a blast, the ray and fire leave the Metal door be (it never fires on cell loss it cannot suffer)', () => {
    const plug = door();
    step(50);
    expect(plug.state).toBe(0);
    expect(plug.relentFrames).toBeLessThan(500);
  });

  it('THE WORKS RELENT: a door still shut when its clock runs out cracks open, once, and says so', () => {
    const plug = door();
    step(499);
    expect(plug.state).toBe(0);
    step(3);
    expect(plug.state).toBe(1);
    expect(plug.relentFrames).toBeUndefined();
    expect(world.types[world.idx(310, 310)]).toBe(Cell.Empty);
    expect(lockEvents.filter((e) => e.phase === 'relented').length).toBe(1);
    expect(lockEvents.filter((e) => e.phase === 'opened').length).toBe(0);
    step(600);
    expect(lockEvents.filter((e) => e.phase === 'relented').length).toBe(1);
  });

  it('a door the machine opened does not relent afterwards', () => {
    const plug = door();
    plug.relentFrames = 5000;
    const relay = makeRelay(list, 290, 290, { outputAction: 'break' }, plug);
    // a destroyed relay (its footing cells never stamped) fires for itself after its groan
    step(31); // the 30-frame audit marks it wrecked
    expect(relay.broken).toBeGreaterThan(0);
    step(1900); // the groan runs out, the relay fires, the door breaks
    expect(plug.state).toBe(1);
    expect(plug.relentFrames).toBeUndefined();
    expect(lockEvents.filter((e) => e.phase === 'relented').length).toBe(0);
  });

  it('announces the machine the first time the alchemist is within sight (once)', () => {
    const plug = door();
    const sensor = makeSensor(world, list, 200, 300, { sensorType: 'heat', threshold: 4, zone: { x0: 195, y0: 295, x1: 205, y1: 299 }, latch: 'permanent' }, makeRelay(list, 290, 290, { outputAction: 'break' }, plug));
    (list.find((m) => m.kind === 'relay')!).targetId = plug.id;
    sensor.targetId = list.find((m) => m.kind === 'relay')!.id;
    ctx.player.x = 900; ctx.player.y = 900;
    step(90);
    expect(lockEvents.filter((e) => e.phase === 'seen').length).toBe(0);
    ctx.player.x = 230; ctx.player.y = 300;
    step(90);
    expect(lockEvents.filter((e) => e.phase === 'seen').length).toBe(1);
    step(120);
    expect(lockEvents.filter((e) => e.phase === 'seen').length).toBe(1);
  });

  it('a vent drips while its cap is open and halts for good on its latch', () => {
    const sensor: Mechanism = { id: 77, kind: 'sensor', x: 50, y: 50, w: 1, h: 1, state: 0, targetId: -1 };
    list.push(sensor);
    emitters.push({ x: 500, y: 500, cell: Cell.MarshGas, rate: 4, dir: 180, burst: 1, phase: 0, cap: { x0: 480, y0: 470, x1: 520, y1: 500, max: 2 }, haltOn: 77 });
    const gasIn = (): number => {
      let n = 0;
      for (let y = 470; y <= 500; y++) for (let x = 480; x <= 520; x++) if (world.types[world.idx(x, y)] === Cell.MarshGas) n++;
      return n;
    };
    // (the test runs no sim, so a drip never rises: move the gas up one by hand as the sim would)
    const rise = (): void => { world.types[world.idx(500, 499)] = Cell.Empty; world.types[world.idx(500, 490)] = Cell.MarshGas; };
    step(8);
    expect(gasIn()).toBe(1);
    rise();
    step(8);
    expect(gasIn()).toBe(2);
    rise();
    world.types[world.idx(500, 489)] = Cell.MarshGas; // the vent sees 2+ about: the cap holds it
    step(24);
    expect(world.types[world.idx(500, 499)]).toBe(Cell.Empty);
    for (let y = 470; y <= 500; y++) for (let x = 480; x <= 520; x++) world.types[world.idx(x, y)] = Cell.Empty;
    sensor.state = 1;
    step(24);
    expect(gasIn()).toBe(0); // the clapper has rung: the vent is shut for good
  });
});

describe('the lock\'s voice', () => {
  it('every lock has every line, and the portal toast of a key floor names it', () => {
    for (const kind of Object.keys(LOCK_TEXT) as LockKind[]) {
      const c = LOCK_TEXT[kind];
      for (const field of ['name', 'near', 'open', 'hint', 'teachTitle', 'teachBody', 'placeName', 'placeDescription'] as const) expect(c[field].length, `${kind}.${field}`).toBeGreaterThan(6);
      if (kind !== 'crucible') expect(c.sealed.length, `${kind}.sealed`).toBeGreaterThan(8);
    }
  });

  it('the objective is generic far from the machine, names the puzzle near it and the reward once open', () => {
    const level = generate(LEVELS.d2, 1337);
    const runtime = runtimeOf(level, LEVELS.d2);
    const plug = lockOf(runtime)!;
    const at = lockFocus(runtime, plug);
    expect(lockObjective(runtime, { x: at.x + 900, y: at.y })).toBe(LOCK_FAR_OBJECTIVE);
    expect(lockObjective(runtime, { x: at.x + 40, y: at.y + 30 })).toBe(LOCK_TEXT.gasbell.near);
    plug.state = 1;
    expect(lockObjective(runtime, { x: 0, y: 0 })).toBe(LOCK_TEXT.gasbell.open);
    runtime.keyTaken = true;
    expect(lockObjective(runtime, { x: 0, y: 0 })).toBeNull();
  });
});

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '@/core/types';
import { EventBus } from '@/core/events';
import { initRapier } from '@/entities/rapierInit';
import { RigidBodies } from '@/entities/RigidBodies';
import { TeaMachine, restoreTeaMachine } from '@/game/TeaMachine';
import { createLivingState } from '@/game/LivingExpedition';
import { makeLevelRuntime } from '@/game/runtime';
import { LEVELS } from '@/config/worldgraph';
import { TEA, TEA_BODIES, stampTeaMachine, teaRect } from '@/world/teaMachine';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { Simulation } from '@/sim/Simulation';
import { createGameParams } from '@/config/params';
import { Levels } from '@/game/Levels';
import { Pickups, makePickup } from '@/game/Pickups';

beforeAll(() => initRapier());

function fixture() {
  const world = new World();
  const ctx = { world, events: new EventBus(), state: { mode: 'play', frameCount: 0 },
    camera: { actionFocus: null }, player: { x: 430, y: 305, dead: true, perks: {} },
    input: { keys: {}, mouse: { x: 0, y: 0 } }, fx: { digBeam: null }, debug: { active: false },
    enemies: [], particles: { spawn: vi.fn(), burst: vi.fn() },
    audio: { at: (_x: number, _y: number, fn: () => void) => fn(), zap: vi.fn(), lever: vi.fn(), bubble: vi.fn() },
    telemetry: { count: vi.fn() }, } as unknown as Ctx;
  const rigid = new RigidBodies(ctx); ctx.rigidBodies = rigid;
  const runtime = makeLevelRuntime({ world, def: LEVELS.d1, spawn: { x: 170, y: 314 }, living: createLivingState() });
  ctx.levels = { current: runtime } as Ctx['levels'];
  return { ctx, rigid, world, runtime };
}

describe('machine physics', () => {
  it.each([41, 777, 1337])('the finite lava supply boils real water and drives the kettle piston to its trip (seed %i)', seed => {
    const { ctx, rigid, world, runtime } = fixture();
    ctx.params = createGameParams(); ctx.state.worldSeed = seed;
    ctx.shockwaves = [];
    ctx.projectileCtl = { update: vi.fn() } as unknown as Ctx['projectileCtl'];
    ctx.audio = new Proxy({}, { get: () => () => undefined }) as Ctx['audio'];
    stampTeaMachine(world, runtime.mechanisms);
    Object.assign(world.simBounds, { x0: 1195, y0: 45, x1: 1270, y1: 240 });
    const def = TEA_BODIES.find(d => d.key === 'piston')!;
    const piston = rigid.spawn(def.shape, def.x, def.y, def.opts);
    const sim = new Simulation();
    for (let i = 0; i < 240; i++) { ctx.state.frameCount++; sim.update(ctx); rigid.update(ctx); }
    teaRect(world, TEA.lavaGate, Cell.Empty);
    let minimumY = piston.y, maximumSteam = 0;
    for (let i = 0; i < 1200 && minimumY >= 175; i++) {
      ctx.state.frameCount++; sim.update(ctx); rigid.update(ctx);
      minimumY = Math.min(minimumY, piston.y);
      let n = 0; for(let x=1240;x<1260;x++)for(let y=196;y<203;y++)if(world.type(x,y)===Cell.Steam)n++;
      maximumSteam = Math.max(maximumSteam, n);
    }
    expect(minimumY, `maximum steam at rest face: ${maximumSteam}`).toBeLessThan(175);
    rigid.dispose();
  }, 30000);
  it('holds its armed pendulum and boulder still, then gravity swings the released bob into the boulder', () => {
    const { ctx, rigid, world, runtime } = fixture();
    stampTeaMachine(world, runtime.mechanisms);
    const [pd, bd] = TEA_BODIES;
    const bob = rigid.spawn(pd.shape, pd.x, pd.y, pd.opts);
    const rock = rigid.spawn(bd.shape, bd.x, bd.y, bd.opts);
    rigid.tieRope(bob, pd.rope!.x, pd.rope!.y, pd.rope!.length);
    for (let i = 0; i < 360; i++) { ctx.state.frameCount++; rigid.update(ctx); }
    expect(bob.x).toBeLessThan(608); expect(Math.abs(rock.x - 682)).toBeLessThan(1);
    teaRect(world, TEA.cradle, Cell.Empty); teaRect(world, TEA.cradleStop, Cell.Empty);
    for (let i = 0; i < 180; i++) { ctx.state.frameCount++; rigid.update(ctx); }
    expect(rock.x).toBeGreaterThan(808);
    expect(Math.hypot(bob.x - pd.rope!.x, bob.y - pd.rope!.y)).toBeLessThan(pd.rope!.length + 1);
    rigid.dispose();
  });

  it('cuts a hot rope and leaves the body free to fall; clearing frees its anchors', () => {
    const { ctx, rigid, world } = fixture();
    const bob = rigid.spawn({ kind: 'circle', radius: 4 }, 120, 100, { material: 'metal' });
    rigid.tieRope(bob, 120, 40, 60);
    teaRect(world, { x: 119, y: 68, w: 3, h: 6 }, Cell.Fire);
    rigid.update(ctx); expect(bob.rope).toBeUndefined();
    for (let i = 0; i < 20; i++) rigid.update(ctx);
    expect(bob.y).toBeGreaterThan(125);
    rigid.clear(); expect(rigid.bodies).toHaveLength(0); rigid.dispose();
  });

  it('steam lifts a piston only when material reaches its underside', () => {
    const { ctx, rigid, world } = fixture();
    const piston = rigid.spawn({ kind: 'box', halfW: 8, halfH: 3 }, 200, 100, { material: 'metal', steamPiston: true });
    teaRect(world, { x: 192, y: 105, w: 17, h: 5 }, Cell.Steam);
    rigid.update(ctx); rigid.update(ctx);
    expect(piston.vy).toBeLessThan(0);
    teaRect(world, { x: 180, y: 70, w: 40, h: 50 }, Cell.Empty);
    for (let i = 0; i < 12; i++) rigid.update(ctx);
    expect(piston.vy).toBeGreaterThan(0); rigid.dispose();
  });
});

describe('machine state and camera ownership', () => {
  it('requires both the completed machine and its collected bell at the main descent gate', () => {
    const { ctx, rigid, runtime } = fixture();
    ctx.player.dead = false; ctx.state.frameCount = 1;
    ctx.audio.portalWhoosh = vi.fn(); ctx.sanctum = { open: vi.fn() } as unknown as Ctx['sanctum'];
    const levels = new Levels(ctx);
    const internals = levels as unknown as { currentId: string; levels: Map<string, typeof runtime> };
    internals.currentId = 'd1'; internals.levels.set('d1', runtime); ctx.levels = levels;
    runtime.portal = { x: 430, y: 299, open: false };
    runtime.keyTaken = true; levels.update(ctx);
    expect(runtime.portal.open).toBe(false); expect(ctx.sanctum.open).not.toHaveBeenCalled();
    runtime.living!.tea = { stage: 9, ticks: 1000, stageTicks: 0, completed: true, stalled: false, bodies: [] };
    runtime.keyTaken = false; levels.update(ctx); expect(runtime.portal.open).toBe(false);
    runtime.keyTaken = true; levels.update(ctx);
    expect(runtime.portal.open).toBe(true); expect(ctx.sanctum.open).toHaveBeenCalledOnce();
    rigid.dispose();
  });

  it('keeps the bell uncollectible until the machine completes, then awards it on contact', () => {
    const { ctx, rigid, runtime } = fixture(); ctx.player.dead = false;
    ctx.audio.keyJingle = vi.fn();
    const bell = makePickup('key', ctx.player.x, ctx.player.y - 8); runtime.pickups.push(bell);
    const pickups = new Pickups(); pickups.update(ctx);
    expect(bell.taken).toBe(false); expect(runtime.keyTaken).toBe(false);
    runtime.living!.tea = { stage: 9, ticks: 1000, stageTicks: 0, completed: true, stalled: false, bodies: [] };
    pickups.update(ctx); expect(bell.taken).toBe(true); expect(runtime.keyTaken).toBe(true);
    rigid.dispose();
  });

  it('resuming the same runtime does not duplicate machine bodies or reclaim the camera', () => {
    const { ctx, rigid, runtime, world } = fixture(); ctx.player.dead = false;
    stampTeaMachine(world, runtime.mechanisms);
    const director = new TeaMachine(ctx); director.update();
    ctx.state.mode = 'build'; ctx.events.emit('modeChanged', { mode: 'build' });
    ctx.state.mode = 'play'; director.update();
    expect(rigid.bodies.filter(b => b.tag?.startsWith('tea-'))).toHaveLength(5);
    expect(director.watching).toBe(false); director.dispose(); rigid.dispose();
  });
  it('restores bounded detached body state and cannot manufacture a completion flag', () => {
    const saved = { stage: 4, ticks: 99, completed: true, bodies: [{ key: 'duck', x: 950, y: 220, vx: 999, vy: NaN, angle: 1, va: .1, rope: false }] };
    const restored = restoreTeaMachine(saved)!;
    expect(restored.completed).toBe(false); expect(restored.bodies[0].vx).toBe(20); expect(restored.bodies[0].vy).toBe(0);
    restored.bodies[0].x = 1000; expect(saved.bodies[0].x).toBe(950);
  });

  it('a failed fuse returns control without advancing the puzzle; manual repair restocks only the machine', () => {
    const { ctx, runtime, world, rigid } = fixture(); ctx.player.dead = false;
    stampTeaMachine(world, runtime.mechanisms);
    const director = new TeaMachine(ctx); ctx.contraption = director; director.update();
    runtime.mechanisms.find(m => m.id === TEA.lever.id)!.state = 1; director.update();
    expect(director.watching).toBe(true);
    const sentinel = world.idx(100, 800); world.replaceCellAt(sentinel, Cell.Gold, 1);
    const catwalk = world.idx(800, 312); world.clearCellAt(catwalk);
    runtime.living!.tea!.stageTicks = 2401; director.update();
    expect(runtime.living!.tea!.stage).toBe(1); expect(runtime.living!.tea!.stalled).toBe(true);
    for (let i = 0; i < 70; i++) director.update();
    expect(director.watching).toBe(false); expect(ctx.camera.actionFocus).toBeNull();
    expect(director.interact()).toBe(true); expect(runtime.living!.tea!.stage).toBe(0);
    expect(world.types[sentinel]).toBe(Cell.Gold); expect(world.types[catwalk]).toBe(Cell.Empty);
    director.dispose(); rigid.dispose();
  });

  it('keeps simulation on the machine when watching, and clears the camera on transition', () => {
    const { ctx, runtime, world, rigid } = fixture(); ctx.player.dead = false;
    stampTeaMachine(world, runtime.mechanisms);
    const director = new TeaMachine(ctx); ctx.contraption = director; director.update();
    runtime.mechanisms.find(m => m.id === TEA.lever.id)!.state = 1; director.update();
    director.includeSimulation(); expect(world.simBounds).toEqual(TEA.bounds);
    runtime.living!.tea!.completed = true;
    Object.assign(world.simBounds, { x0: 0, y0: 0, x1: 640, y1: 360 });
    director.includeSimulation(); expect(world.simBounds).toEqual(TEA.bounds); // final camera hold still simulates fire
    ctx.events.emit('levelChanged', { id: 'd2', name: 'D2', depth: 2 });
    expect(director.watching).toBe(false); expect(ctx.camera.actionFocus).toBeNull();
    director.dispose(); rigid.dispose();
  });
});

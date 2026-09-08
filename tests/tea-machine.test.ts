import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '@/core/types';
import { EventBus } from '@/core/events';
import { initRapier } from '@/entities/rapierInit';
import { RigidBodies } from '@/entities/RigidBodies';
import { attractElectromagnet, generateFromDrop } from '@/entities/Energy';
import { TeaMachine, restoreTeaMachine } from '@/game/TeaMachine';
import { pullTeaValve } from '@/game/TeaMachineLinkages';
import { createLivingState } from '@/game/LivingExpedition';
import { makeLevelRuntime } from '@/game/runtime';
import { LEVELS } from '@/config/worldgraph';
import { TEA, TEA_BODIES, TEA_COMPLETE_STAGE, stampTeaMachine, teaRect } from '@/world/teaMachine';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { Simulation } from '@/sim/Simulation';
import { Explosions } from '@/sim/explosion';
import { updateElectricalGrid } from '@/sim/electrical';
import { Camera } from '@/render/Camera';
import { createGameParams } from '@/config/params';
import { Levels } from '@/game/Levels';
import { Pickups, makePickup } from '@/game/Pickups';

beforeAll(() => initRapier());

function fixture() {
  const world = new World();
  const ctx = { world, events: new EventBus(), state: { mode: 'play', frameCount: 0 },
    camera: { actionFocus: null }, player: { x: 430, y: 305, dead: true, perks: {} },
    input: { keys: {}, mouse: { x: 0, y: 0 } }, fx: { digBeam: null }, debug: { active: false },
    enemies: [], particles: { list: [], spawn: vi.fn(), burst: vi.fn() },
    audio: { at: (_x: number, _y: number, fn: () => void) => fn(), zap: vi.fn(), lever: vi.fn(), bubble: vi.fn() },
    telemetry: { count: vi.fn() }, } as unknown as Ctx;
  const rigid = new RigidBodies(ctx); ctx.rigidBodies = rigid;
  const runtime = makeLevelRuntime({ world, def: LEVELS.d1, spawn: { x: 170, y: 314 }, living: createLivingState() });
  ctx.levels = { current: runtime } as Ctx['levels'];
  return { ctx, rigid, world, runtime };
}

describe('machine physics', () => {
  it.each([false, true])('a generator powers the distant magnet only through an intact wire (cut: %s)', cut => {
    const { ctx, rigid, world } = fixture(); ctx.params = createGameParams();
    teaRect(world, { x: 200, y: 100, w: 61, h: 1 }, Cell.Metal);
    if (cut) world.clearCellAt(world.idx(230, 100));
    const weight = rigid.spawn({ kind: 'box', halfW: 3, halfH: 5 }, 180, 110, { material: 'metal', guideAxis: 'vertical' });
    const latch = rigid.spawn({ kind: 'box', halfW: 5, halfH: 2 }, 290, 100, { material: 'metal', guideAxis: 'horizontal' });
    for (let tick = 0; tick < 90; tick++) {
      ctx.state.frameCount++; rigid.update(ctx);
      generateFromDrop(ctx, weight, { x: 200, y: 100 }, 110, 140);
      updateElectricalGrid(ctx); attractElectromagnet(ctx, latch, { x: 260, y: 100 });
    }
    if (cut) { expect(latch.x).toBe(290); expect(world.charge[world.idx(260, 100)]).toBe(0); }
    else expect(latch.x).toBeLessThan(280);
    rigid.dispose();
  });
  it('respects hinge stops while releasing stored spring energy, then frees every anchor', () => {
    const { ctx, rigid } = fixture();
    const arm = rigid.spawn({ kind: 'box', halfW: 18, halfH: 2 }, 200, 100, {
      angle: .25, hinge: { minAngle: -.35, maxAngle: .25 },
      torsionSpring: { restAngle: -.35, stiffness: .0018, damping: .06 },
    });
    for (let tick = 0; tick < 240; tick++) rigid.update(ctx);
    expect(arm.x).toBeCloseTo(200, 2); expect(arm.y).toBeCloseTo(100, 2);
    expect(arm.angle).toBeCloseTo(-.35, 2);
    rigid.remove(arm); rigid.clear(); rigid.dispose();
  });

  it('a guided float withstands a sideways impulse without tilting or opening a dry tank', () => {
    const { ctx, rigid, world, runtime } = fixture(); stampTeaMachine(world, runtime.mechanisms);
    const def = TEA_BODIES.find(b => b.key === 'duck')!;
    const duck = rigid.spawn(def.shape, def.x, def.y, def.opts);
    for (let tick = 0; tick < 100; tick++) rigid.update(ctx);
    rigid.applyImpulseAt(duck, 8, 0, duck.x, duck.y - 5);
    const state = { stage: 4, ticks: 0, stageTicks: 0, completed: false, stalled: false, bodies: [] };
    for (let tick = 0; tick < 180; tick++) {
      rigid.update(ctx); expect(pullTeaValve(world, state, 'acid', 233 - duck.y)).toBe(0);
    }
    expect(duck.x).toBeCloseTo(def.x, 2); expect(duck.angle).toBe(0);
    rigid.dispose();
  });

  it('moving valve plates conserve metal and acid, hold their ratchet, and jam on an obstruction', () => {
    const { world, runtime, rigid } = fixture(); stampTeaMachine(world, runtime.mechanisms);
    const state = { stage: 4, ticks: 0, stageTicks: 0, completed: false, stalled: false, bodies: [] };
    const counts = () => {
      const n = { metal: 0, acid: 0 };
      for (let y = 58; y < 130; y++) for (let x = 1092; x < 1124; x++) {
        if (world.type(x, y) === Cell.Metal) n.metal++;
        if (world.type(x, y) === Cell.Acid) n.acid++;
      }
      return n;
    };
    const before = counts(); expect(pullTeaValve(world, state, 'acid', 12)).toBe(12);
    expect(counts()).toEqual(before); expect(pullTeaValve(world, state, 'acid', 0)).toBe(12);
    teaRect(world, { x: 1101, y: 100, w: 1, h: 1 }, Cell.Stone);
    expect(pullTeaValve(world, state, 'acid', 15)).toBe(12); expect(world.type(1101, 100)).toBe(Cell.Stone);
    rigid.dispose();
  });

  it('a still generator produces no electricity and a disconnected electromagnet exerts no force', () => {
    const { ctx, rigid, world } = fixture();
    const terminal = { x: 200, y: 100 }; teaRect(world, { ...terminal, w: 1, h: 1 }, Cell.Metal);
    const weight = rigid.spawn({ kind: 'box', halfW: 3, halfH: 5 }, 250, 100, { material: 'metal', guideAxis: 'vertical' });
    const latch = rigid.spawn({ kind: 'box', halfW: 6, halfH: 2 }, 235, 100, { material: 'metal', guideAxis: 'horizontal' });
    expect(generateFromDrop(ctx, weight, terminal, 90, 120)).toBe(0);
    attractElectromagnet(ctx, latch, terminal); rigid.update(ctx); expect(latch.vx).toBe(0);
    for (let tick = 0; tick < 3; tick++) rigid.update(ctx);
    expect(generateFromDrop(ctx, weight, terminal, 90, 120)).toBeGreaterThan(20);
    attractElectromagnet(ctx, latch, terminal); rigid.update(ctx); expect(latch.vx).toBeLessThan(0);
    const impulse = vi.spyOn(rigid, 'applyImpulse');
    world.clearCellAt(world.idx(terminal.x, terminal.y)); attractElectromagnet(ctx, latch, terminal);
    expect(impulse).not.toHaveBeenCalled(); rigid.dispose();
  });

  it.each([41, 777, 1337])('runs the full chain from one crank with no injected handoffs (seed %i)', seed => {
    const { ctx, rigid, world, runtime } = fixture();
    ctx.params = createGameParams(); ctx.state.worldSeed = seed; ctx.shockwaves = [];
    ctx.projectileCtl = { update: vi.fn() } as unknown as Ctx['projectileCtl'];
    ctx.physics = { cellBlocks: () => false } as unknown as Ctx['physics'];
    ctx.audio = new Proxy({}, { get: () => () => undefined }) as Ctx['audio'];
    ctx.explosions = new Explosions(ctx);
    stampTeaMachine(world, runtime.mechanisms); ctx.player.dead = false;
    const director = new TeaMachine(ctx); ctx.contraption = director; director.update();
    const sim = new Simulation(); Object.assign(world.simBounds, TEA.bounds);
    const step = () => { ctx.state.frameCount++; sim.update(ctx); rigid.update(ctx); director.update(); };
    for (let tick = 0; tick < 180; tick++) step();
    expect(runtime.living!.tea!.stage).toBe(0);
    expect(rigid.bodies.find(b => b.tag === 'tea-sugar')!.y).toBeLessThan(178);
    expect(rigid.bodies.find(b => b.tag === 'tea-rocker')!.angle).toBeGreaterThan(.2);
    runtime.mechanisms.find(m => m.id === TEA.lever.id)!.state = 1;
    for (let tick = 0; tick < 5000 && !runtime.living!.tea!.completed && !runtime.living!.tea!.stalled; tick++) step();
    const final = runtime.living!.tea!;
    const region = (x0: number, y0: number, w: number, h: number) => {
      const counts: Record<number, number> = {};
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        const type = world.type(x, y); counts[type] = (counts[type] ?? 0) + 1;
      }
      return counts;
    };
    expect(final.completed, JSON.stringify({ ...final, catchCells: region(1499, 220, 18, 19),
      charges: [1365, 1426, 1487].map(x => region(x, 212, 7, 11)) })).toBe(true);
    expect(final.travel!.acid).toBeGreaterThanOrEqual(6); expect(final.travel!.bell).toBeGreaterThanOrEqual(12);
    director.dispose(); rigid.dispose();
  }, 60000);
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
    rigid.tieRope(bob, pd.tether!.x, pd.tether!.y, pd.tether!.length, 'rope', true);
    for (let i = 0; i < 360; i++) { ctx.state.frameCount++; rigid.update(ctx); }
    expect(bob.x).toBeLessThan(608); expect(Math.abs(rock.x - 682)).toBeLessThan(1);
    rigid.cutRope(bob, true);
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
  it('treats a blast-open final bell gate as a successful fail-open handoff', () => {
    const { ctx, rigid, runtime, world } = fixture(); ctx.player.dead = false;
    ctx.audio.gong = vi.fn();
    stampTeaMachine(world, runtime.mechanisms);
    const director = new TeaMachine(ctx); director.update();
    const tea = runtime.living!.tea!;
    tea.stage = 11; tea.stageTicks = 0; tea.completed = false; tea.stalled = false;
    teaRect(world, TEA.bellGate, Cell.Empty);
    director.update();
    expect(tea.completed).toBe(true);
    expect(tea.stage).toBe(TEA_COMPLETE_STAGE);
    expect(ctx.audio.gong).toHaveBeenCalledOnce();
    director.dispose(); rigid.dispose();
  });

  it('keeps control with the camera until a long return pan actually arrives', () => {
    const { ctx, rigid, world, runtime } = fixture(); ctx.player.dead = false;
    ctx.camera = new Camera(); ctx.camera.snapTo(1450, 200);
    stampTeaMachine(world, runtime.mechanisms);
    const director = new TeaMachine(ctx); ctx.contraption = director; director.update();
    runtime.mechanisms.find(m => m.id === TEA.lever.id)!.state = 1; director.update(); director.skip();
    for (let tick = 0; tick < 70; tick++) { director.update(); ctx.camera.update(ctx); }
    expect(director.watching).toBe(true);
    for (let tick = 0; tick < 600 && director.watching; tick++) {
      director.update(); if (director.watching) ctx.camera.update(ctx);
    }
    expect(director.watching).toBe(false);
    expect(Math.hypot(ctx.camera.x - ctx.camera.tx, ctx.camera.y - ctx.camera.ty)).toBeLessThan(1);
    director.dispose(); rigid.dispose();
  });
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
    runtime.living!.tea = { stage: TEA_COMPLETE_STAGE, ticks: 1000, stageTicks: 0, completed: true, stalled: false, bodies: [] };
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
    runtime.living!.tea = { stage: TEA_COMPLETE_STAGE, ticks: 1000, stageTicks: 0, completed: true, stalled: false, bodies: [] };
    pickups.update(ctx); expect(bell.taken).toBe(true); expect(runtime.keyTaken).toBe(true);
    rigid.dispose();
  });

  it('resuming the same runtime does not duplicate machine bodies or reclaim the camera', () => {
    const { ctx, rigid, runtime, world } = fixture(); ctx.player.dead = false;
    stampTeaMachine(world, runtime.mechanisms);
    const director = new TeaMachine(ctx); director.update();
    ctx.state.mode = 'build'; ctx.events.emit('modeChanged', { mode: 'build' });
    ctx.state.mode = 'play'; director.update();
    expect(rigid.bodies.filter(b => b.tag?.startsWith('tea-'))).toHaveLength(TEA_BODIES.length);
    expect(director.watching).toBe(false); director.dispose(); rigid.dispose();
  });
  it('restores bounded detached body state and cannot manufacture a completion flag', () => {
    const saved = { stage: 4, ticks: 99, completed: true, travel: { acid: Infinity, water: 200, bell: -99, spring: 4.9 },
      bodies: [{ key: 'duck', x: 950, y: 220, vx: 999, vy: NaN, angle: 1, va: .1, rope: false }] };
    const restored = restoreTeaMachine(saved)!;
    expect(restored.completed).toBe(false); expect(restored.bodies[0].vx).toBe(20); expect(restored.bodies[0].vy).toBe(0);
    expect(restored.travel).toEqual({ acid: 0, water: 12, bell: 0, spring: 4, lava: 0, oil: 0 });
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

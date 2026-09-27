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
import { TEA, TEA_BODIES, TEA_COMPLETE_STAGE, TEA_STAGE as S, stampTeaMachine, teaRect } from '@/world/teaMachine';
import { World } from '@/sim/World';
import { Cell } from '@/sim/CellType';
import { Simulation } from '@/sim/Simulation';
import { Explosions } from '@/sim/explosion';
import { chargeDeposit, updateElectricalGrid } from '@/sim/electrical';
import { Camera } from '@/render/Camera';
import { createGameParams } from '@/config/params';
import { Levels } from '@/game/Levels';
import { Physics } from '@/entities/physics';
import { WORKS_GATE } from '@/world/breathingWorks';
import { Pickups, makePickup } from '@/game/Pickups';
import { waterColor } from '@/sim/colors';

beforeAll(() => initRapier());

function fixture() {
  const world = new World();
  const ctx = { world, events: new EventBus(), state: { mode: 'play', frameCount: 0 },
    camera: { actionFocus: null }, player: { x: 170, y: 305, dead: false, perks: {} },
    input: { keys: {}, mouse: { x: 0, y: 0 } }, fx: { digBeam: null }, debug: { active: false },
    enemies: [], particles: { list: [], spawn: vi.fn(), burst: vi.fn() },
    audio: new Proxy({} as Record<string | symbol, unknown>, { get: (target, key) => target[key] ??
      ((...args: unknown[]) => { if (typeof args[2] === 'function') (args[2] as () => void)(); }) }),
    telemetry: { count: vi.fn() }, } as unknown as Ctx;
  const rigid = new RigidBodies(ctx); ctx.rigidBodies = rigid;
  const runtime = makeLevelRuntime({ world, def: LEVELS.d1, spawn: { x: 170, y: 314 }, living: createLivingState() });
  ctx.levels = { current: runtime } as Ctx['levels'];
  return { ctx, rigid, world, runtime };
}

type Helper = 'player' | 'idle';

/**
 * The whole engine through the real cell simulation, rigid bodies and
 * director. In 'player' mode a scripted alchemist answers each fault with the
 * real verb's effect (a spark bolt's blast and current at the pan, a kick's
 * momentum on the Persuader, a flask's water on the grate) after a human
 * reaction delay; in 'idle' mode nobody helps and the backups must finish it.
 */
function runChain(seed: number, helper: Helper, maxTicks = 9000) {
  const { ctx, rigid, world, runtime } = fixture();
  ctx.params = createGameParams(); ctx.state.worldSeed = seed; ctx.shockwaves = [];
  ctx.projectileCtl = { update: vi.fn() } as unknown as Ctx['projectileCtl'];
  ctx.physics = { cellBlocks: () => false } as unknown as Ctx['physics'];
  ctx.explosions = new Explosions(ctx);
  stampTeaMachine(world, runtime.mechanisms);
  const director = new TeaMachine(ctx); ctx.contraption = director; director.update();
  const sim = new Simulation(); Object.assign(world.simBounds, TEA.simBounds);
  const step = () => {
    ctx.state.frameCount++; Object.assign(world.simBounds, TEA.simBounds); director.includeSimulation();
    sim.update(ctx); updateElectricalGrid(ctx); rigid.update(ctx); director.update();
  };
  for (let tick = 0; tick < 120; tick++) step();
  runtime.mechanisms.find(m => m.id === TEA.lever.id)!.state = 1;
  const stageAt: Record<number, number> = {};
  let last = -1, faultSeen = -1, poured = 0;
  const tea = () => runtime.living!.tea!;
  let tick = 0;
  for (; tick < maxTicks && !tea().completed && !tea().stalled; tick++) {
    step();
    const s = tea();
    if (s.stage !== last) { last = s.stage; stageAt[s.stage] = tick; faultSeen = tick; }
    if (process.env.TEA_TRACE && s.stage === Number(process.env.TEA_TRACE) && tick % 20 === 0) {
      const m = rigid.bodies.find(b => b.tag === 'tea-marble'), d = rigid.bodies.find(b => b.tag === 'tea-duck');
      console.log('trace', tick, m && [m.x.toFixed(1), m.y.toFixed(1), m.vx.toFixed(2), m.sleeping], d && d.y.toFixed(1), JSON.stringify(s.travel));
    }
    if (helper !== 'player' || tick - faultSeen < 75) continue;
    if (s.stage === S.SPARK && tick - faultSeen === 75) {
      // A Spark Bolt striking the pan's underside: its blast and its current.
      const x = TEA.pan.x + 3, y = TEA.pan.y + TEA.pan.h;
      ctx.explosions.trigger(x, y, ctx.params.spells.bolt.explosionRadius!);
      world.setChargeAt(world.idx(x, y - 1), chargeDeposit(ctx, 20));
    }
    if (s.stage === S.KICK && (tick - faultSeen) % 40 === 35) {
      const bob = rigid.bodies.find(b => b.tag === 'tea-persuader')!;
      const ox = bob.x - 10, oy = 303, d = Math.hypot(bob.x - ox, bob.y - oy);
      const dirX = (bob.x - ox) / d, dirY = (bob.y - oy) / d, k = ctx.params.player.kickImpulse;
      rigid.applyMomentumAt(bob, dirX * k, dirY * k - k * .2, bob.x - dirX * 1.5, bob.y - dirY * 1.5);
    }
    if (s.stage === S.POUR && poured < 240) {
      for (let n = 0; n < 10 && poured < 240; n++) {
        const x = 986 + ((tick * 7 + n * 5) % 28), y = 306 + (n % 3);
        if (world.type(x, y) === Cell.Empty) { world.replaceCellAt(world.idx(x, y), Cell.Water, waterColor()); poured++; }
      }
    }
  }
  const s = tea();
  const out = { completed: s.completed, stage: s.stage, ticks: tick, stageAt, travel: s.travel, bath: director.bathWater() };
  director.dispose(); rigid.dispose();
  return out;
}

describe('the played engine', () => {
  it.each([41, 777, 1337])('a player who answers each fault finishes the engine briskly (seed %i)', seed => {
    const r = runChain(seed, 'player');
    if (process.env.TEA_DEBUG) console.log('player', seed, JSON.stringify(r));
    expect(r.completed, JSON.stringify(r)).toBe(true);
    // Each fault genuinely waited for the player instead of solving itself.
    expect(r.stageAt[S.CORD] - r.stageAt[S.SPARK]).toBeGreaterThanOrEqual(70);
    expect(r.stageAt[S.DOMINOES] - r.stageAt[S.KICK]).toBeGreaterThanOrEqual(70);
    expect(r.ticks).toBeLessThan(60 * 50);
  }, 120000);

  it.each([41, 777, 1337])('nobody helps: every fault has a physical backup, and the bell still arrives (seed %i)', seed => {
    const r = runChain(seed, 'idle');
    if (process.env.TEA_DEBUG) console.log('idle', seed, JSON.stringify(r));
    expect(r.completed, JSON.stringify(r)).toBe(true);
    expect(r.stageAt[S.CORD] - r.stageAt[S.SPARK]).toBeGreaterThanOrEqual(500);
    expect(r.ticks).toBeLessThan(60 * 90);
  }, 120000);
});

function directorFixture() {
  const f = fixture();
  stampTeaMachine(f.world, f.runtime.mechanisms);
  const director = new TeaMachine(f.ctx); f.ctx.contraption = director; director.update();
  return { ...f, director, tea: () => f.runtime.living!.tea! };
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

  it('respects hinge stops while releasing stored spring energy', () => {
    const { ctx, rigid } = fixture();
    const arm = rigid.spawn({ kind: 'box', halfW: 18, halfH: 2 }, 200, 100, {
      angle: .25, hinge: { minAngle: -.35, maxAngle: .25 },
      torsionSpring: { restAngle: -.35, stiffness: .0018, damping: .06 },
    });
    for (let tick = 0; tick < 240; tick++) rigid.update(ctx);
    expect(arm.x).toBeCloseTo(200, 2); expect(arm.y).toBeCloseTo(100, 2);
    expect(arm.angle).toBeCloseTo(-.35, 2);
    rigid.dispose();
  });

  it('moving plates conserve metal and water, hold their ratchet, and jam on an obstruction', () => {
    const { world, runtime, rigid } = fixture(); stampTeaMachine(world, runtime.mechanisms);
    const state = { stage: S.SPRING, ticks: 0, stageTicks: 0, completed: false, stalled: false, bodies: [] };
    const t = TEA.tank;
    const counts = () => {
      const n = { metal: 0, water: 0 };
      for (let y = t.y0 - 4; y <= t.y1 + 4; y++) for (let x = t.x0 - 4; x <= t.x1 + 4; x++) {
        if (world.type(x, y) === Cell.Metal) n.metal++;
        if (world.type(x, y) === Cell.Water) n.water++;
      }
      return n;
    };
    const before = counts(); expect(pullTeaValve(world, state, 'tap', 6)).toBe(6);
    expect(counts()).toEqual(before); expect(pullTeaValve(world, state, 'tap', 0)).toBe(6);
    teaRect(world, { x: TEA.tap.x + 2, y: TEA.tap.y - 7, w: 1, h: 1 }, Cell.Stone);
    expect(pullTeaValve(world, state, 'tap', 12)).toBe(6);
    rigid.dispose();
  });

  it('holds its armed pendulum, then the bob swings into the boulder once the cord is cut', () => {
    const { ctx, rigid, world, runtime } = fixture();
    stampTeaMachine(world, runtime.mechanisms);
    const [pd, bd] = TEA_BODIES;
    const bob = rigid.spawn(pd.shape, pd.x, pd.y, pd.opts);
    const rock = rigid.spawn(bd.shape, bd.x, bd.y, bd.opts);
    rigid.tieRope(bob, pd.rope!.x, pd.rope!.y, pd.rope!.length, 'chain');
    rigid.tieRope(bob, pd.tether!.x, pd.tether!.y, pd.tether!.length, 'rope', true);
    for (let i = 0; i < 240; i++) { ctx.state.frameCount++; rigid.update(ctx); }
    expect(bob.x).toBeLessThan(608); expect(Math.abs(rock.x - 682)).toBeLessThan(1.5);
    rigid.cutRope(bob, true);
    for (let i = 0; i < 90; i++) { ctx.state.frameCount++; rigid.update(ctx); }
    expect(rock.x).toBeGreaterThan(700); // struck off its ledge, down toward the tollgate
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
});

describe('faults, backups and ordering', () => {
  it('the first fuse always dies against the cracked coupling, and a spark on the pan relights the far side', () => {
    const { ctx, rigid, world, runtime } = fixture();
    ctx.params = createGameParams(); ctx.shockwaves = [];
    ctx.projectileCtl = { update: vi.fn() } as unknown as Ctx['projectileCtl'];
    ctx.physics = { cellBlocks: () => false } as unknown as Ctx['physics'];
    ctx.explosions = new Explosions(ctx);
    stampTeaMachine(world, runtime.mechanisms);
    const sim = new Simulation(); Object.assign(world.simBounds, TEA.simBounds);
    const step = () => { ctx.state.frameCount++; sim.update(ctx); updateElectricalGrid(ctx); };
    const tail = () => {
      let n = 0;
      for (let x = TEA.coupling.x + TEA.coupling.w; x <= TEA.fuse.x1; x++) for (let y = TEA.fuse.y; y < TEA.fuse.y + 3; y++) if (world.type(x, y) === Cell.Gunpowder) n++;
      return n;
    };
    const full = tail();
    teaRect(world, { x: TEA.striker.x - 1, y: TEA.striker.y, w: 3, h: 1 }, Cell.Fire);
    for (let i = 0; i < 900; i++) step();
    expect(tail()).toBeGreaterThanOrEqual(full - 2); // nothing crossed the coupling (a grain may settle)
    const x = TEA.pan.x + 3, y = TEA.pan.y + TEA.pan.h;
    ctx.explosions.trigger(x, y, ctx.params.spells.bolt.explosionRadius!);
    world.setChargeAt(world.idx(x, y - 1), chargeDeposit(ctx, 20));
    for (let i = 0; i < 240; i++) step();
    expect(tail()).toBeLessThan(full / 2);
    rigid.dispose();
  });

  it('any wand shot striking the priming pan fires its percussion cap (Frost Shard included)', () => {
    const { ctx, rigid, world, director, tea } = directorFixture();
    const s = tea(); s.stage = S.SPARK;
    const primed = () => { let n = 0; for (let x = TEA.pan.x; x < TEA.pan.x + TEA.pan.w; x++) n += world.charge[world.idx(x, TEA.pan.y + TEA.pan.h - 1)]; return n; };
    ctx.events.emit('structureStrike', { x: 700, y: 266, radius: 7 }); // a shot elsewhere on the ceiling
    expect(primed()).toBe(0);
    ctx.events.emit('structureStrike', { x: TEA.pan.x + 3, y: TEA.pan.y + TEA.pan.h, radius: 7 });
    expect(primed()).toBeGreaterThan(0);
    director.dispose(); rigid.dispose();
  });

  it('pulling the crank on a disturbed engine recharges the hall before starting it', () => {
    const { rigid, runtime, world, director, tea } = directorFixture();
    const bob = rigid.bodies.find(b => b.tag === 'tea-pendulum')!;
    rigid.cutRope(bob, true); // somebody burnt the cord before the crank
    teaRect(world, { x: TEA.fuse.x0, y: TEA.fuse.y, w: 20, h: 3 }, Cell.Empty);
    const sentinel = world.idx(100, 800); world.replaceCellAt(sentinel, Cell.Gold, 1);
    runtime.mechanisms.find(m => m.id === TEA.lever.id)!.state = 1;
    director.update(); director.update();
    const fresh = rigid.bodies.find(b => b.tag === 'tea-pendulum')!;
    expect(fresh.tether).toBeDefined();
    expect(world.type(TEA.fuse.x0 + 10, TEA.fuse.y + 1)).not.toBe(Cell.Empty);
    expect(tea().stage).toBe(S.FUSE);
    expect(rigid.bodies.filter(b => b.tag?.startsWith('tea-'))).toHaveLength(TEA_BODIES.length);
    expect(world.types[sentinel]).toBe(Cell.Gold); // the rest of the level is untouched
    director.dispose(); rigid.dispose();
  });

  it('a duck floated early cannot fire the finale out of order', () => {
    const { ctx, rigid, director, tea, world } = directorFixture();
    const duck = rigid.bodies.find(b => b.tag === 'tea-duck')!;
    const s = tea(); s.stage = S.KICK; s.stageTicks = 0;
    rigid.applyImpulse(duck, 0, -1.5); // shoved up as if floated
    for (let i = 0; i < 4; i++) { rigid.update(ctx); director.update(); }
    expect(s.travel?.pin ?? 0).toBe(0);
    expect(world.type(TEA.pin.x, TEA.pin.y)).toBe(Cell.Metal);
    director.dispose(); rigid.dispose();
  });

  it('treats a blast-open bell gate as a successful fail-open handoff', () => {
    const { ctx, rigid, world, director, tea } = directorFixture();
    ctx.audio.sfx = vi.fn();
    const s = tea(); s.stage = S.BELL; s.stageTicks = 0;
    teaRect(world, TEA.bellGate, Cell.Empty);
    director.update();
    expect(s.completed).toBe(true); expect(s.stage).toBe(TEA_COMPLETE_STAGE);
    expect(ctx.audio.sfx).toHaveBeenCalledWith('tea.served');
    director.dispose(); rigid.dispose();
  });

  it('a jammed stage is nudged, then forced, never left to hang', () => {
    const { rigid, director, tea, world } = directorFixture();
    const s = tea(); s.stage = S.SPRING; s.stageTicks = 0;
    const rocker = rigid.bodies.find(b => b.tag === 'tea-rocker')!;
    rigid.remove(rocker); // the crank is gone: nothing can pull the tap
    for (let i = 0; i < 400 && s.stage === S.SPRING; i++) director.update();
    expect(s.stage).toBe(S.POUR);
    expect(world.type(TEA.tap.x, TEA.tap.y)).not.toBe(Cell.Metal);
    director.dispose(); rigid.dispose();
  });
});

describe('camera, control and state', () => {
  it('frames the station AND the alchemist, who keeps control, then lets go when he leaves the hall', () => {
    const { ctx, rigid, runtime, director, tea } = directorFixture();
    ctx.camera = new Camera(); ctx.camera.snapTo(430, 300);
    ctx.player.x = 740; ctx.player.y = 311;
    runtime.mechanisms.find(m => m.id === TEA.lever.id)!.state = 1; director.update();
    tea().stage = S.CHARGES; director.update();
    const focus = ctx.camera.actionFocus!;
    expect(focus).not.toBeNull();
    expect(Math.abs(focus.x - ctx.player.x)).toBeLessThan(640 / (2 * focus.zoom)); // he stays in the shot
    expect('watching' in director).toBe(false);
    ctx.player.x = 170; ctx.player.y = 800; director.update();
    expect(ctx.camera.actionFocus).toBeNull();
    director.dispose(); rigid.dispose();
  });

  it('hands the frame back the moment the chain completes, and never frames him out vertically', () => {
    const { ctx, rigid, runtime, director, tea } = directorFixture();
    ctx.camera = new Camera(); ctx.camera.snapTo(1400, 300);
    ctx.player.x = 1530; ctx.player.y = 331; // dropped to the receiver tray below the catwalk
    runtime.mechanisms.find(m => m.id === TEA.lever.id)!.state = 1; director.update();
    tea().stage = S.MAGNET; director.update();
    const focus = ctx.camera.actionFocus!;
    expect(focus).not.toBeNull();
    const halfH = 360 / (2 * focus.zoom);
    expect(ctx.player.y).toBeLessThanOrEqual(focus.y + halfH - 2); // feet in the shot (QA: only his hat was)
    expect(ctx.player.y - 17).toBeGreaterThanOrEqual(focus.y - halfH);
    const s = tea(); s.stage = S.DONE; s.completed = true; s.stageTicks = 0;
    director.update();
    expect(ctx.camera.actionFocus).toBeNull(); // released at once (was held 300 ticks)
    director.dispose(); rigid.dispose();
  });

  it('keeps simulating the whole hall while running, and clears the camera on transition', () => {
    const { ctx, runtime, world, rigid, director } = directorFixture();
    ctx.player.x = 740; ctx.player.y = 311;
    runtime.mechanisms.find(m => m.id === TEA.lever.id)!.state = 1; director.update();
    Object.assign(world.simBounds, { x0: 0, y0: 600, x1: 300, y1: 900 });
    director.includeSimulation();
    expect(world.simBounds.x1).toBeGreaterThanOrEqual(TEA.simBounds.x1);
    expect(world.simBounds.y0).toBeLessThanOrEqual(TEA.simBounds.y0);
    ctx.events.emit('levelChanged', { id: 'd2', name: 'D2', depth: 2 });
    expect(ctx.camera.actionFocus).toBeNull();
    director.dispose(); rigid.dispose();
  });

  it('requires both the completed machine and its collected bell at the main descent gate', () => {
    const { ctx, rigid, runtime } = fixture();
    ctx.state.frameCount = 1; ctx.player.x = 430; ctx.player.y = 305;
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

  it('the open grate takes a player standing on its lip (QA: he stood beside the drop)', () => {
    const { ctx, rigid, runtime, world } = fixture();
    ctx.physics = new Physics(ctx);
    ctx.audio.portalWhoosh = vi.fn(); ctx.sanctum = { open: vi.fn() } as unknown as Ctx['sanctum'];
    const levels = new Levels(ctx);
    const internals = levels as unknown as { currentId: string; levels: Map<string, typeof runtime> };
    internals.currentId = 'd1'; internals.levels.set('d1', runtime); ctx.levels = levels;
    const G = WORKS_GATE;
    // the Lower Bell floor with its pit open (leaves withdrawn)
    for (let y = G.floor + 1; y <= G.pit.y1 + 4; y++) {
      for (let x = G.pit.x0 - 30; x <= G.pit.x1 + 30; x++) {
        const inPit = x >= G.pit.x0 && x <= G.pit.x1 && y <= G.pit.y1;
        world.types[world.idx(x, y)] = inPit ? Cell.Empty : Cell.Stone;
      }
    }
    runtime.portal = { x: G.x, y: 1008, open: true };
    runtime.keyTaken = true;
    runtime.living!.tea = { stage: TEA_COMPLETE_STAGE, ticks: 1000, stageTicks: 0, completed: true, stalled: false, bodies: [] };
    // on the right lip: half the body over the pit, feet on the floor beside it
    ctx.player.x = G.pit.x1 + 3; ctx.player.y = G.floor; (ctx.player as { grounded?: boolean }).grounded = true;
    const x0 = ctx.player.x;
    for (let t = 0; t < 8; t++) { ctx.state.frameCount++; levels.update(ctx); }
    expect(ctx.player.x).toBeLessThan(x0 - 3); // slid off the lip toward the drop
    expect(ctx.sanctum.open).not.toHaveBeenCalled(); // not yet: his feet are still up
    ctx.player.y = G.floor + 8; ctx.state.frameCount++; levels.update(ctx); // falling into the pit
    expect(ctx.sanctum.open).toHaveBeenCalledOnce();
    rigid.dispose();
  });

  it('keeps the bell uncollectible until the machine completes, then awards it on contact', () => {
    const { ctx, rigid, runtime } = fixture();
    ctx.audio.keyJingle = vi.fn();
    const bell = makePickup('key', ctx.player.x, ctx.player.y - 8); runtime.pickups.push(bell);
    const pickups = new Pickups(); pickups.update(ctx);
    expect(bell.taken).toBe(false); expect(runtime.keyTaken).toBe(false);
    runtime.living!.tea = { stage: TEA_COMPLETE_STAGE, ticks: 1000, stageTicks: 0, completed: true, stalled: false, bodies: [] };
    pickups.update(ctx); expect(bell.taken).toBe(true); expect(runtime.keyTaken).toBe(true);
    rigid.dispose();
  });

  it('resuming the same runtime does not duplicate machine bodies', () => {
    const { ctx, rigid, director } = directorFixture();
    ctx.state.mode = 'build'; ctx.events.emit('modeChanged', { mode: 'build' });
    ctx.state.mode = 'play'; director.update();
    expect(rigid.bodies.filter(b => b.tag?.startsWith('tea-'))).toHaveLength(TEA_BODIES.length);
    director.dispose(); rigid.dispose();
  });

  it('restores bounded detached body state and cannot manufacture a completion flag', () => {
    const saved = { stage: 4, ticks: 99, completed: true, travel: { gate: Infinity, tap: 200, bell: -99, spring: 4.9 }, faultTicks: -5,
      bodies: [{ key: 'duck', x: 950, y: 220, vx: 999, vy: NaN, angle: 1, va: .1, rope: false }] };
    const restored = restoreTeaMachine(saved)!;
    expect(restored.completed).toBe(false); expect(restored.bodies[0].vx).toBe(20); expect(restored.bodies[0].vy).toBe(0);
    expect(restored.travel).toEqual({ gate: 0, spring: 4, tap: 12, pin: 0, bell: 0 });
    expect(restored.faultTicks).toBe(0);
    restored.bodies[0].x = 1000; expect(saved.bodies[0].x).toBe(950);
  });

  it('a stalled engine recharges from its crank without touching the rest of the level', () => {
    const { ctx, runtime, world, rigid, director, tea } = directorFixture();
    ctx.player.x = TEA.lever.x; ctx.player.y = TEA.lever.y;
    tea().stalled = true; tea().stage = S.DOMINOES;
    const sentinel = world.idx(100, 800); world.replaceCellAt(sentinel, Cell.Gold, 1);
    const catwalk = world.idx(800, 312); world.clearCellAt(catwalk);
    expect(director.interact()).toBe(true); expect(runtime.living!.tea!.stage).toBe(0);
    expect(world.types[sentinel]).toBe(Cell.Gold); expect(world.types[catwalk]).toBe(Cell.Empty);
    director.dispose(); rigid.dispose();
  });
});

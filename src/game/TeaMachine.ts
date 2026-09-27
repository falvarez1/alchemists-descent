import type { Ctx, RigidBody, TeaMachineState } from '@/core/types';
import type { EventMap } from '@/core/events';
import { Cell } from '@/sim/CellType';
import { fireColor } from '@/sim/colors';
import { chargeDeposit } from '@/sim/electrical';
import { VIEW_W } from '@/config/constants';
import { BATH_TRIP_WATER, TEA, TEA_BACKUP, TEA_BODIES, TEA_COMPLETE_STAGE, TEA_FUSE_TAIL_CELLS, TEA_STAGE as S, TEA_VALVES,
  type TeaValve, stampTeaMachine, teaRect } from '@/world/teaMachine';
import { pullTeaValve } from '@/game/TeaMachineLinkages';
import { attractElectromagnet, generateFromDrop } from '@/entities/Energy';

/** Title and caption for each director stage (indexed by TEA_STAGE). */
const ACTS: ReadonlyArray<readonly [string, string]> = [
  ['The Unreasonable Bell & Tea Engine', 'The descent gate needs its brass bell. Pull the crank to begin.'],
  ['First, a little powder', 'The striker lights the fuse. It runs along the floor toward the pendulum’s cord.'],
  ['A broken coupling', 'The flame died at the cracked coupling. The priming pan’s percussion cap, struck, will jump the gap.'],
  ['The knot is the fuse', 'The fuse burns through the hemp cord holding the pendulum back.'],
  ['Percussive maintenance', 'The heavy pendulum swings free and introduces itself to a boulder.'],
  ['Downhill, briskly', 'The boulder rolls down the ramp toward the dominoes…'],
  ['The tollgate is stuck', 'The boulder is stuck at the tollgate. The gate’s chain drops through the floor to the Persuader.'],
  ['Six dominoes and a wound spring', 'The boulder topples the dominoes. The last one pulls the latch under the spring crank.'],
  ['The spring lets go', 'The spring crank whips round and its cable lifts the header tank’s plug.'],
  ['Please mind the duck', 'The downpipe is clogged. The duck’s bath fills one drip at a time; the floating duck’s rod lifts the marble’s pin.'],
  ['A marble of some urgency', 'The steel marble runs the long rail and strikes the flint at the head of the second fuse.'],
  ['The second fuse', 'The fuse runs toward three packed charges.'],
  ['This is probably enough heat', 'Three charges. The last blast burns the copper tea bag’s cord.'],
  ['A most electrifying tea bag', 'The copper bag falls through a generator coil. Current races along the overhead wire.'],
  ['The magnet has opinions', 'The powered coil pulls the iron latch out from under the counterweight.'],
  ['Gravity gets the last word', 'The braked counterweight pulls four pulley strands, lifting the bell latch.'],
  ['Tea is served. The bell is yours.', 'Collect the brass bell at the receiver, then carry it to the descent gate.'],
];

/** How long a fault waits for the player before its physical backup acts. */
const SPARK_BACKUP_TICKS = TEA_BACKUP.spark;
const KICK_BACKUP_TICKS = TEA_BACKUP.kick;
const POUR_FORCE_TICKS = 1800; // the seep always gets there first; this is a last resort
/** One water cell seeps through the clogged downpipe every this many ticks. */
const SEEP_EVERY = 6;
/** Pin travel (the duck's rise ×7, ratcheted) at which the marble rolls free under it. */
const PIN_TRIP = 15;
const HOLD_AFTER_DONE = 300;

export function restoreTeaMachine(value: unknown): TeaMachineState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const s = value as Partial<TeaMachineState>;
  const finite = (n: unknown, fallback: number, min: number, max: number): number =>
    typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  return {
    stage: Math.floor(finite(s.stage, 0, 0, TEA_COMPLETE_STAGE)), ticks: Math.floor(finite(s.ticks, 0, 0, 1000000)),
    stageTicks: Math.floor(finite(s.stageTicks, 0, 0, 1000000)), completed: s.completed === true && s.stage === TEA_COMPLETE_STAGE,
    stalled: s.stalled === true,
    assists: Math.floor(finite(s.assists, 0, 0, 10)), faultTicks: Math.floor(finite(s.faultTicks, 0, 0, 1000000)),
    travel: Object.fromEntries((Object.keys(TEA_VALVES) as TeaValve[]).map(key =>
      [key, Math.floor(finite(s.travel?.[key], 0, 0, TEA_VALVES[key].max))])),
    bodies: Array.isArray(s.bodies) ? TEA_BODIES.flatMap(def => {
      const b = s.bodies!.find(body => body?.key === def.key);
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return [];
      return [{ key: def.key, x: finite(b.x, def.x, 8, 1591), y: finite(b.y, def.y, 8, 1055),
        vx: finite(b.vx, 0, -20, 20), vy: finite(b.vy, 0, -20, 20), angle: finite(b.angle, 0, -10000, 10000),
        va: finite(b.va, 0, -1, 1), rope: b.rope === true, tether: b.tether === true }];
    }) : [],
  };
}

/**
 * Directs the Bell & Tea Engine. The chain is physical — every stage advances
 * only when the grid or a body shows its handoff happened — but the engine is
 * PLAYED, not watched: the alchemist keeps full control on the catwalk below
 * while the camera frames the active station with him, and three stations
 * (the coupling, the tollgate, the downpipe) stop until a starting verb
 * fixes them. Every stop has a slow physical backup and every other stage a
 * watchdog that nudges a stuck body, so the engine can never hard-lock the
 * level. Pulling the crank on a disturbed engine recharges it first.
 */
export class TeaMachine {
  private runtime: Ctx['levels']['current'] = null;
  private readonly bodies = new Map<string, RigidBody>();
  private lastView = '';
  private framing = false;
  private publishedStage = -1;
  private readonly disposers: Array<() => void>;

  constructor(private readonly ctx: Ctx) {
    this.disposers = [ctx.events.on('levelChanged', () => this.leave()),
      ctx.events.on('modeChanged', () => { if (ctx.state.mode !== 'play') this.leave(); }),
      ctx.events.on('structureStrike', strike => this.onStrike(strike))];
  }

  dispose(): void { this.leave(); this.disposers.forEach(fn => fn()); }

  private leave(): void {
    this.runtime = null; this.bodies.clear();
    this.releaseCamera(); this.publish(false);
  }

  private releaseCamera(): void {
    if (this.framing) this.ctx.camera.actionFocus = null;
    this.framing = false;
  }

  private initialize(): TeaMachineState | null {
    const rt = this.ctx.levels.current;
    if (!rt?.living || !rt.mechanisms.some(m => m.id === TEA.lever.id)) return null;
    if (this.runtime === rt) return rt.living.tea ?? null;
    this.runtime = rt; this.bodies.clear();
    const saved = rt.living.tea;
    const s = rt.living.tea ??= { stage: 0, ticks: 0, stageTicks: 0, completed: false, stalled: false, bodies: [] };
    for (const def of TEA_BODIES) {
      const old = saved?.bodies.find(b => b.key === def.key);
      if (saved && saved.bodies.length > 0 && !old) continue; // a destroyed prop stays destroyed
      const existing = this.ctx.rigidBodies.bodies.find(b => b.tag === `tea-${def.key}`);
      if (existing) { this.bodies.set(def.key, existing); continue; }
      const b = this.ctx.rigidBodies.spawn(def.shape, old?.x ?? def.x, old?.y ?? def.y,
        { ...def.opts, ...(old ? { vx: old.vx, vy: old.vy, angle: old.angle, va: old.va } : {}), tag: `tea-${def.key}` });
      this.bodies.set(def.key, b);
      if (def.rope && (!old || old.rope)) this.ctx.rigidBodies.tieRope(b, def.rope.x, def.rope.y, def.rope.length, def.rope.material);
      if (def.tether && (!old || old.tether)) this.ctx.rigidBodies.tieRope(b, def.tether.x, def.tether.y, def.tether.length, 'rope', true);
    }
    this.snapshot(s);
    return s;
  }

  private snapshot(s: TeaMachineState): void {
    s.bodies = [...this.bodies].filter(([, b]) => this.ctx.rigidBodies.bodies.includes(b)).map(([key, b]) =>
      ({ key, x: b.x, y: b.y, vx: b.vx, vy: b.vy, angle: b.angle, va: b.va, rope: !!b.rope, tether: !!b.tether }));
  }

  private live(key: string): RigidBody | undefined {
    const b = this.bodies.get(key); return b && this.ctx.rigidBodies.bodies.includes(b) ? b : undefined;
  }

  private count(x: number, y: number, w: number, h: number, types: readonly number[]): number {
    let n = 0;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (types.includes(this.ctx.world.type(xx, yy))) n++;
    return n;
  }

  /** Real fire cells: the same thing a striker, a flint or a slow match makes. */
  private spark(x: number, y: number): void {
    const world = this.ctx.world;
    for (let dx = -1; dx <= 1; dx++) {
      if (!world.inBounds(x + dx, y) || world.type(x + dx, y) === Cell.Metal) continue;
      const i = world.idx(x + dx, y);
      world.replaceCellAt(i, Cell.Fire, fireColor()); world.life[i] = 240;
    }
    this.ctx.particles.burst(x, y, 8, null, () => 0xffd27a, 1.6, { glow: 2.2, grav: .08 });
    this.ctx.audio.at(x, y, () => this.ctx.audio.zap());
  }

  /** The west-most unburnt powder of a fuse — where a re-strike belongs. */
  private powderFront(x0: number, x1: number, y: number): number {
    for (let x = x0; x <= x1; x++) if (this.count(x, y - 1, 1, 4, [Cell.Gunpowder]) > 0) return x;
    return -1;
  }

  /** The east-most burning cell of a fuse — the head the camera follows. */
  private fireFront(x0: number, x1: number, y: number): number {
    let head = -1;
    for (let x = x0; x <= x1; x++) if (this.count(x, y - 6, 1, 9, [Cell.Fire]) > 0) head = x;
    return head;
  }

  private advance(s: TeaMachineState): void {
    s.stage++; s.stageTicks = 0; s.assists = 0; s.faultTicks = 0;
    this.ctx.telemetry.count(`tea.stage${s.stage}`);
    const f = this.focusX(s);
    this.ctx.audio.at(f, 200, () => this.ctx.audio.lever());
  }

  /** A pristine engine: nothing released, nothing burnt, every plate home. */
  private pristine(): boolean {
    for (const def of TEA_BODIES) {
      const b = this.live(def.key);
      if (!b) return false;
      if (Math.hypot(b.x - def.x, b.y - def.y) > 3) return false;
      if (def.tether && !b.tether) return false;
    }
    const s = this.runtime?.living?.tea;
    if (s && Object.values(s.travel ?? {}).some(v => (v ?? 0) > 0)) return false;
    return this.count(TEA.fuse.x0, TEA.fuse.y, TEA.fuse.x1 - TEA.fuse.x0 + 1, 3, [Cell.Gunpowder]) >=
      (TEA.fuse.x1 - TEA.fuse.x0 + 1 - TEA.coupling.w) * 3 - 6;
  }

  /** Re-stamp the hall and re-spawn its props. The rest of the level persists. */
  private recharge(): void {
    const rt = this.ctx.levels.current!;
    for (const b of this.bodies.values()) this.ctx.rigidBodies.remove(b);
    for (const b of [...this.ctx.rigidBodies.bodies]) if (b.tag?.startsWith('tea-')) this.ctx.rigidBodies.remove(b);
    stampTeaMachine(this.ctx.world, rt.mechanisms, true);
    rt.living!.tea = undefined;
    this.runtime = null; this.initialize();
  }

  interact(): boolean {
    const s = this.ctx.levels.current?.living?.tea;
    if (!s || Math.hypot(this.ctx.player.x - TEA.lever.x, this.ctx.player.y - TEA.lever.y) > 35) return false;
    if (s.stalled) {
      // A deliberately labelled maintenance crank resets ONLY this machine.
      this.recharge();
      this.ctx.events.emit('toast', { text: 'Engine recharged. Pull the crank to try again.' });
      const lever = this.ctx.levels.current!.mechanisms.find(m => m.id === TEA.lever.id);
      if (lever) lever.state = 0;
      return true;
    }
    // Already running or finished: the crank has done its job.
    return s.stage > 0;
  }

  includeSimulation(): void {
    const s = this.ctx.levels.current?.living?.tea;
    if (!s || s.stage === 0 || s.stalled || (s.completed && s.stageTicks > HOLD_AFTER_DONE)) return;
    const bounds = this.ctx.world.simBounds, machine = TEA.simBounds;
    bounds.x0 = Math.min(bounds.x0, machine.x0); bounds.x1 = Math.max(bounds.x1, machine.x1);
    bounds.y0 = Math.min(bounds.y0, machine.y0); bounds.y1 = Math.max(bounds.y1, machine.y1);
  }

  update(): void {
    const ctx = this.ctx;
    if (ctx.state.mode !== 'play') { this.releaseCamera(); return; }
    const s = this.initialize(); if (!s) return;
    const lever = this.runtime!.mechanisms.find(m => m.id === TEA.lever.id)!;
    if (s.stage === S.IDLE && lever.state === 1) {
      // Somebody sparked or kicked the engine before the crank was pulled:
      // pulling it recharges the hall first, so the chain always starts whole.
      if (!this.pristine()) { this.recharge(); return this.startAfterRecharge(); }
      this.spark(TEA.striker.x, TEA.striker.y); this.advance(s);
    }
    if (s.stage > S.IDLE && !s.completed && !s.stalled) {
      s.ticks++; s.stageTicks++;
      this.drive(s);
      for (let guard = 0; guard < 6; guard++) {
        const before = s.stage;
        this.check(s);
        if (s.stage === before || s.completed) break;
      }
    } else if (s.completed) s.stageTicks++;
    this.frame(s);
    this.snapshot(s);
    const near = Math.hypot(ctx.player.x - TEA.lever.x, ctx.player.y - TEA.lever.y) < 110;
    // Throttled for the backup meter, but a new act or fault shows at once.
    if (ctx.state.frameCount % 10 === 0 || s.stage !== this.publishedStage) {
      this.publishedStage = s.stage; this.publish(near || this.inHall());
    }
  }

  private startAfterRecharge(): void {
    const s = this.runtime?.living?.tea;
    if (!s) return;
    this.spark(TEA.striker.x, TEA.striker.y); this.advance(s);
  }

  /**
   * Persistent one-way linkages and the slow physical processes. Plates take
   * their travel from real body poses (ratcheted), even while the camera is
   * on another station. A linkage is engaged only once its stage is reached,
   * so a duck floated early cannot fire the finale out of order.
   */
  private drive(s: TeaMachineState): void {
    const ctx = this.ctx;
    const persuader = this.live('persuader'), domino = this.live('domino-5'), rocker = this.live('rocker');
    const bob = this.live('pendulum'), duck = this.live('duck');
    // The hemp cord's lower run is tied into the fuse: fire at the cleat is the cut.
    if (bob?.tether && this.count(TEA.cleat.x, TEA.cleat.y - 4, TEA.cleat.w, 7, [Cell.Fire]) > 0) ctx.rigidBodies.cutRope(bob, true);
    const armature = this.live('armature'), latch = this.live('magnet-latch'), counterweight = this.live('counterweight');
    if (armature) generateFromDrop(ctx, armature, TEA.generatorTerminal, 222, 249);
    if (latch) attractElectromagnet(ctx, latch, TEA.magnetTerminal);
    if (persuader) pullTeaValve(ctx.world, s, 'gate', Math.abs(persuader.x - TEA.persuader.x) * 2.4);
    if (s.stage >= S.DOMINOES && domino) pullTeaValve(ctx.world, s, 'spring', Math.max(0, domino.angle) * 26);
    if (s.stage >= S.DOMINOES && rocker) pullTeaValve(ctx.world, s, 'tap', (.25 - rocker.angle) * 22);
    if (s.stage >= S.POUR && duck) pullTeaValve(ctx.world, s, 'pin', (TEA.duckRest - duck.y) * 7);
    if (s.stage >= S.MAGNET && counterweight) pullTeaValve(ctx.world, s, 'bell', (counterweight.y - 96) / 4);
    this.wakeBesideMovedPlates(s);
    if ((s.travel?.tap ?? 0) >= 4 && s.ticks % SEEP_EVERY === 0) this.seep();
  }

  private readonly lastTravel: Partial<Record<TeaValve, number>> = {};
  /** A body resting against a plate falls asleep; the plate moving out from under it must wake it. */
  private wakeBesideMovedPlates(s: TeaMachineState): void {
    for (const key of Object.keys(TEA_VALVES) as TeaValve[]) {
      const now = s.travel?.[key] ?? 0;
      if (now === (this.lastTravel[key] ?? 0)) continue;
      this.lastTravel[key] = now;
      const { plate } = TEA_VALVES[key], cx = plate.x + plate.w / 2, cy = plate.y + plate.h / 2;
      for (const b of this.bodies.values()) {
        if (Math.hypot(b.x - cx, b.y - cy) < 28 && this.ctx.rigidBodies.bodies.includes(b)) this.ctx.rigidBodies.applyImpulse(b, 0, 0);
      }
    }
  }

  /** The clogged downpipe passes one real water cell: out of the pipe, into the air below the nozzle. */
  private seep(): void {
    const world = this.ctx.world, p = TEA.pipe;
    const outX = TEA.nozzle.x + (this.ctx.state.frameCount % 2), outY = 266;
    if (world.type(outX, outY) !== Cell.Empty) return;
    for (let y = p.y1; y >= p.y0; y--) for (let x = p.x0; x <= p.x1; x++) {
      if (world.type(x, y) !== Cell.Water) continue;
      const color = world.colors[world.idx(x, y)];
      world.clearCellAt(world.idx(x, y));
      world.replaceCellAt(world.idx(outX, outY), Cell.Water, color);
      return;
    }
  }

  /** Water standing in the duck's bath (the HUD's seep gauge reads it). */
  bathWater(): number {
    const b = TEA.bath;
    return this.count(b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1, [Cell.Water]);
  }

  /** Watchdog: after `every` ticks without progress, apply the next assist (0,1,2…). */
  private watchdog(s: TeaMachineState, every: number, assist: (n: number) => void): void {
    const n = s.assists ?? 0;
    if (n >= 4 || s.stageTicks < every * (n + 1)) return;
    s.assists = n + 1;
    this.ctx.telemetry.count(`tea.assist${s.stage}`);
    assist(n);
  }

  private nudge(b: RigidBody | undefined, ix: number, iy: number): void {
    if (!b) return;
    this.ctx.rigidBodies.applyImpulse(b, ix, iy);
    this.ctx.particles.burst(b.x, b.y, 6, null, () => 0xe8c58a, 1.2, { glow: 1.2, grav: .05 });
    this.ctx.audio.at(b.x, b.y, () => this.ctx.audio.lever());
  }

  private check(s: TeaMachineState): void {
    const ctx = this.ctx;
    const bob = this.live('pendulum'), boulder = this.live('boulder'), persuader = this.live('persuader');
    const marble = this.live('marble'), armature = this.live('armature'), counterweight = this.live('counterweight');
    const latch = this.live('magnet-latch');
    const tail = (): boolean => this.count(TEA.coupling.x + TEA.coupling.w, TEA.fuse.y - 6, TEA.fuse.x1 - TEA.coupling.x, 9, [Cell.Fire]) > 0 ||
      this.count(TEA.coupling.x + TEA.coupling.w, TEA.fuse.y, TEA.fuse.x1 - TEA.coupling.x, 3, [Cell.Gunpowder]) < TEA_FUSE_TAIL_CELLS - 3;
    const cordCut = (): boolean => !!bob && !bob.tether;
    const travel = (key: TeaValve): number => s.travel?.[key] ?? 0;
    switch (s.stage) {
      case S.FUSE: {
        if (tail() || cordCut()) { this.advance(s); break; }
        const burnt = this.count(TEA.coupling.x - 12, TEA.fuse.y, 12, 3, [Cell.Gunpowder]) === 0;
        const burning = this.count(TEA.fuse.x0, TEA.fuse.y - 6, TEA.coupling.x - TEA.fuse.x0, 9, [Cell.Fire]) > 0;
        if (burnt && !burning) { this.advance(s); this.fault('The fuse fizzled out at the cracked coupling.'); break; }
        // The striker re-strikes a fuse that went out short of the coupling.
        if (!burning) this.watchdog(s, 240, () => {
          const front = this.powderFront(TEA.fuse.x0, TEA.coupling.x - 1, TEA.fuse.y + 1);
          if (front > 0) this.spark(front, TEA.fuse.y - 1);
        });
        break;
      }
      case S.SPARK:
        if (tail() || cordCut()) { this.advance(s); break; }
        s.faultTicks = (s.faultTicks ?? 0) + 1;
        if (s.faultTicks === SPARK_BACKUP_TICKS) this.primePan('The slow match reaches the priming pan.');
        if (s.faultTicks === SPARK_BACKUP_TICKS + 180) this.spark(TEA.coupling.x + TEA.coupling.w + 1, TEA.fuse.y - 1);
        break;
      case S.CORD:
        if (cordCut()) { this.advance(s); break; }
        this.watchdog(s, 300, n => {
          const front = this.powderFront(TEA.coupling.x + TEA.coupling.w, TEA.fuse.x1, TEA.fuse.y + 1);
          if (n === 0 && front > 0) this.spark(front, TEA.fuse.y - 1);
          else if (bob) { this.spark(TEA.cleat.x + 3, TEA.cleat.y - 1); ctx.rigidBodies.cutRope(bob, true); }
        });
        break;
      case S.SWING:
        if (!boulder || Math.hypot(boulder.x - 682, boulder.y - 138) > 4) { this.advance(s); break; }
        this.watchdog(s, 240, () => this.nudge(boulder, 1.6, -.4));
        break;
      case S.RAMP: {
        if (!boulder) { this.advance(s); break; }
        const speed = Math.hypot(boulder.vx, boulder.vy);
        if (travel('gate') >= TEA_VALVES.gate.max - 4 && boulder.x > TEA.gate.x) { this.advance(s); break; }
        if (boulder.x > TEA.gate.x - 16 && speed < .15) { this.advance(s); this.fault('The tollgate is jammed shut.'); break; }
        this.watchdog(s, 240, () => this.nudge(boulder, 1.2, -.2));
        break;
      }
      case S.KICK:
        if (travel('gate') >= TEA_VALVES.gate.max - 4) { this.advance(s); break; }
        s.faultTicks = (s.faultTicks ?? 0) + 1;
        if (s.faultTicks === KICK_BACKUP_TICKS && persuader) {
          ctx.rigidBodies.applyMomentumAt(persuader, 60, -12, persuader.x - 3, persuader.y);
          ctx.audio.at(persuader.x, persuader.y, () => ctx.audio.lever());
          ctx.particles.burst(persuader.x - 4, persuader.y, 10, null, () => 0xffe2a0, 1.5, { glow: 1.6, grav: .06 });
          ctx.events.emit('toast', { text: 'The clockwork knocker gives the Persuader a whack.' });
        }
        if (s.faultTicks === KICK_BACKUP_TICKS + 120) pullTeaValve(ctx.world, s, 'gate', 99);
        break;
      case S.DOMINOES:
        if (travel('spring') >= 9) { this.advance(s); break; }
        this.watchdog(s, 300, n => {
          if (n >= 2) { pullTeaValve(ctx.world, s, 'spring', 99); return; }
          if (boulder && boulder.x < 772 && Math.hypot(boulder.vx, boulder.vy) < .2) { this.nudge(boulder, 1.5, -.2); return; }
          for (let i = 0; i < 6; i++) {
            const d = this.live(`domino-${i}`);
            if (d && Math.abs(d.angle) < .3) { ctx.rigidBodies.applyImpulseAt(d, .6, 0, d.x, d.y - 9); this.nudge(d, 0, 0); return; }
          }
        });
        break;
      case S.SPRING:
        if (travel('tap') >= 8) { this.advance(s); this.fault('The downpipe is clogged.'); break; }
        this.watchdog(s, 300, () => pullTeaValve(ctx.world, s, 'tap', 99));
        break;
      case S.POUR:
        s.faultTicks = (s.faultTicks ?? 0) + 1;
        if (!this.live('duck') || s.faultTicks >= POUR_FORCE_TICKS) pullTeaValve(ctx.world, s, 'pin', 99);
        if (travel('pin') >= PIN_TRIP) this.advance(s);
        break;
      case S.MARBLE:
        if (!marble || marble.x >= TEA.flint.x - 2) {
          this.spark(TEA.fuse2.x0 + 1, TEA.fuse2.y + 1);
          ctx.particles.burst(TEA.flint.x, TEA.flint.y, 14, null, () => 0xfff0b0, 2.2, { glow: 2.6, grav: .12 });
          this.advance(s); break;
        }
        this.watchdog(s, 180, n => {
          if (n < 3) this.nudge(marble, 1.4, -.3);
          else ctx.rigidBodies.remove(marble);
        });
        break;
      case S.FUSE2:
        if (this.count(TEA.charges[0], 212, 7, 11, [Cell.Gunpowder]) < 5) { this.advance(s); break; }
        if (this.fireFront(TEA.fuse2.x0, TEA.charges[0] + 8, TEA.fuse2.y + 1) < 0) this.watchdog(s, 240, () => {
          const front = this.powderFront(TEA.fuse2.x0, TEA.charges[0], TEA.fuse2.y + 1);
          if (front > 0) this.spark(front, TEA.fuse2.y - 1);
        });
        break;
      case S.CHARGES: {
        const last = TEA.charges[TEA.charges.length - 1];
        if (this.count(last, 212, 7, 11, [Cell.Gunpowder]) < 5 && (!armature || (!armature.rope && armature.y > 222))) {
          this.advance(s); break;
        }
        this.watchdog(s, 300, n => {
          if (n === 0) {
            const front = this.powderFront(TEA.fuse2.x0, last, TEA.fuse2.y + 1);
            if (front > 0) this.spark(front, TEA.fuse2.y - 1);
          } else if (armature?.rope) { this.spark(1486, 196); ctx.rigidBodies.cutRope(armature); }
        });
        break;
      }
      case S.GENERATOR:
        if (ctx.world.charge[ctx.world.idx(TEA.magnetTerminal.x, TEA.magnetTerminal.y)] >= 20) { this.advance(s); break; }
        this.watchdog(s, 240, () => {
          // The coil's reserve cell discharges into whatever wire is left.
          for (const t of [TEA.generatorTerminal, TEA.magnetTerminal]) {
            if (ctx.world.type(t.x, t.y) === Cell.Metal) ctx.world.setChargeAt(ctx.world.idx(t.x, t.y), chargeDeposit(ctx, 120));
          }
          if (ctx.world.type(TEA.magnetTerminal.x, TEA.magnetTerminal.y) !== Cell.Metal) this.advance(s);
        });
        break;
      case S.MAGNET:
        if (!counterweight || counterweight.y > 105) { this.advance(s); break; }
        this.watchdog(s, 240, () => this.nudge(latch, -1.4, 0));
        break;
      case S.BELL:
        if (travel('bell') >= 12 || this.count(TEA.bellGate.x, TEA.bellGate.y - 20, TEA.bellGate.w, TEA.bellGate.h + 20, [Cell.Metal]) < 8) {
          // The last powder charge can legitimately tear the thin receiver gate
          // away before the counterweight finishes its stroke: an open path.
          this.advance(s); s.completed = true;
          ctx.audio.gong(); ctx.events.emit('objectiveChanged', { text: 'Collect the brass bell from the engine receiver.' });
          break;
        }
        this.watchdog(s, 300, n => {
          if (n === 0) pullTeaValve(ctx.world, s, 'bell', 99);
          else teaRect(ctx.world, TEA.bellGate, Cell.Empty);
        });
        break;
    }
  }

  /**
   * The priming pan carries a percussion cap: ANY wand shot that strikes it
   * fires the cap (a Spark Bolt's own current would do it anyway). A player
   * who swapped Spark Bolt out for Frost Shard at the cold lock still has the
   * verb. Projectile and blast impacts both announce themselves this way.
   */
  private onStrike(strike: { x: number; y: number; radius: number }): void {
    const s = this.ctx.levels.current?.living?.tea;
    if (!s || s.stage < S.FUSE || s.stage > S.SPARK || s.stalled) return;
    const pan = TEA.pan, cx = pan.x + pan.w / 2, cy = pan.y + pan.h / 2;
    if (Math.hypot(strike.x - cx, strike.y - cy) > Math.min(strike.radius, 8) + 4) return;
    this.primePan(s.stage === S.SPARK ? 'The percussion cap fires.' : '');
  }

  /** Current on the pan runs through the floor into the coupling, igniting the powder beyond it. */
  private primePan(toast: string): void {
    const ctx = this.ctx, pan = TEA.pan;
    for (let x = pan.x; x < pan.x + pan.w; x++) {
      if (ctx.world.type(x, pan.y + pan.h - 1) === Cell.Metal) ctx.world.setChargeAt(ctx.world.idx(x, pan.y + pan.h - 1), chargeDeposit(ctx, 60));
    }
    ctx.particles.burst(pan.x + pan.w / 2, pan.y + pan.h, 16, null, () => 0xffc96a, 1.8, { glow: 2.4, grav: .1 });
    ctx.audio.at(pan.x, pan.y, () => ctx.audio.zap());
    if (toast) ctx.events.emit('toast', { text: toast });
  }

  private fault(text: string): void {
    this.ctx.audio.at(this.focusX(this.runtime!.living!.tea!), 220, () => this.ctx.audio.hollowKnock());
    this.ctx.telemetry.count('tea.fault');
    if (!this.inHall()) this.ctx.events.emit('toast', { text: `Bell & Tea Engine: ${text}` });
  }

  private inHall(): boolean {
    const p = this.ctx.player;
    return p.x > TEA.bounds.x0 - 40 && p.x < TEA.bounds.x1 + 8 && p.y > 250 && p.y < 340;
  }

  /**
   * The camera frames the hall from the catwalk up while the engine runs and
   * the alchemist is in it: the active station, held within reach of him so
   * he never leaves the shot. He keeps every control.
   */
  private frame(s: TeaMachineState): void {
    const ctx = this.ctx, p = ctx.player;
    const running = s.stage > S.IDLE && !s.stalled && (!s.completed || s.stageTicks < HOLD_AFTER_DONE);
    if (!running || p.dead || !this.inHall()) { this.releaseCamera(); return; }
    // Close enough that a domino reads as a domino; the hall floor-to-ceiling
    // and the catwalk still fit. The duck's bath sits under the catwalk, so
    // its station frames a little lower.
    const zoom = ctx.state.reduceCameraShake ? 1 : 1.2;
    const half = VIEW_W / (2 * zoom) - 70;
    const x = Math.max(p.x - half, Math.min(p.x + half, this.focusX(s)));
    ctx.camera.actionFocus = { x, y: s.stage === S.POUR ? 214 : 168, zoom };
    this.framing = true;
  }

  private focusX(s: TeaMachineState): number {
    switch (s.stage) {
      case S.FUSE: { const f = this.fireFront(TEA.fuse.x0, TEA.coupling.x, TEA.fuse.y + 1); return Math.max(500, f + 40); }
      case S.SPARK: return TEA.pan.x + 4;
      case S.CORD: return 575;
      case S.SWING: return 640;
      case S.RAMP: return 700;
      case S.KICK: return TEA.persuader.x - 6;
      case S.DOMINOES: return 815;
      case S.SPRING: return 930;
      case S.POUR: return 1000;
      case S.MARBLE: { const m = this.live('marble'); return Math.max(1030, (m?.x ?? 1030) + 50); }
      case S.FUSE2: { const f = this.fireFront(TEA.fuse2.x0, TEA.fuse2.x1, TEA.fuse2.y + 1); return Math.max(1320, f + 50); }
      case S.CHARGES: return 1440;
      case S.GENERATOR: return 1470;
      case S.MAGNET: return 1430;
      case S.BELL: return 1490;
      case S.DONE: return 1500;
      default: return 520;
    }
  }

  private faultView(s: TeaMachineState): EventMap['contraptionView']['fault'] {
    const t = s.faultTicks ?? 0;
    if (s.stage === S.SPARK) return { verb: 'spark', prompt: 'Shoot the priming pan under the floor',
      backup: Math.min(1, t / SPARK_BACKUP_TICKS), backupLabel: 'Slow match' };
    if (s.stage === S.KICK) return { verb: 'kick', prompt: 'Kick the Persuader hanging from the ceiling',
      backup: Math.min(1, t / KICK_BACKUP_TICKS), backupLabel: 'Clockwork knocker' };
    if (s.stage === S.POUR) return { verb: 'pour', prompt: 'Pour water through the grate into the duck’s bath',
      backup: Math.min(1, this.bathWater() / BATH_TRIP_WATER), backupLabel: 'Seeping' };
    return null;
  }

  private publish(visible: boolean): void {
    const s = this.ctx.levels.current?.living?.tea;
    const stage = s?.stage ?? 0, act = ACTS[stage] ?? ACTS[0];
    const payload: EventMap['contraptionView'] = { visible, title: s?.stalled ? 'A slight technical difficulty' : act[0],
      detail: s?.stalled ? 'Return to the crank. Press Use to recharge the engine.' : act[1], stage, stalled: s?.stalled ?? false,
      fault: s && !s.stalled ? this.faultView(s) : null };
    const key = JSON.stringify(payload);
    if (key !== this.lastView) { this.lastView = key; this.ctx.events.emit('contraptionView', payload); }
  }
}

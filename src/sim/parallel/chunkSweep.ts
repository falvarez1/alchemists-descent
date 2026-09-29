import type { SfxId } from '@/content/audio/sfxCues';
import type { EventMap } from '@/core/events';
import type { Ctx, GameParams, ParticleOpts } from '@/core/types';
import { reseedSimChunk, simRandom } from '@/core/simRandom';
import { Cell, isLiquid } from '@/sim/CellType';
import { canDryBloodOnSurface, stainCell } from '@/sim/stains';
import { handleGas, handleMarshGas } from '@/sim/elements/gas';
import { maybeReact, refreshSecretReaction } from '@/sim/reactions';
import { handleAcid, handleLava, handleNitrogen, handleOil, handleViscousLiquid, handleWater } from '@/sim/elements/liquids';
import { handleAsh, handleCoal, handleExoticLiquid, handleSnow } from '@/sim/elements/newMaterials';
import { handleGunpowder, handleSand } from '@/sim/elements/powders';
import { handleEmber, handleFire } from '@/sim/elements/thermal';
import { handleSeed } from '@/sim/elements/flora';
import { handleBrine } from '@/sim/elements/brine';
import type { World } from '@/sim/World';
import {
  BLAST_SOURCES, E_BURST, E_EXPLODE, E_FLORA, E_LEARN, E_SECRET_TOAST, E_SFX, E_SPAWN, E_STEAM, EffectLog, FLORA_KINDS,
  PARTICLE_DEPOSIT, PARTICLE_HOMING, PARTICLE_LOOSE_DEBRIS, SFX_NAMES,
} from '@/sim/parallel/effectLog';
import {
  C_CURSOR, C_FIRST, C_FLOW_STEP, C_MOVED_TICK, C_PARTICLES, C_READY_TAIL, C_SUBSTEP, C_TICK, C_WORLD_SEED,
  CHUNK, F_PLAYER_X, F_PLAYER_Y, FLOW_REACH, wavefrontSchedule, type WavefrontSchedule,
} from '@/sim/parallel/protocol';
import { type ParticipantView, type SharedWorldDescriptor, viewSharedWorld } from '@/sim/parallel/sharedWorld';

/** Buffers one participant needs (all structured-cloneable). */
export interface ParticipantSetup {
  world: SharedWorldDescriptor;
  control: SharedArrayBuffer;
  controlF64: SharedArrayBuffer;
  /** Int32 per wavefront position: dependencies not yet finished this substep. */
  pending: SharedArrayBuffer;
  /** Int32 per position: the ready queue's slots (-1 = not pushed yet). */
  ready: SharedArrayBuffer;
  /** Float64 x4: last substep's [sweeping ms, queue-wait ms, chunks] (diagnostics). */
  stats: SharedArrayBuffer;
  /** Int32 x GROWTH_LOG_INTS: the reclassify phase's growth-set edits. */
  growthLog: SharedArrayBuffer;
  logData: SharedArrayBuffer | ArrayBuffer;
  logSegs: SharedArrayBuffer | ArrayBuffer;
  boxes: SharedArrayBuffer | ArrayBuffer;
}

/** The subset of GameParams the rules read (and workers receive). */
export type RuleParams = Pick<GameParams, 'global' | 'materials'>;

function opts(grav: number, glow: number, flags: number): number[] {
  return [grav, glow, flags];
}
function encodeOpts(o: ParticleOpts | undefined): number[] {
  if (!o) return opts(NaN, NaN, 0);
  return opts(o.grav ?? NaN, o.glow ?? NaN,
    (o.homing ? PARTICLE_HOMING : 0) | (o.looseDebris ? PARTICLE_LOOSE_DEBRIS : 0) | (o.deposit ? PARTICLE_DEPOSIT : 0));
}

/**
 * The narrow Ctx the rules see inside a sweep: the participant's view World,
 * the tuning params, the few state fields they read, and recorders for every
 * side effect (replayed on the main thread, in chunk order).
 */
function makeRuleCtx(world: World, params: RuleParams, log: EffectLog): {
  ctx: Ctx;
  state: { frameCount: number; worldSeed: number; mode: string; secretReaction: unknown };
  player: { x: number; y: number; dead: boolean; perks: Record<string, unknown> };
  particleCount: { length: number };
  setParams(p: RuleParams): void;
} {
  const state = { frameCount: 0, worldSeed: 0, mode: 'build', secretReaction: null as unknown, score: 0 };
  const player = { x: -1e9, y: -1e9, dead: false, perks: {} };
  const particleCount = { length: 0 };
  const ctx = {
    world,
    params,
    state,
    player,
    particles: {
      list: particleCount,
      spawn(x: number, y: number, vx: number, vy: number, type: number | null, color: number, life: number, o?: ParticleOpts): void {
        log.putMany(E_SPAWN, [x, y, vx, vy, type ?? -1, color, life, ...encodeOpts(o)]);
      },
      burst(cx: number, cy: number, count: number, type: number | null, colorFn: () => number, speed: number, o?: ParticleOpts): void {
        // The rules' colour functions are constants or fx-stream draws; one
        // sample stands for the burst (the replay reuses it per particle).
        log.putMany(E_BURST, [cx, cy, count, type ?? -1, colorFn(), speed, ...encodeOpts(o)]);
      },
    },
    audio: {
      sfx(name: string, x?: number, y?: number): void {
        const id = SFX_NAMES.indexOf(name as SfxId);
        if (id >= 0) log.put3(E_SFX, id, x ?? NaN, y ?? NaN);
      },
      steam(x: number, y: number): void { log.put2(E_STEAM, x, y); },
      learn(): void { log.put0(E_LEARN); },
    },
    events: {
      emit(type: string, payload?: { kind?: string; x?: number; y?: number; strength?: number; text?: string }): void {
        if (type === 'floraMoment' && payload) {
          const id = FLORA_KINDS.indexOf((payload.kind ?? '') as EventMap['floraMoment']['kind']);
          if (id >= 0) log.put4(E_FLORA, id, payload.x ?? 0, payload.y ?? 0, payload.strength ?? 0);
        } else if (type === 'toast' && payload?.text?.startsWith('SECRET ALCHEMY')) {
          log.put0(E_SECRET_TOAST);
        }
      },
      on(): void { /* rules never subscribe */ },
    },
    explosions: {
      trigger(x: number, y: number, radius: number, o?: { playerDamageSource?: string }): void {
        log.put4(E_EXPLODE, x, y, radius, BLAST_SOURCES.indexOf(o?.playerDamageSource ?? ''));
      },
    },
  } as unknown as Ctx;
  return {
    ctx, state, player, particleCount,
    setParams(p: RuleParams): void { (ctx as { params: RuleParams }).params = p; },
  };
}

/**
 * One sweep participant — a worker, or the main thread's own share of the
 * work. Owns a view World over the shared planes, an effect log and seed
 * boxes, and runs the four checkerboard passes of each substep, claiming
 * chunks from the shared cursors.
 */
export class Participant {
  readonly view: ParticipantView;
  readonly log: EffectLog;
  private readonly ctrl: Int32Array;
  private readonly ctrlF: Float64Array;
  private readonly boxes: Int32Array;
  private readonly pending: Int32Array;
  private readonly ready: Int32Array;
  private readonly stats: Float64Array;
  private readonly growthLog: Int32Array;
  private growthCount = 0;
  private readonly growthSink = (key: number, index: number, added: boolean): void => {
    const o = 2 + this.growthCount * 3;
    if (o + 3 > this.growthLog.length) { this.growthLog[1] = 1; return; }
    this.growthLog[o] = key; this.growthLog[o + 1] = index; this.growthLog[o + 2] = added ? 1 : 0;
    this.growthCount++;
  };
  private readonly schedule: WavefrontSchedule;
  private readonly rule: ReturnType<typeof makeRuleCtx>;
  private readonly columns: number;
  /** Tests only: sweep the positions in this (dependency-respecting) order
   *  instead of claiming them, to prove the result does not depend on which
   *  valid order the threads happened to produce (tests/parallel-sweep). */
  testOrder: (() => Int32Array) | null = null;
  /** Stats for the last substep. */
  chunksSwept = 0;
  sweepMs = 0;

  constructor(setup: ParticipantSetup, params: RuleParams) {
    this.log = new EffectLog(setup.logData, setup.logSegs);
    this.view = viewSharedWorld(setup.world, this.log);
    this.ctrl = new Int32Array(setup.control);
    this.ctrlF = new Float64Array(setup.controlF64);
    this.boxes = new Int32Array(setup.boxes);
    this.pending = new Int32Array(setup.pending);
    this.ready = new Int32Array(setup.ready);
    this.stats = new Float64Array(setup.stats);
    this.growthLog = new Int32Array(setup.growthLog);
    this.schedule = wavefrontSchedule(setup.world.width, setup.world.height);
    this.columns = Math.ceil(setup.world.width / CHUNK);
    this.rule = makeRuleCtx(this.view.world, params, this.log);
  }

  setParams(params: RuleParams): void { this.rule.setParams(params); }

  /**
   * The reclassify phase (ActivityGrid.reclassChunk): claim chunks until none
   * are left. Chunks are independent — each reclassifies only its own cells
   * and row words from neighbour types nobody writes in this phase. Growth-set
   * edits go to the log for main.
   */
  runReclass(): void {
    const ctrl = this.ctrl, world = this.view.world, activity = this.view.activity;
    const first = ctrl[C_FIRST] !== 0, count = activity.columns * activity.rows;
    this.growthCount = 0;
    this.growthLog[1] = 0;
    for (;;) {
      const key = Atomics.add(ctrl, C_CURSOR, 1);
      if (key >= count) break;
      activity.reclassChunk(world, key, first, this.growthSink);
    }
    this.growthLog[0] = this.growthCount;
  }

  /** Take part in the substep main just published; then publish results. */
  runSubstep(): void {
    const ctrl = this.ctrl, world = this.view.world;
    world.movedTick = ctrl[C_MOVED_TICK];
    this.view.flow.setStep(ctrl[C_FLOW_STEP]);
    const state = this.rule.state;
    state.frameCount = ctrl[C_TICK];
    state.worldSeed = ctrl[C_WORLD_SEED];
    this.rule.particleCount.length = ctrl[C_PARTICLES];
    this.rule.player.x = this.ctrlF[F_PLAYER_X];
    this.rule.player.y = this.ctrlF[F_PLAYER_Y];
    refreshSecretReaction(this.rule.ctx);
    this.log.reset();
    this.chunksSwept = 0;
    const t0 = performance.now();
    const tick = ctrl[C_TICK], substep = ctrl[C_SUBSTEP], seed = ctrl[C_WORLD_SEED];
    const scheduled = world.activity.scheduled, pending = this.pending, ready = this.ready;
    const { order, dependentStart, dependents } = this.schedule, n = order.length;
    const testOrder = this.testOrder?.() ?? null;
    let busy = 0, waiting = 0;
    for (let claim = 0; ; claim++) {
      let i: number;
      if (testOrder !== null) {
        i = claim < n ? testOrder[claim] : n;
        if (i >= n) break;
      } else {
        const slot = Atomics.add(ctrl, C_CURSOR, 1);
        if (slot >= n) break;
        // Filled once the last dependency of some chunk finishes (see protocol).
        if ((i = Atomics.load(ready, slot)) < 0) {
          const w0 = performance.now();
          while ((i = Atomics.load(ready, slot)) < 0) { /* the wavefront is catching up */ }
          waiting += performance.now() - w0;
        }
      }
      const key = order[i];
      if (scheduled[key] !== 0) {
        const b0 = performance.now();
        reseedSimChunk(seed, tick, substep, key);
        this.log.begin(i);
        this.sweepChunk(key);
        this.log.end();
        this.chunksSwept++;
        busy += performance.now() - b0;
      }
      if (testOrder !== null) continue;
      for (let d = dependentStart[i], end = dependentStart[i + 1]; d < end; d++) {
        const j = dependents[d];
        if (Atomics.sub(pending, j, 1) === 1) Atomics.store(ready, Atomics.add(ctrl, C_READY_TAIL, 1), j);
      }
    }
    this.sweepMs = performance.now() - t0;
    this.stats[0] = busy; this.stats[1] = waiting; this.stats[2] = this.chunksSwept;
    this.log.publish();
    this.view.activity.publishBoxes(this.boxes);
  }

  /**
   * One chunk, bottom row first — the serial sweep (Simulation.processFrame)
   * restricted to 64x64 cells. KEEP THE DISPATCH IN STEP WITH processFrame.
   */
  private sweepChunk(key: number): void {
    const world = this.view.world, ctx = this.rule.ctx;
    const cx = key % this.columns, cy = (key - cx) / this.columns;
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const x1 = Math.min(world.width, x0 + CHUNK), y1 = Math.min(world.height, y0 + CHUNK);
    this.view.flow.beginChunk(x0 - FLOW_REACH, x1 + FLOW_REACH);
    const movedArr = world.moved, tick = world.movedTick, types = world.types, eligible = world.activity.eligible;
    const masks = world.activity.rowMasks, wordsPerRow = world.activity.wordsPerRow;
    const wa = x0 >> 5, wb = (x1 - 1) >> 5;
    for (let y = y1 - 1; y >= y0; y--) {
      const leftToRight = simRandom() < 0.5;
      for (let k = 0; k <= wb - wa; k++) {
        const word = leftToRight ? wa + k : wb - k;
        let mask = masks[y * wordsPerRow + word];
        while (mask !== 0) {
          const bit = leftToRight ? 31 - Math.clz32(mask & -mask) : 31 - Math.clz32(mask);
          mask &= ~(1 << bit);
          const x = word * 32 + bit;
          const ci = x + y * world.width;
          if (movedArr[ci] === tick || !eligible[ci]) continue;

          const type = types[ci] as Cell;
          if (
            type === Cell.Empty || type === Cell.Wall || type === Cell.Wood || type === Cell.Stone ||
            type === Cell.Metal || type === Cell.Ice || type === Cell.Vines || type === Cell.Crystal ||
            type === Cell.Glass || type === Cell.Fungus || type === Cell.Glowshroom || type === Cell.Moss ||
            type === Cell.RawOre || type === Cell.Grass || type === Cell.Leaf || type === Cell.Trunk ||
            type === Cell.Mirror
          ) continue;

          if (isLiquid(type) && maybeReact(ctx, x, y, type)) continue;

          if (type === Cell.Sand || type === Cell.Gold || type === Cell.Catalyst) handleSand(ctx, x, y, type);
          else if (type === Cell.Water) handleWater(ctx, x, y);
          else if (type === Cell.Fire) handleFire(ctx, x, y);
          else if (type === Cell.Ember) handleEmber(ctx, x, y);
          else if (type === Cell.Oil) handleOil(ctx, x, y);
          else if (type === Cell.Acid) handleAcid(ctx, x, y);
          else if (type === Cell.Gunpowder) handleGunpowder(ctx, x, y);
          else if (type === Cell.Lava) handleLava(ctx, x, y);
          else if (type === Cell.Nitrogen) handleNitrogen(ctx, x, y);
          else if (type === Cell.Snow) handleSnow(ctx, x, y);
          else if (type === Cell.Coal) handleCoal(ctx, x, y);
          else if (type === Cell.Ash) handleAsh(ctx, x, y);
          else if (type === Cell.Toxic || type === Cell.Healium || type === Cell.Teleportium) handleExoticLiquid(ctx, x, y, type);
          else if (
            type === Cell.Blood || type === Cell.Slime || type === Cell.ElixirLife ||
            type === Cell.ElixirLevity || type === Cell.ElixirStone
          ) {
            if (type === Cell.Blood) {
              if (simRandom() < 0.10) {
                stainCell(world, x, y + 1, 118, 14, 20, 0.22);
                if (simRandom() < 0.5) stainCell(world, x + (simRandom() < 0.5 ? 1 : -1), y, 118, 14, 20, 0.16);
              }
              if (simRandom() < 0.004 && canDryBloodOnSurface(world, x, y + 1)) {
                stainCell(world, x, y + 1, 110, 12, 18, 0.5);
                world.clearCellAt(ci);
                continue;
              }
            }
            handleViscousLiquid(ctx, x, y, type);
          } else if (type === Cell.Steam) handleGas(ctx, x, y, Cell.Steam, ctx.params.materials[Cell.Water].flowRate!, 0.3);
          else if (type === Cell.Smoke) {
            handleGas(ctx, x, y, Cell.Smoke, ctx.params.materials[Cell.Smoke].floatSpeed!, ctx.params.materials[Cell.Smoke].dispersion!);
          } else if (type === Cell.MarshGas) handleMarshGas(ctx, x, y);
          else if (type === Cell.Seed) handleSeed(ctx, x, y);
          else if (type === Cell.Brine) handleBrine(ctx, x, y);
        }
      }
    }
  }
}

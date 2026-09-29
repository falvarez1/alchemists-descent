import type { Ctx, ParticleOpts } from '@/core/types';
import { reseedSimChunk, restoreStreams, snapshotStreams } from '@/core/simRandom';
import type { World } from '@/sim/World';
import type { ParallelSweep } from '@/sim/Simulation';
import { Participant, type ParticipantSetup, type RuleParams } from '@/sim/parallel/chunkSweep';
import {
  BLAST_SOURCES, E_BURST, E_CHARGE_ADD, E_CHARGE_DEL, E_EXPLODE, E_FLORA, E_LEARN, E_SCAR_ADD, E_SCAR_DEL,
  E_SECRET_TOAST, E_SFX, E_SPAWN, E_STEAM, E_TOUCH, EFFECT_ARGS, EffectLog, FLORA_KINDS, OVERFLOW_STATE,
  OVERFLOW_TOUCH, PARTICLE_DEPOSIT, PARTICLE_HOMING, PARTICLE_LOOSE_DEBRIS, SFX_NAMES,
} from '@/sim/parallel/effectLog';
import type { ParallelFlow } from '@/sim/parallel/ParallelFlow';
import {
  C_CURSOR, C_FLOW_STEP, C_GEN, C_MOVED_TICK, C_PARAMS_EPOCH, C_PARTICLES, C_PUBLISHED,
  C_SHUTDOWN, C_SUBSTEP, C_TICK, C_WORLD_SEED, CONTROL_F64, CONTROL_INTS, EXPLOSION_STREAM_KEY, F_PLAYER_X,
  F_PLAYER_Y,
} from '@/sim/parallel/protocol';
import { sharedDescriptorOf } from '@/sim/parallel/sharedWorld';
import type { SimWorkerMessage } from '@/sim/parallel/simWorker';

export interface ParallelSimStats {
  /** Substeps run in parallel since creation. */
  substeps: number;
  /** Last substep: main's own share of the passes, waiting for workers to publish, the merge. */
  sweepMs: number;
  waitMs: number;
  mergeMs: number;
  /** Last substep: chunks swept (all participants / main alone), replayed records. */
  chunks: number;
  mainChunks: number;
  records: number;
}

function decodeOpts(grav: number, glow: number, flags: number): ParticleOpts | undefined {
  if (Number.isNaN(grav) && Number.isNaN(glow) && flags === 0) return undefined;
  const o: ParticleOpts = {};
  if (!Number.isNaN(grav)) o.grav = grav;
  if (!Number.isNaN(glow)) o.glow = glow;
  if (flags & PARTICLE_HOMING) o.homing = true;
  if (flags & PARTICLE_LOOSE_DEBRIS) o.looseDebris = true;
  if (flags & PARTICLE_DEPOSIT) o.deposit = true;
  return o;
}

/**
 * THE MULTITHREADED SANDBOX SWEEP (prototype; docs/SANDBOX-MT.md). Noita's
 * scheme over our activity chunks: four checkerboard passes, each sweeping
 * every scheduled chunk of one parity concurrently — two chunks swept at
 * once are two chunks apart, and every rule stays within REACH (32) cells of
 * its chunk, so they can never touch the same cell. The main thread is a
 * participant too; it then merges the workers' seed boxes and replays their
 * side effects in chunk order. Each chunk draws from its own RNG streams, so
 * the result is identical for any thread count (tests/parallel-sweep.test.ts).
 *
 * Everything outside the sweep (electrical, activity bookkeeping, growth,
 * projectiles) stays serial on main, exactly where Simulation runs it.
 */
export class ParallelSim implements ParallelSweep {
  /** Runtime A/B switch: off = the serial sweep over the same shared world. */
  enabled = true;
  readonly threads: number;
  readonly stats: ParallelSimStats = { substeps: 0, sweepMs: 0, waitMs: 0, mergeMs: 0, chunks: 0, mainChunks: 0, records: 0 };
  failure: string | null = null;
  private readonly ctrl: Int32Array;
  private readonly ctrlF: Float64Array;
  private readonly main: Participant;
  private readonly participants: { log: EffectLog; boxes: Int32Array }[] = [];
  private readonly workers: Worker[] = [];
  private readyCount = 0;
  private paramsJson = '';
  private paramsEpoch = 0;
  private lastParamsCheck = -Infinity;
  private readonly segmentOrder: number[] = [];
  private readonly explosions: number[] = [];

  /**
   * @param threads worker count (0 = the chunked sweep on main alone — the
   *        determinism reference and the Node test path).
   */
  constructor(private readonly world: World, params: RuleParams, threads: number,
    createWorker: (index: number) => Worker = defaultWorker) {
    const descriptor = sharedDescriptorOf(world);
    if (!descriptor) throw new Error('ParallelSim needs a world from createSharedWorld()');
    this.threads = Math.max(0, threads | 0);
    const control = new SharedArrayBuffer(CONTROL_INTS * 4), controlF64 = new SharedArrayBuffer(CONTROL_F64 * 8);
    this.ctrl = new Int32Array(control);
    this.ctrlF = new Float64Array(controlF64);
    const chunks = Math.ceil(descriptor.width / 64) * Math.ceil(descriptor.height / 64);
    const done = new SharedArrayBuffer(chunks * 4);
    const setupFor = (): ParticipantSetup => {
      const log = EffectLog.allocate(true);
      return { world: descriptor, control, controlF64, done, logData: log.data, logSegs: log.segs, boxes: new SharedArrayBuffer((1 + chunks * 5) * 4) };
    };
    const mainSetup = setupFor();
    this.main = new Participant(mainSetup, params);
    this.participants.push({ log: this.main.log, boxes: new Int32Array(mainSetup.boxes) });
    this.paramsJson = JSON.stringify(params);
    for (let i = 0; i < this.threads; i++) {
      const setup = setupFor();
      this.participants.push({ log: new EffectLog(setup.logData, setup.logSegs), boxes: new Int32Array(setup.boxes) });
      const worker = createWorker(i);
      worker.onmessage = (event: MessageEvent<{ type: string; message?: string }>) => {
        if (event.data.type === 'ready') this.readyCount++;
        else if (event.data.type === 'error') this.fail(`sim worker ${i}: ${event.data.message}`);
      };
      worker.onerror = (event) => this.fail(`sim worker ${i}: ${event.message}`);
      const init: SimWorkerMessage = { type: 'init', setup, params: JSON.parse(this.paramsJson) as RuleParams, paramsEpoch: 0, index: i };
      worker.postMessage(init);
      this.workers.push(worker);
    }
  }

  /** Tests only: see Participant.testOrder (main sweeping alone, threads = 0). */
  set testOrder(order: (() => Int32Array) | null) { this.main.testOrder = order; }

  get ready(): boolean { return this.failure === null && this.readyCount === this.threads; }

  handles(world: World): boolean {
    return this.enabled && world === this.world && this.ready;
  }

  private fail(message: string): void {
    if (this.failure !== null) return;
    this.failure = message;
    console.warn(`[sandbox-mt] falling back to the serial sweep — ${message}`);
  }

  /** Workers get tuning as messages; a change is noticed within 30 ticks. */
  private syncParams(ctx: Ctx): void {
    const tick = ctx.state.frameCount;
    if (tick - this.lastParamsCheck < 30 && tick >= this.lastParamsCheck) return;
    this.lastParamsCheck = tick;
    const params: RuleParams = { global: ctx.params.global, materials: ctx.params.materials };
    this.main.setParams(params);
    const json = JSON.stringify(params);
    if (json === this.paramsJson) return;
    this.paramsJson = json;
    this.paramsEpoch++;
    for (const worker of this.workers) {
      const message: SimWorkerMessage = { type: 'params', params: JSON.parse(json) as RuleParams, epoch: this.paramsEpoch };
      worker.postMessage(message);
    }
    Atomics.store(this.ctrl, C_PARAMS_EPOCH, this.paramsEpoch);
  }

  sweep(ctx: Ctx, substep: number): void {
    const c = this.ctrl, world = this.world, tick = ctx.state.frameCount;
    this.syncParams(ctx);
    c[C_TICK] = tick;
    c[C_SUBSTEP] = substep;
    c[C_WORLD_SEED] = ctx.state.worldSeed | 0;
    c[C_MOVED_TICK] = world.movedTick;
    c[C_FLOW_STEP] = (world.flow as ParallelFlow).stepNumber;
    c[C_PARTICLES] = ctx.particles?.list.length ?? 0;
    this.ctrlF[F_PLAYER_X] = ctx.player?.x ?? -1e9;
    this.ctrlF[F_PLAYER_Y] = ctx.player?.y ?? -1e9;
    c[C_CURSOR] = 0;
    c[C_PUBLISHED] = 0;
    const gen = Atomics.add(c, C_GEN, 1) + 1;
    if (this.threads > 0) Atomics.notify(c, C_GEN);

    const t0 = performance.now();
    const streams = snapshotStreams();
    this.main.runSubstep(gen);
    restoreStreams(streams);
    const t1 = performance.now();
    while (Atomics.load(c, C_PUBLISHED) < this.threads) { /* workers finishing their last chunk */ }
    const t2 = performance.now();
    this.merge(ctx, substep);
    const t3 = performance.now();
    const s = this.stats;
    s.substeps++;
    s.sweepMs = t1 - t0; s.waitMs = t2 - t1; s.mergeMs = t3 - t2;
    s.mainChunks = this.main.chunksSwept;
  }

  /** Seed boxes into the activity grid; every logged effect, in chunk order. */
  private merge(ctx: Ctx, substep: number): void {
    const world = this.world, order = this.segmentOrder, participants = this.participants;
    order.length = 0;
    let flags = 0, chunks = 0;
    // One number per segment: ordinal (unique per chunk) | participant | segment slot.
    for (let p = 0; p < participants.length; p++) {
      const segs = participants[p].log.segs, count = segs[0];
      flags |= segs[1];
      chunks += count;
      for (let s = 0; s < count; s++) order.push((segs[2 + s * 3] * 64 + p) * 4096 + s);
    }
    order.sort((a, b) => a - b);
    const explosions = this.explosions;
    explosions.length = 0;
    let records = 0;
    for (const packed of order) {
      const s = packed % 4096, p = Math.floor(packed / 4096) % 64;
      const log = participants[p].log, o = 2 + s * 3;
      records += this.replay(ctx, log.data, log.segs[o + 1], log.segs[o + 2]);
    }
    for (const { boxes } of participants) {
      for (let n = 0, count = boxes[0]; n < count; n++) {
        const o = 1 + n * 5;
        world.activity.adoptSeedBox(boxes[o], boxes[o + 1], boxes[o + 2], boxes[o + 3], boxes[o + 4]);
      }
    }
    world.activity.finishAdoption();
    if (flags & OVERFLOW_STATE) this.repairIndexes();
    if (flags & OVERFLOW_TOUCH) world.activity.invalidateAll();
    if (explosions.length > 0) {
      reseedSimChunk(ctx.state.worldSeed | 0, ctx.state.frameCount, substep, EXPLOSION_STREAM_KEY);
      for (let i = 0; i < explosions.length; i += 4) {
        const source = BLAST_SOURCES[explosions[i + 3]];
        ctx.explosions.trigger(explosions[i], explosions[i + 1], explosions[i + 2], source ? { playerDamageSource: source } : undefined);
      }
    }
    this.stats.chunks = chunks;
    this.stats.records = records;
  }

  private replay(ctx: Ctx, d: Float64Array, start: number, end: number): number {
    const world = this.world;
    let o = start, records = 0;
    while (o < end) {
      const kind = d[o], a = o + 1;
      records++;
      switch (kind) {
        case E_CHARGE_ADD: world.activeCharges.adoptLogged(d[a], true); break;
        case E_CHARGE_DEL: world.activeCharges.adoptLogged(d[a], false); break;
        case E_SCAR_ADD: world.colorOverrides.adoptLogged(d[a], true); break;
        case E_SCAR_DEL: world.colorOverrides.adoptLogged(d[a], false); break;
        case E_TOUCH: world.activity.touchRect(d[a], d[a + 1], d[a + 2], d[a + 3]); break;
        case E_SPAWN:
          ctx.particles.spawn(d[a], d[a + 1], d[a + 2], d[a + 3], d[a + 4] < 0 ? null : d[a + 4], d[a + 5], d[a + 6],
            decodeOpts(d[a + 7], d[a + 8], d[a + 9]));
          break;
        case E_BURST: {
          const color = d[a + 4];
          ctx.particles.burst(d[a], d[a + 1], d[a + 2], d[a + 3] < 0 ? null : d[a + 3], () => color, d[a + 5],
            decodeOpts(d[a + 6], d[a + 7], d[a + 8]));
          break;
        }
        case E_SFX: {
          const name = SFX_NAMES[d[a]];
          if (name) ctx.audio.sfx(name, Number.isNaN(d[a + 1]) ? undefined : d[a + 1], Number.isNaN(d[a + 2]) ? undefined : d[a + 2]);
          break;
        }
        case E_STEAM: ctx.audio.steam(d[a], d[a + 1]); break;
        case E_LEARN: ctx.audio.learn(); break;
        case E_SECRET_TOAST: {
          const name = ctx.state.secretReaction?.name;
          if (name) ctx.events.emit('toast', { text: `SECRET ALCHEMY — ${name}` });
          break;
        }
        case E_FLORA: {
          const flora = FLORA_KINDS[d[a]];
          if (flora) ctx.events.emit('floraMoment', { kind: flora, x: d[a + 1], y: d[a + 2], strength: d[a + 3] });
          break;
        }
        case E_EXPLODE: this.explosions.push(d[a], d[a + 1], d[a + 2], d[a + 3]); break;
        default:
          console.warn(`[sandbox-mt] unknown effect record ${kind}`);
          return records;
      }
      o = a + EFFECT_ARGS[kind];
    }
    return records;
  }

  /** A log overflowed and lost index edits: rebuild both sparse indexes from their planes. */
  private repairIndexes(): void {
    const world = this.world, n = world.width * world.height;
    console.warn('[sandbox-mt] effect log overflow — rebuilding charge/scar indexes');
    world.activeCharges.rebuildFrom(world.charge);
    const mask = world.colorOverrides.mask;
    const scars: number[] = [];
    for (let i = 0; i < n; i++) if (mask[i] !== 0) scars.push(i);
    world.colorOverrides.clear();
    for (const i of scars) world.colorOverrides.add(i);
  }

  dispose(): void {
    Atomics.store(this.ctrl, C_SHUTDOWN, 1);
    Atomics.add(this.ctrl, C_GEN, 1);
    Atomics.notify(this.ctrl, C_GEN);
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.readyCount = 0;
    this.failure = 'disposed';
  }
}

function defaultWorker(index: number): Worker {
  return new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module', name: `sim-worker-${index}` });
}

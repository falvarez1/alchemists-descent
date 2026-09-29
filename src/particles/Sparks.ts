import type { Ctx, SparkBurst, SparkKind, SparksApi } from '@/core/types';
import { fxRandom } from '@/core/simRandom';

/**
 * COSMETIC SPARKS. The particle list (Particles.ts) carries material: debris
 * that lands becomes a cell, gold that flies is paid. Sparks carry nothing —
 * embers off a blast, the fizz of a spell, a boss's aura, smoke curling off a
 * burning crate — so they can live on the GPU by the tens of thousands
 * (render/GpuSparkSim: ping-pong state textures, stepped once per game tick,
 * bouncing off the real terrain window). They read the grid; they never write
 * it, so "if the grid can't explain it, it doesn't ship" still holds for
 * everything gameplay touches.
 *
 * This service is renderer-agnostic: gameplay queues bursts here (events
 * outward, like shockwaves); the GPU sim drains the queue each composed frame.
 * A frame the GPU cannot take (CPU compose, WebGPU) drains it into a thinned
 * set of ordinary cosmetic particles instead, so an effect never vanishes.
 *
 * Randomness is the fx stream: cosmetics that never feed a decision.
 */

/** Floats per queued spawn record: x, y, vx, vy, life, kind, color, glow. */
export const SPARK_RECORD = 8;
/** Most spawns queued per frame (a burst past it is clipped, not deferred). */
export const SPARK_QUEUE_MAX = 16384;

export const SPARK_KIND_ID: Record<SparkKind, number> = { spark: 0, ember: 1, smoke: 2, magic: 3 };

const DEFAULT_LIFE: Record<SparkKind, number> = { spark: 34, ember: 70, smoke: 90, magic: 48 };

export class Sparks implements SparksApi {
  private readonly queue = new Float32Array(SPARK_QUEUE_MAX * SPARK_RECORD);
  private count = 0;
  /** Bursts requested this session (telemetry / probes). */
  requested = 0;
  generation = 0;

  get pending(): number {
    return this.count;
  }

  burst(x: number, y: number, opts: SparkBurst): void {
    const kind = opts.kind ?? 'spark';
    const kindId = SPARK_KIND_ID[kind];
    const n = Math.max(0, Math.min(opts.count | 0, SPARK_QUEUE_MAX - this.count));
    if (n === 0 || opts.colors.length === 0) return;
    this.requested += n;
    const spread = opts.spread ?? Math.PI;
    const centre = opts.angle ?? -Math.PI / 2;
    const life = opts.life ?? DEFAULT_LIFE[kind];
    const glow = opts.glow ?? 1;
    const radius = opts.radius ?? 0;
    const q = this.queue;
    for (let i = 0; i < n; i++) {
      const a = centre + (fxRandom() * 2 - 1) * spread;
      const s = opts.speed * (0.35 + fxRandom() * 0.9);
      const r = radius * Math.sqrt(fxRandom()), ra = fxRandom() * Math.PI * 2;
      const o = (this.count + i) * SPARK_RECORD;
      q[o] = x + Math.cos(ra) * r;
      q[o + 1] = y + Math.sin(ra) * r;
      q[o + 2] = Math.cos(a) * s;
      q[o + 3] = Math.sin(a) * s;
      q[o + 4] = Math.max(2, life * (0.7 + fxRandom() * 0.6));
      q[o + 5] = kindId;
      q[o + 6] = opts.colors[(fxRandom() * opts.colors.length) | 0] & 0xffffff;
      q[o + 7] = glow;
    }
    this.count += n;
  }

  /** Hand this frame's queued records to the GPU sim; the queue empties. */
  drain(sink: (records: Float32Array, count: number) => void): void {
    if (this.count === 0) return;
    sink(this.queue, this.count);
    this.count = 0;
  }

  /**
   * No GPU this frame: a thinned set becomes ordinary cosmetic particles
   * (type null — they never deposit), so the effect still reads.
   */
  drainToParticles(ctx: Ctx, keepOneIn = 6): void {
    const q = this.queue;
    for (let i = 0; i < this.count; i += keepOneIn) {
      const o = i * SPARK_RECORD;
      const kind = q[o + 5];
      const color = q[o + 6] | 0;
      const grav = kind === SPARK_KIND_ID.spark ? 0.12 : kind === SPARK_KIND_ID.ember ? -0.01 : kind === SPARK_KIND_ID.smoke ? -0.02 : 0;
      ctx.particles.spawn(q[o], q[o + 1], q[o + 2], q[o + 3], null, color, Math.round(q[o + 4]), {
        grav, glow: kind === SPARK_KIND_ID.smoke ? 0 : Math.max(0.6, q[o + 7]),
      });
    }
    this.count = 0;
  }

  clear(): void {
    this.count = 0;
    this.generation++;
  }
}

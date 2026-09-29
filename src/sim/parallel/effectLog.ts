import type { SfxId } from '@/content/audio/sfxCues';
import type { EventMap } from '@/core/events';
import { LOG_CAPACITY, SEGMENT_CAPACITY } from '@/sim/parallel/protocol';

/**
 * Everything a sweep participant cannot do in place — spawn a particle, play
 * a sound, emit an event, detonate, or edit a main-thread-only index (the
 * active-charge Set, the colour-scar Set) — is appended here as a record and
 * replayed by the main thread after the sweep, in chunk order. Records are
 * flat doubles in a shared buffer: [kind, ...args].
 *
 * Segments (ordinal, start, end) mark which chunk wrote which records, so the
 * replay order is the chunk order, not the order threads happened to finish.
 */
export const E_SPAWN = 1;
export const E_BURST = 2;
export const E_SFX = 3;
export const E_STEAM = 4;
export const E_LEARN = 5;
export const E_SECRET_TOAST = 6;
export const E_FLORA = 7;
export const E_EXPLODE = 8;
export const E_CHARGE_ADD = 9;
export const E_CHARGE_DEL = 10;
export const E_SCAR_ADD = 11;
export const E_SCAR_DEL = 12;
export const E_TOUCH = 13;

/** Argument count per record kind. */
export const EFFECT_ARGS = [0, 10, 9, 3, 2, 0, 0, 4, 4, 1, 1, 1, 1, 4];

/** Overflow flags: what a full log dropped (main repairs state, drops cosmetics). */
export const OVERFLOW_STATE = 1;
export const OVERFLOW_TOUCH = 2;
export const OVERFLOW_COSMETIC = 4;

/** Strings the rules pass, as table indices (unknown strings are dropped). */
export const SFX_NAMES: readonly SfxId[] = ['mat.brine.fizz'];
export const FLORA_KINDS: readonly EventMap['floraMoment']['kind'][] = ['sprout', 'bloom', 'rung', 'soak'];
export const BLAST_SOURCES = ['gunpowder'];

export const PARTICLE_HOMING = 1;
export const PARTICLE_LOOSE_DEBRIS = 2;
export const PARTICLE_DEPOSIT = 4;

function overflowKind(kind: number): number {
  if (kind === E_TOUCH) return OVERFLOW_TOUCH;
  if (kind >= E_CHARGE_ADD) return OVERFLOW_STATE;
  return kind === E_EXPLODE ? OVERFLOW_STATE : OVERFLOW_COSMETIC;
}

export class EffectLog {
  readonly data: Float64Array;
  /** [segmentCount, overflowFlags, (ordinal, start, end)...] */
  readonly segs: Int32Array;
  private len = 0;
  private segCount = 0;
  private segStart = 0;
  private ordinal = -1;
  private flags = 0;

  constructor(data: SharedArrayBuffer | ArrayBuffer, segs: SharedArrayBuffer | ArrayBuffer) {
    this.data = new Float64Array(data);
    this.segs = new Int32Array(segs);
  }

  static allocate(shared: boolean): { data: SharedArrayBuffer | ArrayBuffer; segs: SharedArrayBuffer | ArrayBuffer } {
    const make = (bytes: number): SharedArrayBuffer | ArrayBuffer => shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
    return { data: make(LOG_CAPACITY * 8), segs: make((2 + SEGMENT_CAPACITY * 3) * 4) };
  }

  reset(): void {
    this.len = 0; this.segCount = 0; this.flags = 0; this.ordinal = -1;
  }

  begin(ordinal: number): void {
    this.ordinal = ordinal;
    this.segStart = this.len;
  }

  end(): void {
    if (this.len === this.segStart) return;
    if (this.segCount >= SEGMENT_CAPACITY) {
      // No slot to say who wrote them: the records cannot be replayed in order.
      this.flags |= OVERFLOW_STATE | OVERFLOW_TOUCH | OVERFLOW_COSMETIC;
      this.len = this.segStart;
      return;
    }
    const o = 2 + this.segCount * 3;
    this.segs[o] = this.ordinal; this.segs[o + 1] = this.segStart; this.segs[o + 2] = this.len;
    this.segCount++;
  }

  /** Make the records visible to the main thread (before PUBLISHED is bumped). */
  publish(): void {
    this.segs[0] = this.segCount;
    this.segs[1] = this.flags;
  }

  private room(kind: number): boolean {
    if (this.len + 1 + EFFECT_ARGS[kind] <= this.data.length) return true;
    this.flags |= overflowKind(kind);
    return false;
  }

  put1(kind: number, a: number): void {
    if (!this.room(kind)) return;
    const d = this.data, o = this.len;
    d[o] = kind; d[o + 1] = a;
    this.len = o + 2;
  }

  put2(kind: number, a: number, b: number): void {
    if (!this.room(kind)) return;
    const d = this.data, o = this.len;
    d[o] = kind; d[o + 1] = a; d[o + 2] = b;
    this.len = o + 3;
  }

  put3(kind: number, a: number, b: number, c: number): void {
    if (!this.room(kind)) return;
    const d = this.data, o = this.len;
    d[o] = kind; d[o + 1] = a; d[o + 2] = b; d[o + 3] = c;
    this.len = o + 4;
  }

  put4(kind: number, a: number, b: number, c: number, e: number): void {
    if (!this.room(kind)) return;
    const d = this.data, o = this.len;
    d[o] = kind; d[o + 1] = a; d[o + 2] = b; d[o + 3] = c; d[o + 4] = e;
    this.len = o + 5;
  }

  put0(kind: number): void {
    if (!this.room(kind)) return;
    this.data[this.len++] = kind;
  }

  /** SPAWN (10 args) and BURST (9 args). */
  putMany(kind: number, args: readonly number[]): void {
    if (!this.room(kind)) return;
    const d = this.data;
    d[this.len++] = kind;
    for (let i = 0; i < EFFECT_ARGS[kind]; i++) d[this.len++] = args[i];
  }
}

/**
 * Deterministic mulberry32 PRNG. One seeded instance drives a whole
 * generation pass, so identical seeds reproduce identical worlds
 * (snapshots, level regen, and daily seeds all depend on this).
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Next sample in [0, 1) — drop-in for the global random function. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExcl). */
  int(maxExcl: number): number {
    return Math.floor(this.next() * maxExcl);
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

/** Non-deterministic 32-bit seed for rolling a fresh world. */
export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}

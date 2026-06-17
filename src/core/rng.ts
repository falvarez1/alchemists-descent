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

/**
 * FNV-1a fold of a label into a seed; returns a uint32.
 *
 * Use this to FORK deterministic sub-streams for additive generation passes:
 * a new pass seeds its own `new Rng(hashSeed(worldSeed, 'my-pass'))` instead
 * of consuming draws from the main stream, so every existing pass keeps
 * byte-identical output on old seeds.
 */
export function hashSeed(seed: number, label: string): number {
  let h = 0x811c9dc5;
  let s = seed >>> 0;
  for (let i = 0; i < 4; i++) {
    h ^= s & 0xff;
    h = Math.imul(h, 0x01000193);
    s >>>= 8;
  }
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i);
    h ^= c & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= c >>> 8;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * FNV-1a hash of a string → uint32 (seed 0x811c9dc5, prime 0x01000193).
 *
 * The canonical single-source for the string fold that was previously
 * copy-pasted across Levels (expedition seed), Builder (campaign playtest
 * seed — MUST stay byte-identical to Levels for seed reproducibility), and the
 * asset content signatures. Pass `seed` to CHAIN folds (fold A then B is
 * `fnv1aString(B, fnv1aString(A))`), reproducing a multi-string running hash.
 */
export function fnv1aString(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

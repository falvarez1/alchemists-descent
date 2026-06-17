import { hashSeed } from '@/core/rng';

export function fnv1aByteArrays(arrays: readonly Uint8Array[]): string {
  let h = 0x811c9dc5;
  for (const bytes of arrays) {
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function hashCoord(seed: number, label: string, x: number, y: number): number {
  return hashSeed(seed >>> 0, `${label}:${x}:${y}`);
}

export function unitHash(seed: number, label: string, x: number, y: number): number {
  return hashCoord(seed, label, x, y) / 0x100000000;
}

/** Hot-loop-safe integer coordinate hash. No string allocation, deterministic uint32. */
export function hash2i(seed: number, x: number, y: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h ^= Math.imul(x | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= Math.imul(y | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 16), 0x165667b1);
  return (h ^ (h >>> 15)) >>> 0;
}

export function unitHash2i(seed: number, x: number, y: number): number {
  return hash2i(seed, x, y) / 0x100000000;
}

export function signedUnitHash2i(seed: number, x: number, y: number): number {
  return unitHash2i(seed, x, y) * 2 - 1;
}

import { hashSeed } from '@/core/rng';

export function fnv1aBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function hashCoord(seed: number, label: string, x: number, y: number): number {
  return hashSeed(seed >>> 0, `${label}:${x}:${y}`);
}

export function hashCoord3(seed: number, label: string, x: number, y: number, z: number): number {
  return hashSeed(seed >>> 0, `${label}:${x}:${y}:${z}`);
}

export function unitHash(seed: number, label: string, x: number, y: number): number {
  return hashCoord(seed, label, x, y) / 0x100000000;
}

export function signedUnitHash(seed: number, label: string, x: number, y: number): number {
  return unitHash(seed, label, x, y) * 2 - 1;
}

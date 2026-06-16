import { describe, expect, it } from 'vitest';

import { createDefaultVirtualWorldDef } from '@/world/virtual/defaults';
import {
  generateVirtualChunk,
  setRoundCornersBackend,
} from '@/world/virtual/ChunkGenerator';
import { isRoundCornersWasmAvailable } from '@/world/virtual/wasm/roundCornersKernel';

function sameTyped(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('wasm corner-rounding kernel', () => {
  it('instantiates in this environment', () => {
    // Guards the parity test below from a false pass: if the kernel were unavailable, the
    // 'wasm' backend would silently fall back to TS and parity would be trivially true.
    expect(isRoundCornersWasmAvailable()).toBe(true);
  });

  it('produces byte-identical chunks via the WASM and TS corner-rounding paths', () => {
    // roundCaveCorners runs BEFORE the dressing passes, which read terrain shape — so a single
    // divergent cell cascades into a different chunk hash. Equal hashes => byte-identical morphology.
    const coords: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [-1, 2],
      [7, -3],
      [3, 5],
      [-4, -2],
    ];
    const seeds = [0x4e4f4954, 1337, 20260616, 99];
    try {
      for (const seed of seeds) {
        const def = createDefaultVirtualWorldDef(seed);
        for (const [cx, cy] of coords) {
          setRoundCornersBackend('ts');
          const ts = generateVirtualChunk(def, cx, cy);
          setRoundCornersBackend('wasm');
          const wasm = generateVirtualChunk(def, cx, cy);
          expect(wasm.meta.hash).toBe(ts.meta.hash);
          expect(sameTyped(wasm.types, ts.types)).toBe(true);
          expect(sameTyped(wasm.colors, ts.colors)).toBe(true);
          expect(sameTyped(wasm.life, ts.life)).toBe(true);
          expect(sameTyped(wasm.charge, ts.charge)).toBe(true);
        }
      }
    } finally {
      setRoundCornersBackend('auto');
    }
  });
});

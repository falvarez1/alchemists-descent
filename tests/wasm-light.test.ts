import { describe, expect, it } from 'vitest';

import { propagateLight } from '@/render/propagateLight';
import { isLightWasmAvailable, propagateLightWasm } from '@/render/wasm/lightKernel';

function field(LW: number, LH: number, seed: number): { r: Float32Array; g: Float32Array; b: Float32Array; att: Float32Array } {
  let s = seed >>> 0;
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const n = LW * LH;
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n), att = new Float32Array(n);
  const palette = [0.86, 0.84, 0.8, 0.74, 0.4];
  for (let i = 0; i < n; i++) att[i] = palette[(rnd() * palette.length) | 0];
  // Sparse bright seeds plus a scatter of faint ones (fire, embers, glow).
  for (let k = 0; k < Math.max(1, n >> 6); k++) {
    const i = (rnd() * n) | 0;
    r[i] = rnd() * 1.4; g[i] = r[i] * rnd(); b[i] = rnd() * 0.9;
  }
  return { r, g, b, att };
}

describe('wasm light propagation', () => {
  it('instantiates in this environment', () => {
    // Guards the parity test from a false pass via the silent TS fallback.
    expect(isLightWasmAvailable()).toBe(true);
  });

  it('is bit-identical to the TypeScript sweeps', () => {
    // The game field (321x181), plus odd and degenerate shapes for the edge clamps.
    const shapes: Array<[number, number]> = [[321, 181], [7, 5], [2, 9], [1, 12], [64, 1], [33, 17]];
    for (const [LW, LH] of shapes) {
      for (const seed of [1, 42, 20260928]) {
        const ref = field(LW, LH, seed), got = field(LW, LH, seed);
        propagateLight(LW, LH, ref.r, ref.g, ref.b, ref.att);
        expect(propagateLightWasm(LW, LH, got.r, got.g, got.b, got.att)).toBe(true);
        let diffs = 0;
        for (const [a, c] of [[ref.r, got.r], [ref.g, got.g], [ref.b, got.b]] as const) {
          for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) diffs++;
        }
        expect({ LW, LH, seed, diffs }).toEqual({ LW, LH, seed, diffs: 0 });
      }
    }
  });
});

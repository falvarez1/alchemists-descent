import { describe, expect, it } from 'vitest';
import { DataUtils } from 'three';
import { overlayHalf } from '@/render/ComposeShader';

/**
 * The WebGL2 overlay converts its staging floats to f16 inline (fix4b perf:
 * the per-value library call was a third of the overlay's cost on the Bell &
 * Tea Engine's busiest frames). It must stay bit-exact to DataUtils.
 */
describe('overlay f16 conversion', () => {
  it('matches DataUtils.toHalfFloat bit for bit', () => {
    const values = [0, -0, 1, -1, 0.5, 1e-8, -1e-8, 6.1e-5, 5.9e-8, 65504, 65519, 65535, -65535, 1.8, 2.2, -3.75, 0.0001];
    for (let i = 0; i < 20000; i++) values.push(Math.sin(i * 12.9898) * 43758.5453 % 40, (i - 10000) * 0.00731, Math.pow(2, (i % 60) - 40));
    for (const v of values) expect(overlayHalf(v)).toBe(DataUtils.toHalfFloat(v));
  });
});

import { expect, test } from 'vitest';
import { backdropTexel } from '@/render/depth/parallax';

test('decimal plate scales land on the correct texel at exact rational boundaries', () => {
  // The waterworks at camera 483: (483 * .08 + 92) / .46 is exactly 284.
  // Binary double precision previously rounded it just below that boundary.
  expect(backdropTexel(483 * .08, 92, .46, 0, 1672)).toBe(284);
  expect(backdropTexel(483 * .08, 115, .46, 0, 1672)).toBe(334);
  expect(backdropTexel(483 * .08, 138, .46, 0, 1672)).toBe(384);
  // Actual movement on either side still samples the corresponding texel.
  expect(backdropTexel(483 * .08 - .01, 92, .46, 0, 1672)).toBe(283);
  expect(backdropTexel(483 * .08 + .01, 92, .46, 0, 1672)).toBe(284);
});

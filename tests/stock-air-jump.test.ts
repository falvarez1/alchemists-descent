import { expect, it } from 'vitest';
import { StockAirJump } from '@/arena/StockAirJump';

it('allows one fresh airborne jump, blocks commitments, and refreshes only on landing or reset', () => {
  const jump = new StockAirJump();
  expect(jump.step(true, true, true)).toBe(false);
  expect(jump.step(false, false, true)).toBe(false);
  expect(jump.step(true, false, false)).toBe(false);
  expect(jump.step(true, false, true)).toBe(true);
  expect(jump.step(true, false, true)).toBe(false);
  expect(jump.step(false, false, true)).toBe(false);
  expect(jump.step(true, false, true)).toBe(false);
  jump.step(false, true, true);
  expect(jump.step(true, false, true)).toBe(true);
  jump.reset();
  expect(jump.step(true, false, true)).toBe(true);
});

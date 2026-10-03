import { expect, it } from 'vitest';
import { StockFootwork } from '@/arena/ai/stockFootwork';

it('closes to melee then holds a band instead of chasing tiny position changes', () => {
  const feet = new StockFootwork();
  expect(feet.goal(100, 220, 0)).toBe(202);
  expect(feet.goal(198, 220, 30)).toBeNull();
  for (let i = 31; i < 90; i++) expect(feet.goal(198, 220 + Math.sin(i) * 6, i)).toBeNull();
  expect(feet.goal(198, 240, 91)).toBe(222);
});
it('pauses an abrupt reversal instead of following a target back and forth every decision', () => {
  const feet = new StockFootwork();
  expect(feet.goal(100, 160, 0)).toBe(142);
  expect(feet.goal(100, 40, 5)).toBeNull();
  expect(feet.goal(100, 40, 10)).toBeNull();
  expect(feet.goal(100, 40, 18)).toBe(58);
  feet.reset(); expect(feet.goal(100, 160, 19)).toBe(142);
});

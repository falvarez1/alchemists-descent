import { expect, it } from 'vitest';
import { StockFootwork } from '@/arena/ai/stockFootwork';

it('resumes pressure when knockback leaves a stationary foe beyond jab reach', () => {
  const feet = new StockFootwork();
  expect(feet.goal(100, 116, 0)).toBeNull();
  expect(feet.goal(100, 130, 30)).not.toBeNull();
});

it('closes to melee then holds a band instead of chasing tiny position changes', () => {
  const feet = new StockFootwork();
  expect(feet.goal(100, 220, 0)).toBe(210);
  expect(feet.goal(198, 212, 30)).toBeNull();
  for (let i = 31; i < 90; i++) expect(feet.goal(198, 212 + Math.sin(i) * 4, i)).toBeNull();
  expect(feet.goal(198, 240, 91)).toBe(230);
});
it('pauses an abrupt reversal instead of following a target back and forth every decision', () => {
  const feet = new StockFootwork();
  expect(feet.goal(100, 160, 0)).toBe(150);
  expect(feet.goal(100, 40, 5)).toBeNull();
  expect(feet.goal(100, 40, 10)).toBeNull();
  expect(feet.goal(100, 40, 18)).toBe(50);
  feet.reset(); expect(feet.goal(100, 160, 19)).toBe(150);
});

import { expect, it } from 'vitest';
import { StockSpecial } from '@/arena/StockSpecial';

it('limits bursts and sustains one charge per three seconds', () => {
  const s = new StockSpecial();
  expect(s.spend()).toBe(true);
  expect(s.spend()).toBe(false);
  for (let i = 0; i < 24; i++) s.step();
  expect(s.spend()).toBe(true);
  expect(s.charges).toBe(0);
  for (let i = 24; i < 179; i++) s.step();
  expect(s.spend()).toBe(false);
  s.step(); expect(s.charges).toBe(1);
});
it('rewards a melee contact with refill progress without shortening cast recovery', () => {
  const s = new StockSpecial(); s.spend();
  s.rewardMelee(); s.rewardMelee(); s.rewardMelee();
  expect(s.charges).toBe(2);
  expect(s.busy).toBe(true); expect(s.spend()).toBe(false);
  for (let i = 0; i < 24; i++) s.step();
  expect(s.spend(2)).toBe(true); expect(s.charges).toBe(0);
  s.reset(); expect(s.charges).toBe(2); expect(s.busy).toBe(false); expect(s.progress).toBe(0);
});
it('refunds a refused ability without adding recovery or losing prior refill progress', () => {
  const s = new StockSpecial(); s.spend();
  for (let i = 0; i < 30; i++) s.step();
  const before = s.progress;
  expect(s.spend()).toBe(true); s.refund();
  expect(s.charges).toBe(1); expect(s.progress).toBe(before); expect(s.busy).toBe(false);
});

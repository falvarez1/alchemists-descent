import { expect, it } from 'vitest';
import { selectStockAttack, stockMoveset } from '@/config/stockAttacks';
import { stockAttackOverlaps } from '@/arena/StockAttack';
it('selects Ilyra aerials and distinct ground heavies with authored contact volumes', () => {
  const neutral = { left: false, right: false, up: false, down: false };
  const set = stockMoveset('ilyra-voss');
  expect(selectStockAttack('ilyra-voss', false, neutral, 1).kind).toBe('neutral_air');
  expect(selectStockAttack('ilyra-voss', false, { ...neutral, left: true }, 1).kind).toBe('back_air');
  expect(selectStockAttack('ilyra-voss', true, neutral, 1, 'up_smash').kind).toBe('up_smash');
  expect(selectStockAttack('ilyra-voss', true, neutral, 1, 'down_smash').kind).toBe('down_smash');
  expect(stockAttackOverlaps(set.back_air, 1, 100, 100, 80, 100)).toBe(true);
  expect(stockAttackOverlaps(set.back_air, 1, 100, 100, 120, 100)).toBe(false);
  expect(set.down_air.knockY).toBeGreaterThan(0);
  expect(set.up_smash.damage).toBeGreaterThan(set.launcher.damage);
  expect(set.down_smash.minReach).toBeLessThan(0);
});

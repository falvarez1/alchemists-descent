import { describe, expect, it } from 'vitest';
import { selectStockAttack, stockMoveset } from '@/config/stockAttacks';
import { StockAttack, stockAttackOverlaps } from '@/arena/StockAttack';

const neutral = { left: false, right: false, up: false, down: false };
describe('Brann playable move selection', () => {
  it('selects distinct aerials and preserves the body facing for a back air', () => {
    const choose = (keys = neutral) => selectStockAttack('brann-rook', false, keys, 1);
    expect(choose()).toEqual({ kind: 'neutral_air', facing: 1 });
    expect(choose({ ...neutral, right: true }).kind).toBe('aerial');
    expect(choose({ ...neutral, left: true })).toEqual({ kind: 'back_air', facing: 1 });
    expect(choose({ ...neutral, up: true }).kind).toBe('up_air');
    expect(choose({ ...neutral, down: true }).kind).toBe('down_air');
    expect(selectStockAttack('brann-rook', false, { ...neutral, right: true }, -1)).toEqual({ kind: 'back_air', facing: -1 });
  });
  it('retains light ground attacks and supports explicit heavy directions', () => {
    expect(selectStockAttack('brann-rook', true, neutral, 1).kind).toBe('opener');
    expect(selectStockAttack('brann-rook', true, { ...neutral, up: true }, 1).kind).toBe('launcher');
    expect(selectStockAttack('brann-rook', true, { ...neutral, down: true }, 1).kind).toBe('finisher');
    expect(selectStockAttack('brann-rook', true, neutral, 1, 'up_smash').kind).toBe('up_smash');
    expect(selectStockAttack('brann-rook', true, neutral, 1, 'down_smash').kind).toBe('down_smash');
    expect(selectStockAttack('rusk-emberjaw', false, { ...neutral, down: true }, 1).kind).toBe('aerial');
  });
});

describe('Brann directional hit volumes', () => {
  const moves = stockMoveset('brann-rook');
  it('hits behind with back air and mirrors the volume and knockback', () => {
    expect(stockAttackOverlaps(moves.back_air, 1, 100, 100, 80, 100)).toBe(true);
    expect(stockAttackOverlaps(moves.back_air, 1, 100, 100, 120, 100)).toBe(false);
    expect(stockAttackOverlaps(moves.back_air, -1, 100, 100, 120, 100)).toBe(true);
    expect(moves.back_air.knockX).toBeLessThan(0);
  });
  it('separates upward and downward contacts and gives down air a downward launch', () => {
    expect(stockAttackOverlaps(moves.up_air, 1, 100, 100, 100, 70)).toBe(true);
    expect(stockAttackOverlaps(moves.up_air, 1, 100, 100, 100, 120)).toBe(false);
    expect(stockAttackOverlaps(moves.down_air, 1, 100, 100, 100, 120)).toBe(true);
    expect(stockAttackOverlaps(moves.down_air, 1, 100, 100, 100, 70)).toBe(false);
    expect(moves.down_air.knockY).toBeGreaterThan(0);
  });
  it('sweeps both sides with down smash but not overhead', () => {
    for (const x of [75, 125]) expect(stockAttackOverlaps(moves.down_smash, 1, 100, 100, x, 100)).toBe(true);
    expect(stockAttackOverlaps(moves.down_smash, 1, 100, 100, 100, 70)).toBe(false);
  });
  it.each(['neutral_air', 'back_air', 'up_air', 'down_air', 'up_smash', 'down_smash'] as const)(
    '%s has commitment, one contact per victim, and interruption',
    kind => {
      const attack = new StockAttack(), spec = moves[kind];
      attack.start(kind, spec, 1);
      expect(attack.claim(1)).toBe(false);
      for (let i = 0; i < spec.startup; i++) attack.step(true);
      expect(attack.claim(1)).toBe(true); expect(attack.claim(1)).toBe(false);
      for (let i = 0; i < spec.active; i++) attack.step(true);
      expect(attack.phase).toBe('recovery'); expect(attack.claim(0)).toBe(false);
      expect(attack.start('opener', moves.opener, 1)).toBe(false);
      attack.step(false); expect(attack.busy).toBe(false);
    },
  );
});

import { describe, expect, it } from 'vitest';
import { StockAttack, stockAttackOverlaps } from '@/arena/StockAttack';
import { stockMoveset } from '@/config/stockAttacks';

describe('committed stock attacks', () => {
  it('has distinct startup, active and punishable recovery windows', () => {
    const a = new StockAttack(), move = stockMoveset('ilyra-voss').opener;
    expect(a.start('opener', move, 1)).toBe(true); expect(a.phase).toBe('startup');
    for (let i = 0; i < move.startup - 1; i++) a.step(true);
    expect(a.phase).toBe('startup'); a.step(true); expect(a.phase).toBe('active');
    for (let i = 0; i < move.active; i++) a.step(true);
    expect(a.phase).toBe('recovery'); expect(a.start('opener', move, -1)).toBe(false);
    for (let i = 0; i < move.recovery; i++) a.step(true);
    expect(a.phase).toBe('idle');
  });
  it('hits each target only once per attack and never during startup or recovery', () => {
    const a = new StockAttack(), move = stockMoveset('mara-quell').aerial;
    a.start('aerial', move, -1); expect(a.claim(1)).toBe(false);
    for (let i = 0; i < move.startup; i++) a.step(true);
    expect(a.claim(1)).toBe(true); expect(a.claim(1)).toBe(false); expect(a.claim(0)).toBe(true);
    a.reset(); a.start('aerial', move, 1);
    for (let i = 0; i < move.startup; i++) a.step(true);
    expect(a.claim(1)).toBe(true); expect(a.id).toBe(2);
  });
  it('cancels on interruption and keeps facing locked during commitment', () => {
    const a = new StockAttack(), move = stockMoveset('brann-rook').finisher;
    a.start('finisher', move, -1); a.start('opener', move, 1); expect(a.facing).toBe(-1);
    a.step(false); expect(a.busy).toBe(false); expect(a.claim(1)).toBe(false);
  });
  it('compares the attack volume with the real body and mirrors it left/right', () => {
    const move = stockMoveset('ilyra-voss').opener;
    expect(stockAttackOverlaps(move, 1, 100, 100, 120, 100)).toBe(true);
    expect(stockAttackOverlaps(move, 1, 100, 100, 80, 100)).toBe(false);
    expect(stockAttackOverlaps(move, -1, 100, 100, 80, 100)).toBe(true);
    expect(stockAttackOverlaps(move, 1, 100, 100, 120, 50)).toBe(false);
    expect(stockAttackOverlaps(move, 1, 100, 100, 140, 100)).toBe(false);
  });
  it('gives heavy finishers more commitment and launch growth than openers', () => {
    for (const fighter of ['ilyra-voss', 'brann-rook', 'mara-quell'] as const) {
      const moves = stockMoveset(fighter);
      expect(moves.finisher.startup).toBeGreaterThan(moves.opener.startup * 2);
      expect(moves.finisher.recovery).toBeGreaterThan(moves.opener.recovery);
      expect(moves.finisher.growth).toBeGreaterThan(moves.opener.growth);
      expect(moves.launcher.knockY).toBeLessThan(-2);
    }
  });
});

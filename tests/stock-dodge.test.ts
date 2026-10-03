import { describe, expect, test } from 'vitest';
import { StockDodge } from '@/arena/StockDodge';

describe('stock dodge commitment', () => {
  test('startup and end lag are vulnerable, with a bounded evasion window between them', () => {
    const d = new StockDodge();
    d.step(true, true, true, 1, 0);
    expect(d.phase).toBe('startup'); expect(d.evading).toBe(false);
    let invulnerable = 0, recovery = 0;
    for (let i = 0; i < 45; i++) {
      d.step(false, true, true, 1, 0);
      if (d.evading) invulnerable++;
      if (d.phase === 'recovery') { recovery++; expect(d.evading).toBe(false); }
    }
    expect(invulnerable).toBe(8); expect(recovery).toBe(12); expect(d.phase).toBe('idle');
  });
  test('only one air dodge is available until landing or reset', () => {
    const d = new StockDodge();
    d.step(true, true, false, 1, -1);
    expect(d.airReady).toBe(false);
    for (let i = 0; i < 45; i++) d.step(false, true, false, 0, 0);
    d.step(true, true, false, 1, 0); expect(d.phase).toBe('idle');
    d.step(false, true, true, 0, 0); expect(d.airReady).toBe(true);
    d.step(true, true, false, 1, 0); expect(d.phase).toBe('startup');
    d.reset(); expect(d.airReady).toBe(true); expect(d.phase).toBe('idle');
  });
  test('diagonal air dodges do not gain speed and committed directions cannot turn', () => {
    const d = new StockDodge();
    d.step(true, true, false, 1, -1);
    for (let i = 0; i < 3; i++) d.step(false, true, false, -1, 1);
    expect(d.phase).toBe('evade');
    expect(d.vx).toBeGreaterThan(0); expect(d.vy).toBeLessThan(0);
    expect(Math.hypot(d.vx, d.vy)).toBeCloseTo(4.4);
  });
  test('stun denies a request and interrupts startup without refunding an air dodge', () => {
    const d = new StockDodge();
    d.step(true, false, false, 1, 0); expect(d.phase).toBe('idle');
    d.step(true, true, false, 1, 0); expect(d.phase).toBe('startup');
    d.step(false, false, false, 0, 0); expect(d.phase).toBe('idle');
    expect(d.airReady).toBe(false);
  });
  test('a request during end lag cannot extend invulnerability or queue another dodge', () => {
    const d = new StockDodge();
    d.step(true, true, true, -1, 0);
    for (let i = 0; i < 16; i++) d.step(false, true, true, 0, 0);
    expect(d.phase).toBe('recovery');
    d.step(true, true, true, 1, 0); expect(d.phase).toBe('recovery'); expect(d.evading).toBe(false);
    for (let i = 0; i < 35; i++) d.step(false, true, true, 0, 0);
    expect(d.phase).toBe('idle');
  });
});

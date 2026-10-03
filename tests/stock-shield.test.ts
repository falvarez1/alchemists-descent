import { describe, expect, it } from 'vitest';
import { StockShield } from '@/arena/StockShield';

describe('finite stock shield', () => {
  it('blocks while grounded, drains on contact, and leaves release lag', () => {
    const s = new StockShield();
    s.step(true, true, true);
    expect(s.phase).toBe('guard'); expect(s.busy).toBe(true);
    expect(s.block(12)).toBe(true); expect(s.strength).toBeLessThan(90);
    s.step(false, true, true); expect(s.busy).toBe(true);
    for (let i = 0; i < 30; i++) s.step(false, true, true);
    expect(s.phase).toBe('idle'); expect(s.block(12)).toBe(false);
  });
  it('breaks under pressure and cannot be held forever or reactivated before release', () => {
    const s = new StockShield(); s.step(true, true, true);
    s.block(200); expect(s.phase).toBe('broken'); expect(s.block(10)).toBe(false);
    for (let i = 0; i < 150; i++) s.step(true, true, true);
    expect(s.phase).toBe('idle');
    s.step(false, true, true); s.step(true, true, true); expect(s.phase).toBe('guard');
    for (let i = 0; i < 300; i++) s.step(true, true, true);
    expect(s.phase).not.toBe('guard');
  });
  it('regenerates only after a quiet delay and cancels when airborne or interrupted', () => {
    const s = new StockShield(); s.step(true, true, true); s.block(10);
    s.step(false, true, false); const strength = s.strength;
    expect(s.phase).not.toBe('guard');
    for (let i = 0; i < 20; i++) s.step(false, true, true);
    expect(s.strength).toBe(strength);
    for (let i = 0; i < 100; i++) s.step(false, true, true);
    expect(s.strength).toBeGreaterThan(strength);
    s.step(true, true, true); s.step(true, false, true); expect(s.block(5)).toBe(false);
    s.reset(); expect(s.strength).toBe(100); expect(s.phase).toBe('idle');
  });
  it('allows a dodge out of guard but prevents canceling contact stun or break', () => {
    const s = new StockShield(); s.step(true, true, true);
    expect(s.canDodge).toBe(true); s.block(8); expect(s.canDodge).toBe(false);
    for (let i = 0; i < 20; i++) s.step(true, true, true);
    expect(s.canDodge).toBe(true); s.drop(); expect(s.busy).toBe(false);
  });
});

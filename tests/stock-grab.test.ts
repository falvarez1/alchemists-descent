import { describe, expect, it } from 'vitest';
import { StockGrab } from '@/arena/StockGrab';

describe('committed grabs', () => {
  it('has startup, a short contact window, and punishable whiff recovery', () => {
    const g = new StockGrab(); expect(g.start(-1)).toBe(true);
    expect(g.phase).toBe('startup'); expect(g.facing).toBe(-1);
    for (let i = 0; i < 6; i++) g.step(true);
    expect(g.phase).toBe('active'); expect(g.start(1)).toBe(false);
    for (let i = 0; i < 3; i++) g.step(true);
    expect(g.phase).toBe('recovery');
    for (let i = 0; i < 22; i++) g.step(true);
    expect(g.busy).toBe(false);
  });
  it('only catches during contact and provides a finite hold with throw recovery', () => {
    const g = new StockGrab(); g.start(1);
    expect(g.catch(1)).toBe(false);
    for (let i = 0; i < 6; i++) g.step(true);
    expect(g.catch(1)).toBe(true); expect(g.victim).toBe(1); expect(g.phase).toBe('hold');
    for (let i = 0; i < 8; i++) g.step(true);
    expect(g.canThrow).toBe(true); g.release(); expect(g.phase).toBe('recovery'); expect(g.victim).toBeNull();
    g.reset(); g.start(1); for (let i = 0; i < 6; i++) g.step(true); g.catch(1);
    for (let i = 0; i < 50; i++) g.step(true);
    expect(g.phase).toBe('recovery'); expect(g.victim).toBeNull();
  });
  it('cancels when interrupted and resets all ownership', () => {
    const g = new StockGrab(); g.start(1); for (let i = 0; i < 6; i++) g.step(true); g.catch(1);
    g.step(false); expect(g.busy).toBe(false); expect(g.victim).toBeNull();
  });
});

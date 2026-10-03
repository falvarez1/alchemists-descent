import { describe, expect, test } from 'vitest';
import { MatchDirector, stockLaunch, influenceLaunch } from '@/arena/MatchDirector';
import { STOCK_RULES, STOCK_LAUNCH } from '@/config/stockRules';

const box = { left: 100, right: 700, top: 100, bottom: 450 };
const alive = [{ x: 300, y: 300 }, { x: 500, y: 300 }];
const rules = { ...STOCK_RULES, countdownTicks: 0 };

describe('stock matches', () => {
  test('attack growth changes high-volatility launch, mass applies once, and stun remains bounded', () => {
    const opener = stockLaunch(2, -1, 10, 100, 1, .35, .65);
    const finisher = stockLaunch(2, -1, 10, 100, 1, 1.5, 1.2);
    const heavy = stockLaunch(2, -1, 10, 100, 1.5, 1.5, 1.2);
    expect(Math.hypot(finisher.x, finisher.y)).toBeGreaterThan(Math.hypot(opener.x, opener.y));
    expect(Math.hypot(heavy.x, heavy.y)).toBeCloseTo(Math.hypot(finisher.x, finisher.y) / 1.5);
    expect(finisher.stun).toBeGreaterThan(opener.stun);
    expect(stockLaunch(6, -2, 100, 999, 1, 5, 10).stun).toBeLessThanOrEqual(STOCK_LAUNCH.maxStun);
  });
  test('directional influence bends a launch at most twelve degrees without adding speed', () => {
    const up = influenceLaunch(10, 0, 0, -1);
    expect(Math.hypot(up.x, up.y)).toBeCloseTo(10);
    expect(Math.atan2(up.y, up.x)).toBeCloseTo(-Math.PI / 15);
    expect(influenceLaunch(10, 0, 1, 0)).toEqual({ x: 10, y: 0 });
  });
  test('damage accumulates without removing a stock and heavier bodies launch less', () => {
    const m = new MatchDirector(rules, box);
    m.start(2);
    m.hurt(0, 40);
    expect(m.fighters[0].volatility).toBe(40);
    expect(m.fighters[0].stocks).toBe(3);
    const low = stockLaunch(3, -1, 12, 0, 1);
    const high = stockLaunch(3, -1, 12, 120, 1);
    const heavy = stockLaunch(3, -1, 12, 120, 1.5);
    expect(Math.hypot(high.x, high.y)).toBeGreaterThan(Math.hypot(low.x, low.y));
    expect(Math.hypot(heavy.x, heavy.y)).toBeCloseTo(Math.hypot(high.x, high.y) / 1.5);
  });

  test('ring-out costs one stock and respawn resets volatility with protection', () => {
    const m = new MatchDirector({ ...rules, respawnTicks: 3 }, box); m.start(2);
    m.hurt(0, 80);
    expect(m.step([{ x: 90, y: 300 }, alive[1]]).downs).toEqual([0]);
    expect(m.fighters[0].stocks).toBe(2);
    expect(m.step([{ x: 90, y: 300 }, alive[1]]).downs).toEqual([]);
    m.step(alive);
    expect(m.step(alive).respawns).toEqual([0]);
    expect(m.fighters[0].volatility).toBe(0);
    expect(m.fighters[0].protection).toBe(rules.protectionTicks);
    expect(m.hurt(0, 100)).toBe(false);
  });

  test.each([
    { x: 99, y: 300 }, { x: 701, y: 300 }, { x: 300, y: 99 }, { x: 300, y: 451 },
  ])('every blast boundary removes a stock: %j', position => {
    const m = new MatchDirector(rules, box); m.start(2);
    expect(m.step([position, alive[1]]).downs).toEqual([0]);
  });

  test('simultaneous last stocks draw instead of favoring update order', () => {
    const m = new MatchDirector({ ...rules, stocks: 1 }, box); m.start(2);
    m.step([{ x: 90, y: 300 }, { x: 800, y: 300 }]);
    expect(m.state).toBe('finished'); expect(m.winner).toBeNull(); expect(m.reason).toBe('draw');
  });

  test('timeout uses stocks then volatility, and exact ties draw', () => {
    const m = new MatchDirector({ ...rules, timeTicks: 1 }, box); m.start(2);
    m.hurt(0, 20); m.step(alive);
    expect(m.winner).toBe(1); expect(m.reason).toBe('timeout');
    m.start(2); m.step(alive);
    expect(m.winner).toBeNull(); expect(m.reason).toBe('draw');
  });

  test('countdown ignores hits and clock; restart clears all match state', () => {
    const m = new MatchDirector({ ...rules, countdownTicks: 2 }, box); m.start(2);
    expect(m.hurt(0, 10)).toBe(false);
    m.step(alive); expect(m.remainingTicks).toBe(rules.timeTicks);
    m.step(alive); expect(m.state).toBe('fighting');
    m.hurt(0, 90); m.start(2);
    expect(m.fighters[0].volatility).toBe(0); expect(m.fighters[0].stocks).toBe(3);
  });

  test('damage without an impulse builds volatility without launching; nonfinite damage is rejected', () => {
    expect(stockLaunch(0, 0, 5, 100, 1)).toEqual({ x: 0, y: 0, stun: 0 });
    const m = new MatchDirector(rules, box); m.start(2);
    expect(m.hurt(0, Number.NaN)).toBe(false);
    expect(m.hurt(0, -20)).toBe(false);
    expect(m.fighters[0].volatility).toBe(0);
  });
});

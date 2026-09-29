import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTouchControlsPreference, touchControlsEnabled, touchStickVector } from '@/input/touchSupport';

afterEach(() => vi.unstubAllGlobals());

describe('touch input capabilities', () => {
  it('enables touch for coarse pointers without relying on phone user-agent strings', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(touchControlsEnabled('auto')).toBe(true);
    expect(touchControlsEnabled('off')).toBe(false);
  });

  it('keeps desktop controls by default and allows a hybrid-device override', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(touchControlsEnabled('auto')).toBe(false);
    expect(touchControlsEnabled('on')).toBe(true);
  });

  it('works when preference storage is blocked or invalid', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(readTouchControlsPreference()).toBe('auto');
    vi.stubGlobal('localStorage', { getItem: () => 'invalid' });
    expect(readTouchControlsPreference()).toBe('auto');
  });
});

describe('thumb pad geometry', () => {
  it('ignores thumb jitter at the center', () => {
    expect(touchStickVector(3, -2, 45)).toEqual({ x: 0, y: 0 });
    expect(touchStickVector(0, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('keeps diagonal movement bounded when pointer capture goes outside the pad', () => {
    const vector = touchStickVector(-300, 400, 45);
    expect(vector.x).toBeCloseTo(-0.6);
    expect(vector.y).toBeCloseTo(0.8);
    expect(Math.hypot(vector.x, vector.y)).toBeCloseTo(1);
  });

  it('retains short aim distances for nearby interactions', () => {
    expect(touchStickVector(12, 0, 48)).toEqual({ x: 0.25, y: 0 });
  });
});

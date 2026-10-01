import { describe, expect, it } from 'vitest';

import { PORTAL_WAYPOINT_LABEL, setGameWaypoint } from '@/game/compass';
import {
  GLINT_TICKS,
  lureGlint,
  lurePeriod,
  lurePhase,
  lureRings,
} from '@/game/keyLure';

describe('key lure clock', () => {
  it('runs one slow clock per key: a period of 6.5 to 9 seconds', () => {
    for (const [x, y] of [[795, 1057], [1483, 104], [70, 600], [1500, 900]]) {
      const period = lurePeriod(x, y);
      expect(period).toBeGreaterThanOrEqual(390);
      expect(period).toBeLessThan(540);
    }
  });

  it('rings exactly once per period, on the tick the glint begins', () => {
    const x = 1483, y = 104, period = lurePeriod(x, y);
    let rings = 0;
    for (let f = 0; f < period * 5; f++) {
      if (lureRings(f, x, y)) {
        rings++;
        expect(lureGlint(f, x, y)).toBe(0); // the swell starts from nothing
        expect(lurePhase(f, x, y)).toBe(0);
      }
    }
    expect(rings).toBe(5);
  });

  it('swells fast, settles slowly, and is dark the rest of the period', () => {
    const x = 400, y = 300;
    let start = 0;
    while (!lureRings(start, x, y)) start++;
    const env = Array.from({ length: GLINT_TICKS + 4 }, (_, i) => lureGlint(start + i, x, y));
    const peak = Math.max(...env);
    expect(peak).toBeCloseTo(1, 5);
    const peakAt = env.indexOf(peak);
    expect(peakAt).toBeLessThan(GLINT_TICKS / 2); // a quick swell…
    expect(GLINT_TICKS - peakAt).toBeGreaterThan(peakAt * 2); // …and a longer settle
    expect(env.slice(GLINT_TICKS).every((v) => v === 0)).toBe(true);
    for (const v of env) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('keeps two keys out of step', () => {
    const a = lurePhase(1000, 100, 100);
    const b = lurePhase(1000, 900, 600);
    expect(a).not.toBe(b);
  });
});

describe('game waypoint', () => {
  it('sets the compass when it is empty', () => {
    const rt = { mapWaypoint: null as { x: number; y: number; label: string } | null };
    expect(setGameWaypoint(rt, PORTAL_WAYPOINT_LABEL, 390.4, 1008.6)).toBe(true);
    expect(rt.mapWaypoint).toEqual({ x: 390, y: 1009, label: PORTAL_WAYPOINT_LABEL });
  });

  it('never takes the compass from a waypoint someone else set', () => {
    const rt = { mapWaypoint: { x: 10, y: 20, label: 'Waypoint' } };
    expect(setGameWaypoint(rt, PORTAL_WAYPOINT_LABEL, 390, 1008)).toBe(false);
    expect(rt.mapWaypoint).toEqual({ x: 10, y: 20, label: 'Waypoint' });
    const gift = { mapWaypoint: { x: 10, y: 20, label: 'Pell’s mark' } };
    expect(setGameWaypoint(gift, PORTAL_WAYPOINT_LABEL, 390, 1008)).toBe(false);
  });

  it('replaces its own earlier waypoint', () => {
    const rt = { mapWaypoint: { x: 1, y: 2, label: PORTAL_WAYPOINT_LABEL } };
    expect(setGameWaypoint(rt, PORTAL_WAYPOINT_LABEL, 5, 6)).toBe(true);
    expect(rt.mapWaypoint).toMatchObject({ x: 5, y: 6 });
  });
});

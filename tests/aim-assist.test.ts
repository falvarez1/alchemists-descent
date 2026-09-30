import { describe, expect, it } from 'vitest';

import { AIM_ASSIST_DEGREES, angleDelta, pickBearingAssist } from '@/combat/aimAssist';
import { AIM_ASSISTS, sanitizeChoice } from '@/config/playerPrefs';

const deg = (d: number): number => (d * Math.PI) / 180;
const straight = (_x: number, _y: number): number => 0;

describe('aim assist levels', () => {
  it('are Off, Light (the Trickshot default, 4) and Strong (its ceiling, 8)', () => {
    expect(AIM_ASSIST_DEGREES).toEqual({ off: 0, light: 4, strong: 8 });
    expect([...AIM_ASSISTS]).toEqual(['off', 'light', 'strong']);
    expect(sanitizeChoice('heavy', AIM_ASSISTS, 'off')).toBe('off');
  });
});

describe('the smallest turn between two angles', () => {
  it('goes the short way round', () => {
    expect(angleDelta(deg(10), deg(20))).toBeCloseTo(deg(10), 10);
    expect(angleDelta(deg(179), deg(-179))).toBeCloseTo(deg(2), 10);
    expect(angleDelta(deg(-179), deg(179))).toBeCloseTo(deg(-2), 10);
    expect(angleDelta(deg(90), deg(90))).toBeCloseTo(0, 10);
  });
});

describe('locking a creature by bearing', () => {
  const at = (bearingDeg: number, distance: number, ref: string) => ({ x: Math.cos(deg(bearingDeg)) * distance, y: Math.sin(deg(bearingDeg)) * distance, ref });

  it('takes a creature inside the cone, and launches by the spell’s own compensation', () => {
    const hit = pickBearingAssist(0, 0, deg(-3), deg(4), [at(0, 100, 'a')], 260, () => 0.123);
    expect(hit).toEqual({ angle: 0.123, ref: 'a' });
  });

  it('leaves aim alone when nothing is inside the cone, or it is off', () => {
    expect(pickBearingAssist(0, 0, deg(-6), deg(4), [at(0, 100, 'a')], 260, straight)).toBeNull();
    expect(pickBearingAssist(0, 0, deg(-6), deg(8), [at(0, 100, 'a')], 260, straight)?.ref).toBe('a');
    expect(pickBearingAssist(0, 0, deg(-6), 0, [at(0, 100, 'a')], 260, straight)).toBeNull();
    expect(pickBearingAssist(0, 0, NaN, deg(8), [at(0, 100, 'a')], 260, straight)).toBeNull();
    expect(pickBearingAssist(0, 0, 0, deg(8), [], 260, straight)).toBeNull();
  });

  it('prefers the creature nearest the aim, then the nearer one', () => {
    const near = pickBearingAssist(0, 0, 0, deg(8), [at(6, 50, 'wide'), at(1, 150, 'tight')], 260, straight);
    expect(near?.ref).toBe('tight');
    const tie = pickBearingAssist(0, 0, 0, deg(8), [at(2, 200, 'far'), at(2, 60, 'close')], 260, straight);
    expect(tie?.ref).toBe('close');
  });

  it('ignores what is out of reach or standing on top of the player', () => {
    expect(pickBearingAssist(0, 0, 0, deg(8), [at(0, 400, 'far')], 260, straight)).toBeNull();
    expect(pickBearingAssist(0, 0, 0, deg(8), [at(0, 1, 'on me')], 260, straight)).toBeNull();
  });

  it('works aiming left, across the +/-PI seam', () => {
    const left = pickBearingAssist(0, 0, deg(178), deg(4), [at(-179, 90, 'behind')], 260, straight);
    expect(left?.ref).toBe('behind');
    expect(pickBearingAssist(0, 0, deg(178), deg(4), [at(-170, 90, 'too far round')], 260, straight)).toBeNull();
  });

  it('measures from the player, not from the origin', () => {
    const t = { x: 300 + 100, y: 50, ref: 'e' };
    expect(pickBearingAssist(300, 50, deg(2), deg(4), [t], 260, straight)?.ref).toBe('e');
  });
});

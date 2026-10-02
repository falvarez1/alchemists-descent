import { describe, expect, test } from 'vitest';
import { FIGHTER_ORDER } from '@/content/fighters';
import { FIGHTER_BODIES, bodyFor } from '@/content/fighterBodies';
import {
  BODY_FIELDS,
  BODY_MOD_FIELDS,
  BODY_RANGES,
  NEUTRAL_BODY,
  bodyBars,
  bodyViolations,
  cloneBody,
  composeBody,
  makeBody,
} from '@/core/fighterBody';

/** The fighters' bodies (docs/arena/FIGHTER-PHYSICS.md): the table, the ranges and the guard rails. */

describe('the neutral body', () => {
  test('is every field 1, frozen, and in range: the classic Alchemist is untouched', () => {
    for (const f of BODY_FIELDS) expect(NEUTRAL_BODY[f]).toBe(1);
    expect(Object.isFrozen(NEUTRAL_BODY)).toBe(true);
    expect(bodyViolations(NEUTRAL_BODY)).toEqual([]);
    expect(bodyFor(null)).toEqual(NEUTRAL_BODY);
  });

  test('makeBody fills what is not named with 1', () => {
    const b = makeBody({ mass: 1.2 });
    expect(b.mass).toBe(1.2);
    expect(b.run).toBe(1);
    expect(Object.isFrozen(b)).toBe(true);
  });
});

describe('composing a body with running effects', () => {
  test('multiplies the fields an effect names, and only those', () => {
    const base = makeBody({ gravity: 0.8, run: 1.1 });
    const out = cloneBody(NEUTRAL_BODY);
    composeBody(out, base, [{ gravity: 0.5 }, { gravity: 0.5, fall: 0.3 }, { run: 2 }]);
    expect(out.gravity).toBeCloseTo(0.8 * 0.25, 10);
    expect(out.fall).toBeCloseTo(0.3, 10);
    expect(out.run).toBeCloseTo(2.2, 10);
    expect(out.mass).toBe(1);
  });

  test('with no effects it is exactly the base, and it resets what a lapsed effect left behind', () => {
    const base = makeBody({ airControl: 1.2 });
    const out = cloneBody(NEUTRAL_BODY);
    composeBody(out, base, [{ airControl: 0.5 }]);
    expect(out.airControl).toBeCloseTo(0.6, 10);
    composeBody(out, base, []);
    expect(out).toEqual(base);
  });

  test('the fields an effect may bend are all real body fields', () => {
    for (const f of BODY_MOD_FIELDS) expect(BODY_FIELDS).toContain(f);
  });
});

describe('the ten bodies', () => {
  test('every value lies inside its declared range', () => {
    for (const id of FIGHTER_ORDER) expect(bodyViolations(FIGHTER_BODIES[id]), id).toEqual([]);
  });

  test('every fighter has a body, and the bodies are frozen complete profiles', () => {
    expect(Object.keys(FIGHTER_BODIES).sort()).toEqual([...FIGHTER_ORDER].sort());
    for (const id of FIGHTER_ORDER) {
      expect(Object.isFrozen(NEUTRAL_BODY), id).toBe(true); // (the ten are live tuning data, mutable on purpose; the neutral body is the fixed reference)
      for (const f of BODY_FIELDS) expect(typeof FIGHTER_BODIES[id][f], `${id}.${f}`).toBe('number');
    }
  });

  test('no body is heavy AND fast (that is the one thing a bruiser may not be)', () => {
    for (const id of FIGHTER_ORDER) {
      const b = FIGHTER_BODIES[id];
      expect(b.mass > 1.2 && b.run > 1.1, id).toBe(false);
    }
  });

  test('no two fighters share a feel: at least one of weight, run, traction, air control differs by more than 10%', () => {
    const differs = (a: number, b: number): boolean => Math.abs(a - b) / Math.max(a, b) > 0.1;
    for (let i = 0; i < FIGHTER_ORDER.length; i++) {
      for (let j = i + 1; j < FIGHTER_ORDER.length; j++) {
        const a = FIGHTER_BODIES[FIGHTER_ORDER[i]];
        const b = FIGHTER_BODIES[FIGHTER_ORDER[j]];
        const apart = differs(a.mass, b.mass) || differs(a.run, b.run) || differs(a.friction, b.friction) || differs(a.airControl, b.airControl);
        expect(apart, `${FIGHTER_ORDER[i]} vs ${FIGHTER_ORDER[j]}`).toBe(true);
      }
    }
  });

  test('the roster says what the design says: who is heaviest, fastest, slidiest, floatiest, frailest', () => {
    const by = (f: keyof typeof NEUTRAL_BODY, pick: 'max' | 'min'): string => {
      const sorted = [...FIGHTER_ORDER].sort((a, b) => FIGHTER_BODIES[a][f] - FIGHTER_BODIES[b][f]);
      return pick === 'max' ? sorted[sorted.length - 1] : sorted[0];
    };
    expect(by('mass', 'max')).toBe('brann-rook');
    expect(by('mass', 'min')).toBe('edda-morrow');
    expect(by('run', 'max')).toBe('kest-rel');
    expect(by('run', 'min')).toBe('brann-rook');
    expect(by('friction', 'min')).toBe('selene-wraith');
    expect(by('friction', 'max')).toBe('father-thorne');
    expect(by('gravity', 'min')).toBe('mara-quell');
    expect(by('jetFuel', 'max')).toBe('mara-quell');
    expect(by('maxHp', 'min')).toBe('edda-morrow');
    expect(by('maxHp', 'max')).toBe('brann-rook');
    expect(by('dealt', 'max')).not.toBe('mara-quell');
  });

  test('Nox is the plain body on purpose: close to the Alchemist in every field', () => {
    const b = FIGHTER_BODIES['nox-calder'];
    for (const f of BODY_FIELDS) expect(Math.abs(b[f] - 1), f).toBeLessThanOrEqual(0.12);
  });
});

describe('the Body card', () => {
  test('a bar per stat, each between 0 and 1 for a body inside its ranges', () => {
    for (const id of FIGHTER_ORDER) {
      for (const bar of bodyBars(FIGHTER_BODIES[id])) {
        expect(bar.unit, `${id} ${bar.label}`).toBeGreaterThanOrEqual(0);
        expect(bar.unit, `${id} ${bar.label}`).toBeLessThanOrEqual(1);
      }
    }
    expect(bodyBars(NEUTRAL_BODY).length).toBeGreaterThanOrEqual(8);
  });

  test('the ranges are sane: min below 1 below max for every field', () => {
    for (const f of BODY_FIELDS) {
      expect(BODY_RANGES[f].min, f).toBeLessThan(1);
      expect(BODY_RANGES[f].max, f).toBeGreaterThan(1);
    }
  });
});

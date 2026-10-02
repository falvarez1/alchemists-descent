import { beforeAll, describe, expect, test } from 'vitest';
import { FIGHTER_BODIES } from '@/content/fighterBodies';
import { FIGHTER_ORDER } from '@/content/fighters';
import { BODY_RANGES } from '@/core/fighterBody';
import type { BodyField } from '@/core/fighterBody';
import { ParamRegistry } from '@/fighters/paramOverride';
import { fighterParamRange, inRange } from '@/fighters/paramRanges';

/** The tuning registry (docs/arena/TELEMETRY-AND-BALANCE.md 3.5): every knob named, bounded, restorable. */

describe('paramRanges', () => {
  test('a range admits the shipped default it was resolved for', () => {
    for (const [path, dflt] of [['kit.x.ram.cooldown', 540], ['kit.x.guard.damage', 16], ['kit.x.range', 40], ['kit.x.foo.bar', 3]] as const) {
      expect(inRange(fighterParamRange(path, dflt), dflt), path).toBe(true);
    }
  });
  test('inRange refuses non-finite, out-of-window and fractional-for-integer values', () => {
    expect(inRange({ min: 0, max: 10 }, Number.NaN)).toBe(false);
    expect(inRange({ min: 0, max: 10 }, 11)).toBe(false);
    expect(inRange({ min: 0, max: 10, integer: true }, 2.5)).toBe(false);
    expect(inRange({ min: 0, max: 10, integer: true }, 3)).toBe(true);
  });
});

describe('ParamRegistry', () => {
  const reg = new ParamRegistry();
  beforeAll(async () => {
    await reg.ready();
    reg.addRoot('body', FIGHTER_BODIES, {
      range: (path) => { const r = BODY_RANGES[path.slice(path.lastIndexOf('.') + 1) as BodyField]; return r ? { min: r.min, max: r.max, step: 0.01 } : null; },
    });
  }, 60000);

  test('registers the shared dials, every kit\'s tuning and every fighter\'s body', () => {
    const list = reg.list();
    expect(list.some((p) => p.path.startsWith('fighter.'))).toBe(true);
    for (const id of FIGHTER_ORDER) {
      expect(list.some((p) => p.path.startsWith(`kit.${id}.`)), `kit ${id}`).toBe(true);
      expect(reg.get(`body.${id}.mass`), `body ${id}`).toBeTypeOf('number');
    }
  });

  test('every knob\'s shipped default lies inside its own range', () => {
    for (const spec of reg.list()) {
      if (typeof spec.default !== 'number') continue;
      expect(spec.default >= spec.min && spec.default <= spec.max, `${spec.path} = ${spec.default} in ${spec.min}..${spec.max}`).toBe(true);
    }
  });

  test('set refuses an unknown path, a wrong type and an out-of-range value, and changes nothing', () => {
    const path = 'body.brann-rook.dealt';
    const was = reg.get(path);
    expect(reg.set('body.brann-rook.nope', 1)).toBe(false);
    expect(reg.set(path, true)).toBe(false);
    expect(reg.set(path, 99)).toBe(false);
    expect(reg.get(path)).toBe(was);
  });

  test('apply is all-or-nothing, throws on one bad entry, and the restore function puts everything back', () => {
    const a = 'body.brann-rook.dealt', b = 'body.selene-wraith.friction';
    const wasA = reg.get(a), wasB = reg.get(b);
    expect(() => reg.apply({ [a]: 1.2, 'body.brann-rook.bogus': 1 })).toThrow(/refused/);
    expect(reg.get(a)).toBe(wasA);
    const restore = reg.apply({ [a]: 1.2, [b]: 0.5 });
    expect(reg.get(a)).toBe(1.2);
    expect(reg.get(b)).toBe(0.5);
    expect(reg.snapshot()[a]).toBe(1.2);
    restore();
    expect(reg.get(a)).toBe(wasA);
    expect(reg.get(b)).toBe(wasB);
    expect(reg.snapshot()[a]).toBeUndefined();
    restore(); // restoring twice is harmless
    expect(reg.get(a)).toBe(wasA);
  });

  test('a body knob is the live body: writing it changes what the fighter reads', () => {
    const restore = reg.apply({ 'body.mara-quell.gravity': 0.7 });
    expect(FIGHTER_BODIES['mara-quell'].gravity).toBe(0.7);
    restore();
    expect(FIGHTER_BODIES['mara-quell'].gravity).toBe(0.8);
  });

  test('reset puts every knob back to its default', () => {
    reg.set('body.kest-rel.run', 1.1);
    reg.reset();
    expect(Object.keys(reg.snapshot()).length).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';

import { VIEW_H, VIEW_W } from '@/config/constants';
import { cloudSumGlsl, glslFloat, SKY } from '@/render/skyAtmosphere';

/**
 * The D1 daytime sky is rendered twice — once as a GLSL string (ComposeShader,
 * the GPU compose path) and once as a JS loop (FrameComposer, the CPU path) —
 * from ONE shared tuning table, SKY. They drifted once (the cloud tint differed
 * between paths). These tests lock the table's invariants and the GLSL generator
 * so the two paths can't silently diverge again.
 */
describe('sky atmosphere — GLSL float formatter', () => {
  it('always emits a parseable GLSL float (decimal point or exponent)', () => {
    for (const n of [0, 1, 26, -3, 0.5, 0.02, -0.28, 2.4, 150, 0.004]) {
      const s = glslFloat(n);
      expect(s.includes('.') || s.includes('e'), `glslFloat(${n}) = "${s}"`).toBe(true);
      expect(Number.parseFloat(s)).toBeCloseTo(n, 6);
    }
  });

  it('appends ".0" to integers but preserves fractional precision', () => {
    expect(glslFloat(1)).toBe('1.0');
    expect(glslFloat(26)).toBe('26.0');
    expect(glslFloat(-3)).toBe('-3.0');
    expect(glslFloat(0.02)).toBe('0.02');
    expect(glslFloat(-0.28)).toBe('-0.28');
  });

  it('formats every numeric SKY tuning value as a valid GLSL literal', () => {
    const nums: number[] = [
      SKY.DRIFT_SPEED,
      ...Object.values(SKY.gradient),
      SKY.sun.screenX, SKY.sun.screenY, SKY.sun.haloRadius, SKY.sun.haloPower,
      SKY.sun.haloStrength, SKY.sun.coreEdge0, SKY.sun.coreEdge1, SKY.sun.r, SKY.sun.g, SKY.sun.b,
      SKY.clouds.parallax, SKY.clouds.freqX, SKY.clouds.freqY, SKY.clouds.opacity,
      ...SKY.clouds.octaves.flatMap((o) => [o.amp, o.fx, o.fy]),
    ];
    for (const n of nums) {
      const s = glslFloat(n);
      expect(s, `${n}`).toMatch(/[.e]/);
      expect(s).not.toContain('NaN');
    }
  });
});

describe('sky atmosphere — cloud sum GLSL generator', () => {
  const glsl = cloudSumGlsl();

  it('emits exactly one sin() term per cloud octave', () => {
    const terms = glsl.match(/sin\(/g) ?? [];
    expect(terms.length).toBe(SKY.clouds.octaves.length);
  });

  it('adds the drift phase to (and only to) drifting octaves', () => {
    const driftCount = SKY.clouds.octaves.filter((o) => o.drift).length;
    const occurrences = glsl.match(/uPhaseSky/g) ?? [];
    expect(occurrences.length).toBe(driftCount);
  });

  it('omits the cay term for a zero-Y octave and signs non-zero ones', () => {
    // octave 0 has fy:0 → no vertical component; octave 2 has fy:-1.4 → subtracted.
    const lines = glsl.split('\n').map((l) => l.trim());
    const zeroOct = lines.find((l) => l.startsWith(`${glslFloat(SKY.clouds.octaves[0].amp)} * sin`));
    expect(zeroOct, glsl).toBeDefined();
    expect(zeroOct).not.toContain('cay');
    expect(glsl).toContain('- cay * 1.4'); // negative fy renders as a subtraction
  });

  it('references only the GLSL locals the shader defines (cax, cay, uPhaseSky)', () => {
    const idents = glsl.match(/[a-zA-Z_]\w*/g) ?? [];
    const allowed = new Set(['sin', 'cax', 'cay', 'uPhaseSky']);
    for (const id of idents) expect(allowed.has(id), `unexpected identifier "${id}"`).toBe(true);
  });
});

describe('sky atmosphere — SKY table invariants', () => {
  const inUnit = (n: number) => n >= 0 && n <= 1;

  it('keeps every color channel in [0,1]', () => {
    const colors = [SKY.sun, SKY.clouds, SKY.hillFar, SKY.hillNear];
    for (const c of colors) {
      for (const ch of [c.r, c.g, c.b]) expect(inUnit(ch)).toBe(true);
    }
  });

  it('keeps every blend opacity in [0,1] and drift positive', () => {
    expect(inUnit(SKY.clouds.opacity)).toBe(true);
    expect(inUnit(SKY.hillFar.opacity)).toBe(true);
    expect(inUnit(SKY.hillNear.opacity)).toBe(true);
    expect(SKY.DRIFT_SPEED).toBeGreaterThan(0);
  });

  it('pins the sun inside the view rectangle', () => {
    expect(SKY.sun.screenX).toBeGreaterThanOrEqual(0);
    expect(SKY.sun.screenX).toBeLessThanOrEqual(VIEW_W);
    expect(SKY.sun.screenY).toBeGreaterThanOrEqual(0);
    expect(SKY.sun.screenY).toBeLessThanOrEqual(VIEW_H);
  });

  it('grades the gradient blue overhead → warm haze at the horizon', () => {
    // warms toward the horizon (R up) and cools (B down) as t: 0 → 1.
    expect(SKY.gradient.rHorizon).toBeGreaterThan(0);
    expect(SKY.gradient.bHorizon).toBeLessThan(0);
    // overhead (t=0) is blue-dominant.
    expect(SKY.gradient.bBase).toBeGreaterThan(SKY.gradient.rBase);
  });

  it('makes the near hill ridge taller and darker than the far one (depth cue)', () => {
    expect(SKY.hillNear.base).toBeGreaterThan(SKY.hillFar.base);
    const lum = (h: { r: number; g: number; b: number }) => h.r + h.g + h.b;
    expect(lum(SKY.hillNear)).toBeLessThan(lum(SKY.hillFar));
  });

  it('has at least one drifting cloud octave with positive amplitudes', () => {
    expect(SKY.clouds.octaves.length).toBeGreaterThan(0);
    expect(SKY.clouds.octaves.some((o) => o.drift)).toBe(true);
    for (const o of SKY.clouds.octaves) expect(o.amp).toBeGreaterThan(0);
  });
});

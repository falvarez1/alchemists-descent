import { describe, expect, it } from 'vitest';
import { createGameParams } from '@/config/params';
import { DARKNESS, FLOOR_DARKNESS } from '@/config/darkness';
import {
  DARK_CELL,
  DARK_W,
  bakeDarkMap,
  darkMapFor,
  renderDarkness,
  renderOpenLut,
  sampleDarkMap,
  zoneInside,
} from '@/core/darkness';
import type { Ctx, DarkZone, LevelRuntime } from '@/core/types';
import { LightQuery, type QueryableLightField } from '@/render/LightQuery';

function field(originX = 100, originY = 200, LW = 40, LH = 30): QueryableLightField & {
  lightR: Float32Array; lightG: Float32Array; lightB: Float32Array; wandField: Float32Array; lightOpen: Float32Array;
} {
  const n = LW * LH;
  return {
    LW, LH, originX, originY, built: true,
    lightR: new Float32Array(n), lightG: new Float32Array(n), lightB: new Float32Array(n),
    wandField: new Float32Array(n), lightOpen: new Float32Array(n).fill(1),
  };
}

function ctxWith(runtime: Partial<LevelRuntime> | null, state: Record<string, unknown> = {}): Ctx {
  return {
    state: { mode: 'play', ...state },
    params: createGameParams(),
    levels: { current: runtime },
  } as unknown as Ctx;
}

const UNDERTOW: DarkZone = { x: 400, y: 300, rx: 120, ry: 60, shape: 'rect' };

describe('designed darkness map', () => {
  it('reads the floor base everywhere and a zone core at its full strength', () => {
    const map = bakeDarkMap([UNDERTOW], { base: 0.3, deep: 1 });
    expect(sampleDarkMap(map, 20, 20)).toBeCloseTo(0.3, 2);
    expect(sampleDarkMap(map, 400, 300)).toBeCloseTo(1, 2);
  });

  it('feathers a zone rim instead of cutting a hard edge', () => {
    const map = bakeDarkMap([UNDERTOW], { base: 0, deep: 1 });
    const rim = sampleDarkMap(map, 400 - 120 + 14, 300);
    const inside = sampleDarkMap(map, 400 - 120 + DARKNESS.feather + DARKNESS.rimNoise + 4, 300);
    expect(rim).toBeGreaterThan(0);
    expect(rim).toBeLessThan(0.8);
    expect(inside).toBeCloseTo(1, 2);
    expect(sampleDarkMap(map, 400 - 120 - DARKNESS.rimNoise - 2, 300)).toBe(0);
  });

  it('combines overlapping zones by max, never by sum', () => {
    const a: DarkZone = { x: 300, y: 300, rx: 80, ry: 80, strength: 0.6 };
    const b: DarkZone = { x: 320, y: 300, rx: 80, ry: 80, strength: 0.6 };
    const map = bakeDarkMap([a, b], { base: 0, deep: 1 });
    expect(sampleDarkMap(map, 310, 300)).toBeCloseTo(0.6, 1);
  });

  it('ellipse zones fall off radially, with a wandering rim', () => {
    const z: DarkZone = { x: 500, y: 500, rx: 100, ry: 50 };
    expect(zoneInside(z, 500, 500)).toBe(1);
    expect(zoneInside(z, 500, 500 + 50 + DARKNESS.rimNoise + 1)).toBe(0);
    expect(zoneInside(z, 588, 500)).toBeGreaterThan(0);
    expect(zoneInside(z, 588, 500)).toBeLessThan(1);
    // The rim is not a perfect curve: equal-radius points differ.
    const around = [0, 1, 2, 3, 4, 5].map((k) => zoneInside(z, 500 + Math.cos(k) * 90, 500 + Math.sin(k) * 45));
    expect(Math.max(...around) - Math.min(...around)).toBeGreaterThan(0.05);
  });

  it('keeps high-readability lighting meaningful: half the render darkness', () => {
    expect(renderDarkness(1, false)).toBeCloseTo(DARKNESS.renderStrength, 3);
    expect(renderDarkness(1, true)).toBeCloseTo(DARKNESS.renderStrength * DARKNESS.readabilityScale, 3);
    // An ordinary cave (0.3) barely dims; the render curve is gamma'd.
    expect(renderDarkness(0.3, false)).toBeLessThan(0.1);
    expect(renderOpenLut(false)[0]).toBe(1);
  });

  it('bakes nothing for a fully readable level and caches per runtime', () => {
    expect(darkMapFor({ def: { id: 'physics-test' } })).toBeNull();
    const rt = { def: { id: 'd1' }, darkZones: [UNDERTOW] };
    const a = darkMapFor(rt);
    expect(a).not.toBeNull();
    expect(darkMapFor(rt)).toBe(a);
    // The Bellows has no base darkness: the lamp-lit Works stay readable.
    expect(FLOOR_DARKNESS.d1.base).toBe(0);
    expect(a![Math.floor(300 / DARK_CELL) * DARK_W + Math.floor(400 / DARK_CELL)]).toBe(255);
  });
});

describe('LightQuery (the LightQueryApi contract)', () => {
  it('level: ambient + the built field, clamped to 2', () => {
    const f = field();
    const i = ((210 - 200) >> 1) * f.LW + ((120 - 100) >> 1);
    f.lightR[i] = 0.5; f.lightG[i] = 0.9; f.lightB[i] = 0.2;
    const q = new LightQuery(ctxWith(null), f);
    const amb = createGameParams().global.ambient;
    expect(q.level(120, 210)).toBeCloseTo(amb + 0.9, 5);
    f.lightG[i] = 5;
    expect(q.level(120, 210)).toBe(2);
  });

  it('level: an off-view point reads as unlit (ambient only)', () => {
    const q = new LightQuery(ctxWith(null), field());
    expect(q.level(5000, 5000)).toBeCloseTo(createGameParams().global.ambient, 5);
  });

  it('level: designed darkness removes the ambient in the dark', () => {
    const f = field();
    f.lightOpen.fill(0.035);
    const q = new LightQuery(ctxWith(null), f);
    expect(q.level(110, 210)).toBeLessThan(0.02);
  });

  it('wandLight reads the wand field and is 0 while hooded', () => {
    const f = field();
    const i = ((220 - 200) >> 1) * f.LW + ((130 - 100) >> 1);
    f.wandField[i] = 0.64;
    const ctx = ctxWith(null);
    const q = new LightQuery(ctx, f);
    expect(q.wandLight(130, 220)).toBeCloseTo(0.64, 5);
    expect(q.wandLight(131, 221)).toBeCloseTo(0.64, 5); // same half-res texel
    expect(q.hooded).toBe(false);
    ctx.state.lanternHooded = true;
    expect(q.hooded).toBe(true);
    expect(q.wandLight(130, 220)).toBe(0);
  });

  it('reads nothing before the first light build', () => {
    const f = { ...field(), built: false };
    const q = new LightQuery(ctxWith(null), f);
    expect(q.wandLight(110, 210)).toBe(0);
  });

  it('darkness is by design, everywhere on the level (not only in view)', () => {
    const rt = { def: { id: 'd2' }, darkZones: [UNDERTOW] } as unknown as LevelRuntime;
    const q = new LightQuery(ctxWith(rt), field());
    expect(q.darkness(400, 300)).toBeCloseTo(1, 2);
    expect(q.darkness(1200, 900)).toBeCloseTo(FLOOR_DARKNESS.d2.base, 2);
    expect(new LightQuery(ctxWith(null), field()).darkness(400, 300)).toBe(0);
  });
});

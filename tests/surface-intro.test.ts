import { describe, expect, it } from 'vitest';

import type { LevelRuntime } from '@/core/types';
import { introArrivalSpawn, isOnIntroSurface, SURFACE_DESCENT_DROP } from '@/game/surfaceIntro';

/**
 * The surface-intro arrival rules used to be re-spelled (identically) in Levels
 * and IntroProgression. They now live in surfaceIntro.ts; these tests lock the
 * three states — on the surface, descended, and "no surface at all" (every level
 * below D1) — so the dedup can't quietly change behavior.
 */
function runtime(partial: Partial<LevelRuntime>): LevelRuntime {
  return { spawn: { x: 100, y: 200 }, ...partial } as LevelRuntime;
}

describe('surfaceIntro predicates', () => {
  it('is on the surface only with a surface spawn that has not descended', () => {
    expect(isOnIntroSurface(runtime({ surfaceSpawn: { x: 50, y: 60 }, surfaceDescended: false }))).toBe(true);
  });

  it('is not on the surface once descended', () => {
    expect(isOnIntroSurface(runtime({ surfaceSpawn: { x: 50, y: 60 }, surfaceDescended: true }))).toBe(false);
  });

  it('is not on the surface when there is no surface spawn (deeper levels)', () => {
    expect(isOnIntroSurface(runtime({}))).toBe(false);
    expect(isOnIntroSurface(runtime({ surfaceDescended: false }))).toBe(false);
  });

  it('arrives at the surface spawn on first D1 entry', () => {
    const surfaceSpawn = { x: 50, y: 60 };
    expect(introArrivalSpawn(runtime({ surfaceSpawn, surfaceDescended: false }))).toEqual(surfaceSpawn);
  });

  it('arrives at the cave spawn after descending', () => {
    const spawn = { x: 100, y: 200 };
    expect(introArrivalSpawn(runtime({ spawn, surfaceSpawn: { x: 50, y: 60 }, surfaceDescended: true }))).toEqual(spawn);
  });

  it('arrives at the cave spawn when there is no surface (every other level)', () => {
    const spawn = { x: 777, y: 333 };
    expect(introArrivalSpawn(runtime({ spawn }))).toEqual(spawn);
  });

  it('isOnIntroSurface and introArrivalSpawn agree on which spawn is used', () => {
    const onSurface = runtime({ surfaceSpawn: { x: 9, y: 9 }, surfaceDescended: false });
    expect(introArrivalSpawn(onSurface)).toBe(onSurface.surfaceSpawn);
    const descended = runtime({ surfaceSpawn: { x: 9, y: 9 }, surfaceDescended: true });
    expect(introArrivalSpawn(descended)).toBe(descended.spawn);
  });

  it('exposes a positive descent drop threshold', () => {
    expect(SURFACE_DESCENT_DROP).toBeGreaterThan(0);
  });
});

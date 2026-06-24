import type { LevelRuntime } from '@/core/types';

/**
 * Shared predicates for the Noita-style D1 surface intro, so the "is the wizard
 * still up top?" / "where does he arrive?" rules live in ONE place instead of
 * being re-spelled (identically) in Levels and IntroProgression.
 *
 * The surface intro is a transient phase of the very first D1 entry: the wizard
 * starts on `surfaceSpawn` (the grass beside his cabin) and `surfaceDescended`
 * flips true once he drops down the cave mouth. After that — and on every other
 * level, which has no `surfaceSpawn` — arrivals/respawns use the cave `spawn`.
 */

/** Dropping this many cells below the surface spawn counts as "descended into the cave". */
export const SURFACE_DESCENT_DROP = 70;

/** True while the wizard is still up on the daylit intro surface. */
export function isOnIntroSurface(runtime: LevelRuntime): boolean {
  return !!runtime.surfaceSpawn && !runtime.surfaceDescended;
}

/** The arrival point for a level: the intro surface on first D1 entry, otherwise the cave spawn. */
export function introArrivalSpawn(runtime: LevelRuntime): { x: number; y: number } {
  return runtime.surfaceSpawn && !runtime.surfaceDescended ? runtime.surfaceSpawn : runtime.spawn;
}

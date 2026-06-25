import type { Projectile } from '@/core/types';
import type { CastAction } from './compiler';

/*
 * Projectile side-channel marks. The frozen Projectile contract has no card
 * fields, so card effects that must survive until impact travel in WeakMaps
 * keyed by the live projectile object. WandSystem writes them at spawn; the
 * projectile system reads and consumes them.
 */

/** Terrain bounces remaining for a marked projectile. */
export const BOUNCE_COUNTS: WeakMap<Projectile, number> = new WeakMap();

/** Flask material a projectile sheds while flying, with a bounded cell budget
 *  so the trail is conserved (the flask pays exactly `budget` cells at cast) and
 *  the mark is dropped at 0 rather than shedding forever. */
export interface InfuseTrail {
  material: number;
  budget: number;
}
export const INFUSED: WeakMap<Projectile, InfuseTrail> = new WeakMap();

/** Cells an infuser bolt may shed over its life (the flask pays this many). */
export const INFUSE_TRAIL_BUDGET = 60;

export interface ProjectileModState {
  /** Fixed low-economy water cells left to shed. */
  waterTrailBudget?: number;
  /** Frame cadence for water shedding. */
  waterTrailCadence?: number;
  /** Fixed low-economy oil cells left to shed. */
  oilTrailBudget?: number;
  /** Frame cadence for oil shedding. */
  oilTrailCadence?: number;
  /** Electrify enemies and conductor terrain touched by this projectile. */
  electricCharge?: boolean;
  /** Conditional crit when the struck target is wet or touching water. */
  critWet?: boolean;
  /** Frames of short-range homing correction remaining. */
  shortHomingFrames?: number;
  /** Frame cadence for homing retargeting. */
  shortHomingCadence?: number;
  /** Freeze struck targets and lightly frost struck terrain. */
  frostCharge?: boolean;
  /** Conditional crit when the struck target was already frozen or touching cryo cells. */
  shatterCrit?: boolean;
  /** Conditional crit when the struck target is burning or standing in fire/lava. */
  pyreCrit?: boolean;
}

/** Aggregate review-content projectile modifier state. */
export const PROJECTILE_MODS: WeakMap<Projectile, ProjectileModState> = new WeakMap();

export function ensureProjectileMods(p: Projectile): ProjectileModState {
  let state = PROJECTILE_MODS.get(p);
  if (!state) {
    state = {};
    PROJECTILE_MODS.set(p, state);
  }
  return state;
}

/** Depth-1 trigger payload cast at the carrier projectile's impact point. */
export const TRIGGERED: WeakMap<Projectile, CastAction[]> = new WeakMap();

/** Wand-frame spread that belonged to the projectile when its trigger was armed. */
export const TRIGGER_SOURCE_SPREAD: WeakMap<Projectile, number> = new WeakMap();

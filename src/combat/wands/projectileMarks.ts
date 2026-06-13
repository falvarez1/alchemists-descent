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

/** Flask material this projectile sheds while flying. */
export const INFUSED: WeakMap<Projectile, number> = new WeakMap();

/** Depth-1 trigger payload cast at the carrier projectile's impact point. */
export const TRIGGERED: WeakMap<Projectile, CastAction[]> = new WeakMap();

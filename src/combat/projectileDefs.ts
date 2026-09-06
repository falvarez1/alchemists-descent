import type { ProjectileType } from '@/core/types';
import { Cell } from '@/sim/CellType';

export const WEAVER_LIMB_DAMAGE: Partial<Record<ProjectileType, number>> = { bolt: 18, pellet: 8, iceshard: 16, wisp: 13, icelance: 25, fireball: 14 };

export function isSpentGore(type: number): boolean { return type === Cell.Blood || type === Cell.Slime; }

export function projectileGravity(type: ProjectileType): number {
  return type === 'bomb' ? .14 : type === 'fireball' ? .02 : type === 'frostbolt' ? .01 :
    type === 'iceshard' ? .04 : type === 'meteor' ? .07 : type === 'acidglob' ? .12 : 0;
}

/**
 * Per-type projectile lifetime in frames — the single source of truth shared by
 * the LIVE wand path (`WandSystem.castActionAt`) and the legacy/preview paths
 * (`Spells.firePlayerSpell` for the gallery card preview, `Spells.castBuildSpell`
 * for sandbox casting). These are the live wand timings; centralizing them here
 * retired the old drift where the same spell flew a few frames shorter/longer
 * depending on who spawned it (iceshard 140, icelance 90, wisp 260, build-mode
 * warp 180 → the live 180 / 140 / 240 / 90).
 *
 * `bomb` is intentionally absent — its life is the live fuse (`fuseTicks`), not a
 * fixed type constant.
 */
export const PROJECTILE_LIFE = {
  bolt: 180,
  iceshard: 180,
  icelance: 140,
  wisp: 240,
  warp: 90,
  meteor: 300,
  blackhole: 240,
} as const satisfies Partial<Record<ProjectileType, number>>;

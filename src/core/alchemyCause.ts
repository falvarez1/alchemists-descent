import type { AlchemyCause } from '@/core/run';
import type { EnemyDamageSource } from '@/core/types';
import { Cell } from '@/sim/CellType';

/**
 * Pure cause mapping shared by every damage path that reports to kill
 * attribution (combat/AlchemyKills). Foundation-level so the sim (explosions)
 * and the entity layer can tag their blows without importing a system.
 */

/** The cause a hazard cell inflicts on contact (poured, sprayed, stood in). */
export function causeForCell(cell: number): AlchemyCause {
  if (cell === Cell.Lava) return 'rendered';
  if (cell === Cell.Acid) return 'dissolved';
  if (cell === Cell.Toxic) return 'poisoned';
  if (cell === Cell.Steam) return 'steeped';
  return 'burned';
}

/**
 * The cause an explosion inflicts, from the source tag it was triggered with
 * (`ExplosionApi.trigger` options). The wand's own blasts — spell bolts, bombs,
 * lightning — are direct; gunpowder, barrels, a bomber's last act, a kiln's
 * death and hostile fire are the world going off.
 */
export function causeForExplosion(playerDamageSource: string | undefined): EnemyDamageSource {
  if (playerDamageSource === undefined || playerDamageSource === 'self-explosion' || playerDamageSource === 'lightning') {
    return 'direct';
  }
  return 'detonated';
}

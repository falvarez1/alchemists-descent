import type { EntityStatus, PerkId, PlayerState } from '@/core/types';

/**
 * A BOON, held for the run (a Sanctum boon: `perks`) or for a while (a potion:
 * `status.boons`, frames left). Gameplay that a boon changes asks `hasBoon` and so
 * answers the same either way: the Salamander's Gall is Pyro Skin for a minute,
 * and no hook has to know which one it is talking to.
 */
export function hasBoon(player: Pick<PlayerState, 'perks' | 'status'>, id: PerkId): boolean {
  // Tolerant on purpose: gameplay hooks run against partial test and builder players too.
  return player.perks?.[id] === true || (player.status?.boons?.[id] ?? 0) > 0;
}

/** Frames left of a potion's hold on a boon (0 when it is only the run's, or not held at all). */
export function boonFrames(status: Pick<EntityStatus, 'boons'>, id: PerkId): number {
  return status.boons?.[id] ?? 0;
}

/** Count a potion boon's frames down (the status tick calls it); the entry goes when it runs out. */
export function tickBoons(status: Pick<EntityStatus, 'boons'>, frames: number): void {
  const boons = status.boons;
  if (!boons) return;
  for (const k in boons) {
    const id = k as PerkId;
    const left = (boons[id] ?? 0) - frames;
    if (left > 0) boons[id] = left;
    else delete boons[id];
  }
}

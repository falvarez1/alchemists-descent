import type { Ctx, PerkId } from '@/core/types';

export interface PerkDefinition {
  id: PerkId;
  name: string;
  shortLabel: string;
  sanctumName: string;
  desc: string;
  offeredInSanctum: boolean;
}

export const PERK_DEFS: readonly PerkDefinition[] = Object.freeze([
  {
    id: 'might',
    name: 'Might',
    shortLabel: 'MIGHT',
    sanctumName: 'Power Surge',
    desc: 'All spell damage +25%',
    offeredInSanctum: true,
  },
  {
    id: 'vampirism',
    name: 'Vampirism',
    shortLabel: 'VAMP',
    sanctumName: 'Vampirism',
    desc: 'Kills restore 2 HP',
    offeredInSanctum: true,
  },
  {
    id: 'featherweight',
    name: 'Featherweight',
    shortLabel: 'FEATHER',
    sanctumName: 'Featherweight',
    desc: 'Levitation drains 45% slower',
    offeredInSanctum: true,
  },
  {
    id: 'manafont',
    name: 'Mana Font',
    shortLabel: 'MANA',
    sanctumName: 'Mana Font',
    desc: 'Wand mana regenerates 60% faster',
    offeredInSanctum: true,
  },
  {
    id: 'swiftfoot',
    name: 'Swift Foot',
    shortLabel: 'SWIFT',
    sanctumName: 'Swift Soles',
    desc: 'Move 18% faster',
    offeredInSanctum: true,
  },
  {
    id: 'torchbearer',
    name: 'Torchbearer',
    shortLabel: 'TORCH',
    sanctumName: 'Torchbearer',
    desc: 'Carry a stronger wand light without a tonic',
    offeredInSanctum: false,
  },
  {
    id: 'ironhide',
    name: 'Ironhide',
    shortLabel: 'IRON',
    sanctumName: 'Blast Shield',
    desc: 'Explosions deal 60% less to you',
    offeredInSanctum: true,
  },
  {
    id: 'flameward',
    name: 'Flame Ward',
    shortLabel: 'FIRE',
    sanctumName: 'Pyro Skin',
    desc: 'Fire and lava deal 60% less; you cannot catch fire',
    offeredInSanctum: true,
  },
  {
    id: 'toxinward',
    name: 'Toxin Ward',
    shortLabel: 'TOXIN',
    sanctumName: 'Toxicology',
    desc: 'Acid and toxin deal 75% less',
    offeredInSanctum: true,
  },
  {
    id: 'goldmagnet',
    name: 'Gold Magnet',
    shortLabel: 'GOLD',
    sanctumName: 'Gold Sense',
    desc: 'Your gold pull reaches much further',
    offeredInSanctum: true,
  },
]);

export const PERK_IDS: readonly PerkId[] = Object.freeze(PERK_DEFS.map((perk) => perk.id));

export const SANCTUM_PERK_DEFS: readonly PerkDefinition[] = Object.freeze(
  PERK_DEFS.filter((perk) => perk.offeredInSanctum),
);

export function isPerkId(value: string): value is PerkId {
  return (PERK_IDS as readonly string[]).includes(value);
}

/**
 * Powers whose effect is ALSO carried by a temporary status the review/god kit
 * grants alongside the perk (both read by the same gameplay code). Turning the
 * power off must clear the twin status too, or the effect lingers until the
 * status timer (up to ~60s) runs out — reading as a delayed toggle.
 */
const PERK_STATUS_TWIN: Partial<Record<PerkId, 'swift' | 'torch'>> = {
  swiftfoot: 'swift',
  torchbearer: 'torch',
};

export function isPerkActive(ctx: Ctx, id: PerkId): boolean {
  return ctx.player.perks[id] === true;
}

export function setPerkActive(ctx: Ctx, id: PerkId, active: boolean): void {
  if (active) {
    ctx.player.perks[id] = true;
    return;
  }
  delete ctx.player.perks[id];
  const twin = PERK_STATUS_TWIN[id];
  if (twin) ctx.player.status[twin] = 0;
}

export function togglePerkActive(ctx: Ctx, id: PerkId): boolean {
  const next = !isPerkActive(ctx, id);
  setPerkActive(ctx, id, next);
  return next;
}

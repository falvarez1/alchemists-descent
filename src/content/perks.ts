import type { Ctx, PerkId } from '@/core/types';

export interface PerkDefinition {
  id: PerkId;
  name: string;
  shortLabel: string;
  sanctumName: string;
  desc: string;
  offeredInSanctum: boolean;
  /**
   * Level ids whose floor makes this boon worth the draft: it is offered only
   * while one of them is a door below, so a ward is never a dead card (Warm
   * Blood before a floor with no cold). Absent = offered anywhere. See
   * docs/BOONS.md ("Measured") for why each is keyed as it is.
   */
  worth?: readonly string[];
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
  // The alchemist's bargains. Each one changes how the world is met rather than
  // how large a number is, and each is read off the grid or the kill ledger
  // (game/Chill, combat/AlchemyKills, combat/Telekinesis, creatures/lightResponse,
  // entities/Player).
  {
    id: 'stronggrip',
    name: 'Sexton’s Grip',
    shortLabel: 'GRIP',
    sanctumName: 'Sexton’s Grip',
    desc: 'The wand’s grip on the fallen costs half, and hurls fly harder',
    offeredInSanctum: true,
  },
  {
    id: 'rimesoles',
    name: 'Rime Soles',
    shortLabel: 'RIME',
    sanctumName: 'Rime Soles',
    desc: 'Water you cross skins over with ice underfoot',
    offeredInSanctum: true,
    worth: ['d3'], // the Drowned Cisterns: the only floor with pools to cross
  },
  {
    id: 'longfuse',
    name: 'Long Fuse',
    shortLabel: 'FUSE',
    sanctumName: 'Long Fuse',
    desc: 'Chains last twice as long and pay up to ×4',
    offeredInSanctum: true,
  },
  {
    id: 'velvethood',
    name: 'Velvet Hood',
    shortLabel: 'HOOD',
    sanctumName: 'Velvet Hood',
    desc: 'Hooded, dim places hide you like deep dark',
    offeredInSanctum: true,
  },
  {
    id: 'grounded',
    name: 'Insulated Boots',
    shortLabel: 'GROUND',
    sanctumName: 'Insulated Boots',
    desc: 'Current deals 75% less to you',
    offeredInSanctum: true,
    worth: ['d3'], // water + electricity
  },
  {
    id: 'warmblood',
    name: 'Warm Blood',
    shortLabel: 'WARM',
    sanctumName: 'Warm Blood',
    desc: 'The cold reaches you half as fast',
    offeredInSanctum: true,
    worth: ['d2b'], // the Cold Store
  },
]);

export const PERK_IDS: readonly PerkId[] = Object.freeze(PERK_DEFS.map((perk) => perk.id));

export const SANCTUM_PERK_DEFS: readonly PerkDefinition[] = Object.freeze(
  PERK_DEFS.filter((perk) => perk.offeredInSanctum),
);

/**
 * The Sanctum's draft: `count` boons from `pool`, deterministic in `rng` (the
 * run's seed and the floor, so a reload cannot reroll it and a daily descent
 * offers everyone the same table). A boon keyed to floors (`worth`) is only
 * eligible while one of them is a door below; with no doors known (a test
 * arena) everything is eligible.
 */
export function draftBoons<T extends { worth?: readonly string[] }>(
  pool: readonly T[],
  doors: readonly string[],
  rng: () => number,
  count = 3,
): T[] {
  const eligible = pool.filter((boon) => !boon.worth || doors.length === 0 || boon.worth.some((id) => doors.includes(id)));
  const offer: T[] = [];
  while (offer.length < count && eligible.length > 0) {
    offer.push(eligible.splice(Math.floor(rng() * eligible.length), 1)[0]);
  }
  return offer;
}

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

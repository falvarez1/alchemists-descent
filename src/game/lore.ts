import type { Ctx } from '@/core/types';
import { LEGACY_LORE_KEY, loadDiscoveredMaterials, recordMaterialDiscovery } from '@/game/GrimoireStore';
import { Cell } from '@/sim/CellType';

/**
 * Material Lore — short, TRUE facts about what each material does, recorded the
 * first time the player examines it (the `I` inspector is the examine lens).
 * "Knowledge is progression": this turns the deep material rules into Grimoire
 * entries instead of a tutorial wall. Persisted across expeditions like recipes.
 */
export const LORE_KEY = LEGACY_LORE_KEY;

export interface LoreEntry {
  title: string;
  body: string;
}

/** Keyed by Cell id; only cataloged materials are discoverable lore. */
export const MATERIAL_LORE: Partial<Record<number, LoreEntry>> = {
  [Cell.Water]: { title: 'Water', body: 'Quenches flame to steam, carries a charge, and thins toxic sludge it touches.' },
  [Cell.Lava]: { title: 'Lava', body: 'Molten rock — melts ice, sets fire to what burns, and conducts a current.' },
  [Cell.Fire]: { title: 'Fire', body: 'Rises and spreads through anything flammable; water snuffs it, wood chars to ash.' },
  [Cell.Acid]: { title: 'Acid', body: 'Eats through most solids. Beside water it transmutes rock into gold.' },
  [Cell.Oil]: { title: 'Oil', body: 'Slick and flammable — a long, creeping fuse once it catches.' },
  [Cell.Toxic]: { title: 'Toxic Sludge', body: 'Caustic ooze; clean water thins it back to water.' },
  [Cell.Sand]: { title: 'Sand', body: 'Loose grain that pours and piles. Heat or strong charge fuses it to glass.' },
  [Cell.Wood]: { title: 'Wood', body: 'Catches fire readily and burns down to ash.' },
  [Cell.Ice]: { title: 'Ice', body: 'Frozen and slick; fire and lava melt it back to water.' },
  [Cell.Metal]: { title: 'Metal', body: 'Conducts electricity far and fast — a path for lightning.' },
  [Cell.Gold]: { title: 'Gold', body: "Heavy, glittering dust — the alchemist's prize." },
  [Cell.Blood]: { title: 'Blood', body: 'Wet gore conducts a current and slows whatever wades through it.' },
  [Cell.Gunpowder]: { title: 'Gunpowder', body: 'Thin trails burn like fuses. Packed clumps answer a spark with a blast.' },
  [Cell.Glowshroom]: { title: 'Glowshroom', body: 'Living light clinging to the rock, soft and breathing.' },
  [Cell.Crystal]: { title: 'Mana Crystal', body: 'Bright crystal that glints with stored magic.' },
  [Cell.Nitrogen]: { title: 'Liquid Nitrogen', body: 'Bitter cold — freezes surface water into ice bridges.' },
};

/** Snapshot of discovered lore ids (for the Grimoire render). */
export function discoveredLore(): Record<string, boolean> {
  return loadDiscoveredMaterials();
}

/**
 * Record that the player examined `cell`. Returns the entry on a NEW discovery
 * (and toasts) so the caller can react; null if uncataloged or already known.
 */
export function recordLore(ctx: Ctx, cell: number): LoreEntry | null {
  const entry = MATERIAL_LORE[cell];
  if (!entry) return null;
  if (!recordMaterialDiscovery(ctx, String(cell), entry.title)) return null;
  ctx.events.emit('toast', { text: `Grimoire — learned of ${entry.title}` });
  return entry;
}

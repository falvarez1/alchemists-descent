import { Cell } from '@/sim/CellType';

/**
 * The Sandbox/Builder material palette: which materials a human can paint,
 * in the order and grouping they are offered.
 *
 * This used to live only as markup in `index.html`, and the Builder built its
 * own palette by CLONING those buttons out of the DOM. That made the editor
 * depend on the player page's HTML — which broke the moment a second entry
 * point (`builder.html`) stopped shipping that markup, leaving the Builder
 * with one material. It also meant adding a material required editing HTML,
 * duplicating cell ids that are an append-only save ABI.
 *
 * This module is now the single source: the Sandbox toolbar renders from it,
 * and the Builder reads it directly. Order is UX, not data — it is the order
 * a designer scans, so keep related materials adjacent.
 *
 * `color` is the SWATCH color (a readable label chip), deliberately separate
 * from `COLOR_FN` in `sim/colors.ts`, which produces per-cell simulation color
 * with grain and jitter. A swatch wants one flat legible tone.
 */

export interface MaterialSwatch {
  id: number;
  label: string;
  /** Flat swatch color for the palette chip. */
  color: string;
}

export interface MaterialGroup {
  title: string;
  items: MaterialSwatch[];
}

export const MATERIAL_PALETTE: readonly MaterialGroup[] = [
  {
    title: "Granular Solids",
    items: [
      { id: Cell.Sand, label: "Sand", color: '#d4af37' },
      { id: Cell.Gunpowder, label: "Gunpowder", color: '#5a5d64' },
      { id: Cell.Wood, label: "Wood", color: '#8a5a36' },
      { id: Cell.Vines, label: "Vines (Organic)", color: '#3ad55a' },
      { id: Cell.Gold, label: "Gold Powder", color: '#fbbf24' },
      { id: Cell.Ember, label: "Ember", color: '#ff7a1e' },
      { id: Cell.Snow, label: "Snow", color: '#f0f0f8' },
      { id: Cell.Coal, label: "Coal", color: '#26262a' },
      { id: Cell.Ash, label: "Ash", color: '#6b6660' },
      { id: Cell.Catalyst, label: "Aurum Catalyst", color: '#f09646' },
    ],
  },
  {
    title: "Fluids & Gases",
    items: [
      { id: Cell.Water, label: "Water", color: '#3a7bd5' },
      { id: Cell.Oil, label: "Oil", color: '#654228' },
      { id: Cell.Lava, label: "Lava", color: '#ff4500' },
      { id: Cell.Nitrogen, label: "Liquid Nitrogen", color: '#a0f0ff' },
      { id: Cell.Acid, label: "Acid", color: '#4afc4a' },
      { id: Cell.Blood, label: "Blood", color: '#c01a2e' },
      { id: Cell.Slime, label: "Slime", color: '#65d63f' },
      { id: Cell.Toxic, label: "Toxic Sludge", color: '#4a7a2c' },
      { id: Cell.Healium, label: "Healium", color: '#fa7ca8' },
      { id: Cell.Teleportium, label: "Teleportium", color: '#a04af0' },
      { id: Cell.Fire, label: "Fire", color: '#e65c00' },
      { id: Cell.Smoke, label: "Smoke", color: '#55555d' },
    ],
  },
  {
    title: "Potions & Elixirs",
    items: [
      { id: Cell.ElixirLife, label: "Elixir of Life", color: '#fb7185' },
      { id: Cell.ElixirLevity, label: "Elixir of Levity", color: '#67e8f9' },
      { id: Cell.ElixirStone, label: "Elixir of Stone", color: '#a8a29e' },
    ],
  },
  {
    title: "Structural Frameworks",
    items: [
      { id: Cell.Ice, label: "Ice", color: '#7cd0ff' },
      { id: Cell.Metal, label: "Metal", color: '#7a8a99' },
      { id: Cell.Wall, label: "Wall", color: '#555555' },
      { id: Cell.Stone, label: "Stone", color: '#8a8a92' },
      { id: Cell.Crystal, label: "Mana Crystal", color: '#7ce8ff' },
      { id: Cell.Glass, label: "Glass", color: '#c8dce6' },
      { id: Cell.Fungus, label: "Glowcap Fungus", color: '#3cc8a0' },
      { id: Cell.Glowshroom, label: "Glowshroom", color: '#8cf0a0' },
      { id: Cell.Moss, label: "Cave Moss", color: '#2e7a32' },
      { id: Cell.Grass, label: "Grass", color: '#7cb034' },
      { id: Cell.MarshGas, label: "Marsh Gas", color: '#979e54' },
      { id: Cell.Empty, label: "Eraser", color: '#a83232' },
    ],
  },
] as const;

/** Flattened, de-duplicated palette entries in display order. */
export const MATERIAL_SWATCHES: readonly MaterialSwatch[] = MATERIAL_PALETTE.flatMap((g) => g.items);

/**
 * Authoring-only materials the Sandbox does not offer but the Builder needs
 * (well plugs, basins, and rune doors are made of Stone).
 */
export const BUILDER_EXTRA_SWATCHES: readonly MaterialSwatch[] = [
  { id: Cell.Stone, label: 'Stone', color: '#8a8a92' },
];

import { CELL_COUNT, Cell } from '@/sim/CellType';
import { packRGB, unpackB, unpackG, unpackR } from '@/sim/colors';

/**
 * Canonical marker colors for PNG interchange (export a region as a paintable
 * PNG, edit in Aseprite/Piskel, re-import): exactly one stable, opaque,
 * visually-distinguishable RGB per cell type.
 *
 * APPEND-ONLY ABI, exactly like cell ids in CellType.ts: a color, once
 * shipped, identifies its material in every PNG anyone ever exported. Never
 * change or reuse an entry; new cell types append a new color whose Manhattan
 * RGB distance to every existing entry is >= 12 (tests/assets.test.ts
 * enforces both rules).
 *
 * Empty is special: it round-trips as PNG transparency (alpha 0), never as a
 * color. Its table entry below exists only for thumbnail rendering; lookups
 * deliberately exclude it. Opaque black is intentionally NOT in the palette —
 * it is the most common stray color in art tools, and it must surface as an
 * import error rather than silently become a material.
 *
 * Values are locked literals (NOT derived from COLOR_FN — material colors are
 * randomized paint, this is interchange ABI). They started as each factory's
 * base term, nudged apart where materials were visually close.
 */
export const CELL_PALETTE: readonly number[] = [
  packRGB(8, 8, 12), //    0 Empty       (thumbnail backdrop only — see note above)
  packRGB(225, 180, 90), //  1 Sand
  packRGB(35, 105, 240), //  2 Water
  packRGB(60, 60, 65), //    3 Wall
  packRGB(110, 70, 35), //   4 Wood
  packRGB(255, 70, 0), //    5 Fire
  packRGB(58, 45, 35), //    6 Oil
  packRGB(40, 250, 40), //   7 Acid
  packRGB(55, 55, 60), //    8 Gunpowder
  packRGB(160, 160, 170), // 9 Steam
  packRGB(160, 215, 255), // 10 Ice
  packRGB(250, 22, 0), //   11 Lava
  packRGB(85, 80, 85), //   12 Stone
  packRGB(105, 115, 130), // 13 Metal
  packRGB(45, 45, 50), //   14 Smoke
  packRGB(35, 165, 55), //  15 Vines
  packRGB(210, 245, 255), // 16 Nitrogen
  packRGB(245, 195, 30), // 17 Gold
  packRGB(160, 12, 25), //  18 Blood
  packRGB(80, 200, 50), //  19 Slime
  packRGB(250, 80, 8), //   20 Ember
  packRGB(255, 100, 130), // 21 ElixirLife
  packRGB(130, 220, 255), // 22 ElixirLevity
  packRGB(155, 140, 100), // 23 ElixirStone
  packRGB(64, 118, 36), //  24 Toxic
  packRGB(248, 110, 160), // 25 Healium
  packRGB(150, 60, 235), // 26 Teleportium
  packRGB(232, 232, 240), // 27 Snow
  packRGB(30, 30, 33), //   28 Coal
  packRGB(96, 200, 228), // 29 Crystal
  packRGB(40, 190, 150), // 30 Fungus
  packRGB(185, 210, 222), // 31 Glass
  packRGB(95, 91, 89), //   32 Ash
  packRGB(120, 230, 140), // 33 Glowshroom
  packRGB(38, 96, 42), //   34 Moss
  packRGB(255, 150, 60), // 35 Catalyst
  packRGB(120, 95, 45), //  36 RawOre (dark gold-flecked rock)
];

/** Display names, indexed by cell id (import reports, .gpl swatch labels). */
export const CELL_NAME: readonly string[] = [
  'Empty',
  'Sand',
  'Water',
  'Wall',
  'Wood',
  'Fire',
  'Oil',
  'Acid',
  'Gunpowder',
  'Steam',
  'Ice',
  'Lava',
  'Stone',
  'Metal',
  'Smoke',
  'Vines',
  'Nitrogen',
  'Gold',
  'Blood',
  'Slime',
  'Ember',
  'Elixir of Life',
  'Elixir of Levity',
  'Elixir of Stone',
  'Toxic',
  'Healium',
  'Teleportium',
  'Snow',
  'Coal',
  'Crystal',
  'Fungus',
  'Glass',
  'Ash',
  'Glowshroom',
  'Moss',
  'Catalyst',
  'Raw Ore',
];

export function paletteColor(t: number): number {
  return CELL_PALETTE[t] ?? CELL_PALETTE[Cell.Empty];
}

/** Exact-match lookup excluding Empty (Empty arrives only as transparency). */
const COLOR_TO_CELL = new Map<number, number>();
for (let t = 1; t < CELL_COUNT; t++) COLOR_TO_CELL.set(CELL_PALETTE[t], t);

export function cellForColor(rgb: number): number | null {
  return COLOR_TO_CELL.get(rgb) ?? null;
}

/** Nearest non-Empty palette entry by Manhattan RGB distance. */
export function nearestPaletteCell(rgb: number): { cell: number; dist: number } {
  const r = unpackR(rgb),
    g = unpackG(rgb),
    b = unpackB(rgb);
  let cell = Cell.Wall as number;
  let dist = Infinity;
  for (let t = 1; t < CELL_COUNT; t++) {
    const p = CELL_PALETTE[t];
    const d =
      Math.abs(r - unpackR(p)) + Math.abs(g - unpackG(p)) + Math.abs(b - unpackB(p));
    if (d < dist) {
      dist = d;
      cell = t;
    }
  }
  return { cell, dist };
}

/**
 * The palette as GIMP .gpl text — Aseprite/GIMP import it directly, giving
 * artists a named swatch per material so external edits stay on-palette.
 */
export function paletteAsGpl(): string {
  const lines = ['GIMP Palette', 'Name: Alchemists Descent Cells', 'Columns: 8', '#'];
  for (let t = 1; t < CELL_COUNT; t++) {
    const p = CELL_PALETTE[t];
    lines.push(
      `${String(unpackR(p)).padStart(3)} ${String(unpackG(p)).padStart(3)} ${String(unpackB(p)).padStart(3)}\t${CELL_NAME[t]}`,
    );
  }
  return lines.join('\n') + '\n';
}

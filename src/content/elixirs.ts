import type { EntityStatus, PerkId } from '@/core/types';
import { Cell } from '@/sim/CellType';

/**
 * THE ELIXIRS: one table says what each potion cell does when it is drunk.
 *
 * A potion is a timed rewrite of what the body is (DESIGN pillar 5): the flask
 * swallows real cells and each cell is worth `framesPerCell` frames of the
 * effect. An effect is either one of the status timers the sim already ticks
 * (regen, levity, stoneskin, swift, torch) or a TIMED BOON: the same rule a
 * Sanctum boon sets for the whole run (flameward, warmblood...), held for a while
 * in `status.boons` and read through `hasBoon` (core/boons). A new elixir is a
 * new cell (sim/CellType, colors, params, palette) plus one row here, and no
 * new gameplay code unless it needs a boon that does not exist yet.
 *
 * Plain data over type-only imports and the Cell ids, so the cell tables, the
 * HUD chips, the Grimoire and the tests can all read it.
 */

/** The longest any one potion effect can be stacked to (60 s at 60 Hz). Was 1800 inline in three files. */
export const POTION_CAP_FRAMES = 3600;

/** The numeric timers on EntityStatus a potion may drive. */
export type PotionStatusKey = Extract<keyof EntityStatus, 'regen' | 'levity' | 'stoneskin' | 'swift' | 'torch'>;

export type ElixirEffect =
  | { kind: 'status'; key: PotionStatusKey }
  | { kind: 'boon'; key: PerkId };

export interface ElixirDef {
  /** The potion's cell id. */
  cell: number;
  effect: ElixirEffect;
  /** Frames of the effect one drunk cell gives: a brimming 13-cell bowl is 13 times this. */
  framesPerCell: number;
  /** The HUD chip: a short upper-case label and its tint. */
  chip: { label: string; tint: string };
  /** What it does, as the Grimoire says it (a clause that follows "Drinking it grants"). */
  does: string;
}

export const ELIXIRS: readonly ElixirDef[] = [
  {
    cell: Cell.ElixirLife,
    effect: { kind: 'status', key: 'regen' },
    framesPerCell: 100,
    chip: { label: 'MENDING', tint: '#fb7185' },
    does: 'wounds that knit as you walk',
  },
  {
    cell: Cell.ElixirLevity,
    effect: { kind: 'status', key: 'levity' },
    framesPerCell: 130,
    chip: { label: 'LEVITY', tint: '#67e8f9' },
    does: 'flight without the effort of it',
  },
  {
    cell: Cell.ElixirStone,
    effect: { kind: 'status', key: 'stoneskin' },
    framesPerCell: 130,
    chip: { label: 'STONE', tint: '#c4b59a' },
    does: 'half the harm from every blow, and no being shoved',
  },
];

/** Every potion cell id, as a 256-entry byte table (the sim reads it per cell). */
const ELIXIR_TABLE = new Uint8Array(256);
for (const e of ELIXIRS) ELIXIR_TABLE[e.cell] = 1;

/** Is `t` a potion cell (a product of the cauldron, never an ingredient)? */
export function isElixirCell(t: number): boolean {
  return ELIXIR_TABLE[t] === 1;
}

const BY_CELL = new Map<number, ElixirDef>(ELIXIRS.map((e) => [e.cell, e]));

export function elixirDef(cell: number): ElixirDef | undefined {
  return BY_CELL.get(cell);
}

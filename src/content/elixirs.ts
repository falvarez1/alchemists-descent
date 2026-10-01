import type { EntityStatus, PerkId, PotionStatusKey } from '@/core/types';
import { Cell, isElixir } from '@/sim/CellType';

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

export type ElixirEffect =
  | { kind: 'status'; key: PotionStatusKey }
  | { kind: 'boon'; key: PerkId };

export interface ElixirDef {
  /** The potion's cell id. */
  cell: number;
  effect: ElixirEffect;
  /** A second effect the same cell carries (it takes the same frames, and its timer counts down beside the first). */
  also?: ElixirEffect;
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
    chip: { label: 'STONESKIN', tint: '#c4b59a' },
    does: 'half the harm from every blow, and no being shoved',
  },
  {
    cell: Cell.ElixirSwift,
    effect: { kind: 'status', key: 'swift' },
    framesPerCell: 200,
    also: { kind: 'boon', key: 'manafont' },
    chip: { label: 'SWIFT', tint: '#e0903a' },
    does: 'a step half again as quick, a higher leap, and a wand that refills its mana 60% faster',
  },
  {
    cell: Cell.ElixirTorch,
    effect: { kind: 'status', key: 'torch' },
    framesPerCell: 250,
    chip: { label: 'LAMPLIGHT', tint: '#d6f27a' },
    does: 'a brighter, steadier wand light',
  },
  {
    cell: Cell.ElixirFire,
    effect: { kind: 'boon', key: 'flameward' },
    framesPerCell: 180,
    chip: { label: 'FIREPROOF', tint: '#ff8a3a' },
    does: 'fire and lava that bite far less, and no catching alight',
  },
  {
    cell: Cell.ElixirFrost,
    effect: { kind: 'boon', key: 'warmblood' },
    framesPerCell: 180,
    chip: { label: 'FROSTPROOF', tint: '#9ae8d6' },
    does: 'cold that reaches you half as fast',
  },
  {
    cell: Cell.ElixirShock,
    effect: { kind: 'boon', key: 'grounded' },
    framesPerCell: 180,
    chip: { label: 'INSULATED', tint: '#4aa6c8' },
    does: 'a current that deals a quarter of its harm',
  },
  {
    cell: Cell.ElixirToxin,
    effect: { kind: 'boon', key: 'toxinward' },
    framesPerCell: 180,
    chip: { label: 'ANTIDOTE', tint: '#6fae8a' },
    does: 'acid and toxic sludge that deal a quarter of their harm',
  },
  {
    cell: Cell.ElixirMight,
    effect: { kind: 'boon', key: 'might' },
    framesPerCell: 130,
    chip: { label: 'BRIMSTONE', tint: '#ecd23a' },
    does: 'a quarter more damage from every spell',
  },
  {
    cell: Cell.ElixirVampire,
    effect: { kind: 'boon', key: 'vampirism' },
    framesPerCell: 200,
    chip: { label: 'HEARTWINE', tint: '#c2417f' },
    does: 'two hit points back from every creature you kill',
  },
  {
    cell: Cell.ElixirHush,
    effect: { kind: 'boon', key: 'velvethood' },
    framesPerCell: 200,
    chip: { label: 'HUSHED', tint: '#a79fd8' },
    does: 'a lantern hood that hides you in half-dark, as in full dark',
  },
];

/** Is `t` a potion cell (a product of the cauldron, never an ingredient)? */
export function isElixirCell(t: number): boolean {
  return isElixir(t);
}

const BY_CELL = new Map<number, ElixirDef>(ELIXIRS.map((e) => [e.cell, e]));

export function elixirDef(cell: number): ElixirDef | undefined {
  return BY_CELL.get(cell);
}

/** Frames left of an effect on a body. */
export function effectFrames(status: EntityStatus, effect: ElixirEffect): number {
  return effect.kind === 'status' ? status[effect.key] : status.boons?.[effect.key] ?? 0;
}

/**
 * Add `frames` to an effect, never past the shared cap. Returns the frames actually added
 * (0 when the cup is already full: a drink refuses rather than wasting the cell).
 */
export function addEffectFrames(status: EntityStatus, effect: ElixirEffect, frames: number): number {
  const have = effectFrames(status, effect);
  const next = Math.min(POTION_CAP_FRAMES, have + frames);
  if (effect.kind === 'status') status[effect.key] = next;
  else (status.boons ??= {})[effect.key] = next;
  return next - have;
}

/** Load a drunk cell of `def` onto a body: its effect, and its second one, each under the shared cap. Returns the frames the first took (0 = the cup is full). */
export function addElixirFrames(status: EntityStatus, def: ElixirDef, frames: number): number {
  const took = addEffectFrames(status, def.effect, frames);
  if (def.also) addEffectFrames(status, def.also, frames);
  return took;
}

/** Add to one of the numeric status timers under the shared cap (loot potions, the Sanctum's brew, the bench's tiles). */
export function addStatusFrames(status: EntityStatus, key: PotionStatusKey, frames: number): void {
  status[key] = Math.min(POTION_CAP_FRAMES, status[key] + frames);
}

export interface PotionTimer {
  def: ElixirDef;
  frames: number;
}

/** The potions working on a body right now, one per effect, in the table's order (the HUD's chips). */
export function activePotions(status: EntityStatus): PotionTimer[] {
  const out: PotionTimer[] = [];
  for (const def of ELIXIRS) {
    const frames = effectFrames(status, def.effect);
    if (frames > 0) out.push({ def, frames });
  }
  return out;
}

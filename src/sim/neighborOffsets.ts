/**
 * Shared neighbor-offset tables for the cellular-automata element handlers.
 *
 * These tables were copy-pasted byte-for-byte across several element files
 * (liquids/thermal/powders). They are LOAD-BEARING port constants (invariant 4):
 * both the VALUES and the ORDER are preserved exactly from the original
 * noita-sandbox.html. Centralizing them here documents the one deliberate
 * asymmetry in a single place so it can never be "fixed back" to symmetric in
 * one copy while the others stay asymmetric.
 *
 * Keep these two tables SEPARATE — do not merge the asymmetric ignition list
 * into the symmetric cardinal list. newMaterials.ts intentionally keeps its own
 * distinctly-ordered CARDINAL_DIRS / FUNGUS_DIRS tables (a random index into
 * them selects a direction, so their order is RNG-load-bearing too).
 */

/** The four symmetric cardinal neighbors (right, left, down, up). */
export const CARDINAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Fire/ignition reaction neighbors. Deliberately ASYMMETRIC: the fourth entry
 * is the up-LEFT diagonal `[-1, -1]` (not the `[0, -1]` straight-up of the
 * cardinal list). Preserved verbatim from the original port — do not change.
 */
export const IGNITION_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [-1, -1],
];

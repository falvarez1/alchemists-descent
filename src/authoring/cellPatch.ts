import type { World } from '@/sim/World';
import { CELL_COUNT } from '@/sim/CellType';

/**
 * A sparse cell diff: the changed cells of one authoring operation, stored as
 * parallel arrays sharing an index set.
 *
 * This was born as the Builder's undo payload (one brush stroke = one
 * `paintTerrainCmd`) and it is ALSO the AuthorLink wire format for terrain —
 * the two uses want exactly the same thing, so the shape lives here in the
 * neutral authored-contract layer rather than in Builder. `src/net` may not
 * import `src/builder` (boundary-enforced), and a stroke is small enough to
 * put straight on a socket: ~100 cells ≈ 2 KB of JSON.
 *
 * The index space is `x + y * world.width`, so a patch is only meaningful
 * against a world of the width it was captured at — {@link cellPatchBounds}
 * takes the width explicitly for that reason.
 */
export interface CellPatch {
  idxs: number[];
  types: number[];
  colors: number[];
  life: number[];
  charge: number[];
}

export interface CellPatchBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function createCellPatch(): CellPatch {
  return { idxs: [], types: [], colors: [], life: [], charge: [] };
}

export function cellPatchSize(patch: CellPatch): number {
  return patch.idxs.length;
}

/**
 * Replay a patch into a world.
 *
 * Mirrors `paintTerrainCmd`'s apply exactly — including routing charge through
 * `setChargeAt`, which is the only sanctioned way to deposit charge (World
 * keeps a conductor bookkeeping invariant behind it). Out-of-range indices are
 * skipped rather than thrown on: a patch can arrive from another process, and
 * a malformed one must not take the frame loop down.
 *
 * Returns the number of cells actually written.
 */
export function applyCellPatch(world: World, patch: CellPatch): number {
  const limit = world.types.length;
  let written = 0;
  for (let n = 0; n < patch.idxs.length; n++) {
    const i = patch.idxs[n];
    if (!Number.isInteger(i) || i < 0 || i >= limit) continue;
    world.types[i] = patch.types[n];
    world.colors[i] = patch.colors[n];
    world.life[i] = patch.life[n];
    world.setChargeAt(i, patch.charge[n]);
    written++;
  }
  return written;
}

/** Bounding box of the touched cells, or null for an empty patch. */
export function cellPatchBounds(patch: CellPatch, width: number): CellPatchBounds | null {
  if (patch.idxs.length === 0 || width <= 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const i of patch.idxs) {
    const x = i % width;
    const y = (i - x) / width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Structural + range validation for a patch that crossed a process boundary.
 *
 * The cell-id ceiling is checked against `CELL_COUNT` because cell ids are an
 * append-only save ABI: a patch from a NEWER build can name a material this
 * build has no behavior for, and stamping that id would put an unsimulatable
 * value in the grid. Rejecting the whole patch is the honest failure.
 */
export function isValidCellPatch(value: unknown, cellLimit: number): value is CellPatch {
  if (typeof value !== 'object' || value === null) return false;
  const patch = value as Partial<CellPatch>;
  const { idxs, types, colors, life, charge } = patch;
  if (!Array.isArray(idxs) || !Array.isArray(types) || !Array.isArray(colors)) return false;
  if (!Array.isArray(life) || !Array.isArray(charge)) return false;
  const n = idxs.length;
  if (types.length !== n || colors.length !== n || life.length !== n || charge.length !== n) return false;
  for (let k = 0; k < n; k++) {
    const i = idxs[k];
    if (!Number.isInteger(i) || i < 0 || i >= cellLimit) return false;
    const t = types[k];
    if (!Number.isInteger(t) || t < 0 || t >= CELL_COUNT) return false;
    if (!Number.isFinite(colors[k]) || !Number.isFinite(life[k]) || !Number.isFinite(charge[k])) return false;
  }
  return true;
}

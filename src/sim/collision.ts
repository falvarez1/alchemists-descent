import { blocksEntity, Cell } from '@/sim/CellType';

export const LOOSE_RUBBLE_BLOCKING_CLUSTER = 5;

export interface CollisionGrid {
  width: number;
  height: number;
  types: Uint8Array;
  idx?: (x: number, y: number) => number;
}

export interface CollisionScratch {
  x: Int32Array;
  y: Int32Array;
}

const DIR8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function idxOf(grid: CollisionGrid, x: number, y: number): number {
  return grid.idx ? grid.idx(x, y) : x + y * grid.width;
}

/**
 * Runtime entity collision rule: engineered Metal always blocks. Other
 * blocking cells only block when they belong to an 8-connected cluster of at
 * least five blocking cells; smaller fragments are walk-through rubble.
 */
export function cellBlocksEntityWithLooseRubble(
  grid: CollisionGrid,
  x: number,
  y: number,
  scratch?: CollisionScratch,
): boolean {
  // Cells are integer-indexed. Entity positions can be fractional, and a
  // fractional index makes `idxOf` (x + y*width) bleed the y-fraction into the
  // column AND makes the TypedArray read return `undefined` (→ treated as empty)
  // — i.e. an entity at a fractional coord would silently fall through solid
  // terrain. Floor to the containing cell so any float query is well-defined.
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return true;
  const t = grid.types[idxOf(grid, x, y)];
  if (!blocksEntity(t)) return false;
  if (t === Cell.Metal) return true;

  const qx = scratch?.x ?? new Int32Array(24);
  const qy = scratch?.y ?? new Int32Array(24);
  qx[0] = x;
  qy[0] = y;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const cx = qx[head];
    const cy = qy[head];
    head++;
    for (const [dx, dy] of DIR8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      if (!blocksEntity(grid.types[idxOf(grid, nx, ny)])) continue;
      let dup = false;
      for (let q = 0; q < tail; q++) {
        if (qx[q] === nx && qy[q] === ny) {
          dup = true;
          break;
        }
      }
      if (dup) continue;
      qx[tail] = nx;
      qy[tail] = ny;
      tail++;
      if (tail >= LOOSE_RUBBLE_BLOCKING_CLUSTER) return true;
    }
  }
  return false;
}

/**
 * Full-grid mask for validator/worldgen erosion passes. This mirrors
 * cellBlocksEntityWithLooseRubble, but labels every connected component once
 * instead of flood-counting per queried cell.
 */
export function computeLooseRubbleBlockingMask(grid: CollisionGrid): Uint8Array {
  const W = grid.width;
  const H = grid.height;
  const len = W * H;
  const solid = new Uint8Array(len);
  const metal = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const t = grid.types[i];
    if (!blocksEntity(t)) continue;
    solid[i] = 1;
    if (t === Cell.Metal) metal[i] = 1;
  }

  const comp = new Int32Array(len);
  const areas: number[] = [0];
  const stack: number[] = [];
  for (let i0 = 0; i0 < len; i0++) {
    if (!solid[i0] || comp[i0] !== 0) continue;
    const label = areas.length;
    let area = 0;
    comp[i0] = label;
    stack.push(i0);
    while (stack.length > 0) {
      const i = stack.pop()!;
      area++;
      const x = i % W;
      const y = (i - x) / W;
      for (const [dx, dy] of DIR8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = nx + ny * W;
        if (!solid[ni] || comp[ni] !== 0) continue;
        comp[ni] = label;
        stack.push(ni);
      }
    }
    areas.push(area);
  }

  const blocks = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    if (metal[i] || (solid[i] && areas[comp[i]] >= LOOSE_RUBBLE_BLOCKING_CLUSTER)) blocks[i] = 1;
  }
  return blocks;
}

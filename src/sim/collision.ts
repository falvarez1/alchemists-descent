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
 * `blocksEntity` as a 256-entry table (1 = blocks), derived from the predicate
 * itself so new cell ids stay correct automatically. Full-grid passes read it
 * instead of calling the predicate chain once per cell.
 */
export const BLOCKS_ENTITY_LUT: Uint8Array = (() => {
  const lut = new Uint8Array(256);
  for (let t = 0; t < 256; t++) lut[t] = blocksEntity(t) ? 1 : 0;
  return lut;
})();

// Reused scratch for the component pass (never returned). The visited plane is
// cleared per call; the queue is written before it is read, so it needs no reset.
let componentVisited = new Uint8Array(0);
let componentQueue = new Int32Array(0);

/**
 * Full-grid mask for validator/worldgen erosion passes. This mirrors
 * cellBlocksEntityWithLooseRubble, but labels every connected component once
 * instead of flood-counting per queried cell.
 *
 * PERF: one typed-array BFS per 8-connected component (the queue doubles as
 * the member list), no per-component label/area arrays and no per-neighbour
 * tuple destructuring. The settled findability repair calls this up to seven
 * times in the first twelve seconds of every floor (plus worldgen's gauge
 * rescue), and the old number[]-stack version was ~120 ms of main thread per
 * call on a 1600x1064 cave. Output is identical: a cell blocks when it is
 * Metal, or when it is entity-blocking and its component has at least
 * LOOSE_RUBBLE_BLOCKING_CLUSTER cells.
 */
export function computeLooseRubbleBlockingMask(grid: CollisionGrid): Uint8Array {
  const W = grid.width;
  const len = W * grid.height;
  const types = grid.types;
  const solid = BLOCKS_ENTITY_LUT;
  if (componentVisited.length < len) {
    componentVisited = new Uint8Array(len);
    componentQueue = new Int32Array(len);
  } else componentVisited.fill(0, 0, len);
  const visited = componentVisited;
  const queue = componentQueue;
  const blocks = new Uint8Array(len);
  const lastRow = len - W;
  for (let i0 = 0; i0 < len; i0++) {
    if (visited[i0] || !solid[types[i0]]) continue;
    visited[i0] = 1;
    queue[0] = i0;
    let head = 0;
    let tail = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      const left = x > 0;
      const right = x < W - 1;
      if (i >= W) {
        const u = i - W;
        if (!visited[u] && solid[types[u]]) { visited[u] = 1; queue[tail++] = u; }
        if (left && !visited[u - 1] && solid[types[u - 1]]) { visited[u - 1] = 1; queue[tail++] = u - 1; }
        if (right && !visited[u + 1] && solid[types[u + 1]]) { visited[u + 1] = 1; queue[tail++] = u + 1; }
      }
      if (i < lastRow) {
        const d = i + W;
        if (!visited[d] && solid[types[d]]) { visited[d] = 1; queue[tail++] = d; }
        if (left && !visited[d - 1] && solid[types[d - 1]]) { visited[d - 1] = 1; queue[tail++] = d - 1; }
        if (right && !visited[d + 1] && solid[types[d + 1]]) { visited[d + 1] = 1; queue[tail++] = d + 1; }
      }
      if (left && !visited[i - 1] && solid[types[i - 1]]) { visited[i - 1] = 1; queue[tail++] = i - 1; }
      if (right && !visited[i + 1] && solid[types[i + 1]]) { visited[i + 1] = 1; queue[tail++] = i + 1; }
    }
    if (tail >= LOOSE_RUBBLE_BLOCKING_CLUSTER) {
      for (let k = 0; k < tail; k++) blocks[queue[k]] = 1;
    } else {
      for (let k = 0; k < tail; k++) if (types[queue[k]] === Cell.Metal) blocks[queue[k]] = 1;
    }
  }
  return blocks;
}

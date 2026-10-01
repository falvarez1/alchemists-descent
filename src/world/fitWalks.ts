import { HEIGHT, WIDTH } from '@/config/constants';

/**
 * The walk to everything, as generation sees it: a 4-connected flood over BODY-FIT cells
 * (validate.computeFits: a 9x17 box clear) from the spawn, with parent pointers, so a path to
 * any reached cell is a chain of positions the alchemist's body can occupy. Shared by the
 * passes that must keep off, or place things along, the route (lava lakes, route waystones).
 */
export interface FitWalks {
  /** Steps from the spawn (-1 = not reached). */
  dist: Int32Array;
  /** Parent cell index along the walk (-1 at the root). */
  prev: Int32Array;
}

export function fitWalks(fits: Uint8Array, sx: number, sy: number): FitWalks | null {
  const W = WIDTH, H = HEIGHT;
  const dist = new Int32Array(W * H).fill(-1);
  const prev = new Int32Array(W * H).fill(-1);
  const q = new Int32Array(W * H);
  let seed = -1;
  for (let r = 0; r < 60 && seed < 0; r++) {
    for (let dy = -r; dy <= r && seed < 0; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = sx + dx, y = sy + dy;
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        if (fits[x + y * W]) { seed = x + y * W; break; }
      }
    }
  }
  if (seed < 0) return null;
  let qh = 0, qt = 0;
  dist[seed] = 0;
  q[qt++] = seed;
  const bottom = (H - 1) * W;
  while (qh < qt) {
    const i = q[qh++];
    const x = i % W;
    const d = dist[i] + 1;
    if (x + 1 < W - 1 && dist[i + 1] < 0 && fits[i + 1]) { dist[i + 1] = d; prev[i + 1] = i; q[qt++] = i + 1; }
    if (x - 1 >= 1 && dist[i - 1] < 0 && fits[i - 1]) { dist[i - 1] = d; prev[i - 1] = i; q[qt++] = i - 1; }
    if (i + W < bottom && dist[i + W] < 0 && fits[i + W]) { dist[i + W] = d; prev[i + W] = i; q[qt++] = i + W; }
    if (i - W >= W && dist[i - W] < 0 && fits[i - W]) { dist[i - W] = d; prev[i - W] = i; q[qt++] = i - W; }
  }
  return { dist, prev };
}

/** Nearest reached cell to (x, y) within a small ring search, or -1. */
export function reachedNear(b: FitWalks, x: number, y: number): number {
  x = Math.floor(x);
  y = Math.floor(y);
  for (let r = 0; r <= 24; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= WIDTH || Y >= HEIGHT) continue;
        if (b.dist[X + Y * WIDTH] >= 0) return X + Y * WIDTH;
      }
    }
  }
  return -1;
}

/** The cell indices of the walk from the spawn to `cell`, spawn first. */
export function walkTo(b: FitWalks, cell: number): number[] {
  const path: number[] = [];
  for (let c = cell; c >= 0; c = b.prev[c]) path.push(c);
  return path.reverse();
}

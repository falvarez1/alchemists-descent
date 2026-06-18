// ===================== Region graph (the placement brain) =====================
// Wave C: flood-fill analysis of a generated level at 1:4 downsample
// (DESIGN.md pillar 2). The SINGLE placement authority — secrets, waystones,
// refuges, nests, puzzle locks and boss arenas all request placements from the
// graph this module extracts, so every "where" decision is explained by the
// actual cells of the level, not by generator bookkeeping.
//
// Shape of the analysis:
// - Downsampled occupancy: one analysis cell per 4x4 world block, OPEN unless
//   the block-center world cell blocks moving bodies. Liquids, gas, soft growth
//   and empty space all count as open — a flooded gallery is still a room.
// - Regions: iterative 4-connected flood fill over the open cells.
// - Edges: for every solid cell, scan the two axes up to SCAN_REACH cells each
//   way; where two different regions face each other across the solid run, the
//   pair gets an edge carrying the MINIMUM separating wall thickness (world
//   cells) and the midpoint of that thinnest wall — breachability, located.
// - Main path: BFS spawn-region -> exit-region across edges thin enough to
//   breach; small regions off that path are flagged as natural secret pockets.

import type { Region, RegionEdge, RegionGraph } from '@/core/types';
import { blocksEntity } from '@/sim/CellType';
import type { World } from '@/sim/World';

/** Downsample factor: one analysis cell covers a 4x4 world block. */
const SCALE = 4;
/** Edge scan reach (downsampled cells) each way from a solid cell. */
const SCAN_REACH = 8;
/** Open area (downsampled cells) below which an off-path region is a pocket. */
const POCKET_AREA = 220;
/** Walls at or below this thickness (WORLD cells) are breachable for main-path BFS. */
const BREACHABLE_THICKNESS = 8;
/** Outward search radius (downsampled cells) when spawn/exit lands on solid. */
const ANCHOR_SEARCH = 6;

/**
 * Body-blocking cells for region analysis. Runtime collision already treats
 * soft growth as pass-through, so vines/moss/fungus stay open here too.
 */
function isRegionSolid(t: number): boolean {
  return blocksEntity(t);
}

/**
 * Extract the region graph for a generated level: flood-fill regions, thin-wall
 * adjacency edges, spawn/exit anchors and the breachable main path between
 * them. Pure read of the world; never throws (a degenerate empty graph is
 * returned if anything goes wrong — placement falls back gracefully).
 */
export function extractRegionGraph(
  world: World,
  spawn: { x: number; y: number },
  exit: { x: number; y: number },
): RegionGraph {
  const w = Math.max(1, Math.floor(world.width / SCALE));
  const h = Math.max(1, Math.floor(world.height / SCALE));
  try {
    return extract(world, w, h, spawn, exit);
  } catch (err) {
    // Never let analysis failure take down level generation (fail-open). But a
    // throw here means a real bug in extract() (e.g. an OOB from a future edit),
    // not "this level has no regions" — surface it in DEV so it isn't masked.
    if (import.meta.env.DEV) console.error('extractRegionGraph: analysis failed', err);
    return {
      scale: SCALE,
      w,
      h,
      labels: new Int32Array(w * h).fill(-1),
      regions: [],
      edges: [],
      mainPath: [],
      spawnRegion: -1,
      exitRegion: -1,
    };
  }
}

function extract(
  world: World,
  w: number,
  h: number,
  spawn: { x: number; y: number },
  exit: { x: number; y: number },
): RegionGraph {
  // 1) Downsample + flood-fill label the open cells (iterative — the open
  //    interior of a level can be hundreds of thousands of world cells).
  const labels = new Int32Array(w * h).fill(-1);
  const open = new Uint8Array(w * h);
  for (let by = 0; by < h; by++) {
    const wy = by * SCALE + 2;
    for (let bx = 0; bx < w; bx++) {
      const wx = bx * SCALE + 2;
      if (!isRegionSolid(world.types[wx + wy * world.width])) open[bx + by * w] = 1;
    }
  }

  const regions: Region[] = [];
  const stack: number[] = [];
  for (let start = 0; start < open.length; start++) {
    if (open[start] === 0 || labels[start] !== -1) continue;
    const id = regions.length;
    let area = 0;
    let sx = 0;
    let sy = 0;
    labels[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const bx = i % w;
      const by = (i - bx) / w;
      area++;
      sx += bx;
      sy += by;
      if (bx > 0 && open[i - 1] === 1 && labels[i - 1] === -1) {
        labels[i - 1] = id;
        stack.push(i - 1);
      }
      if (bx < w - 1 && open[i + 1] === 1 && labels[i + 1] === -1) {
        labels[i + 1] = id;
        stack.push(i + 1);
      }
      if (by > 0 && open[i - w] === 1 && labels[i - w] === -1) {
        labels[i - w] = id;
        stack.push(i - w);
      }
      if (by < h - 1 && open[i + w] === 1 && labels[i + w] === -1) {
        labels[i + w] = id;
        stack.push(i + w);
      }
    }
    regions.push({
      id,
      area,
      cx: Math.round((sx / area) * SCALE + 2),
      cy: Math.round((sy / area) * SCALE + 2),
      onMainPath: false,
      isPocket: false,
    });
  }

  // 2) Adjacency edges across thin walls. From every solid cell, scan both
  //    axes up to SCAN_REACH cells each way for the first open cell; when the
  //    two sides belong to different regions, the solid run between them is a
  //    candidate wall — keep the thinnest one (and its midpoint) per pair.
  const edgeMap = new Map<number, RegionEdge>();
  const n = regions.length;
  const recordEdge = (la: number, lb: number, runLen: number, midBx: number, midBy: number): void => {
    const a = Math.min(la, lb);
    const b = Math.max(la, lb);
    const thickness = runLen * SCALE;
    const key = a * n + b;
    const prev = edgeMap.get(key);
    if (prev && prev.minWallThickness <= thickness) return;
    edgeMap.set(key, {
      a,
      b,
      minWallThickness: thickness,
      mx: Math.round(midBx * SCALE + 2),
      my: Math.round(midBy * SCALE + 2),
    });
  };

  for (let by = 0; by < h; by++) {
    for (let bx = 0; bx < w; bx++) {
      if (open[bx + by * w] === 1) continue;

      // Horizontal: first open cell left and right of this solid cell.
      let leftLabel = -1;
      let kL = 0;
      for (let k = 1; k <= SCAN_REACH && bx - k >= 0; k++) {
        const li = bx - k + by * w;
        if (open[li] === 1) {
          leftLabel = labels[li];
          kL = k;
          break;
        }
      }
      if (leftLabel >= 0) {
        for (let k = 1; k <= SCAN_REACH && bx + k < w; k++) {
          const ri = bx + k + by * w;
          if (open[ri] === 1) {
            if (labels[ri] !== leftLabel) {
              recordEdge(leftLabel, labels[ri], kL + k - 1, bx + (k - kL) / 2, by);
            }
            break;
          }
        }
      }

      // Vertical: first open cell above and below this solid cell.
      let upLabel = -1;
      let kU = 0;
      for (let k = 1; k <= SCAN_REACH && by - k >= 0; k++) {
        const ui = bx + (by - k) * w;
        if (open[ui] === 1) {
          upLabel = labels[ui];
          kU = k;
          break;
        }
      }
      if (upLabel >= 0) {
        for (let k = 1; k <= SCAN_REACH && by + k < h; k++) {
          const di = bx + (by + k) * w;
          if (open[di] === 1) {
            if (labels[di] !== upLabel) {
              recordEdge(upLabel, labels[di], kU + k - 1, bx, by + (k - kU) / 2);
            }
            break;
          }
        }
      }
    }
  }
  const edges = [...edgeMap.values()];

  // 3) Anchors + main path. Spawn/exit may land on a solid downsampled cell
  //    (a brazier base, the well plug) — search outward a little, then fall
  //    back to the largest region rather than poisoning every consumer.
  const spawnRegion = regionNear(labels, w, h, spawn.x, spawn.y, regions);
  const exitRegion = regionNear(labels, w, h, exit.x, exit.y, regions);

  let mainPath: number[];
  if (spawnRegion < 0 || exitRegion < 0) {
    mainPath = spawnRegion >= 0 ? [spawnRegion] : exitRegion >= 0 ? [exitRegion] : [];
  } else if (spawnRegion === exitRegion) {
    mainPath = [spawnRegion];
  } else {
    mainPath = breachablePath(regions.length, edges, spawnRegion, exitRegion) ?? [spawnRegion];
  }

  for (const id of mainPath) {
    const r = regions[id];
    if (r) r.onMainPath = true;
  }
  for (const r of regions) r.isPocket = r.area < POCKET_AREA && !r.onMainPath;

  return {
    scale: SCALE,
    w,
    h,
    labels,
    regions,
    edges,
    mainPath,
    spawnRegion,
    exitRegion,
  };
}

/**
 * Region label at a world position, searching outward up to ANCHOR_SEARCH
 * downsampled cells (rings of increasing Chebyshev radius) when the position
 * lands on solid. Falls back to the largest region, else -1.
 */
function regionNear(labels: Int32Array, w: number, h: number, px: number, py: number, regions: Region[]): number {
  const bx0 = Math.min(w - 1, Math.max(0, Math.floor(px / SCALE)));
  const by0 = Math.min(h - 1, Math.max(0, Math.floor(py / SCALE)));
  for (let r = 0; r <= ANCHOR_SEARCH; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const bx = bx0 + dx;
        const by = by0 + dy;
        if (bx < 0 || bx >= w || by < 0 || by >= h) continue;
        const label = labels[bx + by * w];
        if (label >= 0) return label;
      }
    }
  }
  let best = -1;
  for (const region of regions) {
    if (best === -1 || region.area > regions[best].area) best = region.id;
  }
  return best;
}

/**
 * BFS from spawn to exit across edges whose separating wall is breachable
 * (minWallThickness <= BREACHABLE_THICKNESS). Returns the region-id path, or
 * null when the exit is unreachable through thin walls.
 */
function breachablePath(regionCount: number, edges: RegionEdge[], from: number, to: number): number[] | null {
  const adj = new Map<number, number[]>();
  for (const e of edges) {
    if (e.minWallThickness > BREACHABLE_THICKNESS) continue;
    let la = adj.get(e.a);
    if (!la) adj.set(e.a, (la = []));
    la.push(e.b);
    let lb = adj.get(e.b);
    if (!lb) adj.set(e.b, (lb = []));
    lb.push(e.a);
  }

  const prev = new Int32Array(regionCount).fill(-2); // -2 = unvisited
  prev[from] = -1; // -1 = path root
  const queue: number[] = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === to) break;
    const neighbours = adj.get(cur);
    if (!neighbours) continue;
    for (const next of neighbours) {
      if (prev[next] !== -2) continue;
      prev[next] = cur;
      queue.push(next);
    }
  }
  if (prev[to] === -2) return null;

  const path: number[] = [];
  for (let cur = to; cur !== -1; cur = prev[cur]) path.push(cur);
  path.reverse();
  return path;
}

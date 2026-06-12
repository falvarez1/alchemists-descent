import { HEIGHT, WIDTH } from '@/config/constants';
import { clamp } from '@/core/math';
import type { Rng } from '@/core/rng';
import type { RegionGraph } from '@/core/types';
import { Cell } from '@/sim/CellType';
import type { World } from '@/sim/World';

/**
 * Shared carve/connect primitives for post-generation placement passes
 * (landmark structures, authored prefabs). Extracted verbatim from the
 * placeStructures closures so every pass guarantees the same thing: carved
 * content JOINS the cave network, and bedrock Metal is never breached.
 */

/** Elliptical hollow; Metal (bedrock, vault shells, well casing) survives. */
export function carvePocket(
  world: World,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue;
      const X = cx + dx,
        Y = cy + dy;
      if (X < 2 || X >= WIDTH - 2 || Y < 2 || Y >= HEIGHT - 8) continue;
      const i = world.idx(X, Y);
      if (world.types[i] !== Cell.Metal) {
        world.types[i] = Cell.Empty;
        world.colors[i] = 0x08080c;
      }
    }
  }
}

/**
 * REACHABILITY GUARANTEE: every carved structure must join the cave network.
 * Winds a 4-radius tunnel from a structure's mouth to the nearest sizable
 * open region's centroid (Metal is never breached, so vault shells and water
 * tanks survive their own approach tunnels).
 *
 * Returns the carve-step centers in walk order (first = nearest the mouth),
 * so callers can reseal part of the tunnel (sealed prefab anchors).
 */
export function connectToCaves(
  world: World,
  rng: Rng,
  graph: RegionGraph,
  fromX: number,
  fromY: number,
): Array<[number, number]> {
  const steps: Array<[number, number]> = [];
  // Target the nearest MAIN-PATH region: those form the spawn<->exit artery,
  // so the tunnel provably joins the network the player actually walks.
  // (Nearest "open area" is not enough — isolated pockets are open too.)
  let best: { cx: number; cy: number } | null = null;
  let bestD = Infinity;
  for (const onlyMain of [true, false]) {
    for (const reg of graph.regions) {
      if (onlyMain && !reg.onMainPath) continue;
      if (!onlyMain && reg.area < 60) continue;
      const d = (reg.cx - fromX) * (reg.cx - fromX) + (reg.cy - fromY) * (reg.cy - fromY);
      if (d < bestD) {
        bestD = d;
        best = { cx: reg.cx, cy: reg.cy };
      }
    }
    if (best) break;
  }
  if (!best) return steps;
  // A concave region's centroid can sit in solid rock — resolve to the
  // nearest actually-open cell so the tunnel provably touches the cave.
  let tx = Math.floor(best.cx),
    ty = Math.floor(best.cy);
  if (world.inBounds(tx, ty) && world.types[world.idx(tx, ty)] !== Cell.Empty) {
    outer: for (let r = 2; r <= 50; r += 2) {
      for (const [ddx, ddy] of [
        [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
      ]) {
        const X = tx + ddx * r,
          Y = ty + ddy * r;
        if (world.inBounds(X, Y) && world.types[world.idx(X, Y)] === Cell.Empty) {
          tx = X;
          ty = Y;
          break outer;
        }
      }
    }
  }
  let x = fromX,
    y = fromY,
    guard = 0;
  while ((Math.abs(x - tx) > 3 || Math.abs(y - ty) > 3) && guard < 900) {
    guard++;
    x += Math.sign(tx - x) * (rng.next() < 0.8 ? 1 : 0) + Math.floor((rng.next() - 0.5) * 2);
    y += Math.sign(ty - y) * (rng.next() < 0.8 ? 1 : 0);
    x = Math.floor(clamp(x, 6, WIDTH - 7));
    y = Math.floor(clamp(y, 26, HEIGHT - 12));
    carvePocket(world, x, y, 4, 4);
    steps.push([x, y]);
  }
  return steps;
}

/* ============================================================
 * Placement ledger — reserved ground the placement passes respect
 * ============================================================ */

export interface ReservedRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  label: string;
}

/**
 * Axis-aligned reservation registry threaded through the placement passes:
 * prefabs reserve their footprints; spawn / exit-well / waystones /
 * onboarding zones are pre-reserved so prefabs keep clear of them; secrets
 * and landmark structures reject candidate sites on reserved ground.
 * An EMPTY ledger is inert — every guard is a no-op, so the pre-prefab
 * pipeline behaves byte-identically when nothing reserves anything.
 */
export class PlacementLedger {
  private list: ReservedRect[] = [];

  reserve(x0: number, y0: number, x1: number, y1: number, label: string): void {
    this.list.push({
      x0: Math.min(x0, x1),
      y0: Math.min(y0, y1),
      x1: Math.max(x0, x1),
      y1: Math.max(y0, y1),
      label,
    });
  }

  intersects(x0: number, y0: number, x1: number, y1: number): boolean {
    const a0 = Math.min(x0, x1),
      a1 = Math.max(x0, x1),
      b0 = Math.min(y0, y1),
      b1 = Math.max(y0, y1);
    for (const r of this.list) {
      if (a0 <= r.x1 && a1 >= r.x0 && b0 <= r.y1 && b1 >= r.y0) return true;
    }
    return false;
  }

  rects(): ReadonlyArray<ReservedRect> {
    return this.list;
  }
}

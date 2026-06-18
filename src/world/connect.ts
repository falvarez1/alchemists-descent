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
 * Rectangular hollow; Metal survives, same bounds guard as carvePocket.
 * A RECT (not an ellipse) is the standing-room primitive: a disc of radius r
 * guarantees a 9x17 clear box only at its exact center, but a 15x20 rect
 * guarantees fitting feet across its whole middle — the gauge-rescue pass
 * carves one above a cut-off lock so the wizard provably has somewhere to
 * STAND inside the validator's check window.
 */
export function carveRect(
  world: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  for (let Y = y0; Y <= y1; Y++) {
    for (let X = x0; X <= x1; X++) {
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
 * Winds a tunnel from a structure's mouth to the nearest sizable open
 * region's centroid (Metal is never breached, so vault shells and water
 * tanks survive their own approach tunnels).
 *
 * `radius` defaults to 12: the player's collision box is 9x17 and EVERY
 * cell of it must be clear — an axis-aligned 9x17 box needs a circle of
 * radius >= 9.62 just to EXIST inside it, and the walk's jitter plus
 * diagonal runs eat the rest of the margin (radius 9 fragments into
 * disconnected fit-islands; the legacy radius-4 crawl stranded the player
 * outside his own checkpoints). Pass a smaller radius only for connections
 * that are deliberately dig-gated.
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
  radius = 12,
  fits?: Uint8Array,
  sweep?: { halfW: number; up: number; down: number },
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
  let tx = Math.floor(best.cx),
    ty = Math.floor(best.cy);
  // The centroid of a sprawling region can sit in rock OR in a box-thin
  // appendix the player cannot occupy. With a fits mask, resolve to the
  // nearest WIZARD-FIT cell — the tunnel then provably joins the network
  // where the player can actually BE.
  if (fits) {
    let fx = -1,
      fy = -1;
    outerF: for (let r = 0; r <= 90; r += 2) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const X = Math.floor(tx + Math.cos(ang) * r),
          Y = Math.floor(ty + Math.sin(ang) * r);
        if (X > 1 && Y > 1 && X < WIDTH - 1 && Y < HEIGHT - 1 && fits[X + Y * WIDTH]) {
          fx = X;
          fy = Y;
          break outerF;
        }
      }
    }
    if (fx >= 0) {
      tx = fx;
      ty = fy;
    }
  }
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
  return tunnelTo(world, rng, fromX, fromY, tx, ty, radius, sweep);
}

/** The raw tunnel walk: jittered march from (fromX, fromY) to an EXPLICIT
 *  target, carving radius-sized pockets each step (Metal survives).
 *
 *  `sweep` additionally drags a rect along the path — a GAUGE-GUARANTEED
 *  gallery. A disc chain only promises 9x17 clearance exactly on its
 *  centerline, so a thin Metal survivor (a latch pedestal) or a rock spire
 *  one row above disc reach silently severs the fits corridor. A swept rect
 *  with a flat ceiling `up` rows above the centerline lets the wizard step
 *  OVER bumps the carve must spare: feet on a 1-tall Metal pedestal still
 *  have 17 clear rows overhead. Used by the gauge-rescue pass; ordinary
 *  connectors stay disc-carved for the organic look. */
export function tunnelTo(
  world: World,
  rng: Rng,
  fromX: number,
  fromY: number,
  tx: number,
  ty: number,
  radius: number,
  sweep?: { halfW: number; up: number; down: number },
  // Lower bound on carved rows. Defaults to 26 (the old hardcoded clamp) so
  // every existing caller is byte-identical; the gauge-rescue pass passes a
  // lower value when its target sits above row 26, which the hardcoded clamp
  // would otherwise pull DOWN — producing a tunnel that never reaches it.
  minY = 26,
): Array<[number, number]> {
  const steps: Array<[number, number]> = [];
  let x = fromX,
    y = fromY,
    guard = 0;
  while ((Math.abs(x - tx) > 3 || Math.abs(y - ty) > 3) && guard < 900) {
    guard++;
    x += Math.sign(tx - x) * (rng.next() < 0.8 ? 1 : 0) + Math.floor((rng.next() - 0.5) * 2);
    y += Math.sign(ty - y) * (rng.next() < 0.8 ? 1 : 0);
    x = Math.floor(clamp(x, radius + 2, WIDTH - radius - 3));
    y = Math.floor(clamp(y, minY, HEIGHT - 12));
    carvePocket(world, x, y, radius, radius);
    if (sweep) {
      carveRect(world, x - sweep.halfW, y - sweep.up, x + sweep.halfW, y + sweep.down);
    }
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

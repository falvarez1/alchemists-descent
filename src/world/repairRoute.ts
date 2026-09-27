import type { World } from '@/sim/World';
import { BLOCKS_ENTITY_LUT } from '@/sim/collision';

/** An authored room a repair should walk through, never dig through. */
export interface RepairRoom {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Route grid pitch, in cells (the carve box is 15 wide, so a 4-cell walk overlaps). */
const STEP = 4;
/** The standing body a route node must clear: 9 wide, 17 tall (entities/physics). */
const BODY_HALF_W = 4, BODY_H = 17;
/** What a non-fitting node carves (validate.ts markRepairInterior): 15 wide, feet-20 .. feet+2. */
const CARVE_HALF_W = 7, CARVE_UP = 20, CARVE_DOWN = 2;
/** Cost of each rock cell a node's carve removes, on top of the step's 1:
 *  a fully solid node costs ~8 steps, so a route prefers existing caves and
 *  thin walls over a straight bore. */
const DIG_COST = 0.02;
/** Cost of each blocking cell of an AUTHORED ROOM a node's carve would remove.
 *  50x the dig cost: a repair walks a long way round rather than cut a puzzle
 *  room, but a room is never walled off absolutely (fail-open) — if its cells
 *  are truly the only way, the cheapest cut is taken, which is where the room
 *  is thinnest: its doorway. */
const ROOM_COST = 1;
/** A node whose body would stand in protected MECHANISM cells (a closed door,
 *  a plate): passable only as the very last resort — the carve never removes
 *  those cells, so a route through them is a route the validator re-checks. */
const PROTECTED_COST = 5000;
/** A route ends at a node this close to the target on both axes. It must be at
 *  least the grid pitch: a ±5 window can miss every node (the pitch-4 grid has
 *  none in a 3-cell gap), and the route then fell back to the straight bore
 *  through whatever lay between (D4 seed 1337: 10,723 cells, through the
 *  kiln-elevator machine room and the lava-bridge flora room). */
const GOAL = 6;

/**
 * A findability repair's route from `from` to within GOAL cells of `to`, on a
 * STEP-cell grid of standing positions. Returns the node centres (feet) in walk
 * order, or null only when the start is off the usable grid (the caller then
 * falls back to a straight bore).
 *
 * The route is the CHEAPEST one, not the straightest: a node where the body
 * already fits costs 1 and carves nothing, a node that must be dug costs 1 +
 * DIG_COST per rock cell its carve removes, and ROOM_COST per cell that belongs
 * to one of `rooms` (flora puzzle rooms, light puzzles, machine prefabs, boss
 * arenas — the placements whose cells ARE the puzzle). The settled repair used
 * to bore a 15-wide tunnel straight from the spawn to the cut-off lock; on D4
 * seed 3 that line crossed the flora lava-bridge room after arrival and cut
 * its tree in two.
 */
export function protectedRepairRoute(
  world: World, protectedCells: Uint8Array,
  from: { x: number; y: number }, to: { x: number; y: number },
  rooms: readonly RepairRoom[] = [],
): Array<{ x: number; y: number }> | null {
  const W = world.width, H = world.height, types = world.types, blocks = BLOCKS_ENTITY_LUT;
  const columns = Math.ceil(W / STEP), rows = Math.ceil(H / STEP), count = columns * rows;
  // Per node: 0 unknown, else cost + 1 (Float32: cost is fractional); -1 closed.
  const nodeCost = new Float32Array(count);
  const closed = new Uint8Array(count);
  const scores = new Float64Array(count).fill(Infinity);
  const parents = new Int32Array(count).fill(-1);
  const heapIds: number[] = [], heapScores: number[] = [];
  const point = (id: number) => ({ x: (id % columns) * STEP + 2, y: Math.floor(id / columns) * STEP + 2 });
  const inRoom = (x: number, y: number): boolean => {
    for (const r of rooms) if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return true;
    return false;
  };
  /** What stepping onto node `id` costs; Infinity only off the usable grid. */
  const costOf = (id: number): number => {
    const cached = nodeCost[id];
    if (cached !== 0) return cached < 0 ? Infinity : cached - 1;
    const { x, y } = point(id);
    if (x < BODY_HALF_W + 1 || x + BODY_HALF_W + 1 >= W || y < BODY_H + 1 || y >= H - 2) { nodeCost[id] = -1; return Infinity; }
    let fits = true, guarded = false;
    for (let py = y - BODY_H + 1; py <= y; py++) {
      const row = py * W;
      for (let px = x - BODY_HALF_W; px <= x + BODY_HALF_W; px++) {
        const i = row + px;
        if (!blocks[types[i]]) continue;
        if (protectedCells[i]) guarded = true;
        fits = false;
      }
    }
    let cost = guarded ? PROTECTED_COST : 1;
    if (!fits) {
      // The carve this node will need: rock is cheap, a room's cells are dear.
      const touchesRoom = rooms.length > 0 && rooms.some((r) =>
        x + CARVE_HALF_W >= r.x0 && x - CARVE_HALF_W <= r.x1 && y + CARVE_DOWN >= r.y0 && y - CARVE_UP <= r.y1);
      for (let py = Math.max(1, y - CARVE_UP); py <= Math.min(H - 2, y + CARVE_DOWN); py++) {
        const row = py * W;
        for (let px = Math.max(1, x - CARVE_HALF_W); px <= Math.min(W - 2, x + CARVE_HALF_W); px++) {
          const i = row + px;
          if (!blocks[types[i]] || protectedCells[i]) continue;
          cost += touchesRoom && inRoom(px, py) ? ROOM_COST : DIG_COST;
        }
      }
    }
    nodeCost[id] = cost + 1;
    return cost;
  };
  const push = (id: number, score: number): void => {
    let at = heapIds.length; heapIds.push(id); heapScores.push(score);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (heapScores[parent] <= score) break;
      heapIds[at] = heapIds[parent]; heapScores[at] = heapScores[parent]; at = parent;
    }
    heapIds[at] = id; heapScores[at] = score;
  };
  const pop = (): number => {
    const result = heapIds[0], id = heapIds.pop()!, score = heapScores.pop()!;
    if (heapIds.length === 0) return result;
    let at = 0;
    while (at * 2 + 1 < heapIds.length) {
      let child = at * 2 + 1;
      if (child + 1 < heapIds.length && heapScores[child + 1] < heapScores[child]) child++;
      if (heapScores[child] >= score) break;
      heapIds[at] = heapIds[child]; heapScores[at] = heapScores[child]; at = child;
    }
    heapIds[at] = id; heapScores[at] = score; return result;
  };
  // Admissible: every step costs at least 1.
  const heuristic = (id: number): number => {
    const p = point(id);
    return Math.max(0, Math.abs(p.x - to.x) - GOAL) / STEP + Math.max(0, Math.abs(p.y - to.y) - GOAL) / STEP;
  };
  const start = Math.max(0, Math.min(columns - 1, Math.round((from.x - 2) / STEP))) +
    Math.max(0, Math.min(rows - 1, Math.round((from.y - 2) / STEP))) * columns;
  if (!Number.isFinite(costOf(start))) return null;
  scores[start] = 0; push(start, heuristic(start));
  while (heapIds.length) {
    const id = pop();
    if (closed[id]) continue;
    closed[id] = 1;
    const p = point(id);
    if (Math.abs(p.x - to.x) <= GOAL && Math.abs(p.y - to.y) <= GOAL) {
      const path = [p];
      for (let parent = parents[id]; parent >= 0; parent = parents[parent]) path.push(point(parent));
      path.reverse(); return path;
    }
    const column = id % columns, row = Math.floor(id / columns);
    for (const next of [column > 0 ? id - 1 : -1, column + 1 < columns ? id + 1 : -1, row > 0 ? id - columns : -1, row + 1 < rows ? id + columns : -1]) {
      if (next < 0 || closed[next]) continue;
      const step = costOf(next);
      if (!Number.isFinite(step)) continue;
      const score = scores[id] + step;
      if (score >= scores[next]) continue;
      scores[next] = score; parents[next] = id;
      push(next, score + heuristic(next));
    }
  }
  return null;
}

/** Does the body stand clear at feet (x, y)? (A route node that needs no carving.) */
export function bodyFitsAt(world: World, x: number, y: number): boolean {
  const W = world.width, types = world.types, blocks = BLOCKS_ENTITY_LUT;
  if (x < BODY_HALF_W || x + BODY_HALF_W >= W || y - BODY_H + 1 < 0 || y >= world.height) return false;
  for (let py = y - BODY_H + 1; py <= y; py++) {
    const row = py * W;
    for (let px = x - BODY_HALF_W; px <= x + BODY_HALF_W; px++) if (blocks[types[row + px]]) return false;
  }
  return true;
}

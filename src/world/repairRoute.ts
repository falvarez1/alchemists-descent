import type { World } from '@/sim/World';
import { blocksEntity } from '@/sim/CellType';

/** A repair may excavate ordinary terrain, but must route a standing body
 * around the closed gates and machinery it is trying to make usable. */
export function protectedRepairRoute(
  world: World, protectedCells: Uint8Array,
  from: { x: number; y: number }, to: { x: number; y: number },
): Array<{ x: number; y: number }> | null {
  const step = 4, columns = Math.ceil(world.width / step), rows = Math.ceil(world.height / step);
  const count = columns * rows, passable = new Uint8Array(count), closed = new Uint8Array(count);
  const scores = new Int32Array(count).fill(0x7fffffff), parents = new Int32Array(count).fill(-1);
  const heapIds: number[] = [], heapScores: number[] = [];
  const point = (id: number) => ({ x: (id % columns) * step + 2, y: Math.floor(id / columns) * step + 2 });
  const fits = (id: number): boolean => {
    if (passable[id]) return passable[id] === 1;
    const { x, y } = point(id);
    if (x < 5 || x + 5 >= world.width || y < 18 || y >= world.height - 2) { passable[id] = 2; return false; }
    for (let py = y - 16; py <= y; py++) for (let px = x - 4; px <= x + 4; px++) {
      const i = px + py * world.width;
      if (protectedCells[i] && blocksEntity(world.types[i])) { passable[id] = 2; return false; }
    }
    passable[id] = 1; return true;
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
  const heuristic = (id: number): number => {
    const p = point(id);
    return Math.max(0, Math.abs(p.x - to.x) - 5) / step + Math.max(0, Math.abs(p.y - to.y) - 5) / step;
  };
  const start = Math.max(0, Math.min(columns - 1, Math.round((from.x - 2) / step))) +
    Math.max(0, Math.min(rows - 1, Math.round((from.y - 2) / step))) * columns;
  if (!fits(start)) return null;
  scores[start] = 0; push(start, heuristic(start));
  for (let visited = 0; heapIds.length && visited < count; visited++) {
    const id = pop();
    if (closed[id]) continue;
    closed[id] = 1;
    const p = point(id);
    if (Math.abs(p.x - to.x) <= 5 && Math.abs(p.y - to.y) <= 5) {
      const path = [p];
      for (let parent = parents[id]; parent >= 0; parent = parents[parent]) path.push(point(parent));
      path.reverse(); return path;
    }
    const column = id % columns, row = Math.floor(id / columns);
    for (const next of [column > 0 ? id - 1 : -1, column + 1 < columns ? id + 1 : -1, row > 0 ? id - columns : -1, row + 1 < rows ? id + columns : -1]) {
      if (next < 0 || closed[next] || scores[next] <= scores[id] + 1 || !fits(next)) continue;
      scores[next] = scores[id] + 1; parents[next] = id;
      push(next, scores[next] + heuristic(next));
    }
  }
  return null;
}
